/**
 * mmx CLI 后端：spawn 本地 `mmx vision describe` 并解析 JSON 结果。
 *
 * 关键工程点：
 * - Windows 上 npm 全局安装的 mmx 是 .ps1/.cmd shim，Node 的 spawn 出于安全
 *   策略不能直接执行；这里解析出 mmx-cli 包的 JS 入口，用 `node <入口>`
 *   直调，完全绕开 shell 与引号转义问题（提示词是自由文本）。
 * - 附件引用的字节落到临时文件（mmx 只接受路径或 URL），调用后清理。
 * - http(s) URL 直接透传给 mmx（它自己下载）；本地路径校验存在性与字节上限。
 * - 保留原 describe-image 的短时语义缓存（同图同提示词不重复调用）。
 *
 * mmx 输出格式（--output json）：
 *   { "content": "…", "base_resp": { "status_code": 0, "status_msg": "success" } }
 * @module dsh-mmx-vision/mmx-client
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { attachmentRefById } from './attach-routes.js'
import { extensionOf, isImageMimeType, sniffMimeType } from './media.js'

/** 一次已解析的图像输入。 */
const ATTACHMENT_REF_GUIDANCE =
  'mmx-vision: image is not a valid attachment reference; copy the exact JSON from the [image attachment …] note'

function asRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value
}

function isPositiveSafeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function nonEmptyString(record, key) {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 校验并收窄模型给的附件引用 JSON。 */
export function parseImageAttachmentRef(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(ATTACHMENT_REF_GUIDANCE)
  }
  const record = asRecord(parsed)
  if (record === undefined) throw new Error(ATTACHMENT_REF_GUIDANCE)
  const attachmentId = nonEmptyString(record, 'attachmentId')
  const mediaType = record['mediaType']
  const bytes = record['bytes']
  const width = record['width']
  const height = record['height']
  const name = record['name']
  if (
    attachmentId === undefined || !isImageMimeType(mediaType)
    || !isPositiveSafeInteger(bytes) || !isPositiveSafeInteger(width) || !isPositiveSafeInteger(height)
    || (name !== undefined && typeof name !== 'string')
  ) {
    throw new Error(ATTACHMENT_REF_GUIDANCE)
  }
  return { attachmentId, mediaType, bytes, width, height, ...(name === undefined ? {} : { name }) }
}

/** 从附件存储读取已验证的字节。 */
async function readAttachmentBytes(ctx, ref, signal) {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('mmx-vision: no attachment service is mounted; pass a file path or URL instead')
  }
  try {
    const stored = await attachments.readImage(ref, signal)
    return Buffer.from(stored.data)
  } catch (error) {
    if (asRecord(error)?.['code'] === 'ATTACHMENT_NOT_FOUND') {
      throw new Error(`mmx-vision: attachment ${JSON.stringify(ref.attachmentId)} is no longer available`)
    }
    throw error
  }
}

/**
 * 解析图像输入为 mmx 可用的形式（本地路径 / URL / 临时文件）。
 * @param ctx - 插件上下文（附件服务可选）。
 * @param input - 模型给的图像引用。
 * @param signal - 取消信号。
 * @param maxBytes - 字节上限。
 */
export async function resolveImage(ctx, input, signal, maxBytes) {
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new Error('mmx-vision: image must be a non-empty path, URL, or attachment reference')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error('mmx-vision: only http(s) URLs, local file paths, and attachment references are supported')
  }

  // 附件引用 JSON：读字节 → 临时文件
  if (trimmed.startsWith('{')) {
    const ref = parseImageAttachmentRef(trimmed)
    const bytes = await readAttachmentBytes(ctx, ref, signal)
    if (bytes.length > maxBytes) {
      throw new Error(`mmx-vision: image is ${bytes.length} bytes, above the ${maxBytes}-byte bound`)
    }
    const mimeType = sniffMimeType(bytes) ?? ref.mediaType
    const temp = await writeTempImage(bytes, mimeType)
    return { source: temp.path, mimeType, bytes: bytes.length, cleanup: temp.cleanup }
  }

  // http(s) URL：直接透传给 mmx（它自己下载并 base64）
  if (/^https?:\/\//i.test(trimmed)) {
    return { source: trimmed, mimeType: undefined, bytes: 0, cleanup: undefined }
  }

  // 裸附件 id（模型从 markdown 引用里抄出来的 sha256:…）
  const registered = attachmentRefById(trimmed)
  if (registered !== undefined) {
    const ref = parseImageAttachmentRef(JSON.stringify(registered))
    const bytes = await readAttachmentBytes(ctx, ref, signal)
    if (bytes.length > maxBytes) {
      throw new Error(`mmx-vision: image is ${bytes.length} bytes, above the ${maxBytes}-byte bound`)
    }
    const mimeType = sniffMimeType(bytes) ?? ref.mediaType
    const temp = await writeTempImage(bytes, mimeType)
    return { source: temp.path, mimeType, bytes: bytes.length, cleanup: temp.cleanup }
  }

  // 本地路径：校验存在性、字节上限、类型
  const info = await stat(trimmed, { bigint: false })
  if (!info.isFile()) throw new Error(`mmx-vision: image path is not a file: ${trimmed}`)
  if (info.size > maxBytes) {
    throw new Error(`mmx-vision: image is ${info.size} bytes, above the ${maxBytes}-byte bound`)
  }
  const bytes = await readFile(trimmed, { signal })
  const mimeType = sniffMimeType(bytes)
  if (mimeType === undefined) {
    throw new Error(`mmx-vision: unsupported image type (expected PNG, JPEG, GIF, or WebP): ${trimmed}`)
  }
  return { source: trimmed, mimeType, bytes: bytes.length, cleanup: undefined }
}

/** 把字节落到临时文件，返回路径与清理句柄。 */
async function writeTempImage(bytes, mimeType) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mmx-vision-'))
  const path = join(dir, `${randomUUID()}.${extensionOf(mimeType)}`)
  await writeFile(path, bytes)
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------------------
// mmx CLI 入口解析
// ---------------------------------------------------------------------------

/**
 * 解析 mmx-cli 的 JS 入口（用 node 直调）。
 * 查找顺序：显式 mmxPath → 常见全局 node_modules 位置。
 * @param explicitPath - 配置的 mmxPath（包目录或 bin JS 或可执行文件）。
 * @returns node 直调参数，或 undefined（找不到时回退 shell 调用）。
 */
export function resolveMmxEntry(explicitPath) {
  const candidates = []
  if (typeof explicitPath === 'string' && explicitPath.trim() !== '') {
    const p = explicitPath.trim()
    candidates.push(p)
    candidates.push(join(p, 'bin', 'mmx.js'), join(p, 'bin', 'mmx.mjs'), join(p, 'dist', 'mmx.js'))
    // 也可能是 bin JSON 声明里的其它名字——由 readPackageBin 兜底
    candidates.push(join(p, 'node_modules', 'mmx-cli'))
  }
  const env = globalThis.process?.env ?? {}
  if (env.APPDATA !== undefined) candidates.push(join(env.APPDATA, 'npm', 'node_modules', 'mmx-cli'))
  if (env.NVM_HOME !== undefined) candidates.push(join(env.NVM_HOME, 'node_modules', 'mmx-cli'))
  candidates.push('/usr/local/lib/node_modules/mmx-cli', '/usr/lib/node_modules/mmx-cli')
  candidates.push(join(env.HOME ?? '', '.npm-global', 'lib', 'node_modules', 'mmx-cli'))
  candidates.push(join(env.HOME ?? '', '.local', 'lib', 'node_modules', 'mmx-cli'))

  for (const candidate of candidates) {
    const entry = readPackageBin(candidate)
    if (entry !== undefined) return { packageDir: candidate, entry }
    // 直接给了一个 JS 文件
    if (candidate.endsWith('.js') || candidate.endsWith('.mjs') || candidate.endsWith('.cjs')) {
      if (existsSync(candidate)) return { packageDir: undefined, entry: resolve(candidate) }
    }
  }
  return undefined
}

/** 读包目录 package.json 的 bin 字段，返回 JS 入口绝对路径。 */
function readPackageBin(packageDir) {
  if (typeof packageDir !== 'string' || packageDir === '') return undefined
  try {
    const manifestPath = join(packageDir, 'package.json')
    if (!existsSync(manifestPath)) return undefined
    const manifest = JSON.parse(readFileSyncUtf8(manifestPath))
    if (manifest?.name !== undefined && manifest.name !== 'mmx-cli') {
      // 显式路径下允许指向任意包（只要 bin 存在）；全局候选严格要求 mmx-cli
      if (packageDir.includes('mmx-cli') === false) return undefined
    }
    const bin = manifest.bin
    let binPath
    if (typeof bin === 'string') binPath = bin
    else if (typeof bin === 'object' && bin !== null) binPath = bin.mmx ?? Object.values(bin)[0]
    if (typeof binPath !== 'string' || binPath === '') return undefined
    const entry = resolve(packageDir, binPath)
    if (!existsSync(entry)) return undefined
    return entry
  } catch {
    return undefined
  }
}

/** 同步读文本（避免引入 node:fs 的 readFileSync 顶层绑定失败场景）。 */
function readFileSyncUtf8(path) {
  // eslint-disable-next-line no-undef
  const fs = globalThis.process?.getBuiltinModule?.('node:fs')
  if (fs === undefined) throw new Error('fs unavailable')
  return fs.readFileSync(path, 'utf8')
}

/**
 * 探测 PATH 上的 mmx 可执行 shim（.cmd/.ps1/.exe 或无后缀）。
 * 覆盖「mmx 不在常规全局 node_modules、但在 PATH 上」的安装方式
 * （此时 runMmx 走 shell 回退仍可调用）。
 * @returns 命中文件的绝对路径，或 undefined。
 */
export function mmxBinaryOnPath() {
  const env = globalThis.process?.env ?? {}
  const pathValue = typeof env.PATH === 'string' ? env.PATH : ''
  if (pathValue === '') return undefined
  const isWindows = globalThis.process?.platform === 'win32'
  const names = isWindows ? ['mmx.cmd', 'mmx.ps1', 'mmx.exe', 'mmx'] : ['mmx']
  for (const dir of pathValue.split(delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        // 单个目录不可读不影响其余探测
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 语义缓存（移植自 describe-image）
// ---------------------------------------------------------------------------

/** 默认缓存 TTL（毫秒）。 */
export const DEFAULT_CACHE_TTL_MS = 10_000
/** 默认缓存容量。 */
export const DEFAULT_CACHE_MAX_ENTRIES = 32

/** TTL + 容量受限的答案缓存。 */
export function createVisionCache(options) {
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS
  const maxEntries = Math.max(1, options?.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES)
  const entries = new Map()
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key)
        return undefined
      }
      return entry.text
    },
    set(key, text) {
      const now = Date.now()
      for (const [k, entry] of entries) if (entry.expiresAt <= now) entries.delete(k)
      entries.set(key, { text, expiresAt: now + ttlMs })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    get size() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// mmx 调用
// ---------------------------------------------------------------------------

/** 从 mmx 的 JSON 输出提取 content，校验 base_resp。 */
export function extractMmxContent(payload) {
  const record = asRecord(payload)
  const content = record?.['content']
  const baseResp = asRecord(record?.['base_resp'])
  const statusCode = baseResp?.['status_code']
  if (typeof statusCode === 'number' && statusCode !== 0) {
    const statusMsg = baseResp?.['status_msg']
    throw new Error(`mmx-vision: mmx reported status_code ${statusCode}: ${typeof statusMsg === 'string' ? statusMsg : 'unknown error'}`)
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('mmx-vision: mmx returned no text content')
  }
  return content
}

/**
 * 调用 mmx vision describe。
 * @param spec - 已解析配置（mmxPath、timeoutMs）。
 * @param prompt - 图像理解指令。
 * @param image - 已解析的图像输入。
 * @param signal - 取消信号。
 * @param cache - 可选语义缓存。
 * @returns 模型的文本回答。
 */
export async function callMmxVision(spec, prompt, image, signal, cache) {
  const cacheKey = JSON.stringify([image.source, image.bytes, prompt])
  if (cache !== undefined) {
    const cached = cache.get(cacheKey)
    if (cached !== undefined) return cached
  }
  try {
    const stdout = await runMmx(spec, ['vision', 'describe', '--image', image.source, '--prompt', prompt], signal)
    let payload
    try {
      // mmx 可能在 JSON 前打印 banner/日志行；取最后一个完整 JSON 对象
      payload = extractTrailingJson(stdout)
    } catch {
      throw new Error(`mmx-vision: mmx returned invalid JSON: ${stdout.slice(0, 200)}`)
    }
    const text = extractMmxContent(payload)
    if (cache !== undefined) cache.set(cacheKey, text)
    return text
  } finally {
    if (image.cleanup !== undefined) await image.cleanup().catch(() => {})
  }
}

/** 从输出里提取最后一个完整 JSON 对象（容忍前置 banner 行）。 */
function extractTrailingJson(stdout) {
  const text = stdout.trim()
  const direct = tryParse(text)
  if (direct !== undefined) return direct
  // 从每个 '{' 位置尝试解析，取最后一个成功的
  let best
  for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
    const parsed = tryParse(text.slice(i))
    if (parsed !== undefined) best = parsed
  }
  if (best !== undefined) return best
  throw new Error('no JSON object in output')
}

function tryParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** mmx CLI 缺失时的可操作指引（无 MiniMax 订阅的用户会走到这里）。 */
const MMX_MISSING_GUIDANCE =
  'mmx-vision: 找不到 mmx CLI。本插件以本地 mmx（MiniMax VLM）作为图像理解后端，'
  + '需要：1) npm install -g mmx-cli；2) 运行 mmx login 登录（需要 MiniMax 账号/订阅）。'
  + '若没有 MiniMax 订阅：请卸载本插件（dsh plugin remove dsh-mmx-vision）并删除 profile '
  + 'cordis.patch.yml 里 describe-image 的禁用条目，即可恢复原版 describe_image（走主模型自带视觉能力）。'

/** 判断错误/输出是否为「mmx 不存在」。 */
function looksLikeMmxMissing(error, stderr) {
  if (error?.code === 'ENOENT') return true
  return /not recognized|command not found|无法找到|不是内部或外部命令/i.test(String(stderr ?? ''))
}

/**
 * 执行一次 mmx 命令：优先 node 直调 JS 入口，回退 shell 执行。
 * 输出上限 1 MiB；stderr 摘录 400 字符进错误信息。
 */
async function runMmx(spec, args, signal) {
  const command = resolveMmxCommand(spec)
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = command.shell
      ? spawn(command.command, [...command.prefix, ...args], {
          shell: true,
          windowsHide: true,
        })
      : spawn(command.command, [...command.prefix, ...args], {
          windowsHide: true,
        })
    let stdout = ''
    let stderr = ''
    let settled = false
    const cap = 1024 * 1024
    child.stdout.on('data', (chunk) => {
      if (stdout.length < cap) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString('utf8')
    })
    // 资源清理约定：所有 settle 路径（超时/abort/error/close）都要
    // clearTimeout + removeEventListener，防止监听器与定时器句柄残留
    // （闭包持有 child/stdout/stderr，长信号上会累积）。
    const onAbort = () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        child.kill()
        rejectPromise(new Error('mmx-vision: aborted'))
      }
    }
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        signal?.removeEventListener('abort', onAbort)
        child.kill()
        rejectPromise(new Error(`mmx-vision: mmx timed out after ${spec.timeoutMs} ms`))
      }
    }, spec.timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      rejectPromise(new Error(
        looksLikeMmxMissing(error, '') ? MMX_MISSING_GUIDANCE : `mmx-vision: failed to start mmx: ${error.message}`,
      ))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) {
        resolvePromise(stdout)
      } else if (looksLikeMmxMissing(undefined, stderr)) {
        rejectPromise(new Error(MMX_MISSING_GUIDANCE))
      } else {
        rejectPromise(new Error(`mmx-vision: mmx exited with code ${code}: ${stderr.slice(0, 400)}`))
      }
    })
  })
}

/** 解析调用方式：node 直调（首选）或 shell 执行 mmx（回退）。 */
function resolveMmxCommand(spec) {
  const resolved = resolveMmxEntry(spec.mmxPath)
  if (resolved !== undefined) {
    return { command: globalThis.process?.execPath ?? 'node', prefix: [resolved.entry], shell: false }
  }
  // 回退：shell 执行 mmx（PATH 上的 .ps1/.cmd shim；参数经 shell 会有转义
  // 风险，仅在找不到 JS 入口时使用）
  const executable = typeof spec.mmxPath === 'string' && spec.mmxPath.trim() !== '' ? spec.mmxPath.trim() : 'mmx'
  return { command: executable, prefix: [], shell: true }
}

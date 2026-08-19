/**
 * DSH 运行时管理器：
 * - Node.js 运行时：优先系统 Node（PATH/常见安装位扫描）；不可用时从镜像下载
 *   官方 node-vX-win-x64.zip 到 userData/runtimes 解压使用（避免与 Electron 的
 *   Node ABI 冲突——dsh 依赖 node-pty 等 NAN 原生模块）。
 * - dsh 本体：npm install @deepseek-ai/dsh 到 userData/dsh-runtime（registry
 *   官方→npmmirror 自动回退），启动时比对最新版本自动升级。
 * - 服务器生命周期：spawn `node dsh/bin.js web --port <free>`，stdout/stderr 落盘
 *   日志轮询 `dsh web: <url>` 就绪行 + HTTP 探测双保险。
 * - 所有子进程 stdio 一律重定向到文件（不用 pipe）：兼容受限执行环境，且天然
 *   留存安装/服务日志便于排查。
 * @module dsh-desktop/runtime
 */

const { spawn } = require('node:child_process')
const { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const fs = require('node:fs/promises')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const os = require('node:os')

/** dsh 运行时与配置的根目录（Electron userData）。 */
let dataDir = ''

/** 各路径。 */
function paths() {
  return {
    runtimes: path.join(dataDir, 'runtimes'),
    dshRuntime: path.join(dataDir, 'dsh-runtime'),
    logs: path.join(dataDir, 'logs'),
    tmp: path.join(dataDir, 'tmp'),
    nodeExe: nodeExePath(),
    dshEntry: path.join(dataDir, 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    state: path.join(dataDir, 'runtime-state.json'),
  }
}

/** 当前固定的 Node 大版本（下载兜底时用；优先复用系统 Node）。 */
const NODE_MAJOR = 24

/** 下载兜底时按序尝试的镜像（nodejs.org 官方 + npmmirror，国内网络友好）。 */
const NODE_DIST_MIRRORS = [
  'https://nodejs.org/dist',
  'https://cdn.npmmirror.com/binaries/node',
]

/** 下载兜底时按序尝试的候选版本（首个 HEAD 200 者生效）。 */
const NODE_FALLBACK_VERSIONS = ['v24.14.1', 'v22.21.1', 'v22.19.0']

/**
 * npm registry 候选：官方 + npmmirror 镜像（国内网络直连官方可能挂死）。
 * 环境变量 DSH_DESKTOP_NPM_REGISTRY 可强制指定；成功者写入状态文件复用。
 */
const NPM_REGISTRIES = [
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
]

/** 状态文件：nodeExe（系统或下载的 node.exe）、已装 dsh 版本、npm registry。 */
function readState() {
  try {
    return JSON.parse(readFileSync(paths().state, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(state) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(paths().state, JSON.stringify(state, null, 2))
}

/** 当前生效的 node.exe 路径（状态里记录，系统或下载皆可）。 */
function nodeExePath() {
  const state = readState()
  return typeof state.nodeExe === 'string' && state.nodeExe !== '' && existsSync(state.nodeExe)
    ? state.nodeExe
    : ''
}

/** setDataDir 必须最先调用。 */
function setDataDir(dir) {
  dataDir = dir
  mkdirSync(dir, { recursive: true })
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function log(...args) {
  console.log('[dsh-desktop]', ...args)
}

/** 下载文件（跟随重定向）。 */
async function download(url, dest, onProgress) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`download ${url} -> HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length')) || 0
  let received = 0
  const chunks = []
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    chunks.push(Buffer.from(value))
    if (onProgress !== undefined && total > 0) onProgress(received, total)
  }
  await fs.writeFile(dest, Buffer.concat(chunks))
}

/**
 * 运行子进程，stdout/stderr 重定向到临时文件（不使用 pipe，兼容受限环境）。
 * @returns {code, stdout, stderr, timedOut}
 */
function runToFile(exe, args, options = {}) {
  return new Promise((resolve) => {
    const { cwd, timeoutMs = 300_000, env } = options
    const tag = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
    mkdirSync(paths().tmp, { recursive: true })
    const outPath = path.join(paths().tmp, `${tag}.out`)
    const errPath = path.join(paths().tmp, `${tag}.err`)
    let outFd
    let errFd
    try {
      outFd = openSync(outPath, 'w')
      errFd = openSync(errPath, 'w')
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: `无法创建临时输出文件：${error.message}`, timedOut: false })
      return
    }
    let child
    try {
      child = spawn(exe, args, {
        cwd,
        env: env ?? process.env,
        windowsHide: true,
        stdio: ['ignore', outFd, errFd],
      })
    } catch (error) {
      closeSync(outFd)
      closeSync(errFd)
      resolve({ code: -1, stdout: '', stderr: `spawn 失败：${error.message}`, timedOut: false })
      return
    }
    // 句柄已复制给子进程，父进程侧立即关闭
    closeSync(outFd)
    closeSync(errFd)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: readOrEmpty(outPath), stderr: String(error), timedOut: false })
      cleanupTmp(outPath, errPath)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      // Windows 下退出后写盘可能稍有延迟，重读一次
      setTimeout(() => {
        resolve({ code: code ?? -1, stdout: readOrEmpty(outPath), stderr: readOrEmpty(errPath), timedOut })
        cleanupTmp(outPath, errPath)
      }, 150)
    })
  })
}

function readOrEmpty(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function cleanupTmp(...files) {
  for (const file of files) fs.rm(file, { force: true }).catch(() => {})
}

/** 树杀进程（Windows taskkill，stdio 全 ignore）。 */
function killTree(pid) {
  try {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.once('error', () => {})
  } catch { /* 已退出则忽略 */ }
}

/** 询问 registry：指定 dist 大版本的最新完整版本号。 */
async function latestNodeVersion() {
  const response = await fetch('https://nodejs.org/dist/index.json', { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`nodejs.org index HTTP ${response.status}`)
  const list = await response.json()
  const hit = list.find((entry) => entry.version.startsWith(`v${NODE_MAJOR}.`))
  return hit === undefined ? undefined : hit.version
}

/** npm registry 上 @deepseek-ai/dsh 的最新版本（官方不通就走镜像）。 */
async function latestDshVersion() {
  for (const registry of NPM_REGISTRIES) {
    try {
      const response = await fetch(`${registry}/@deepseek-ai/dsh/latest`, { signal: AbortSignal.timeout(8000) })
      if (response.ok) return (await response.json()).version
    } catch { /* 走下一个 registry */ }
  }
  throw new Error('npm registry 不可达（官方与镜像均失败）')
}

/** 已安装的 dsh 版本（读它 package.json）。 */
function installedDshVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(paths().dshRuntime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
    return pkg.version
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// 运行时安装 / 升级
// ---------------------------------------------------------------------------

/** HEAD 探测某 URL 是否存在。 */
async function headOk(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10_000) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * 系统 Node 候选：PATH 各目录 + 常见安装位置 + nvm-windows 目录。
 * 纯文件系统扫描，不 spawn（where.exe 在受限环境会 EPERM）。
 */
function systemNodeCandidates() {
  const candidates = []
  const seen = new Set()
  const push = (dir) => {
    if (typeof dir !== 'string' || dir === '') return
    const exe = path.join(dir, 'node.exe')
    if (!seen.has(exe) && existsSync(exe)) {
      seen.add(exe)
      candidates.push(exe)
    }
  }
  for (const dir of (process.env.PATH ?? '').split(';')) push(dir)
  push(path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'))
  push(path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs'))
  push(path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'nodejs'))
  // nvm-windows：各版本子目录里的 node.exe
  const nvmHome = process.env.NVM_HOME
  if (typeof nvmHome === 'string' && nvmHome !== '' && existsSync(nvmHome)) {
    try {
      for (const entry of readdirSync(nvmHome)) {
        if (/^v?\d/.test(entry)) push(path.join(nvmHome, entry))
      }
    } catch { /* 忽略 */ }
  }
  return candidates
}

/**
 * 解析系统 Node：候选列表逐个验证版本满足 dsh 引擎要求
 * （^22.19.0 || >=24.0.0）才接受。
 * @returns node.exe 绝对路径，或 undefined。
 */
async function resolveSystemNode() {
  for (const exe of systemNodeCandidates()) {
    const result = await runToFile(exe, ['-p', 'process.version'], { timeoutMs: 15_000 })
    const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(result.stdout.trim())
    if (match === null) continue
    const major = Number(match[1])
    const minor = Number(match[2])
    // dsh engines: ^22.19.0 || >=24.0.0
    if ((major === 22 && minor >= 19) || major >= 24) return exe
  }
  return undefined
}

/**
 * 下载兜底：在镜像列表 × 候选版本里找第一个 HEAD 200 的 zip。
 * @returns {mirror, version, url} 或 undefined。
 */
async function resolveDownloadCandidate() {
  const candidates = []
  const indexLatest = await latestNodeVersion().catch(() => undefined)
  if (indexLatest !== undefined) candidates.push(indexLatest)
  candidates.push(...NODE_FALLBACK_VERSIONS.filter((v) => !candidates.includes(v)))
  for (const version of candidates) {
    for (const mirror of NODE_DIST_MIRRORS) {
      const url = `${mirror}/${version}/win-x64/node-${version}-win-x64.zip`
      if (await headOk(url)) return { mirror, version, url }
    }
  }
  return undefined
}

/**
 * 确保 Node 运行时可用：优先系统 Node（零下载）；否则下载（镜像回退 + HEAD 预检）。
 * @param onStatus - 进度回调 (stage, detail)。
 */
async function ensureNodeRuntime(onStatus) {
  // 1) 系统 Node 优先
  const systemNode = await resolveSystemNode()
  if (systemNode !== undefined) {
    const state = readState()
    if (state.nodeExe !== systemNode) writeState({ ...state, nodeExe: systemNode })
    log('using system node:', systemNode)
    return
  }
  // 2) 已下载过的直接复用
  const existing = nodeExePath()
  if (existing !== '') {
    log('using downloaded node:', existing)
    return
  }
  // 3) 下载兜底
  const candidate = await resolveDownloadCandidate()
  if (candidate === undefined) {
    throw new Error('无法获取 Node.js 运行时：nodejs.org 与 npmmirror 均不可达。请安装 Node.js 24+（https://nodejs.org）后重试。')
  }
  onStatus?.('下载 Node.js 运行时', `${candidate.version}（约 30 MB，仅首次）`)
  const zipPath = path.join(paths().runtimes, `node-${candidate.version}-win-x64.zip`)
  mkdirSync(paths().runtimes, { recursive: true })
  await download(candidate.url, zipPath,
    (received, total) => onStatus?.('下载 Node.js 运行时', `${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`))
  onStatus?.('解压 Node.js 运行时', candidate.version)
  const result = await runToFile('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(paths().runtimes)} -Force`,
  ], { timeoutMs: 180_000 })
  await fs.rm(zipPath, { force: true })
  const nodeExe = path.join(paths().runtimes, `node-${candidate.version}-win-x64`, 'node.exe')
  if (result.code !== 0 || !existsSync(nodeExe)) {
    throw new Error(`Node 运行时解压失败：${result.stderr.slice(0, 300)}`)
  }
  writeState({ ...readState(), nodeExe })
  log('node runtime ready:', candidate.version)
}

/** 定位与 node.exe 配套的 npm-cli.js。 */
function npmCliPath() {
  const nodeExe = nodeExePath()
  if (nodeExe === '') return ''
  const candidate = path.join(path.dirname(nodeExe), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return existsSync(candidate) ? candidate : ''
}

/**
 * 解析本次使用的 npm registry：
 * 环境变量覆盖 > 状态文件里上次成功者 > 探测（官方可达用官方，否则镜像）。
 */
async function resolveNpmRegistry() {
  const override = process.env.DSH_DESKTOP_NPM_REGISTRY
  if (typeof override === 'string' && override !== '') return override
  const state = readState()
  if (typeof state.npmRegistry === 'string' && state.npmRegistry !== '') return state.npmRegistry
  return (await headOk(`${NPM_REGISTRIES[0]}/@deepseek-ai/dsh`)) ? NPM_REGISTRIES[0] : NPM_REGISTRIES[1]
}

/**
 * 带 registry 回退与超时看门狗的 npm install：
 * 单次尝试 15 分钟上限；失败自动换下一个 registry 重试。
 * @returns 成功的 registry。
 */
async function npmInstallWithFallback(nodeExe, npmCli, dshRuntime, onStatus) {
  const primary = await resolveNpmRegistry()
  const order = [primary, ...NPM_REGISTRIES.filter((r) => r !== primary)]
  let lastError
  for (const registry of order) {
    const label = registry === NPM_REGISTRIES[0] ? '官方源' : '镜像源'
    try {
      onStatus?.('npm install', `registry: ${label}`)
      const result = await runToFile(nodeExe, [
        npmCli, 'install', '@deepseek-ai/dsh@latest',
        '--registry', registry,
        '--fetch-timeout=120000', '--fetch-retries=1',
        '--no-audit', '--no-fund', '--loglevel', 'error',
      ], { cwd: dshRuntime, timeoutMs: 15 * 60_000 })
      if (result.code !== 0) throw new Error(result.stderr.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400))
      // 成功：记住这个 registry，下次直接用
      writeState({ ...readState(), npmRegistry: registry })
      return registry
    } catch (error) {
      lastError = error
      log(`npm install failed on ${label}:`, error.message ?? error)
    }
  }
  throw new Error(`npm install 失败（已尝试 ${order.length} 个 registry）：${lastError?.message ?? lastError}`)
}

/**
 * 确保 dsh 已安装且为最新；必要时 npm install / 升级。
 * @param onStatus - 进度回调。
 * @returns 安装/升级动作描述（无动作返回 null）。
 */
async function ensureDsh(onStatus) {
  const { dshRuntime } = paths()
  const nodeExe = nodeExePath()
  const npmCli = npmCliPath()
  if (nodeExe === '' || npmCli === '') throw new Error('Node 运行时未就绪（ensureNodeRuntime 未完成）')
  const installed = installedDshVersion()
  const latest = await latestDshVersion().catch(() => undefined)
  if (installed !== undefined && existsSync(paths().dshEntry)) {
    if (latest === undefined || latest === installed) return null
    onStatus?.('升级 DeepSeek Harness', `${installed} → ${latest}`)
    await npmInstallWithFallback(nodeExe, npmCli, dshRuntime, onStatus)
    log('dsh updated:', installed, '->', installedDshVersion())
    return `dsh ${installed} → ${installedDshVersion()}`
  }
  onStatus?.('安装 DeepSeek Harness', latest !== undefined ? `@deepseek-ai/dsh@${latest}` : '最新版')
  mkdirSync(dshRuntime, { recursive: true })
  writeFileSync(path.join(dshRuntime, 'package.json'), JSON.stringify({ name: 'dsh-desktop-runtime', private: true }, null, 2))
  await npmInstallWithFallback(nodeExe, npmCli, dshRuntime, onStatus)
  log('dsh installed:', installedDshVersion())
  return `dsh ${installedDshVersion()} 已安装`
}

// ---------------------------------------------------------------------------
// 服务器生命周期
// ---------------------------------------------------------------------------

/** 找一个空闲端口（从 preferred 开始）。 */
async function findFreePort(preferred) {
  const tryPort = (port) => new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
  for (let port = preferred; port < preferred + 64; port += 1) {
    if (await tryPort(port)) return port
  }
  throw new Error('no free port in range')
}

/** 轻量 HTTP 探测：某端口是否活着。 */
function probeHttp(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (response) => {
      response.resume()
      resolve(true)
      request.destroy()
    })
    request.on('timeout', () => {
      resolve(false)
      request.destroy()
    })
    request.on('error', () => resolve(false))
  })
}

/** 活着的 dsh 服务器（本插件管理范围之外也算）。 */
class DshServer {
  constructor() {
    this.child = undefined
    this.port = undefined
    this.url = undefined
    this.onExit = undefined
    this.logPath = undefined
  }

  /**
   * 启动 dsh web。stdout/stderr 追加写入 userData/logs/dsh-web.log
   * （上次启动轮转为 dsh-web.prev.log），就绪判定 = 日志出现 `dsh web:` 行
   * 或 HTTP 探测通过。
   * @param options - { port, workspace, env, onStatus, onLog }。
   */
  async start(options) {
    const { dshEntry, nodeExe, logs } = paths()
    if (!existsSync(dshEntry)) throw new Error('dsh 未安装（ensureDsh 未完成）')
    const port = options.port ?? (await findFreePort(3080))
    const cwd = options.workspace || process.env.USERPROFILE
    options.onStatus?.('启动 DeepSeek Harness', `端口 ${port}`)
    mkdirSync(logs, { recursive: true })
    const logPath = path.join(logs, 'dsh-web.log')
    try {
      await fs.rename(logPath, path.join(logs, 'dsh-web.prev.log'))
    } catch { /* 首次启动无旧日志 */ }
    const outFd = openSync(logPath, 'a')
    const child = spawn(nodeExe, [dshEntry, 'web', '--port', String(port)], {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        ...(options.env ?? {}),
        // 复用用户已有的 ~/.dsh（凭证、profile、插件都在那）
      },
      stdio: ['ignore', outFd, outFd],
    })
    closeSync(outFd)
    this.child = child
    this.port = port
    this.url = `http://127.0.0.1:${port}`
    this.logPath = logPath
    child.once('exit', (code) => {
      if (this.child === child) this.child = undefined
      this.onExit?.(code)
    })
    // 已读日志偏移，轮询时只取新增行推给 onLog
    let readOffset = 0
    const tailLog = () => {
      try {
        const stat = readFileSync(logPath)
        if (stat.length <= readOffset) return false
        const chunk = stat.subarray(readOffset)
        readOffset = stat.length
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.trim() !== '') options.onLog?.(line)
        }
        return chunk.toString('utf8').includes('dsh web:')
      } catch {
        return false
      }
    }
    const deadline = Date.now() + 90_000
    for (;;) {
      if (this.child !== child) throw new Error('dsh web 进程提前退出')
      if (tailLog()) return this.url
      if (await probeHttp(port)) return this.url
      if (Date.now() > deadline) {
        killTree(child.pid)
        this.child = undefined
        throw new Error(`dsh web 启动超时（90s）；日志：${logPath}`)
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }

  /** 是否仍在运行。 */
  get running() {
    return this.child !== undefined && this.child.exitCode === null
  }

  /** 停止（Windows taskkill 树杀）。 */
  async stop() {
    const child = this.child
    if (child === undefined) return
    this.child = undefined
    await new Promise((resolve) => {
      try {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        killer.once('error', () => resolve())
        killer.once('exit', () => resolve())
        setTimeout(resolve, 5000)
      } catch {
        resolve()
      }
    })
  }
}

module.exports = {
  setDataDir,
  paths,
  readState,
  ensureNodeRuntime,
  ensureDsh,
  installedDshVersion,
  latestDshVersion,
  resolveSystemNode,
  findFreePort,
  probeHttp,
  DshServer,
}

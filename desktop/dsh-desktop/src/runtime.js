/**
 * DSH 运行时管理器：
 * - Node.js 运行时：优先系统 Node（PATH/常见安装位扫描）；不可用时从镜像下载
 *   官方 node-vX-win-x64.zip 到 userData/runtimes 解压使用（避免与 Electron 的
 *   Node ABI 冲突——dsh 依赖 node-pty 等 NAN 原生模块）。
 * - dsh 本体：优先复用已有安装——npm 全局安装（%APPDATA%\npm，升级由用户
 *   `npm i -g` 自管，启动零联网零下载）；没有全局安装时才 npm install 到
 *   userData/dsh-runtime 自管（registry 官方→npmmirror 自动回退，启动比对
 *   最新版自动升级）。环境变量 DSH_DESKTOP_DSH_ENTRY 可显式指定入口文件。
 * - 服务器生命周期：spawn `node dsh/bin.js web --port <free>`，stdout/stderr 落盘
 *   日志轮询 `dsh web: <url>` 就绪行（dsh ≥0.1.2 的地址带一次性 token，直接采用）
 *   + HTTP 探测兜底。
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
    dshEntry: resolveDshEntry(),
    state: path.join(dataDir, 'runtime-state.json'),
  }
}

/**
 * dsh 入口解析顺序：
 * 1. 环境变量 DSH_DESKTOP_DSH_ENTRY（显式指定入口 js，调试/特殊部署用）
 * 2. npm 全局安装（%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js）——
 *    用户 `npm i -g @deepseek-ai/dsh` 自管版本，桌面端零联网、零下载、秒启动
 * 3. 自管安装（userData/dsh-runtime\node_modules\@deepseek-ai\dsh\lib\bin.js）
 */
function resolveDshEntry() {
  const override = process.env.DSH_DESKTOP_DSH_ENTRY
  if (typeof override === 'string' && override !== '' && existsSync(override)) return override
  const globalEntry = globalDshEntry()
  if (globalEntry !== '') return globalEntry
  return path.join(dataDir, 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/** npm 全局安装的 dsh 入口（没有返回空串）。 */
function globalDshEntry() {
  // npm config get prefix 的默认值；直接按标准位置探测，避免 spawn npm 进程
  const appdata = process.env.APPDATA ?? ''
  if (appdata === '') return ''
  const entry = path.join(appdata, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  return existsSync(entry) ? entry : ''
}

/** 当前 dsh 安装来源描述（托盘菜单显示用）。 */
function dshSource() {
  const entry = resolveDshEntry()
  if (entry === '') return ''
  if (process.env.DSH_DESKTOP_DSH_ENTRY === entry) return 'env'
  if (entry === globalDshEntry()) return 'npm-global'
  return 'managed'
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

/** 已安装的 dsh 版本（读当前生效入口旁的 package.json；未安装返回 undefined）。 */
function installedDshVersion() {
  try {
    const entry = resolveDshEntry()
    if (!existsSync(entry)) return undefined
    const pkg = JSON.parse(readFileSync(path.join(path.dirname(path.dirname(entry)), 'package.json'), 'utf8'))
    return pkg.version
  } catch {
    return undefined
  }
}

/**
 * 当前 dsh 版本是否 ≥ 指定版本（只比 x.y.z 数字段；预发布后缀如 -rc.2
 * 视为等于其主版本，不单独比较——发布候选即视为已具备该版本特性）。
 */
function dshVersionAtLeast(minVersion) {
  const current = installedDshVersion()
  if (current === undefined) return false
  const parse = (v) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  const [cMaj, cMin, cPat] = parse(current)
  const [mMaj, mMin, mPat] = parse(minVersion)
  if (cMaj !== mMaj) return cMaj > mMaj
  if (cMin !== mMin) return cMin > mMin
  return cPat >= mPat
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
 * @param installArgs - npm install 参数（如 ['install','@deepseek-ai/dsh@latest']
 *   或全局升级 ['install','-g','@deepseek-ai/dsh@latest']）。
 * @returns 成功的 registry。
 */
async function npmInstallWithFallback(nodeExe, npmCli, installArgs, cwd, onStatus) {
  const primary = await resolveNpmRegistry()
  const order = [primary, ...NPM_REGISTRIES.filter((r) => r !== primary)]
  let lastError
  for (const registry of order) {
    const label = registry === NPM_REGISTRIES[0] ? '官方源' : '镜像源'
    try {
      onStatus?.('npm install', `registry: ${label}`)
      const result = await runToFile(nodeExe, [
        npmCli, ...installArgs,
        '--registry', registry,
        '--fetch-timeout=120000', '--fetch-retries=1',
        '--no-audit', '--no-fund', '--loglevel', 'error',
      ], { cwd, timeoutMs: 15 * 60_000 })
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
 * 确保 dsh 已安装可用：
 * - env 指定 / npm 全局 / 自管任一入口存在即通过（不再自动升级，升级时机
 *   交给启动页的更新选择与托盘菜单，杜绝启动卡在半小时 npm install）。
 * - 完全没有时：初始化 dsh-runtime 并 npm install（首次安装，无可跳过）。
 * @param onStatus - 进度回调。
 * @returns 安装动作描述（无需动作返回 null）。
 */
async function ensureDsh(onStatus) {
  const { dshRuntime } = paths()
  const nodeExe = nodeExePath()
  const npmCli = npmCliPath()
  if (nodeExe === '' || npmCli === '') throw new Error('Node 运行时未就绪（ensureNodeRuntime 未完成）')
  if (existsSync(paths().dshEntry)) {
    // 入口可用：全局/自管已装，直接用（版本升级交给启动页选择/托盘菜单）
    return null
  }
  const latest = await latestDshVersion().catch(() => undefined)
  onStatus?.('安装 DeepSeek Harness', latest !== undefined ? `@deepseek-ai/dsh@${latest}` : '最新版')
  mkdirSync(dshRuntime, { recursive: true })
  writeFileSync(path.join(dshRuntime, 'package.json'), JSON.stringify({ name: 'dsh-desktop-runtime', private: true }, null, 2))
  await npmInstallWithFallback(nodeExe, npmCli, ['install', '@deepseek-ai/dsh@latest'], dshRuntime, onStatus)
  log('dsh installed:', installedDshVersion())
  return `dsh ${installedDshVersion()} 已安装`
}

/**
 * 查询 dsh 更新（不安装）：
 * @returns { available, installed, latest, source }——installed/latest 均可能为
 * undefined（读不到/查不到），available 仅在两者皆有且不等时为 true。
 */
async function checkDshUpdate() {
  const installed = installedDshVersion()
  const latest = await latestDshVersion().catch(() => undefined)
  return {
    available: installed !== undefined && latest !== undefined && installed !== latest,
    installed,
    latest,
    source: dshSource(),
  }
}

/**
 * 执行 dsh 升级（用户在启动页/托盘菜单明确选择后调用）：
 * - npm-global 来源：npm i -g @deepseek-ai/dsh@latest（装进 %APPDATA%\npm）
 * - managed 来源：npm install 到 userData/dsh-runtime
 * @returns 升级后的版本号。
 */
async function upgradeDsh(onStatus) {
  const { dshRuntime } = paths()
  const nodeExe = nodeExePath()
  const npmCli = npmCliPath()
  if (nodeExe === '' || npmCli === '') throw new Error('Node 运行时未就绪')
  if (dshSource() === 'npm-global') {
    onStatus?.('升级 DeepSeek Harness（npm 全局）', 'npm i -g @deepseek-ai/dsh@latest')
    // 全局安装 cwd 无关紧要（install -g 按 prefix 装入），取 userData 兜底
    await npmInstallWithFallback(nodeExe, npmCli, ['install', '-g', '@deepseek-ai/dsh@latest'], dataDir, onStatus)
    log('dsh (global) upgraded to:', installedDshVersion())
  } else {
    const latest = await latestDshVersion().catch(() => undefined)
    onStatus?.('升级 DeepSeek Harness', `${installedDshVersion()} → ${latest ?? '最新版'}`)
    await npmInstallWithFallback(nodeExe, npmCli, ['install', '@deepseek-ai/dsh@latest'], dshRuntime, onStatus)
    log('dsh (managed) upgraded to:', installedDshVersion())
  }
  return installedDshVersion()
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

/**
 * 从就绪行提取 dsh web 地址：dsh ≥0.1.2 每次启动生成一次性令牌，就绪行形如
 * `dsh web: http://127.0.0.1:3080/?token=…`（尾部可能还有 ` (LAN: …)`，取首个
 * 空白前的地址）。带 token 的地址必须原样交给 WebView——服务器用它换发签名
 * 会话 cookie 后重定向回干净的 `/`，裸地址会被 401 拒绝。校验协议、回环主机
 * 与端口和本次启动一致，不匹配返回空串（退回裸地址兜底）。
 * @returns 可直接加载的完整地址，解析失败返回空串。
 */
function parseReadyUrl(line, port) {
  const match = /dsh web: (\S+)/.exec(line)
  if (match === null) return ''
  try {
    const url = new URL(match[1])
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    if (url.protocol !== 'http:' || url.port !== String(port) || !loopback) return ''
    return url.toString()
  } catch {
    return ''
  }
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
   * （上次启动轮转为 dsh-web.prev.log）。就绪判定优先采用日志
   * `dsh web: <url>` 行里的完整地址——dsh ≥0.1.2 该地址带一次性 ?token=，
   * 必须用它加载（服务器以 token 换发会话 cookie），裸地址会被 401 拒绝；
   * HTTP 探测只作兜底（日志迟迟无就绪行时退回裸地址，兼容旧版）。
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
    // dsh ≥0.1.1 的 web 模式默认自动开系统浏览器（桌面端有自己的窗口，再弹
    // 浏览器是重复打扰）；0.1.0-rc.7 等旧版不认识 --no-open（unknown option
    // 会直接退出），按版本号决定是否传参。
    const args = ['web', '--port', String(port)]
    if (dshVersionAtLeast('0.1.1')) args.push('--no-open')
    const child = spawn(nodeExe, [dshEntry, ...args], {
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
    // 已读日志偏移，轮询时只取新增行推给 onLog；就绪行里带 token 的地址
    // 直接采用为本轮服务地址
    let readOffset = 0
    const tailLog = () => {
      try {
        const stat = readFileSync(logPath)
        if (stat.length <= readOffset) return false
        const chunk = stat.subarray(readOffset)
        readOffset = stat.length
        let ready = false
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.trim() === '') continue
          options.onLog?.(line)
          const url = parseReadyUrl(line, port)
          if (url !== '') {
            this.url = url
            ready = true
          }
        }
        return ready
      } catch {
        return false
      }
    }
    const deadline = Date.now() + 90_000
    let httpUpAt = 0
    for (;;) {
      if (this.child !== child) throw new Error('dsh web 进程提前退出')
      if (tailLog()) return this.url
      if (httpUpAt === 0 && await probeHttp(port)) httpUpAt = Date.now()
      // HTTP 已通但就绪行迟迟不出现：再等 3 秒拿 token 地址，拿不到按裸
      // 地址兜底（旧版 dsh 无 token，裸地址即可用）
      if (httpUpAt !== 0 && Date.now() - httpUpAt > 3_000) return this.url
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
  checkDshUpdate,
  upgradeDsh,
  installedDshVersion,
  latestDshVersion,
  dshSource,
  dshVersionAtLeast,
  resolveSystemNode,
  findFreePort,
  probeHttp,
  parseReadyUrl,
  DshServer,
}

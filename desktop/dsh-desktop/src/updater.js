/**
 * 壳自动更新（electron-updater + GitHub Releases）。
 * 发布仓库在 package.json build.publish 配置（或 userData/update-config.json 覆盖）；
 * 未配置有效仓库时静默跳过（启动日志里说明原因）。
 *
 * 两种安装形态，两种更新策略：
 * - NSIS 安装版：全自动——检查 → 下载 → 退出时静默重装（electron-updater 标准流程）；
 * - 绿色免安装版（dir 解压）：只检查与提示，去发布页下载新压缩包手动替换
 *   （没有 NSIS 卸载器 = 绿色版，靠这个特征区分）。
 * @module dsh-desktop/updater
 */

const { app } = require('electron')
const { existsSync, readFileSync, writeFileSync, readdirSync } = require('node:fs')
const path = require('node:path')

/** 读取用户覆盖的更新源配置（可改 owner/repo，或换成 generic url）。 */
function loadUpdateConfig() {
  const file = path.join(app.getPath('userData'), 'update-config.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/** 写回更新源配置（设置页调用）。 */
function saveUpdateConfig(config) {
  writeFileSync(path.join(app.getPath('userData'), 'update-config.json'), JSON.stringify(config, null, 2))
}

/** 绿色版检测：NSIS 安装版会在安装目录留下卸载器 exe；没有 = 绿色免安装版。 */
function isPortableInstall() {
  try {
    return !readdirSync(path.dirname(process.execPath)).some((name) => /^uninstall/i.test(name) && name.endsWith('.exe'))
  } catch {
    return false
  }
}

/** 松散 semver 比较：a > b ？（只比 major.minor.patch 数字段，预发布尾巴按字典序） */
function isNewerVersion(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v).split('-', 2)
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0)
    return { nums, pre: pre ?? '' }
  }
  const va = parse(a)
  const vb = parse(b)
  for (let i = 0; i < 3; i++) {
    if (va.nums[i] !== vb.nums[i]) return va.nums[i] > vb.nums[i]
  }
  if (va.pre === vb.pre) return false
  // 无预发布 > 有预发布；同为预发布按字典序
  if (va.pre === '') return true
  if (vb.pre === '') return false
  return va.pre > vb.pre
}

/**
 * 解析更新源（优先级）：
 * 1. userData/update-config.json 用户覆盖（generic url 或 owner/repo）；
 * 2. 打包版：resources/app-update.yml（electron-builder 写入；package.json 的
 *    build 字段不会进 app.asar，打包后从 package.json 读 publish 永远是空！）；
 * 3. 开发模式：package.json build.publish。
 * @returns {{provider:string, owner?:string, repo?:string, url?:string, releasePage:string}|undefined}
 */
function resolveFeed() {
  const userConfig = loadUpdateConfig()
  if (userConfig.provider === 'generic' && typeof userConfig.url === 'string' && userConfig.url !== '') {
    return { provider: 'generic', url: userConfig.url, releasePage: userConfig.url }
  }
  if (typeof userConfig.owner === 'string' && userConfig.owner !== '' && typeof userConfig.repo === 'string' && userConfig.repo !== '') {
    return { provider: 'github', owner: userConfig.owner, repo: userConfig.repo, releasePage: `https://github.com/${userConfig.owner}/${userConfig.repo}/releases/latest` }
  }
  if (app.isPackaged) {
    try {
      const yml = readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
      const field = (key) => {
        const m = yml.match(new RegExp('^' + key + ':\\s*(\\S+)\\s*$', 'm'))
        return m !== null ? m[1] : undefined
      }
      const owner = field('owner')
      const repo = field('repo')
      if (owner !== undefined && repo !== undefined && !/YOUR_/.test(owner)) {
        return { provider: field('provider') ?? 'github', owner, repo, releasePage: `https://github.com/${owner}/${repo}/releases/latest` }
      }
    } catch { /* 无 app-update.yml：本包未配置发布 */ }
  } else {
    const publish = require('../package.json').build?.publish?.[0]
    if (publish?.owner !== undefined && publish?.repo !== undefined && !/YOUR_/.test(String(publish.owner))) {
      return { provider: 'github', owner: publish.owner, repo: publish.repo, releasePage: `https://github.com/${publish.owner}/${publish.repo}/releases/latest` }
    }
  }
  return undefined
}

/** 已挂在 autoUpdater 上的事件桥（单例只 wire 一次，防监听器累积）。 */
let wiredEvents = undefined

/**
 * 把事件回调桥接到 autoUpdater（模块级单例）。
 * 手动检查可反复调用：监听器只注册一次，每次调用仅更新回调目标，
 * 避免托盘每点一次「检查更新」就叠加一组监听器。
 */
function wireEvents(autoUpdater, events) {
  wiredEvents = events
  if (wireEvents.done) return
  wireEvents.done = true
  autoUpdater.on('update-available', (info) => wiredEvents?.onAvailable?.(info))
  autoUpdater.on('download-progress', (progress) => wiredEvents?.onProgress?.(progress))
  autoUpdater.on('update-downloaded', (info) => wiredEvents?.onDownloaded?.(info))
  autoUpdater.on('error', (error) => wiredEvents?.onError?.(error))
}

/** 初始化并检查更新；返回 { status, message, ... }。 */
async function checkForUpdates(events) {
  const feed = resolveFeed()
  if (feed === undefined) {
    return { status: 'not-configured', message: '未配置发布仓库：在 package.json build.publish 或 userData/update-config.json 里填写 GitHub owner/repo 后，壳自动更新才会启用。' }
  }
  let autoUpdater
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch (error) {
    return { status: 'error', message: `electron-updater 加载失败：${error.message}` }
  }
  autoUpdater.logger = console
  const portable = isPortableInstall()
  autoUpdater.autoDownload = !portable
  autoUpdater.autoInstallOnAppQuit = !portable
  if (feed.provider === 'generic') {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed.url })
  } else {
    autoUpdater.setFeedURL({ provider: 'github', owner: feed.owner, repo: feed.repo })
  }
  if (events !== undefined) {
    wireEvents(autoUpdater, events)
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    const info = result?.updateInfo
    const current = app.getVersion()
    const available = result?.isUpdateAvailable
      ?? (info !== undefined && info.version !== undefined && isNewerVersion(info.version, current))
    if (available !== true) {
      return { status: 'up-to-date', message: `当前已是最新版本（${current}）。` }
    }
    if (portable) {
      return {
        status: 'portable-update-available',
        version: info?.version,
        releasePage: feed.releasePage,
        message: `发现新版本 ${info?.version}（当前 ${current}）。绿色免安装版请到发布页下载新压缩包，解压覆盖旧目录即可。`,
      }
    }
    return { status: 'downloading', message: `发现新版本 ${info?.version}（当前 ${current}），正在后台下载，完成后退出时自动安装。` }
  } catch (error) {
    return { status: 'error', message: `检查更新失败：${error.message}` }
  }
}

/** 退出并安装已下载的更新（绿色版没有安装器可跑，直接退出兜底）。 */
function quitAndInstall() {
  try {
    if (isPortableInstall()) {
      app.quit()
      return
    }
    require('electron-updater').autoUpdater.quitAndInstall()
  } catch {
    app.quit()
  }
}

module.exports = { checkForUpdates, quitAndInstall, loadUpdateConfig, saveUpdateConfig, isPortableInstall }

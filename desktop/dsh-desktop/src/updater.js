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

/** 初始化并检查更新；返回 { status, message, ... }。 */
async function checkForUpdates(events) {
  const pkg = require('../package.json')
  const publish = pkg.build?.publish?.[0]
  const userConfig = loadUpdateConfig()
  const owner = userConfig.owner || publish?.owner
  const repo = userConfig.repo || publish?.repo
  const isPlaceholder = owner === undefined || repo === undefined || /YOUR_/.test(String(owner))
  if (isPlaceholder && userConfig.provider !== 'generic') {
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
  let releasePage
  if (userConfig.provider === 'generic' && typeof userConfig.url === 'string') {
    autoUpdater.setFeedURL({ provider: 'generic', url: userConfig.url })
    releasePage = userConfig.url
  } else {
    autoUpdater.setFeedURL({ provider: 'github', owner, repo })
    releasePage = `https://github.com/${owner}/${repo}/releases/latest`
  }
  if (events !== undefined) {
    autoUpdater.on('update-available', (info) => events.onAvailable?.(info))
    autoUpdater.on('download-progress', (progress) => events.onProgress?.(progress))
    autoUpdater.on('update-downloaded', (info) => events.onDownloaded?.(info))
    autoUpdater.on('error', (error) => events.onError?.(error))
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
        releasePage,
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

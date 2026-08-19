/**
 * DSH Desktop 主进程：
 * 启动页（安装/升级运行时 → 启动 dsh web）→ 主窗口（自定义标题栏 + WebContentsView
 * 加载本地 dsh web）；托盘常驻（显示/退出/检查更新/切换工作区）；单实例锁定；
 * 服务器死亡时在视图内显示重连页；壳自动更新（electron-updater）。
 * @module dsh-desktop/main
 */

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, shell, nativeImage, WebContentsView } = require('electron')
const path = require('node:path')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')

const runtime = require('./runtime')
const updater = require('./updater')

/** 开发标志（未打包时 true）。 */
const isDev = !app.isPackaged

// 单实例：第二个实例聚焦已有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (window !== undefined) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
  })
}

app.setAppUserModelId('com.deepseekharness.dshdesktop')

/** 主窗口（自定义标题栏壳）与托盘。 */
let mainWindow = undefined
let splashWindow = undefined
let tray = undefined
let server = undefined
let quitting = false
/** before-quit 重入防护：停服后重新 quit 一次以保留 will-quit（更新器挂这里）。 */
let serverStopping = false
/** boot() 并发防护：重试连点不叠加。 */
let booting = false
/** 承载 dsh web 内容的视图（主窗口标题栏下方）。 */
let contentView = undefined
/** 当前标题栏主题（true=深色），跟随 dsh web 页面。 */
let themeDark = undefined
/** 主题轮询定时器。 */
let themeTimer = undefined

/** 标题栏高度（px），与 shell.css 保持一致。 */
const TITLEBAR_H = 38

/** 应用配置（工作区、更新源覆盖）。 */
function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeConfig(config) {
  writeFileSync(configPath(), JSON.stringify(config, null, 2))
}

/** 图标资源路径（dev: assets/；打包: resources/）。 */
function asset(name) {
  const devPath = path.join(__dirname, '..', 'assets', name)
  if (existsSync(devPath)) return devPath
  return path.join(process.resourcesPath, 'assets', name)
}

function windowIcon() {
  return nativeImage.createFromPath(asset('icon-256.png'))
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

/** 视图边界 = 窗口内容区去掉标题栏。 */
function updateViewBounds() {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  if (contentView === undefined) return
  const [width, height] = mainWindow.getContentSize()
  contentView.setBounds({ x: 0, y: TITLEBAR_H, width, height: Math.max(0, height - TITLEBAR_H) })
}

/** 创建承载 dsh web 的内容视图（挂在主窗口标题栏下方）。 */
function createContentView() {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // 加载期间背景与窗口一致，避免闪白
  view.setBackgroundColor((themeDark ?? nativeThemeShouldUseDark()) ? '#151517' : '#f9fafb')
  // 外部链接走系统浏览器
  view.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target)
    return { action: 'deny' }
  })
  view.webContents.on('did-fail-load', () => {
    if (server?.url !== undefined && contentView === view) {
      showReconnect(`页面加载失败（${server.url}）——服务器可能异常退出。`)
    }
  })
  view.webContents.on('did-finish-load', () => {
    if (contentView === view) startThemeSync()
  })
  return view
}

/**
 * 主题同步：读 dsh web 页面 body 的 data-ds-dark-theme 属性（页面内用户切换
 * 明暗、或本地偏好覆盖系统时都会变），同步给标题栏壳页与视图背景色。
 */
function applyTheme(dark) {
  if (dark === themeDark) return
  themeDark = dark
  mainWindow?.webContents.send('theme-changed', dark)
  contentView?.setBackgroundColor(dark ? '#151517' : '#f9fafb')
}

function startThemeSync() {
  const view = contentView
  if (view === undefined) return
  // 闭包持有自己的 timer id：视图重建后旧闭包自查失效时只清自己的
  // 定时器，不误杀绑定新视图的新定时器。
  let timerId = undefined
  const query = async () => {
    if (contentView !== view || view.webContents.isDestroyed()) {
      if (timerId !== undefined) clearInterval(timerId)
      if (themeTimer === timerId) themeTimer = undefined
      return
    }
    // 只在真正的 dsh web 页面上读取主题（重连页等本地页保持当前主题）
    const url = view.webContents.getURL()
    if (server?.url === undefined || !url.startsWith(server.url)) return
    try {
      const dark = await view.webContents.executeJavaScript(
        'document.body.hasAttribute("data-ds-dark-theme")', true)
      applyTheme(Boolean(dark))
    } catch { /* 页面跳转中 */ }
  }
  query()
  // 总是重建定时器并绑定当前视图（旧定时器一并清除，全局至多一个）
  if (themeTimer !== undefined) clearInterval(themeTimer)
  timerId = setInterval(query, 1200)
  themeTimer = timerId
}

function createMainWindow(url) {
  // 复用已有主窗口（重试/重启服务不新开窗口）：只重载内容视图
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    if (contentView !== undefined && !contentView.webContents.isDestroyed()) {
      contentView.webContents.loadURL(url)
      return
    }
    // 视图已损坏：直接销毁重建（close() 会被"藏到托盘"拦截）
    mainWindow.destroy()
    mainWindow = undefined
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    icon: windowIcon(),
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: 'DSH Desktop',
    backgroundColor: (themeDark ?? nativeThemeShouldUseDark()) ? '#151517' : '#f9fafb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    splashWindow?.close()
    splashWindow = undefined
  })
  mainWindow.on('close', (event) => {
    // 关窗 = 藏到托盘；托盘菜单退出才是真退出
    if (!quitting && tray !== undefined) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = undefined
    contentView = undefined
  })
  // 尺寸变化（含最大化/还原/贴边）同步视图边界
  for (const event of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(event, () => updateViewBounds())
  }
  // 最大化状态推给标题栏按钮图标
  const pushState = () => mainWindow?.webContents.send('window-state-changed', mainWindow.isMaximized())
  mainWindow.on('maximize', pushState)
  mainWindow.on('unmaximize', pushState)
  // 标题栏壳页
  mainWindow.loadFile(path.join(__dirname, 'shell.html'))
  // dsh web 内容视图
  contentView = createContentView()
  mainWindow.contentView.addChildView(contentView)
  contentView.webContents.loadURL(url)
  updateViewBounds()
}

/** 系统当前是否偏好深色（标题栏与 dsh web 默认主题同为系统跟随）。 */
function nativeThemeShouldUseDark() {
  return require('electron').nativeTheme.shouldUseDarkColors
}

function createSplashWindow() {
  // 单例：已存在就复用（重试不新开窗口）
  if (splashWindow !== undefined && !splashWindow.isDestroyed()) return
  splashWindow = new BrowserWindow({
    width: 520,
    height: 400,
    frame: false,
    resizable: false,
    icon: windowIcon(),
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
  splashWindow.on('closed', () => {
    splashWindow = undefined
    // 启动页被用户关闭且主窗口从未出现：整个应用退出（托盘也一并退出）
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
      quitting = true
      app.quit()
    }
  })
}

/** 内容视图展示错误/重连页（保留自定义标题栏）。 */
function showReconnect(message) {
  if (contentView === undefined) return
  contentView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(reconnectHtml(message))}`)
}

/** 启动状态推给启动页。 */
function pushStatus(stage, detail) {
  splashWindow?.webContents.send('boot-status', { stage, detail })
}

// ---------------------------------------------------------------------------
// 托盘
// ---------------------------------------------------------------------------

function createTray() {
  const image = nativeImage.createFromPath(asset('icon-32.png'))
  tray = new Tray(image.isEmpty() ? windowIcon() : image)
  tray.setToolTip('DSH Desktop — DeepSeek Harness')
  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      { label: '显示 DSH', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: `工作区：${readConfig().workspace ?? '默认（用户目录）'}`,
        enabled: false,
      },
      {
        label: '切换工作区…',
        click: async () => {
          const picked = await dialog.showOpenDialog(mainWindow ?? undefined, {
            properties: ['openDirectory'],
            title: '选择 DSH 工作区（会重启服务）',
          })
          if (picked.canceled || picked.filePaths.length === 0) return
          const config = readConfig()
          config.workspace = picked.filePaths[0]
          writeConfig(config)
          await restartServer()
        },
      },
      { type: 'separator' },
      {
        label: '检查壳更新（GitHub）',
        click: () => runShellUpdate(true),
      },
      {
        label: `DSH 运行时：${runtime.installedDshVersion() ?? '未安装'}`,
        enabled: false,
      },
      {
        label: '检查 DSH 更新（npm）',
        click: async () => {
          try {
            const latest = await runtime.latestDshVersion()
            const installed = runtime.installedDshVersion()
            if (latest === installed) {
              dialog.showMessageBox({ type: 'info', message: `DSH 已是最新（${installed}）。` })
              return
            }
            const choice = await dialog.showMessageBox({
              type: 'question',
              buttons: ['升级并重启服务', '暂不'],
              defaultId: 0,
              message: `DSH 有新版本：${installed} → ${latest}。现在升级？`,
            })
            if (choice.response === 0) await restartServer(true)
          } catch (error) {
            dialog.showMessageBox({ type: 'error', message: `检查 DSH 更新失败：${error.message}` })
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ])
    tray.setContextMenu(menu)
  }
  tray.on('double-click', () => showMainWindow())
  rebuild()
}

function showMainWindow() {
  if (mainWindow === undefined || mainWindow.isDestroyed()) {
    boot(true)
    return
  }
  mainWindow.show()
  mainWindow.focus()
}

/** 壳更新入口。 */
async function runShellUpdate(manual) {
  const result = await updater.checkForUpdates({
    onDownloaded: () => {
      dialog
        .showMessageBox({
          type: 'info',
          message: '壳更新已下载，退出时自动安装。',
          buttons: ['现在重启', '稍后'],
        })
        .then((choice) => {
          if (choice.response === 0) updater.quitAndInstall()
        })
    },
  })
  // 绿色免安装版：只提示，去发布页手动下载（没有安装器可静默重跑）
  if (result.status === 'portable-update-available') {
    const choice = await dialog.showMessageBox({
      type: 'info',
      message: result.message,
      buttons: ['去发布页下载', '忽略此版本（本次运行）'],
      defaultId: 0,
    })
    if (choice.response === 0 && result.releasePage) shell.openExternal(result.releasePage)
    return
  }
  if (manual) {
    dialog.showMessageBox({
      type: result.status === 'error' ? 'error' : 'info',
      message: result.message,
    })
  }
}

// ---------------------------------------------------------------------------
// 启动 / 重启流程
// ---------------------------------------------------------------------------

async function boot(skipRuntimeWork) {
  if (booting) return
  booting = true
  createSplashWindow()
  try {
    if (!skipRuntimeWork) {
      runtime.setDataDir(app.getPath('userData'))
      pushStatus('准备运行时', '检查 Node.js / DeepSeek Harness')
      await runtime.ensureNodeRuntime(pushStatus)
      await runtime.ensureDsh(pushStatus)
    }
    server ??= new runtime.DshServer()
    if (server.running) {
      createMainWindow(server.url)
      return
    }
    server.onExit = (code) => {
      if (quitting) return
      showReconnect(`dsh web 进程退出（code ${code}）。`)
    }
    const config = readConfig()
    const url = await server.start({
      workspace: config.workspace,
      onStatus: (stage, detail) => pushStatus(stage, detail),
      onLog: (line) => console.log('[dsh]', line),
    })
    pushStatus('就绪', url)
    createMainWindow(url)
  } catch (error) {
    console.error('[dsh-desktop] boot failed:', error)
    pushStatus('启动失败', error.message)
    // 启动页保留错误详情；5 秒后允许重试
    setTimeout(() => {
      splashWindow?.webContents.send('boot-failed', error.message)
    }, 500)
  } finally {
    booting = false
  }
}

/** 重启 dsh 服务（upgrade=true 时先强制检查 dsh 升级）。 */
async function restartServer(upgrade) {
  try {
    await server?.stop()
  } catch {}
  server = undefined
  if (upgrade) {
    runtime.setDataDir(app.getPath('userData'))
    await runtime.ensureDsh(pushStatus).catch(() => {})
  }
  await boot(false)
  // 重建托盘里的版本号
  if (tray !== undefined) {
    tray.destroy()
    tray = undefined
    createTray()
  }
}

// ---------------------------------------------------------------------------
// IPC（启动页 / 标题栏 / 重连页）
// ---------------------------------------------------------------------------

ipcMain.handle('boot-retry', () => {
  boot(false).catch((error) => console.error(error))
  return true
})

ipcMain.handle('app-quit', () => {
  quitting = true
  app.quit()
  return true
})

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url)
  return true
})

ipcMain.handle('get-info', () => ({
  dshVersion: runtime.installedDshVersion() ?? '未安装',
  workspace: readConfig().workspace ?? '默认（用户目录）',
}))

// ---- 标题栏窗口控制 ----
ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize()
  return true
})

ipcMain.handle('window-toggle-maximize', () => {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return false
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return true
})

ipcMain.handle('window-close', () => {
  // 与点系统关闭一致：藏到托盘
  mainWindow?.close()
  return true
})

ipcMain.handle('window-get-state', () => mainWindow?.isMaximized() ?? false)

ipcMain.handle('get-theme', () => themeDark ?? nativeThemeShouldUseDark())

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  runtime.setDataDir(app.getPath('userData'))
  createTray()
  boot(false)
  // 启动后 10 秒做一次静默壳更新检查
  setTimeout(() => {
    runShellUpdate(false).catch(() => {})
  }, 10_000)
})

app.on('before-quit', async (event) => {
  if (themeTimer !== undefined) clearInterval(themeTimer)
  if (quitting && server?.running && !serverStopping) {
    // 停服后重新 quit：直接 app.exit(0) 会跳过 will-quit，
    // electron-updater 的「退出时自动安装」就挂在 will-quit 上。
    event.preventDefault()
    serverStopping = true
    await server.stop().catch(() => {})
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // 托盘常驻：不退出（用户从托盘菜单退出）
})

// ---------------------------------------------------------------------------
// 内嵌 HTML（重连页，加载在内容视图里）
// ---------------------------------------------------------------------------

function reconnectHtml(message) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>DSH Desktop</title>
<style>
body{margin:0;font-family:system-ui,"Segoe UI",sans-serif;background:#1e2430;color:#e8eaf0;display:flex;align-items:center;justify-content:center;height:100vh}
.card{text-align:center;max-width:480px;padding:40px}
h1{font-size:18px;font-weight:600}
p{color:#9aa3b5;font-size:13px;line-height:1.7;word-break:break-all}
button{margin-top:18px;padding:10px 26px;border:0;border-radius:8px;background:#4f6ef7;color:#fff;font-size:14px;cursor:pointer}
button:hover{background:#3d5df5}
</style></head><body><div class="card">
<h1>与服务器的连接中断</h1>
<p>${message.replace(/</g, '&lt;')}</p>
<button onclick="window.dshDesktop.retry()">重启服务</button>
</div></body></html>`
}

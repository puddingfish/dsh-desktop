/**
 * 预加载桥：向渲染进程暴露最小 IPC 面。
 * - 启动页（splash）：启动状态、重试、退出
 * - 壳标题栏（shell）：窗口控制（最小化/最大化/关闭到托盘）、最大化状态
 * - 重连页（webview 内）：重启服务
 * - 通用：外链、基本信息
 * @module dsh-desktop/preload
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  /** 启动页订阅启动状态。 */
  onBootStatus: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('boot-status', handler)
    return () => ipcRenderer.removeListener('boot-status', handler)
  },
  /** 启动页订阅致命失败。 */
  onBootFailed: (listener) => {
    const handler = (_event, message) => listener(message)
    ipcRenderer.on('boot-failed', handler)
    return () => ipcRenderer.removeListener('boot-failed', handler)
  },
  /** 重连页：重启服务。 */
  retry: () => ipcRenderer.invoke('boot-retry'),
  /** 启动页 × 按钮：退出整个应用。 */
  quitApp: () => ipcRenderer.invoke('app-quit'),
  /** 用系统浏览器打开外部链接。 */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  /** 基本信息（版本/工作区）。 */
  getInfo: () => ipcRenderer.invoke('get-info'),

  // ---- 壳标题栏窗口控制 ----
  /** 最小化窗口。 */
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  /** 最大化 / 还原切换。 */
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  /** 关闭按钮 = 藏到托盘（与窗口 close 行为一致）。 */
  windowClose: () => ipcRenderer.invoke('window-close'),
  /** 当前是否最大化。 */
  getWindowState: () => ipcRenderer.invoke('window-get-state'),
  /** 订阅最大化状态变化。 */
  onWindowStateChanged: (listener) => {
    const handler = (_event, maximized) => listener(maximized)
    ipcRenderer.on('window-state-changed', handler)
    return () => ipcRenderer.removeListener('window-state-changed', handler)
  },

  // ---- 主题（标题栏跟随 dsh web 页面明暗）----
  /** 当前主题（true=深色）。 */
  getTheme: () => ipcRenderer.invoke('get-theme'),
  /** 订阅主题变化。 */
  onThemeChanged: (listener) => {
    const handler = (_event, dark) => listener(dark)
    ipcRenderer.on('theme-changed', handler)
    return () => ipcRenderer.removeListener('theme-changed', handler)
  },
})

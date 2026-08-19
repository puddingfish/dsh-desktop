# DSH Desktop — DeepSeek Harness Windows 桌面客户端

双击即可启动的 Electron 壳应用：把真实的 `dsh web` 服务器包进一个带自定义标题栏的桌面窗口，负责运行时管理、托盘常驻与自动更新。**它不是重新实现的 DSH，而是官方 Web 版的桌面外壳（套壳）**——功能与网页版完全一致，升级跟随官方 npm 包。

## 功能

- **双击启动**：绿色免安装 zip，解压即用，无需管理员权限、不写注册表；
- **自定义标题栏**：跟随 dsh web 页面主题（非系统主题）明暗切换，Windows 风格最小化 / 最大化 / 关闭按钮，双击标题栏最大化；
- **托盘常驻**：关闭窗口即藏到托盘，双击托盘图标随时回来，托盘菜单可完全退出；
- **DSH 运行时自动管理**：优先复用系统 Node.js（22.19+ / 24+），没有则自动从镜像下载独立运行时（约 30 MB，仅一次）；DSH 本体经 npm 安装在 `%APPDATA%\DSH Desktop\dsh-runtime`，启动时自动比对升级（托盘菜单也可手动「检查 DSH 更新」）；
- **壳自动更新**：接入 electron-updater / GitHub Releases（需配置仓库，见下文）；
- **启动页**：Logo + 进度条 + 阶段文案（准备运行时 → 安装/升级 → 启动服务），失败可一键重试；
- **多开避让**：默认端口 3080 被占用时自动落到 3081+。

## 数据位置（与解压目录无关）

```
%APPDATA%\DSH Desktop\
├── config.json      # 工作区、端口、更新开关等
├── dsh-runtime\     # npm 管理的 @deepseek-ai/dsh（自动升级）
└── logs\
    ├── dsh-web.log      # 本次 dsh web 服务日志
    └── dsh-web.prev.log # 上次日志
```

## 开发

```powershell
cd desktop\dsh-desktop
npm install            # Electron 37 + electron-builder
npm start              # 开发模式运行
npm run make-icons     # 从 assets/logo.jpg 重新生成图标（原图直出，不抠背景）
npm run pack           # electron-builder --win --dir → release\win-unpacked
npm run dist           # pack + make-portable.ps1 → release\DSH-Desktop-<版本>-portable-win-x64.zip
```

环境变量（弱网/内网可用）：

- `DSH_DESKTOP_NPM_REGISTRY`：npm 源覆盖（默认官方源 → npmmirror 自动回退）；
- `ELECTRON_MIRROR`：Electron 二进制镜像（如 `https://npmmirror.com/mirrors/electron/`）。

## 打包发布（绿色版）

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm run dist
# → release\DSH-Desktop-0.1.0-portable-win-x64.zip
```

zip 内含 `使用说明.txt`；用户数据在 `%APPDATA%`，覆盖解压目录即可升级壳。

## 壳自动更新（electron-updater / GitHub）

两种安装形态对应两种更新策略：

| 形态 | 行为 |
|---|---|
| **NSIS 安装版**（`DSH Desktop Setup <版本>.exe`） | 全自动：启动 10 秒后静默检查（托盘菜单也可手动查）→ 后台下载 → 弹窗询问「现在重启/退出时自动安装」 |
| **绿色免安装版**（portable zip 解压） | 只检查与提示：发现新版本弹窗给发布页链接，下载新 zip 覆盖解压目录即可（数据都在 `%APPDATA%`，不受影响） |

区分方式：NSIS 安装目录里有卸载器 exe；没有 = 绿色版。

### 首次发布

```powershell
# 1. GitHub 上新建空仓库（不要初始化 README），然后本地：
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin master

# 2. 申请 token：GitHub → Settings → Developer settings → Personal access tokens
#    → Fine-grained tokens → 只勾目标仓库，权限 Contents: Read and write

# 3. 发布（写 owner/repo 进 package.json → 打包 → 上传 Draft Release + 绿色 zip）：
$env:GH_TOKEN = "github_pat_xxx"
cd desktop\dsh-desktop\scripts
.\publish.ps1 -Owner <用户名> -Repo <仓库名>            # 建 Draft
.\publish.ps1 -Owner <用户名> -Repo <仓库名> -Finalize   # 或直接转正式发布
```

electron-builder 建的是 **Draft Release**（draft 里的 latest.yml 对已安装的客户端不可见），确认无误后点 GitHub 上的 Publish（或脚本加 `-Finalize`）。

### 后续发新版

```powershell
# package.json 里 version 改成 0.1.1 → 提交 → 重跑 publish.ps1
# 已安装用户启动 10 秒内会收到更新；绿色版用户会收到「去发布页下载」提示
```

### 用户侧自定义更新源（可选）

`%APPDATA%\DSH Desktop\update-config.json` 可覆盖更新源（自建 HTTP 服务器托管 latest.yml + 安装包）：

```json
{ "provider": "generic", "url": "https://your-server/dsh-desktop/" }
```

未配置仓库/网络不可达时更新检查**静默跳过**，不影响使用（日志里有原因）。

## 已知事项

- Windows 下 electron-builder 偶发 `EPERM rename win-unpacked.tmp`（杀软句柄竞争）：本仓库 `node_modules` 里已带重试补丁；全新环境若复现，重跑一次打包即可；
- 沙箱/受限账户里管道 stdio 的子进程会被 EPERM 拒绝：运行时全部走文件重定向日志（`logs\dsh-web.log`），已规避。

## 致谢

自定义标题栏 + WebContentsView 结构参考 Electron 官方无边框窗口实践；侧栏家族 UI（任务看板 / SSH）来自 [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 家族（Apache-2.0）。

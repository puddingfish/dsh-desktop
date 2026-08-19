<p align="center">
  <img src="desktop/dsh-desktop/assets/logo.jpg" width="160" alt="DSH Desktop logo" style="border-radius:24px" />
</p>

<h1 align="center">DSH Desktop</h1>

<p align="center">
  <b>DeepSeek Harness 的 Windows 桌面客户端与本地增强插件套件</b><br/>
  双击即用 · 绿色免安装 · 自动更新
</p>

---

为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 打造的三件套：一个桌面壳 + 两个功能插件。桌面端是**官方 Web 版的外壳**（套壳，不是重新实现）——功能与网页版完全一致，外加原生的窗口体验、托盘常驻与自动更新；插件按需安装，没有的环境依赖会自动「静默休眠」，不打扰任何人。

| 组件 | 位置 | 一句话 |
|---|---|---|
| 🖥 **dsh-desktop** | [`desktop/dsh-desktop`](desktop/dsh-desktop) | Electron Windows 桌面客户端：双击启动、自定义标题栏跟随页面主题、托盘常驻、DSH 运行时 npm 自动升级、壳自动更新（安装版全自动 / 绿色版提示下载） |
| 🔀 **dsh-model-router** | [`plugins/dsh-model-router`](plugins/dsh-model-router) | 模型路由插件：侧边栏独立「模型路由」入口，按任务类型自动选模型——主会话 / 子代理角色路由 + 轻量/重型关键词规则，简单任务用便宜模型，重型任务用贵模型 |
| 👁 **dsh-mmx-vision** | [`plugins/dsh-mmx-vision`](plugins/dsh-mmx-vision) | 图像理解插件：`describe_image` 后端换成本地 mmx CLI（MiniMax VLM），复用 mmx 登录态零配置；**本机没有 mmx 时自动静默休眠**（不注册工具、不显示配置、零报错） |

## 📥 下载安装

到 [Releases](https://github.com/puddingfish/dsh-desktop/releases) 下载最新版，两种形态任选：

| 形态 | 文件 | 适合 | 更新方式 |
|---|---|---|---|
| **NSIS 安装版** | `DSH-Desktop-Setup-<版本>.exe` | 日常主力机 | **全自动**：启动 10 秒后静默检查 → 后台下载 → 询问「现在重启 / 退出时自动安装」 |
| **绿色免安装版** | `DSH-Desktop-<版本>-portable-win-x64.zip` | U 盘 / 受限环境 | 只提示：发现新版弹窗给发布页链接，下载新 zip 覆盖解压目录（数据都在 `%APPDATA%`，不受影响） |

- 无需管理员权限；首次启动自动准备 DSH 运行时（优先复用系统 Node.js 22.19+/24+，没有则从镜像下载独立运行时，约 30 MB，仅一次）。
- 用户数据与更新缓存在 `%APPDATA%\DSH Desktop\`，与安装目录无关。
- 默认端口 3080，被占用时自动落到 3081+。

详细操作见 [docs/使用说明.md](docs/使用说明.md)。

## 🧩 安装插件

```powershell
git clone https://github.com/puddingfish/dsh-desktop.git
cd dsh-desktop
.\install-plugins.ps1          # 打包 + 安装两个插件到 web 与 headless profile（幂等可重跑）
```

重启 dsh web / DSH Desktop 后生效：侧边栏出现「模型路由」入口；本机装有 mmx CLI 的话，设置 → Web UI 插件里出现「图像理解（mmx）」卡片，带图消息自动走 MiniMax VLM。

> **本机没有 mmx（MiniMax 订阅）？** 完全没关系：安装脚本检测不到 mmx 会直接跳过 dsh-mmx-vision（不写任何配置）；已装的副本也会在运行时静默休眠——不注册 `describe_image`、不显示设置卡片、控制台零告警零报错。装好 mmx 后重跑脚本并重启即可启用。

## 🚀 快速开始（开发）

```powershell
# 插件：改代码后重跑 install-plugins.ps1 + 重启 dsh web 生效
.\install-plugins.ps1

# 桌面客户端：开发模式
cd desktop\dsh-desktop
npm install
npm start

# 桌面客户端：打包（NSIS 安装版 + 绿色 zip）
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm run dist
```

## 📚 文档

| 文档 | 内容 |
|---|---|
| [docs/使用说明.md](docs/使用说明.md) | 终用户手册：安装、启动、托盘与窗口、自动更新、两个插件的配置与使用、故障排查 |
| [desktop/dsh-desktop/README.zh.md](desktop/dsh-desktop/README.zh.md) | 桌面客户端细节：数据位置、运行时管理、更新策略、自定义更新源 |
| [plugins/dsh-model-router/README.zh.md](plugins/dsh-model-router/README.zh.md) | 模型路由：配置项语义、路由规则、生效日志 |
| [plugins/dsh-mmx-vision/README.zh.md](plugins/dsh-mmx-vision/README.zh.md) | mmx 图像理解：前置要求、软检测行为、配置项 |

## 📁 目录结构

```
dsh-desktop/
├── install-plugins.ps1          # 插件一键安装/更新（含 mmx 软检测）
├── docs/
│   └── 使用说明.md               # 终用户手册
├── plugins/
│   ├── dsh-model-router/        # 模型路由插件
│   └── dsh-mmx-vision/          # mmx 图像理解插件（软检测，无 mmx 自动休眠）
└── desktop/
    └── dsh-desktop/             # Electron 桌面客户端（release\ 下为打包产物）
```

## ❓ 常见问题

**Q：桌面端和直接开 `dsh web` 有什么区别？**
功能完全一致——桌面端是官方 Web 版的壳，额外提供：双击启动、独立窗口与自定义标题栏（跟随页面明暗主题）、托盘常驻、DSH 运行时自动升级、壳自动更新。

**Q：没有 MiniMax 订阅，mmx 插件会不会报错？**
不会。mmx 检测贯穿安装与运行两层：安装脚本直接跳过；已安装的运行时静默休眠（不显示配置、不注册工具、零告警）。想恢复原版 describe-image 见 [插件 README](plugins/dsh-mmx-vision/README.zh.md#前置要求与软检测重要)。

**Q：更新检查会不会打扰我？**
未配置仓库 / 网络不可达时静默跳过（日志里有原因）；绿色版只弹一次提示，可选「忽略此版本（本次运行）」。

**Q：日志在哪？**
`%APPDATA%\DSH Desktop\logs\dsh-web.log`（本次）/ `dsh-web.prev.log`（上次）。

## ☕ 赞助

如果这个项目帮到了你，欢迎去 [爱发电](https://ifdian.net/a/zhibi) 请作者喝杯咖啡——这是持续维护的动力。

<p align="center">
  <a href="https://ifdian.net/a/zhibi" target="_blank" rel="noopener">
    <img src="https://img.shields.io/badge/%E7%88%B1%E5%8F%91%E7%94%B5-%E8%AF%B7%E5%96%9D%E6%9D%AF%E5%92%96%E5%95%A1-946CE6?style=flat-square" alt="爱发电 - 请喝杯咖啡" height="28" />
  </a>
</p>

不赞助也完全没关系：点个 ⭐ Star、提个 Issue、分享给朋友，同样是对项目最大的支持。

## ✨ 赞助者

感谢每一位支持者（名单每天自动从爱发电同步）：

<!-- sponsors:start -->
暂无赞助者——也许第一位就是你 ☕
<!-- sponsors:end -->

## 📄 许可与致谢

- 桌面客户端与插件：随本仓库发布。
- dsh-mmx-vision 移植自 [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 的 `@linxin666/dsh-tool-describe-image`（Apache-2.0）：附件路由 / 发送改写 / 缩略图预览 / 设置卡片骨架。
- 感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 [Electron](https://www.electronjs.org/)。

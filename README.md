# DeepSeek Harness 三件套

为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 打造的本地增强套件：

| 组件 | 位置 | 说明 |
|---|---|---|
| **dsh-model-router** | `plugins/dsh-model-router` | 模型路由插件：按「任务类型」自动选择模型——主会话 / 子代理角色路由 + 轻量/重型关键词规则，简单任务用便宜模型，重型任务用贵模型，节省费用。侧边栏独立「模型路由」入口，Provider / 模型下拉选自已配置列表 |
| **dsh-mmx-vision** | `plugins/dsh-mmx-vision` | 图像理解插件：接管 `describe_image` 工具，后端切换为本地 `mmx` CLI（MiniMax VLM），复用 mmx 已有登录态，零额外配置。含输入框图片按钮（附件上传路由 + 发送改写 + 会话内缩略图预览） |
| **dsh-desktop** | `desktop/dsh-desktop` | Electron Windows 桌面客户端：双击启动（绿色免安装）、托盘常驻、自定义标题栏跟随页面主题、DSH 运行时 npm 自动更新、electron-updater/GitHub 壳自动更新接线 |

## 快速开始

```powershell
# 1. 一键安装两个插件到 web 与 headless profile
#    （自动打包 tarball → npm install → 注册 bundles → 禁用旧 describe-image，幂等可重跑）
.\install-plugins.ps1
.\install-plugins.ps1 -Profiles web      # 只装某一个 profile
.\install-plugins.ps1 -SkipPack          # 复用 dist\ 里现有 tarball

# 2. 重启 dsh web（或 DSH Desktop）生效
#    验证：侧边栏出现「模型路由」入口；带图消息自动走 mmx 描述

# 3. 桌面客户端（开发模式）
cd desktop\dsh-desktop
npm install
npm start

# 4. 桌面客户端绿色版打包
#    → release\DSH-Desktop-<版本>-portable-win-x64.zip（解压双击即用）
npm run dist
```

详细文档见各子目录的 `README.zh.md`。

## 目录

```
DeepseekHarness/
├── install-plugins.ps1        # 插件一键安装/更新脚本（幂等）
├── dist/                      # npm pack 产物（两个插件 tarball）
├── plugins/
│   ├── dsh-model-router/      # 模型路由插件
│   └── dsh-mmx-vision/        # mmx 图像理解插件
└── desktop/
    └── dsh-desktop/           # Electron 桌面客户端（release\ 下为打包产物）
```

## 验证记录（本机）

- **模型路由**：Playwright 端到端——侧边栏入口渲染、配置页 10 个下拉（provider 联动模型列表）、保存写入 `~/.dsh/settings.yaml`、零控制台错误；路由日志（`A/B -> C/D (light: keyword …)`）实测可见。
- **mmx-vision**：带图消息经附件路由上传（`POST /mmx-vision/attach`），`describe_image` 工具由 mmx CLI（MiniMax VLM）应答，截图描述实测通过；VLM 截图审查确认 UI 布局。
- **dsh-desktop**：打包 exe 端到端启动——运行时自检 → dsh web 在 3081 就绪（自动避开占用端口）→ `GET /` 200；启动页含「by 韋家小寶」署名。

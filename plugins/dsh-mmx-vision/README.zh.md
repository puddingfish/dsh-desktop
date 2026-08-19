# dsh-mmx-vision — mmx 图像理解插件

给 DeepSeek Harness 的 `describe_image` 工具换上你本地的 **mmx CLI**（MiniMax VLM）后端：文本模型也能「看图」了，而且**复用 mmx 已有的登录态，零额外配置**（不需要填 baseURL / API Key）。

## 前置要求与软检测（重要）

想用起来，前提是：

1. **有 MiniMax 账号/订阅**，并安装 CLI：`npm install -g mmx-cli`
2. 登录过一次：`mmx login`（登录态被本插件复用）

**本机没有 mmx？没关系——插件会自动「静默休眠」，不打扰任何人：**

- `install-plugins.ps1` 检测不到 mmx（npm 全局 / PATH 均无）时**直接跳过本插件**，不写任何配置；
- 已安装的副本在 dsh web 启动时重新检测，检测不到就整体休眠：不注册 `describe_image` 工具、不显示设置卡片、不拦截图片发送，控制台**零告警零报错**——就像没装过一样；
- 装好 mmx 后重跑 `.\install-plugins.ps1` 并重启 dsh web / DSH Desktop 即恢复。

想彻底恢复原版 describe-image（dsh-web-ui-all 自带，走主模型自带视觉能力）：

```powershell
dsh plugin --profile web remove dsh-mmx-vision
# 然后删除 ~/.dsh/profiles/web/cordis.patch.yml 里这段（若存在）：
#   - id: describe-image
#     disabled: true
```

> 检测在启动时定格（改配置/装 mmx 后需重启生效）：显式配置了 `mmxPath` 时无条件信任并激活；
> 否则依次探测 npm 全局 mmx-cli 与 PATH 上的 mmx 可执行文件。休眠状态可随时经
> `GET /mmx-vision/status` 查询（`{"ok":true,"value":{"available":false,"mode":"absent"}}`）。

## 功能

- **接管 `describe_image` 工具**：模型可传入
  - 本地图片绝对路径
  - http(s) 图片 URL（直接透传给 mmx，由它下载）
  - 附件引用 JSON / 裸附件 id（`sha256:…`，从 `![图片](/mmx-vision/raw/…)` 引用里抄出来的）
- **输入框图片按钮**：聊天框原生图片按钮选择的图片，发送时自动改写为 mmx-vision 引用（上传到宿主附件库，字节不进会话日志）
- **会话内缩略图预览**：会话里的图片引用原地渲染为缩略图，点击看大图（仅本地显示，消息文本与模型侧不变）
- **设置卡片**：设置 → 插件配置 →「图像理解（mmx）」，可配 mmx 路径、默认指令、超时等（休眠时隐藏）
- **短时语义缓存**：同图同提示词 10 秒内不重复调用 mmx

## 工作原理

宿主半边在收到 `describe_image` 调用时：

1. 解析图像输入（附件引用 → 读附件库字节 → 落临时文件；本地路径 → 校验魔数与字节上限；URL → 原样透传）
2. 用 `node <mmx-cli 的 JS 入口> vision describe --image … --prompt … --output json --non-interactive` 直调 mmx（自动发现 npm 全局 mmx-cli；绕开 Windows 上 .ps1/.cmd shim 的 spawn 限制，也避免 shell 转义问题）
3. 解析 JSON 输出（`content` + `base_resp.status_code` 校验），把文本返回给模型；临时文件随即清理

图像字节**永远不进会话日志**——只有 mmx 的文本回答进入对话。

## 安装

```powershell
# 仓库根目录的一键脚本（检测到 mmx 才装本插件，并自动禁用旧的 describe-image 插件行）
.\install-plugins.ps1
.\install-plugins.ps1 -ForceMmx    # 本机暂时没有 mmx 也先装上（运行时会静默休眠）
```

或手动：

```powershell
# 1. 禁用全家桶里旧的 describe-image（工具名冲突）
#    在 ~/.dsh/cordis.patch.yml 追加：
#      - id: web-ui-describe-image
#        disabled: true
# 2. 安装
dsh plugin --profile web add <本插件目录打包的 tgz>
```

> ⚠️ 本插件与 dsh-web-ui-all 里的旧 describe-image 都注册 `describe_image` 工具，**必须禁用旧行**，否则启动报「tool already registered」。`install-plugins.ps1` 自动处理。

## 配置（~/.dsh/settings.yaml 的 `mmx-vision` 节）

```yaml
mmx-vision:
  mmxPath: ''            # 留空自动发现 npm 全局 mmx-cli；可填包目录 / bin JS / 可执行文件
  defaultPrompt: '…'     # 调用未带 prompt 时的默认指令
  maxBytes: 10485760     # 图片字节上限（默认 10MB）
  timeoutMs: 180000      # 单次 mmx 调用超时
  renderImagePreview: true
  interceptImageSend: true
```

前提：`mmx` 已登录（`mmx auth status` 正常）。

## 致谢

移植自 [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 的 `@linxin666/dsh-tool-describe-image`（Apache-2.0）：附件路由 / 发送改写 / 缩略图预览 / 设置卡片骨架均来自该插件。

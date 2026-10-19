# DSH Desktop v0.1.7

修复 dsh 版本判断：不再把「已装版本比 registry 新」误判成可升级。

## 桌面端
- **修复误报升级（降级提示）**：`checkDshUpdate` 原先用「已装版本 !== registry 版本」判断有无更新。官方 `latest` 长期停在 0.2.0-rc.2 时，已装 0.2.1-rc.x 的用户会收到「0.2.1-rc.1 → 0.2.0-rc.2」的提示，点「升级」反而把版本降回去。现改为语义化版本比较（semver §11，含 `-rc.N` 预发布排序），只有 registry 版本**严格更新**时才提示
- **版本通道感知**：registry 查询从只读 `latest` 标签改为同时读 `latest` 与 `next`、取语义化版本较新者。0.2.1 系列一直只发布在 `next` 上（官方 `latest` 自 2026-09-29 起未动），原先永远发现不了。可用环境变量 `DSH_DESKTOP_DSH_TAG` 覆盖默认通道（默认 `latest,next`；只写一个即固定该通道）
- **升级改为安装刚查到的确切版本**：`npm i -g @deepseek-ai/dsh@<version>`（原来是 `@latest` 标签），保证装的正是提示里那个版本，也避免查询与安装之间标签漂移；registry 不比已装新时直接拒绝升进，从根上杜绝降级
- `dshVersionAtLeast` 复用同一版本解析器（刻意保持原有「rc 视同正式版」语义，`--no-open` 传参判断不受影响）
- 新增回归测试 `desktop/dsh-desktop/scripts/test-dsh-update.mjs`：`node scripts/test-dsh-update.mjs`（纯函数用例）或加 `--live` 再查一次真实 registry
- 版本号 0.1.6 → 0.1.7

## 升级方式
- 安装版：应用内自动更新，或下载下方 NSIS 安装包
- 绿色版：下载 zip 覆盖

## 排查记录（2026-10-19）
- 本机全局 dsh：`0.2.0-rc.2` → 手动升到 `0.2.1-rc.2`（`%APPDATA%\npm\node_modules\@deepseek-ai\dsh`）
- npm dist-tags（官方与 npmmirror 一致）：`latest=0.2.0-rc.2`、`next=0.2.1-rc.2`、`alpha=0.2.1-alpha.5`
- 修复后 `checkDshUpdate()` 实测：`{"available":false,"installed":"0.2.1-rc.2","latest":"0.2.1-rc.2","source":"npm-global"}`

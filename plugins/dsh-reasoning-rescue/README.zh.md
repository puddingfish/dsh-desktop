# dsh-reasoning-rescue

DSH host 插件：检测「模型只思考、未作答」的回合并自动发送救援消息。

## 背景

GLM-5.3（经 codely/litellm 本地代理）在长思考（约 10k+ reasoning tokens）后有概率以
`finish_reason=stop` 正常结束，但**不输出任何正文** —— 会话日志表现为 turn completed、
最后一条 assistant 消息只有 reasoning 块。用户看到的是「think 完什么都没有」。
dsh-client-auto-continue 只覆盖 error / interrupted / max-tokens，不管 completed。

本会话取证数据：76 个 reasoning-only completed 全部来自 GLM-5.3（占其完成回合的 19.3%），
其他模型 0 例。

## 行为

监听 `session/event` 的 `turn/end`：

- `completed` 且该 turn 全部 assistant 消息只含 reasoning 块 → 延迟 `settleMs`（默认 1.5s）
  后发送救援 followup：「（自动救援：上一条回复只有思考过程、没有输出正文）请基于刚才的思考，
  直接给出完整的回答……」
- 防循环护栏：
  - 每会话连续救援上限 `maxConsecutive`（默认 2）；出现正常输出即清零
  - 若输入本身就是救援消息而 turn 仍 silent → 立即停手（等用户介入）
  - 两次救援冷却 `cooldownMs`（默认 10s）
  - 发送前复核 turn 后无新事件（用户抢先则让位）；agent 正在运行则跳过

## 配置（~/.dsh/settings.yaml 的 reasoning-rescue 节）

```yaml
reasoning-rescue:
  enabled: true
  rescueText: （自动救援：……）请基于刚才的思考，直接给出完整的回答…
  maxConsecutive: 2
  cooldownMs: 10000
  settleMs: 1500
  verbose: false
```

## 安装

```powershell
# 仓库根目录
.install-plugins.ps1 -Profiles web        # 或 headless / 全部
```

重启 dsh web / DSH Desktop 后生效。

## 与 auto-continue 的关系

互补而非重叠：auto-continue 管 error/interrupted/max-tokens（重新尝试），
本插件管 completed-but-silent（让模型把想好的答案写出来）。救援后若新 turn 报错，
auto-continue 自然接管。

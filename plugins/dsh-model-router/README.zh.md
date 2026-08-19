# dsh-model-router — DSH 模型路由插件

按「任务类型」自动为每次 LLM 请求选择模型：**简单任务、写文档走便宜模型，重型任务走贵且能力强的模型**，在不动 DSH 源码的前提下省模型费用。

## 原理

监听官方 `agent/request` 瀑布事件（DSH 设计好的模型路由扩展点，与「会话内手动切换模型」同一管线）：每次请求组装完成后，按规则改写 `provider`/`model`，其余参数（temperature、maxTokens、stop）原样保留。主会话、子代理（subagent）都走这条路由；改写结果会进入会话的 `request/header` 事件，与折叠请求头的完整性校验完全兼容。

## 路由规则（全部可在设置页配置，`~/.dsh/settings.yaml` 的 `model-router` 节）

| 规则 | 作用对象 | 说明 |
|---|---|---|
| `mainProvider` / `mainModel` | 主会话 | 未命中关键词规则时的主会话基础模型；留空 = 不改写 |
| `subagentProvider` / `subagentModel` | 子代理 | 所有委派的后台任务（subagent、subagent_fork）；留空 = 沿用继承的模型。**这是最大的省钱点**：后台研究、独立小任务通常不需要旗舰模型 |
| `lightEnabled` + `lightKeywords` → `lightProvider`/`lightModel` | 主会话 & 子代理 | 命中任一关键词（逗号/换行分隔，不区分大小写）→ 路由到轻量模型，如「总结、写文档、翻译、改名」 |
| `heavyEnabled` + `heavyKeywords` → `heavyProvider`/`heavyModel` | 主会话 & 子代理 | 轻量规则未命中时检查，命中 → 路由到强模型，如「重构、架构、调试、性能优化」 |

匹配对象是**当前待处理的用户消息**（主会话取最后一条用户消息，子代理取委派任务提示词），检查顺序 light → heavy → 角色基础路由。同一回合（turn）内路由决策缓存，回合内模型稳定。

其它行为：

- **尊重显式选择**（`respectExplicit`，默认开）：请求的模型已偏离全局默认（你在会话里手动选过模型、workflow 阶段显式指定了 provider/model、subagent 指定了模型）时不干预。
- **换模型自动剥离 `reasoningEffort`**：与官方 `installModelSelection` 行为一致，避免新模型不支持旧思考档位导致请求报错。
- **透明可审计**：每个回合输出一行路由日志（`model-router: [session … turn …] A/B -> C/D (light: keyword "总结")`），随 `dsh web` 控制台可见。
- **故障安全**：路由器任何异常都会回退原配置，绝不阻断请求。

### 已知边界

- workflow 的 worker-thread 阶段运行在独立线程的 cordis 上下文里，不走本路由（workflow 脚本本身支持按阶段指定 provider/model，那是官方机制）。
- 上下文压缩（compaction）与会话标题生成有各自的模型设置（`compaction-basic` 的 summarization 配置、`session-title-llm` 的 provider 配置），不走 agent 请求管线，可在 `~/.dsh/settings.yaml` 单独设成便宜模型。

## 安装 / 更新

```powershell
# 在仓库根目录下执行（<仓库路径> = 本仓库克隆到的位置）
dsh plugin --profile web add <仓库路径>\plugins\dsh-model-router
```

（或仓库根目录的 `install-plugins.ps1` 一键安装全部插件。）

重启 `dsh web` 后，**侧边栏会出现「模型路由」独立入口**（位于任务看板 / SSH 之后），点击进入全屏配置页：

- 页首显示当前「全局默认模型」作参考；
- Provider / 模型均为**下拉选择**，选项来自你已配置的模型列表（`GET /model-router/models`，由 host 半边实时读取 settings；读不到时自动降级为手动输入）；
- 未保存的修改以「未保存」徽标提示，保存 / 放弃按钮在页脚；改坏的字段有红色提示。

也可以直接编辑 `~/.dsh/settings.yaml`：

```yaml
model-router:
  enabled: true
  respectExplicit: true
  # 主会话基础路由（留空不改写）
  mainProvider: codely
  mainModel: GLM-5.3
  # 子代理走便宜模型
  subagentProvider: codely
  subagentModel: glm-4-flash
  # 轻量关键词 → 便宜模型
  lightEnabled: true
  lightKeywords: 总结, 写文档, 翻译, 改名, 格式化
  lightProvider: codely
  lightModel: glm-4-flash
```

## 卸载

```powershell
dsh plugin --profile web remove dsh-model-router
```

## 致谢

设置卡片骨架（PluginSettingsCard / CardForm）移植自 [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 家族（Apache-2.0）。

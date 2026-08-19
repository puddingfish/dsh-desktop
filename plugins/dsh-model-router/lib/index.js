/**
 * DSH 模型路由插件（host 半边）。
 *
 * 通过官方 `agent/request` 瀑布事件改写每次 LLM 请求的 provider/model：
 * - 角色路由：主会话（main）与子代理（subagent，`AgentOptions.subagentDepth > 0`）
 *   可分别指定模型——后台委派任务默认走便宜模型是最大的省钱点；
 * - 关键词规则：轻量（light）/重型（heavy）两组关键词，命中当前待处理
 *   用户消息即路由到对应模型（light 优先于 heavy）；
 * - 尊重显式选择：默认当请求的 provider/model 与 agentDefaultModel 不同
 * （用户在会话里手动选过、workflow 阶段显式指定、subagent 指定了模型）时不干预；
 * - 同一回合（turn）内路由决策缓存，保证回合内模型稳定；
 * - 换模型时剥离继承的 reasoningEffort（与 installModelSelection 行为一致），
 *   避免新模型不支持旧 effort 导致请求失败。
 *
 * 路由决策每回合输出一行日志，完全透明可审计。所有异常都吞掉并回退原配置，
 * 路由器故障绝不阻断请求。
 *
 * 设置命名空间 `model-router`（~/.dsh/settings.yaml），设置卡片注册在
 * web-ui 插件配置页（`web-ui.plugin.item` 槽位）。
 * @module dsh-model-router
 */

import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** 插件名（cordis loader 用）。 */
export const name = 'model-router'

/** 本插件不硬依赖任何 host 服务：agentDefaultModel / settings 都是可选能力。 */
export const inject = []

/** 设置命名空间（settings.yaml 顶层键）。 */
export const MODEL_ROUTER_SETTINGS_NAMESPACE = settingsNamespace('model-router')

/**
 * 从 settings 原始文档里提取「已配置的 provider 与模型」清单（供下拉选择）。
 * 只输出 id / displayName / models（id+name），不带 apiKey / baseURL 等敏感或
 * 无关字段。settings 服务不可用或未配置 providers 时返回空数组。
 */
export function extractProviderCatalog(settingsService) {
  const providers = settingsService?.document?.['llm-pi-ai']?.providers
  if (providers === undefined || typeof providers !== 'object' || providers === null) return []
  const catalog = []
  for (const [id, spec] of Object.entries(providers)) {
    if (spec === null || typeof spec !== 'object') continue
    const models = Array.isArray(spec.models)
      ? spec.models
          .map((model) => ({
            id: typeof model?.id === 'string' ? model.id : '',
            name: typeof model?.name === 'string' && model.name !== '' ? model.name : undefined,
          }))
          .filter((model) => model.id !== '')
      : []
    catalog.push({
      id,
      displayName: typeof spec.displayName === 'string' && spec.displayName !== '' ? spec.displayName : id,
      models,
    })
  }
  return catalog
}

/**
 * 在共享 webserver 上注册 GET /model-router/models：返回 provider 目录、
 * 全局默认模型与当前路由配置，供独立配置页渲染下拉。webserver 可选。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {() => object} readConfig - 当前路由配置读取器。
 */
export function registerModelsRoute(ctx, readConfig) {
  // fiber inject：webServer 就绪（或重组后再次就绪）时挂路由，卸载时自动回收。
  ctx.inject(['webServer'], () => {
    const webserver = ctx.get('webServer')
    webserver.register({
      kind: 'prefix',
      path: '/model-router',
      handler: async (req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://x').pathname
        if (req.method !== 'GET' || pathname !== '/model-router/models') {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: { code: 'not-found', message: 'only GET /model-router/models is served' } }))
          return
        }
        const value = {
          providers: extractProviderCatalog(ctx.get('settings')),
          default: (() => {
            try {
              return ctx.get('agentDefaultModel')?.currentSelection() ?? undefined
            } catch {
              return undefined
            }
          })(),
          current: readConfig(),
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, value }))
      },
    })
  })
}

/** 分类文本的截断长度：关键词匹配只看前若干字符，避免超长消息拖慢匹配。 */
const CLASSIFY_TEXT_MAX_CHARS = 4000

/** 回合决策缓存的容量上限（超过即整体清空，按会话数而非消息数增长）。 */
const TURN_CACHE_MAX_SESSIONS = 64

/** schemastery 配置；同时作为 `model-router` 设置节的 schema（设置卡片据此渲染）。 */
export const Config = z.object({
  enabled: z.boolean().default(true),
  respectExplicit: z.boolean().default(true),
  mainProvider: z.string().default(''),
  mainModel: z.string().default(''),
  subagentProvider: z.string().default(''),
  subagentModel: z.string().default(''),
  lightEnabled: z.boolean().default(false),
  lightKeywords: z.string().default(''),
  lightProvider: z.string().default(''),
  lightModel: z.string().default(''),
  heavyEnabled: z.boolean().default(false),
  heavyKeywords: z.string().default(''),
  heavyProvider: z.string().default(''),
  heavyModel: z.string().default(''),
})

/** 把逗号/分号/换行分隔的关键词串拆成小写数组。 */
export function parseKeywords(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return []
  return raw
    .split(/[,，;；\n]+/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length > 0)
}

/** 读取一条路由；provider/model 任一为空视为未配置。 */
function routeOf(provider, model) {
  const p = typeof provider === 'string' ? provider.trim() : ''
  const m = typeof model === 'string' ? model.trim() : ''
  if (p === '' || m === '') return undefined
  return { provider: p, model: m }
}

/** 汇总配置里的全部可用路由。 */
function collectRoutes(cfg) {
  const routes = {
    main: routeOf(cfg.mainProvider, cfg.mainModel),
    subagent: routeOf(cfg.subagentProvider, cfg.subagentModel),
    light: routeOf(cfg.lightProvider, cfg.lightModel),
    heavy: routeOf(cfg.heavyProvider, cfg.heavyModel),
  }
  routes.any = routes.main !== undefined || routes.subagent !== undefined || routes.light !== undefined || routes.heavy !== undefined
  return routes
}

/** 提取一条消息里的纯文本（text 内容块拼接）。 */
function textOfMessage(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') text += block.text + '\n'
  }
  return text
}

/**
 * 取用于分类的待处理用户文本。
 * 只认 `source.kind === 'user'` 的真实用户输入（运行时上下文是 `plugin`、
 * 技能目录是 `skill-catalog`、工具结果是 `tool`，都不参与分类）。
 * 主会话取最后一条真实用户消息；子代理取第一条（委派任务提示词）。
 */
function classifyTextOf(agent, isSubagent) {
  let messages
  try {
    messages = agent?.session?.deriveMessages?.() ?? []
  } catch {
    return ''
  }
  const userMessages = []
  for (const message of messages) {
    if (message?.role !== 'user') continue
    if (message?.source?.kind !== 'user') continue
    userMessages.push(message)
  }
  const chosen = isSubagent ? userMessages[0] : userMessages[userMessages.length - 1]
  if (chosen === undefined) return ''
  return textOfMessage(chosen).slice(0, CLASSIFY_TEXT_MAX_CHARS)
}

/** 关键词匹配：light 优先于 heavy，返回命中的规则名。 */
function matchKeywords(cfg, text) {
  if (text === '') return undefined
  const lower = text.toLowerCase()
  if (cfg.lightEnabled !== false) {
    for (const keyword of parseKeywords(cfg.lightKeywords)) {
      if (lower.includes(keyword)) return { rule: 'light', keyword }
    }
  }
  if (cfg.heavyEnabled !== false) {
    for (const keyword of parseKeywords(cfg.heavyKeywords)) {
      if (lower.includes(keyword)) return { rule: 'heavy', keyword }
    }
  }
  return undefined
}

/** 判定 agent 是否子代理。 */
function isSubagentAgent(agent) {
  const depth = agent?.options?.subagentDepth
  return typeof depth === 'number' && depth > 0
}

/** 会话 id（Agent 的 id 即会话 id）。 */
function sessionIdOf(agent) {
  return agent?.id ?? agent?.session?.id ?? 'unknown'
}

/**
 * 做出一次路由决策（不含 respectExplicit 判断——那需要 resolved 配置）。
 * @returns {RouteSpec & {name: string, reason: string} | undefined}
 */
function decideRoute(cfg, routes, agent) {
  const subagent = isSubagentAgent(agent)
  const text = classifyTextOf(agent, subagent)
  const hit = matchKeywords(cfg, text)
  if (hit !== undefined) {
    const route = routes[hit.rule]
    if (route !== undefined) return { ...route, name: hit.rule, reason: `keyword "${hit.keyword}"` }
  }
  if (subagent) {
    return routes.subagent === undefined ? undefined : { ...routes.subagent, name: 'subagent', reason: 'delegated subagent' }
  }
  return routes.main === undefined ? undefined : { ...routes.main, name: 'main', reason: 'main conversation' }
}

/** 应用一条路由：改写 provider/model 并剥离继承的 reasoningEffort。 */
function applyRoute(resolved, route) {
  if (route === undefined) return undefined
  if (route.provider === resolved.provider && route.model === resolved.model) return undefined
  const { reasoningEffort: _inheritedEffort, ...withoutEffort } = resolved
  return { ...withoutEffort, provider: route.provider, model: route.model }
}

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {object} [config] - 组合层配置（loader 已填 schema 默认值）。
 */
export function apply(ctx, config = {}) {
  let current = () => config
  installSettingsSection(ctx, MODEL_ROUTER_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  // 独立配置页的数据源（provider/模型目录 + 默认模型 + 当前配置）。
  registerModelsRoute(ctx, () => {
    try {
      return current()
    } catch {
      return {}
    }
  })

  // 每会话缓存「回合 → 决策」，保证同一回合内所有 step 路由一致，
  // 也避免每个 step 都重新做关键词匹配。
  const turnDecisions = new Map()

  ctx.on(
    'agent/request',
    async (payload, next) => {
      // 永远先放行内层（会话模型选择、基础配置组装），拿到结果再决定是否改写。
      const resolved = await next()
      try {
        const cfg = current()
        if (cfg?.enabled === false) return resolved
        const routes = collectRoutes(cfg)
        if (!routes.any) return resolved

        // 尊重显式选择：请求路由已偏离全局默认（用户在会话里手动换过模型、
        // workflow 阶段指定了 provider/model、subagent 指定了模型）时不干预。
        if (cfg.respectExplicit !== false) {
          const defaultSelection = ctx.get('agentDefaultModel')?.currentSelection()
          if (
            defaultSelection !== undefined &&
            (resolved.provider !== defaultSelection.provider || resolved.model !== defaultSelection.model)
          ) {
            return resolved
          }
        }

        const agent = payload?.agent
        const subagent = isSubagentAgent(agent)
        const hit = matchKeywords(cfg, classifyTextOf(agent, subagent))
        const sessionId = sessionIdOf(agent)
        const turn = payload?.turn ?? 0
        let decision
        const cached = turnDecisions.get(sessionId)
        if (cached !== undefined && cached.turn === turn) {
          decision = cached.decision
        } else {
          decision = hit !== undefined && routes[hit.rule] !== undefined
            ? { ...routes[hit.rule], name: hit.rule, reason: `keyword "${hit.keyword}"` }
            : subagent
              ? routes.subagent === undefined ? undefined : { ...routes.subagent, name: 'subagent', reason: 'delegated subagent' }
              : routes.main === undefined ? undefined : { ...routes.main, name: 'main', reason: 'main conversation' }
          if (turnDecisions.size > TURN_CACHE_MAX_SESSIONS) turnDecisions.clear()
          turnDecisions.set(sessionId, { turn, decision })
        }

        if (decision !== undefined) {
          const rewritten = applyRoute(resolved, decision)
          if (rewritten !== undefined) {
            ctx.logger.info(
              'model-router: [session %s turn %s] %s/%s -> %s/%s (%s: %s)',
              sessionId,
              turn,
              resolved.provider,
              resolved.model,
              decision.provider,
              decision.model,
              decision.name,
              decision.reason,
            )
            return rewritten
          }
          ctx.logger.info(
            'model-router: [session %s turn %s] keep %s/%s (%s: %s)',
            sessionId,
            turn,
            resolved.provider,
            resolved.model,
            decision.name,
            decision.reason,
          )
        }
        return resolved
      } catch (error) {
        // 路由器自身故障绝不阻断请求：记录后原样放行。
        ctx.logger.warn('model-router: routing failed, keeping %s/%s', resolved?.provider, resolved?.model)
        ctx.logger.warn(error)
        return resolved
      }
    },
    { global: true },
  )
}


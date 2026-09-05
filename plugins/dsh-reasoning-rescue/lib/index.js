/**
 * DSH reasoning-rescue 插件（host 半边）。
 *
 * 背景：GLM-5.3（经 codely 代理）在长思考（~10k+ reasoning tokens）后有概率以
 * finish_reason=stop 结束且不输出任何正文 —— 会话表现为「think 完什么都没有」，
 * turn 却是 completed，auto-continue 插件不覆盖这种情形（它只管 error/interrupted/max-tokens）。
 *
 * 本插件监听 session/event 的 turn/end：
 * - reason.kind === 'completed' 且该 turn 的全部 assistant 消息只含 reasoning 块
 *   （无 text / tool-call）→ 判定「只思考未作答」，延迟片刻后自动发送救援 followup，
 *   提示模型基于已有思考直接给出回答。
 *
 * 防循环护栏：
 * - 每会话连续救援上限（默认 2 次）；出现正常输出（有正文/工具调用）即清零计数；
 * - 若输入本身就是本插件的救援消息而 turn 仍 silent → 救援无效，立即停手；
 * - 两次救援之间冷却（默认 10 秒）；发送前复核 turn 之后无新事件（用户抢先则让位）。
 *
 * 设置命名空间 reasoning-rescue（~/.dsh/settings.yaml）：
 *   enabled / rescueText / maxConsecutive / cooldownMs / settleMs / verbose
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** 插件名（cordis loader 用）。 */
export const name = 'reasoning-rescue'

/** 依赖宿主服务：agents 注册表（settings 可选，经 try 挂接）。 */
export const inject = ['agents']

/** 设置命名空间与 schema（同时作为组合层配置 schema）。 */
export const Config = z.object({
  enabled: z.boolean().default(true),
  rescueText: z.string().default('（自动救援：上一条回复只有思考过程、没有输出正文）请基于刚才的思考，直接给出完整的回答；如果思考已足够，无需重新推演。'),
  maxConsecutive: z.natural().default(2),
  cooldownMs: z.natural().default(10_000),
  settleMs: z.natural().default(1_500),
  verbose: z.boolean().default(false),
})

/** 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {object} config - 组合层配置（loader 已填 schema 默认值）。
 */
export function apply(ctx, config = {}) {
  const cfg = { ...config }
  let current = () => cfg

  // settings 服务可用时挂接热更新；不可用时静默退回组合层配置。
  try {
    const settings = ctx.get('settings')
    if (settings !== undefined && settings !== null) {
      installSettingsSection(ctx, settingsNamespace('reasoning-rescue'), Config, cfg, {
        setSource: (source) => { current = source },
        onChange: () => {},
      })
    }
  } catch { /* settings 不可用 */ }

  /** 会话救援状态（内存即可：宿主重启后重新计数是可接受的保守行为）。 */
  const state = new Map() // sessionId -> { consecutive, lastAt, timer }
  const MAX_SESSIONS = 256

  function stateOf(sessionId) {
    let s = state.get(sessionId)
    if (s === undefined) {
      if (state.size > MAX_SESSIONS) state.clear()
      s = { consecutive: 0, lastAt: 0, timer: undefined }
      state.set(sessionId, s)
    }
    return s
  }

  function log(...args) {
    if (current().verbose === true) ctx.logger.info('reasoning-rescue:', ...args)
  }

  /** 判定一条 assistant 消息是否「只有 reasoning 块」。 */
  function isReasoningOnly(message) {
    const blocks = message?.content
    if (!Array.isArray(blocks) || blocks.length === 0) return false
    let reasoning = false
    for (const block of blocks) {
      if (block?.type === 'reasoning') { reasoning = true; continue }
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') return false
      if (block?.type === 'tool-call') return false
    }
    return reasoning
  }

  /**
   * 从会话事件中收集一个 turn 的 assistant 消息。
   * @param {object} session - 会话对象（带 events 数组）。
   * @param {number} turn - 回合号。
   */
  function assistantMessagesOf(session, turn) {
    const messages = []
    for (const event of session.events) {
      if (event.type !== 'assistant/message') continue
      if (event.data?.turn !== turn) continue
      if (event.data?.interrupted === true) continue // 中断消息不参与判定
      messages.push(event.data.message)
    }
    return messages
  }

  /** 救援消息回显识别前缀。 */
  const RESCUE_PREFIX = '（自动救援'

  /** 最后一条用户文本是否我们的救援消息。 */
  function lastUserTextIsOurs(session) {
    for (let i = session.events.length - 1; i >= 0; i--) {
      const event = session.events[i]
      if (event.type !== 'user/message') continue
      const message = event.data?.message ?? event.data
      const blocks = message?.content
      if (!Array.isArray(blocks)) return false
      const text = blocks.filter(b => b?.type === 'text').map(b => b.text).join('')
      return typeof text === 'string' && text.startsWith(RESCUE_PREFIX)
    }
    return false
  }

  ctx.on('session/event', (session, event) => {
    try {
      if (event.type !== 'turn/end') return
      if (event.data?.reason?.kind !== 'completed') return
      if (current().enabled === false) return

      const sessionId = session.id
      const turn = event.data.turn
      const s = stateOf(sessionId)

      const messages = assistantMessagesOf(session, turn)
      if (messages.length === 0) return
      if (!messages.every(isReasoningOnly)) {
        // 正常输出：救援计数清零
        if (s.consecutive !== 0) log(sessionId, 'turn', turn, '有正常输出, 计数清零')
        s.consecutive = 0
        return
      }

      // 只思考未作答。若输入本身就是我们的救援消息 → 救援无效，停手。
      if (lastUserTextIsOurs(session)) {
        log(sessionId, 'turn', turn, '救援后仍只思考, 停止自动救援')
        s.consecutive = Number.MAX_SAFE_INTEGER
        return
      }

      const now = Date.now()
      const limit = current().maxConsecutive
      if (s.consecutive >= limit) {
        log(sessionId, 'turn', turn, '连续救援达上限', limit, ', 跳过')
        return
      }
      if (now - s.lastAt < current().cooldownMs) {
        log(sessionId, 'turn', turn, '冷却中, 跳过')
        return
      }

      // 延迟发送：留出竞态窗口，发送前复核 turn 之后没有新事件（用户抢先则让位）。
      if (s.timer !== undefined) clearTimeout(s.timer)
      const endSeq = event.seq
      s.timer = setTimeout(() => {
        s.timer = undefined
        try {
          const cfgAtSend = current()
          if (cfgAtSend.enabled === false) return
          const agent = ctx.agents.get(sessionId)
          if (agent === undefined) { log(sessionId, '无 live agent, 跳过'); return }
          if (agent.status === 'running') { log(sessionId, '回合又在运行, 跳过'); return }
          const lastEvent = session.events[session.events.length - 1]
          if (lastEvent !== undefined && lastEvent.seq > endSeq) {
            log(sessionId, 'turn', turn, '之后有新事件, 让位给用户')
            return
          }
          s.lastAt = Date.now()
          s.consecutive += 1
          agent.followup(createUserMessage({
            content: [{ type: 'text', text: cfgAtSend.rescueText }],
            source: { kind: 'user' },
          }))
          ctx.logger.info('reasoning-rescue: [%s turn %s] 只思考未作答, 已发送救援(第 %s 次)', sessionId, turn, s.consecutive)
        } catch (error) {
          ctx.logger.warn('reasoning-rescue: 发送失败 %s: %s', sessionId, error instanceof Error ? error.message : String(error))
        }
      }, current().settleMs)
    } catch (error) {
      ctx.logger.warn('reasoning-rescue: 事件处理异常: %s', error instanceof Error ? error.message : String(error))
    }
  })

  ctx.effect(() => () => {
    for (const s of state.values()) if (s.timer !== undefined) clearTimeout(s.timer)
    state.clear()
  }, 'reasoning-rescue: 清理定时器与状态')
}

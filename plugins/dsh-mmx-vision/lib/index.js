/**
 * DSH mmx 图像理解插件（host 半边）。
 *
 * 接管 `describe_image` 工具：模型调用时，把图像（本地路径 / http(s) URL /
 * 附件引用）交给本地 `mmx vision describe`（MiniMax VLM，复用 mmx 已有登录态），
 * 只把返回的文本带回会话——图像字节永远不进会话日志。
 *
 * 与原版 describe-image 的差异：
 * - 后端从「OpenAI 兼容 HTTP 端点」换成「mmx CLI 子进程」，无需 baseURL/apiKey 配置；
 * - 附件引用的字节落到临时文件再交给 mmx（mmx 只接受路径/URL）；
 * - 附件路由前缀 /mmx-vision/*，客户端半边（输入框图片按钮、发送改写、缩略图
 *   预览、设置卡片）随包分发。
 *
 * 移植自 @linxin666/dsh-tool-describe-image（Apache-2.0）。
 * @module dsh-mmx-vision
 */

import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_MAX_BYTES } from './media.js'
import { registerAttachRoute } from './attach-routes.js'
import { callMmxVision, createVisionCache, resolveImage } from './mmx-client.js'

/** 插件名（cordis loader 用）。 */
export const name = 'mmx-vision'

/** 工具注册必需；webServer 可选（headless 无 webserver 也能用工具）。 */
export const inject = ['tools']

/** 设置命名空间。 */
export const MMX_VISION_SETTINGS_NAMESPACE = settingsNamespace('mmx-vision')

/** 默认提示词。 */
export const DEFAULT_PROMPT =
  'Analyze this image: describe what is visible factually, transcribe legible text verbatim, and call out layout, notable details, or anything anomalous.'

/** 默认单次调用超时（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 180_000

/** mmx 直调输出上限之外的输出令牌说明（mmx 无此参数，保留字段供未来用）。 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024

/** schemastery 配置；同时是 `mmx-vision` 设置节的 schema。 */
export const Config = z.object({
  /** mmx CLI 路径：留空自动发现（npm 全局 mmx-cli 的 JS 入口）；可填包目录或 bin JS 或可执行文件。 */
  mmxPath: z.string().default(''),
  defaultPrompt: z.string().default(DEFAULT_PROMPT),
  maxBytes: z.number().step(1).min(1).default(DEFAULT_MAX_BYTES),
  timeoutMs: z.number().min(1).default(DEFAULT_TIMEOUT_MS),
  renderImagePreview: z.boolean().default(true),
  interceptImageSend: z.boolean().default(true),
})

/** 已解析配置。 */
function resolveConfig(config) {
  const mmxPath = typeof config.mmxPath === 'string' ? config.mmxPath.trim() : ''
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
  for (const [field, value] of [['timeoutMs', timeoutMs], ['maxBytes', maxBytes]]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`mmx-vision: ${field} must be a positive safe integer`)
    }
  }
  return {
    mmxPath: mmxPath === '' ? undefined : mmxPath,
    defaultPrompt: config.defaultPrompt ?? DEFAULT_PROMPT,
    timeoutMs,
    maxBytes,
    renderImagePreview: config.renderImagePreview ?? true,
    interceptImageSend: config.interceptImageSend ?? true,
  }
}

const DESCRIPTION_HEAD =
  'Inspect one image — a local absolute path, an http(s) URL, or the JSON of an image attachment '
  + 'note — and return the text the user needs. Use when the user references an image file or URL, '
  + 'or when a task needs OCR, chart or diagram reading, screenshot or UI analysis, translation of '
  + 'image text, or photo understanding. '
  + 'Always pass an explicit `prompt` with a precise instruction — e.g. "transcribe all text", '
  + '"extract the table as CSV", "diagnose the UI layout problems", "translate the text into '
  + 'Chinese" — instead of leaving it to the default description: a targeted instruction produces '
  + 'a much more useful answer. '

const DESCRIPTION_TAIL =
  + 'The image may be a local path, an http(s) URL, the JSON object from an `[image attachment …]` '
  + "note, or — the common case when the user used this plugin's input-box image button — a "
  + 'short markdown image reference like `![图片](/mmx-vision/raw/sha256:abc…)` pasted into '
  + 'the conversation. In the markdown form, take the attachment id from the URL and pass that id '
  + 'as the `image` value (never the whole markdown, and never a made-up path); the tool resolves '
  + 'the id to the stored image. The image itself never enters the conversation — only the '
  + 'returned text is shown to you.'

/** describe_image 调用卡片视图。 */
export function describeImageCallView(args) {
  return {
    card: 'generic',
    title: 'Describe image (mmx)',
    kind: 'read',
    rawInput: args,
    .../^https?:\/\//i.test(args.image) ? {} : { locations: [{ path: args.image }] },
  }
}

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {object} [config] - 组合层配置。
 */
export function apply(ctx, config = {}) {
  let current = () => config
  installSettingsSection(ctx, MMX_VISION_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  const spec = () => resolveConfig(current())
  const visionCache = createVisionCache()
  // webserver 可选：headless 部署没有 webserver，仅工具可用。fiber inject——
  // 服务就绪（或重组后再次就绪）时挂路由，服务消失时自动卸载。
  ctx.inject(['webServer'], (wctx) => {
    registerAttachRoute(wctx, () => spec().maxBytes)
  })

  ctx.tools.register(
    defineTool({
      name: 'describe_image',
      description: DESCRIPTION_HEAD + DESCRIPTION_TAIL,
      parameters: {
        image: {
          type: 'string',
          required: true,
          description: 'Absolute path to a local image file, an http(s) URL of the image, the JSON object from an [image attachment …] note, or the bare attachment id (e.g. sha256:abc…) taken from the markdown image reference ![图片](/mmx-vision/raw/<id>) that the plugin\'s input-box image button pasted into the conversation.',
        },
        prompt: {
          type: 'string',
          description: 'Your precise instruction for the vision model about this image (e.g. "transcribe all text", "extract the table as CSV", "diagnose the UI problems", "translate the text"). Prefer a targeted prompt over the generic default description.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', required: true },
            model: { type: 'string', required: true },
            image: { type: 'string', required: true },
            mimeType: { type: 'string', required: true },
            bytes: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args, exec) {
        const active = spec()
        const image = await resolveImage(ctx, args.image, exec.signal, active.maxBytes)
        const text = await callMmxVision(active, args.prompt ?? active.defaultPrompt, image, exec.signal, visionCache)
        return {
          text,
          model: 'mmx-vision (MiniMax VLM)',
          image: args.image,
          mimeType: image.mimeType ?? 'unknown',
          bytes: image.bytes,
        }
      },
      presentCall: describeImageCallView,
    }),
  )
}


/**
 * /mmx-vision 附件路由：浏览器→宿主的上传缝隙。
 * POST /mmx-vision/attach 上传图片字节 → 存附件库 → 返回 `[image attachment …]`
 * 备注文本与 markdown 引用；GET /mmx-vision/raw/<id> 回读字节（缩略图渲染用）。
 * 移植自 @linxin666/dsh-tool-describe-image（Apache-2.0），前缀改为 /mmx-vision。
 * @module dsh-mmx-vision/attach
 */

import { decodeBase64, isImageMimeType, sniffMimeType, DEFAULT_MAX_BYTES } from './media.js'

/** 请求体字节上限：base64(10MB) + 信封余量。 */
export const MAX_ATTACH_BODY_BYTES = 16 * 1024 * 1024

/** 进程内附件引用注册表：模型只抄 id（而非完整 JSON）时仍可解析。 */
const ATTACHMENT_REF_REGISTRY = new Map()
const ATTACHMENT_REF_REGISTRY_CAP = 128

export function safeDecodeUriComponent(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** 记住一条持久化引用（按附件 id）。 */
export function registerAttachmentRef(ref) {
  ATTACHMENT_REF_REGISTRY.delete(ref.attachmentId)
  ATTACHMENT_REF_REGISTRY.set(ref.attachmentId, ref)
  while (ATTACHMENT_REF_REGISTRY.size > ATTACHMENT_REF_REGISTRY_CAP) {
    const oldest = ATTACHMENT_REF_REGISTRY.keys().next().value
    if (oldest === undefined) break
    ATTACHMENT_REF_REGISTRY.delete(oldest)
  }
}

/** 按裸附件 id 查引用。 */
export function attachmentRefById(id) {
  return ATTACHMENT_REF_REGISTRY.get(id)
}

/** markdown 图片引用（插进输入框草稿的文本）。 */
export function attachmentMarkdown(id) {
  return `![图片](/mmx-vision/raw/${encodeURIComponent(id).replace(/%3A/gi, ':')})`
}

/** `[image attachment …]` 备注文本。 */
export function attachmentNote(ref) {
  return `[image attachment ${JSON.stringify(ref)}]`
}

/** 校验上传载荷并解码字节。纯函数。 */
export function validateAttachPayload(payload, maxBytes) {
  if (typeof payload !== 'object' || payload === null) {
    return { error: { code: 'internal', message: 'request body must be a JSON object' } }
  }
  const record = payload
  const { data, mediaType, name } = record
  if (typeof data !== 'string' || data.length === 0) {
    return { error: { code: 'rejected', message: 'image data must be a non-empty base64 string' } }
  }
  if (!isImageMimeType(mediaType)) {
    return { error: { code: 'rejected', message: 'mediaType must be one of image/png, image/jpeg, image/gif, image/webp' } }
  }
  if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
    return { error: { code: 'rejected', message: 'name must be a non-empty string when present' } }
  }
  const bytes = decodeBase64(data)
  if (bytes === undefined) {
    return { error: { code: 'rejected', message: 'image data is not valid base64' } }
  }
  if (bytes.length === 0) {
    return { error: { code: 'rejected', message: 'image data is empty' } }
  }
  if (bytes.length > maxBytes) {
    return { error: { code: 'rejected', message: `image is ${bytes.length} bytes, above the ${maxBytes}-byte bound` } }
  }
  if (sniffMimeType(bytes) !== mediaType) {
    return { error: { code: 'rejected', message: `bytes do not match the declared ${mediaType} type` } }
  }
  return { payload: { data, mediaType, name }, bytes }
}

/** 校验并持久化一次上传。 */
export async function handleAttach(ctx, maxBytes, payload) {
  const validated = validateAttachPayload(payload, maxBytes)
  if ('error' in validated) return { ok: false, error: validated.error }
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    return { ok: false, error: { code: 'internal', message: 'the attachment service is not mounted; the route cannot store images' } }
  }
  try {
    const ref = await attachments.saveImage({
      data: validated.bytes,
      mediaType: validated.payload.mediaType,
      ...(validated.payload.name === undefined ? {} : { name: validated.payload.name }),
    })
    registerAttachmentRef(ref)
    return { ok: true, ref, note: attachmentNote(ref), markdown: attachmentMarkdown(ref.attachmentId) }
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: `attachment store rejected the image: ${error?.message ?? String(error)}` } }
  }
}

/** 读 JSON 请求体（带字节上限）。 */
async function readJsonBody(req, cap) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    chunks.push(chunk)
    total += chunk.length
    if (total > cap) return null
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function json(res, envelope, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/** GET 半边：按裸附件 id 回读存储的图片字节。 */
async function serveRawImage(ctx, req, res) {
  const match = /^\/mmx-vision\/raw\/([^/]+)$/.exec(new URL(req.url ?? '/', 'http://x').pathname)
  if (match === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const id = safeDecodeUriComponent(match[1])
  if (id === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const ref = attachmentRefById(id)
  if (ref === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const stored = await attachments.readImage(ref)
    res.writeHead(200, {
      'content-type': ref.mediaType,
      'content-length': String(stored.data.byteLength),
      'cache-control': 'private, max-age=3600',
    })
    res.end(Buffer.from(stored.data))
  } catch {
    res.writeHead(404)
    res.end()
  }
}

/**
 * 在共享 webserver 上注册 /mmx-vision 前缀路由（webserver 可选）。
 * @param ctx - 插件上下文。
 * @param readMaxBytes - 每请求字节上限读取器。
 */
export function registerAttachRoute(ctx, readMaxBytes = () => DEFAULT_MAX_BYTES) {
  const webserver = ctx.get('webServer')
  if (webserver === undefined) return
  webserver.register({
    kind: 'prefix',
    path: '/mmx-vision',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        await serveRawImage(ctx, req, res)
        return
      }
      if (req.method !== 'POST') {
        json(res, { ok: false, error: { code: 'internal', message: 'only POST is allowed' } }, 405)
        return
      }
      const body = await readJsonBody(req, MAX_ATTACH_BODY_BYTES)
      if (body === null) {
        json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON within 16 MiB' } }, 400)
        return
      }
      const outcome = await handleAttach(ctx, readMaxBytes(), body)
      if (outcome.ok) {
        json(res, { ok: true, value: { note: outcome.note, markdown: outcome.markdown, ref: outcome.ref } })
        return
      }
      json(res, { ok: false, error: outcome.error }, outcome.error.code === 'rejected' ? 422 : 500)
    },
  })
}

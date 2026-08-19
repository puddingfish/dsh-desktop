/**
 * 共享图像媒体事实：接受的媒体类型、魔数嗅探、base64 严格解码、字节上限。
 * 移植自 @linxin666/dsh-tool-describe-image（Apache-2.0）。
 * @module dsh-mmx-vision/media
 */

/** 接受的图像媒体类型。 */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** 图像字节上限（本地文件与附件）。 */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

/** 是否为接受的媒体类型。 */
export function isImageMimeType(value) {
  return typeof value === 'string' && IMAGE_MEDIA_TYPES.includes(value)
}

/** 从魔数嗅探媒体类型。 */
export function sniffMimeType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii') === 'GIF87a') return 'image/gif'
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}

/** 媒体类型 → 文件扩展名（临时文件用）。 */
export function extensionOf(mimeType) {
  switch (mimeType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    default: return 'bin'
  }
}

/** 严格 base64 解码：标准字母表、正确填充、长度为 4 的倍数。 */
export function decodeBase64(encoded) {
  if (encoded.length === 0 || encoded.length % 4 !== 0) return undefined
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return undefined
  if (/=/.test(encoded) && !/={1,2}$/.test(encoded)) return undefined
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) return undefined
  return bytes
}

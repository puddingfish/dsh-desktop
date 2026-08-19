#!/usr/bin/env node
/**
 * 更新 README.md 的赞助者名单（爱发电开放 API）。
 *
 * 契约（参考 afdian-api SDK 与爱发电开放平台文档）：
 *   POST https://afdian.net/api/open/query-sponsor
 *   body: { user_id, ts, params: JSON字符串, sign }
 *   sign = md5(token + "params" + params + "ts" + ts + "user_id" + user_id)
 *   返回 data.list[]（user.name/user.avatar/plan_title/confirm_amount）+ total_page
 *
 * 用法（GitHub Actions 自动跑；也可本地手动验证）：
 *   AFDIAN_USER_ID=xxx AFDIAN_API_TOKEN=xxx node .github/scripts/update-sponsors.mjs
 *
 * README.md 中 <!-- sponsors:start --> 与 <!-- sponsors:end --> 之间的内容会被重写。
 * @module update-sponsors
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

export const START_MARKER = '<!-- sponsors:start -->'
export const END_MARKER = '<!-- sponsors:end -->'
export const SPONSOR_PAGE = 'https://ifdian.net/a/zhibi'
const API_BASES = ['https://afdian.net', 'https://ifdian.net']

/** md5 签名（爱发电开放 API 约定）。 */
function signRequest(token, body) {
  const toSign = `${token}params${body.params}ts${body.ts}user_id${body.user_id}`
  return { ...body, sign: createHash('md5').update(toSign).digest('hex') }
}

/** 调用爱发电开放 API（双域名兜底：afdian.net 不可达时走 ifdian.net）。 */
async function callApi(token, userId, path, params) {
  const body = signRequest(token, {
    user_id: userId,
    ts: Math.floor(Date.now() / 1000),
    params: JSON.stringify(params ?? { empty: true }),
  })
  let lastError
  for (const base of API_BASES) {
    try {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await response.json()
      if (json.ec !== 200) throw new Error(`爱发电 API ${path} 返回 ec=${json.ec} ${json.em ?? ''}`)
      return json.data
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/** 拉全量赞助者（翻页）。 */
export async function fetchAllSponsors(token, userId) {
  const first = await callApi(token, userId, '/api/open/query-sponsor', { page: 1 })
  const list = [...(first.list ?? [])]
  const totalPages = Number(first.total_page ?? 1)
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await callApi(token, userId, '/api/open/query-sponsor', { page })
    list.push(...(next.list ?? []))
  }
  return list
}

/** 表格单元格转义。 */
const cell = (value) => String(value ?? '').replaceAll('|', '/').replaceAll('\n', ' ').trim()

/** 把 API 返回的赞助者列表渲染成 markdown。 */
export function renderSponsors(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return '暂无赞助者——也许第一位就是你 ☕\n'
  }
  const rows = list
    .map((item) => ({
      name: item.user?.name ?? '匿名',
      avatar: item.user?.avatar ?? '',
      amount: Number.parseFloat(item.confirm_amount ?? '0') || 0,
      plan: item.plan_title ?? '',
    }))
    .sort((a, b) => b.amount - a.amount)
  const lines = ['| | 赞助者 | 累计 | 方案 |', '|---|---|---|---|']
  for (const row of rows) {
    const avatar = row.avatar !== ''
      ? `<img src="${row.avatar}" width="24" height="24" style="border-radius:50%" alt="" />`
      : '🙂'
    lines.push(`| ${avatar} | **${cell(row.name)}** | ¥${row.amount.toFixed(2)} | ${cell(row.plan) || '—'} |`)
  }
  lines.push('')
  lines.push(`> 共 ${rows.length} 位赞助者 · 完整实时名单见 [爱发电主页](${SPONSOR_PAGE})`)
  lines.push('')
  return lines.join('\n')
}

/** 把渲染结果写回 README 的标记区；返回是否发生变化。 */
export function applyToReadme(rendered) {
  const readme = readFileSync('README.md', 'utf8')
  const startIdx = readme.indexOf(START_MARKER)
  const endIdx = readme.indexOf(END_MARKER)
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`README.md 中找不到 ${START_MARKER} / ${END_MARKER} 标记`)
  }
  const next = readme.slice(0, startIdx + START_MARKER.length) + '\n' + rendered + readme.slice(endIdx)
  if (next === readme) return false
  writeFileSync('README.md', next)
  return true
}

// ---- 直接运行时执行主流程（import 时不执行，便于测试） ----
const isMain = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href
if (isMain) {
  const userId = process.env.AFDIAN_USER_ID
  const token = process.env.AFDIAN_API_TOKEN
  if (!userId || !token) {
    console.error('缺少环境变量：AFDIAN_USER_ID / AFDIAN_API_TOKEN（爱发电「我的 → 开发者」页面获取）')
    process.exit(1)
  }
  const sponsors = await fetchAllSponsors(token, userId)
  const changed = applyToReadme(renderSponsors(sponsors))
  console.log(changed ? `已更新 README 赞助者名单（${sponsors.length} 位）` : '名单无变化')
}

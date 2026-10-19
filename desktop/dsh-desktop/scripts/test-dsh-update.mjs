/**
 * dsh 版本判断回归测试（不依赖 Electron；不联网也能跑）：
 *   node scripts/test-dsh-update.mjs          # 纯函数用例
 *   node scripts/test-dsh-update.mjs --live   # 额外查一次真实 registry
 *
 * 覆盖的回归场景：npm 上 latest=0.2.0-rc.2（自 2026-09-29 未动）、
 * next=0.2.1-rc.2 时，已装 0.2.1-rc.1 的桌面端一度提示
 * 「0.2.1-rc.1 → 0.2.0-rc.2」（把降级当升级）。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const runtime = require(path.join(here, '..', 'src', 'runtime.js'))

let failed = 0
function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}` + (ok ? '' : `  期望 ${expected}，实际 ${actual}`))
}

const cases = [
  ['0.2.1-rc.1', '0.2.0-rc.2', 1, '已装 0.2.1-rc.1 时 registry 上的 0.2.0-rc.2 不算新版本'],
  ['0.2.0-rc.2', '0.2.1-rc.1', -1, '反向：0.2.0-rc.2 确实旧于 0.2.1-rc.1'],
  ['0.2.1-rc.2', '0.2.1-rc.1', 1, '同号预发布按 rc 数字比较'],
  ['0.2.1-rc.10', '0.2.1-rc.9', 1, 'rc.10 > rc.9（数值比较，不是字符串序）'],
  ['0.2.1-rc.1', '0.2.1-rc.1', 0, '同版本相等'],
  ['0.2.1', '0.2.1-rc.2', 1, '正式版新于同号预发布'],
  ['0.2.1-alpha.5', '0.2.1-rc.1', -1, 'alpha 旧于 rc'],
  ['0.2.2', '0.2.1-rc.2', 1, '补丁号优先于预发布后缀'],
  ['1.0.0-rc.1', '0.9.9', 1, '大版本优先'],
  ['v0.2.1-rc.2', '0.2.1-rc.2', 0, '兼容 v 前缀'],
]
for (const [a, b, expected, why] of cases) {
  check(`compareDshVersions(${a}, ${b})  # ${why}`, runtime.compareDshVersions(a, b), expected)
}

if (process.argv.includes('--live')) {
  const latest = await runtime.latestDshVersion().catch((error) => `ERR ${error.message}`)
  const installed = runtime.installedDshVersion()
  console.log(`\nregistry（latest+next 取较新）= ${latest}`)
  console.log(`本机已装 dsh = ${installed ?? '未检测到'}`)
  const update = await runtime.checkDshUpdate()
  console.log('checkDshUpdate =>', JSON.stringify(update))
  if (typeof latest === 'string' && !latest.startsWith('ERR') && installed !== undefined) {
    check('是否提示升级与版本比较结果一致', update.available, runtime.compareDshVersions(latest, installed) > 0)
  }
}

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 个用例失败`}`)
// 不用 process.exit()：Windows 上它与 undici/fetch 的异步句柄竞争会触发 libuv
// 断言（0xC0000409），让「全部通过」也返回非 0；用 exitCode 让循环自然收尾。
process.exitCode = failed === 0 ? 0 : 1

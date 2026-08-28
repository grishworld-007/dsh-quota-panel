/**
 * quota-panel — persistent dual-face DSH plugin (static composition row).
 *
 * Host half: collects GLM / Ark / MiniMax / DeepSeek quota and balance every
 * `intervalMs` and serves the latest JSON at an exact webserver route
 * (`/quota-panel/data.json`). The browser half (lib/client.js, a boot-graph
 * bundle via the package's `dsh.client` declaration) fetches that route and
 * renders the panel in the `shell.overlay` slot, so the panel appears on every
 * page load with no session action — unlike dynamic packages, nothing here
 * lives in model-tool memory.
 *
 * Why a route instead of package-private RPC: static client plugins have no
 * `host.call`; the supported seams are shell-seeded `require`, native fetch,
 * and client services (`slots`, `timer`). Same-origin fetch of an exact route
 * registered through the `webServer` service is the lightest channel that
 * needs no checkout rebuild.
 *
 * Keys stay host-side: credentials are read through the `credentials` service
 * and sent only in request headers; they never appear in the served JSON.
 *
 * Config (row `config:`):
 *   intervalMs:  refresh cadence in ms (default 60000)
 *   routePath:   exact data route (default /quota-panel/data.json)
 *
 * @module quota-panel
 */
import { createHash, createHmac } from 'node:crypto'

export const name = 'quota-panel'
export const inject = ['webServer', 'timer']

// ── Volcengine OpenAPI signature V4 (control-plane usage query) ──────────────

const VOLC_HOST = 'open.volcengineapi.com'
const VOLC_VERSION = '2024-01-01'
const VOLC_SERVICE = 'ark'
const VOLC_CT = 'application/json; charset=utf-8'
const VOLC_SH = 'host;x-date;x-content-sha256;content-type'

function volcUriEncode(s) {
	const unreserved = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~'
	let o = ''
	for (const ch of s) {
		if (unreserved.includes(ch)) o += ch
		else for (const b of Buffer.from(ch, 'utf8')) o += '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase()
	}
	return o
}

function volcCanonicalQuery(action, region) {
	return [['Action', action], ['Region', region], ['Version', VOLC_VERSION]]
		.sort((a, b) => (a[0] < b[0] ? -1 : 1))
		.map(([k, v]) => volcUriEncode(k) + '=' + volcUriEncode(v))
		.join('&')
}

function volcXDate(now) {
	const iso = now.toISOString()
	return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + 'T' + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + 'Z'
}

function volcSign(ak, sk, region, query) {
	const xDate = volcXDate(new Date())
	const shortDate = xDate.slice(0, 8)
	const xcs = createHash('sha256').update('').digest('hex')
	const canonicalHeaders = ['host:' + VOLC_HOST, 'x-date:' + xDate, 'x-content-sha256:' + xcs, 'content-type:' + VOLC_CT].join('\n')
	const canonicalRequest = ['POST', '/', query, canonicalHeaders, VOLC_SH, xcs].join('\n')
	const scope = [shortDate, region, VOLC_SERVICE, 'request'].join('/')
	const stringToSign = ['HMAC-SHA256', xDate, scope, createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')].join('\n')
	let k = createHmac('sha256', Buffer.from(sk, 'utf8')).update(shortDate, 'utf8').digest()
	k = createHmac('sha256', k).update(region, 'utf8').digest()
	k = createHmac('sha256', k).update(VOLC_SERVICE, 'utf8').digest()
	k = createHmac('sha256', k).update('request', 'utf8').digest()
	const signature = createHmac('sha256', k).update(stringToSign, 'utf8').digest('hex')
	return {
		xDate,
		xContentSha256: xcs,
		authorization: `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${VOLC_SH}, Signature=${signature}`,
	}
}

function volcRegion(baseUrl) {
	if (baseUrl) {
		const rest = String(baseUrl).split('://')[1] || String(baseUrl)
		for (const p of rest.split('/')[0].split('.')) if (p.startsWith('cn-') || p.startsWith('ap-')) return p
	}
	return 'cn-beijing'
}

// ── provider table ───────────────────────────────────────────────────────────

const STATIC = {
	'zai-coding-cn': { kind: 'glm', key: 'ZAI_CODING_CN_API_KEY', base: 'https://open.bigmodel.cn' },
	'zai': { kind: 'glm', key: 'ZAI_CODING_CN_API_KEY', base: 'https://api.z.ai' },
	'minimax-cn': { kind: 'minimax', key: 'MINIMAX_CN_API_KEY', base: 'https://api.minimaxi.com' },
	'minimax': { kind: 'minimax', key: 'MINIMAX_CN_API_KEY', base: 'https://api.minimaxi.com' },
	'deepseek-official': { kind: 'deepseek', key: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com' },
	'deepseek': { kind: 'deepseek', key: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com' },
	'ark': { kind: 'ark', key: 'ARK_API_KEY', base: 'https://ark.cn-beijing.volces.com/api/coding/v3' },
}

function staticFor(id) {
	if (STATIC[id]) return STATIC[id]
	if (id.includes('zai') || id.includes('bigmodel')) return { kind: 'glm', key: 'ZAI_CODING_CN_API_KEY', base: id.includes('cn') || id.includes('bigmodel') ? 'https://open.bigmodel.cn' : 'https://api.z.ai' }
	if (id.includes('minimax')) return { kind: 'minimax', key: 'MINIMAX_CN_API_KEY', base: 'https://api.minimaxi.com' }
	if (id.includes('deepseek')) return { kind: 'deepseek', key: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com' }
	if (id.includes('ark')) return { kind: 'ark', key: 'ARK_API_KEY', base: 'https://ark.cn-beijing.volces.com/api/coding/v3' }
	return { kind: 'unknown', key: null }
}

// ── formatting helpers ───────────────────────────────────────────────────────

function pad(n) { return n < 10 ? '0' + n : String(n) }
function fmtMs(ms) {
	const d = new Date(ms)
	if (isNaN(d.getTime())) return String(ms)
	return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function toResetMs(v) {
	if (v == null) return null
	if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t }
	if (typeof v === 'number') { if (v <= 0) return null; return v < 1e12 ? v * 1000 : v }
	return null
}
function fmtReset(v) {
	if (v == null) return null
	const ms = toResetMs(v)
	if (ms != null) return fmtMs(ms)
	return String(v)
}

// ── HTTP (native fetch; keys only in headers) ────────────────────────────────

async function httpGetJson(url, headers) {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
	return { status: res.status, body: await res.text() }
}

async function arkOpenApiCall(action, region, ak, sk) {
	const q = volcCanonicalQuery(action, region)
	const sig = volcSign(ak, sk, region, q)
	const res = await fetch(`https://${VOLC_HOST}/?${q}`, {
		method: 'POST',
		headers: {
			'content-type': VOLC_CT,
			'x-date': sig.xDate,
			'x-content-sha256': sig.xContentSha256,
			authorization: sig.authorization,
		},
		body: '',
		signal: AbortSignal.timeout(20000),
	})
	return { status: res.status, body: await res.text() }
}

// ── provider queries ─────────────────────────────────────────────────────────

async function queryGlm(key, base) {
	let r
	try { r = await httpGetJson(base + '/api/monitor/usage/quota/limit', { authorization: 'Bearer ' + key, accept: 'application/json' }) }
	catch (e) { return { ok: false, error: '请求失败: ' + (e && e.message ? e.message : String(e)) } }
	if (r.status !== 200 || !r.body) return { ok: false, error: 'HTTP ' + r.status }
	let j
	try { j = JSON.parse(r.body) } catch { return { ok: false, error: '响应非 JSON' } }
	const data = j && j.data
	const rows = []
	for (const lim of (data && data.limits) || []) {
		if (lim.type === 'TIME_LIMIT') continue
		let label = null
		if (lim.type === 'TOKENS_LIMIT' && lim.unit === 3) label = '5小时窗口'
		else if (lim.type === 'TOKENS_LIMIT' && lim.unit === 6) label = '周配额'
		else if (lim.type === 'TOKENS_LIMIT') label = 'Token 额度'
		else continue
		const used = typeof lim.percentage === 'number' ? lim.percentage : typeof lim.percentage === 'string' ? parseFloat(lim.percentage) : null
		const remain = used == null ? null : Math.max(0, Math.min(100, Math.round((100 - used) * 10) / 10))
		rows.push({
			label,
			usedPct: used == null ? null : Math.round(used * 10) / 10,
			remainPct: remain,
			resetAtMs: toResetMs(lim.nextResetTime),
			resetAtText: fmtReset(lim.nextResetTime),
		})
	}
	return { ok: true, limits: rows }
}

async function queryDeepseek(key) {
	let r
	try { r = await httpGetJson('https://api.deepseek.com/user/balance', { authorization: 'Bearer ' + key, accept: 'application/json' }) }
	catch (e) { return { ok: false, error: '请求失败: ' + (e && e.message ? e.message : String(e)) } }
	if (r.status !== 200 || !r.body) return { ok: false, error: 'HTTP ' + r.status }
	let j
	try { j = JSON.parse(r.body) } catch { return { ok: false, error: '响应非 JSON' } }
	const parts = []
	let total = 0
	for (const b of (j && j.balance_infos) || []) {
		const tb = parseFloat(b.total_balance) || 0
		total += tb
		parts.push({
			currency: b.currency || 'CNY',
			total: tb,
			granted: b.granted_balance != null ? parseFloat(b.granted_balance) || 0 : null,
			toppedUp: b.topped_up_balance != null ? parseFloat(b.topped_up_balance) || 0 : null,
		})
	}
	return { ok: true, isAvailable: j.is_available !== false, total: Math.round(total * 100) / 100, parts }
}

async function queryMinimax(key) {
	let r
	try { r = await httpGetJson('https://api.minimaxi.com/v1/token_plan/remains', { authorization: 'Bearer ' + key, accept: 'application/json' }) }
	catch (e) { return { ok: false, error: '请求失败: ' + (e && e.message ? e.message : String(e)) } }
	if (r.status !== 200 || !r.body) return { ok: false, error: 'HTTP ' + r.status }
	let j
	try { j = JSON.parse(r.body) } catch { return { ok: false, error: '响应非 JSON' } }
	const models = []
	for (const m of (j && j.model_remains) || []) {
		if (m.model_name === 'video') continue
		models.push({
			name: m.model_name ? String(m.model_name) : '?',
			intervalRemainPct: m.current_interval_remaining_percent != null ? Math.round(parseFloat(m.current_interval_remaining_percent) * 10) / 10 : null,
			weeklyRemainPct: m.current_weekly_remaining_percent != null ? Math.round(parseFloat(m.current_weekly_remaining_percent) * 10) / 10 : null,
			weeklyEndText: fmtReset(m.weekly_end_time),
			weeklyEndMs: toResetMs(m.weekly_end_time),
			intervalEndText: fmtReset(m.end_time),
			intervalEndMs: toResetMs(m.end_time),
		})
	}
	return { ok: true, models }
}

function arkResponseError(j) {
	const err = (j && j.ResponseMetadata && j.ResponseMetadata.Error) || (j && j.Error)
	if (!err) return null
	return { code: String(err.Code || ''), msg: String(err.Message || '') }
}
function arkIsAuth(code) {
	const c = String(code).toLowerCase()
	return ['auth', 'signature', 'accessdenied', 'denied', 'unauthorized', 'forbidden', 'credential', 'token'].some((k) => c.includes(k))
}
function parseAfpTiers(result) {
	const rows = []
	for (const [field, label] of [['AFPFiveHour', '5小时窗口'], ['AFPWeekly', '周配额'], ['AFPMonthly', '月配额']]) {
		const win = result[field]
		if (!win) continue
		const quota = parseFloat(win.Quota)
		if (!(quota > 0)) continue
		const usedPct = Math.round(((parseFloat(win.Used) || 0) / quota) * 1000) / 10
		rows.push({ label, usedPct, remainPct: Math.max(0, Math.min(100, Math.round((100 - usedPct) * 10) / 10)), resetAtMs: toResetMs(win.ResetTime), resetAtText: fmtReset(win.ResetTime) })
	}
	return rows
}
function parseCodingTiers(result) {
	const arr = result.QuotaUsage || result.Usages || result.Details
	if (!Array.isArray(arr)) return []
	const rows = []
	for (const item of arr) {
		const lv = String(item.Level || item.Type || item.Period || item.Label || item.Window || '').toLowerCase()
		let label = null
		if (['session', '5h', 'fivehour', 'five_hour', 'rolling_5h'].includes(lv)) label = '5小时窗口'
		else if (['weekly', 'week', '7d'].includes(lv)) label = '周配额'
		else if (['monthly', 'month'].includes(lv)) label = '月配额'
		else continue
		let used = item.Percent != null ? parseFloat(item.Percent) : NaN
		if (isNaN(used)) used = item.UsedPercent != null ? parseFloat(item.UsedPercent) : NaN
		if (isNaN(used)) used = item.UsagePercent != null ? parseFloat(item.UsagePercent) : NaN
		if (isNaN(used)) used = 0
		used = Math.round(used * 10) / 10
		const raw = item.ResetTime != null ? item.ResetTime : item.ResetTimestamp
		rows.push({ label, usedPct: used, remainPct: Math.max(0, Math.min(100, Math.round((100 - used) * 10) / 10)), resetAtMs: toResetMs(raw), resetAtText: fmtReset(raw) })
	}
	return rows
}
async function queryArk(ak, sk, region) {
	let r = await arkOpenApiCall('GetAFPUsage', region, ak, sk).catch((e) => ({ status: 0, body: '', error: e }))
	if (r.error) return { ok: false, error: '请求失败: ' + r.error.message }
	if (r.status === 200 && r.body) {
		let j = null
		try { j = JSON.parse(r.body) } catch { j = null }
		if (j) {
			const err = arkResponseError(j)
			if (err) return { ok: false, error: (arkIsAuth(err.code) ? 'Ark 鉴权失败（' + err.code + '）: ' : 'Ark API 错误（' + err.code + '）: ') + err.msg }
			const result = j.Result || j
			const tiers = parseAfpTiers(result)
			if (tiers.length) return { ok: true, plan: 'Agent Plan', limits: tiers }
		}
	}
	r = await arkOpenApiCall('GetCodingPlanUsage', region, ak, sk).catch((e) => ({ status: 0, body: '', error: e }))
	if (r.error) return { ok: false, error: '请求失败: ' + r.error.message }
	if (r.status === 200 && r.body) {
		let j = null
		try { j = JSON.parse(r.body) } catch { j = null }
		if (j) {
			const err = arkResponseError(j)
			if (err) return { ok: false, error: (arkIsAuth(err.code) ? 'Ark 鉴权失败（' + err.code + '）: ' : 'Ark API 错误（' + err.code + '）: ') + err.msg }
			const tiers = parseCodingTiers(j.Result || j)
			if (tiers.length) return { ok: true, plan: 'Coding Plan', limits: tiers }
			return { ok: false, error: '未找到生效的 Ark 套餐（签名通过）。原始: ' + String(r.body).slice(0, 300) }
		}
	}
	return { ok: false, error: '未找到生效的 Ark Agent/Coding 套餐（HTTP ' + r.status + '）' }
}

// ── settings / credentials / collection ──────────────────────────────────────

export function apply(ctx, config = {}) {
	const credentials = ctx.get('credentials')
	const settings = ctx.get('settings')
	const llm = ctx.get('llm')
	const routePath = config.routePath ?? '/quota-panel/data.json'
	const intervalMs = config.intervalMs ?? 60000

	async function readSettingsProviders() {
		const map = {}
		try {
			if (settings) {
				const ns = settings.get('llm-pi-ai')
				if (ns && ns.providers && typeof ns.providers === 'object') {
					for (const id of Object.keys(ns.providers)) {
						const p = ns.providers[id] || {}
						const models = Array.isArray(p.models)
							? p.models.map((m) => (m && typeof m === 'object' ? (typeof m.id === 'string' && m.id ? m.id : typeof m.name === 'string' ? m.name : '') : String(m))).filter(Boolean)
							: []
						map[id] = { models, keyEnv: typeof p.apiKeyEnv === 'string' ? p.apiKeyEnv : undefined, baseURL: typeof p.baseURL === 'string' ? p.baseURL : undefined }
					}
				}
			}
		} catch { /* settings unreadable — fall back to defaults below */ }
		return map
	}

	async function resolveKey(ref) {
		if (!ref) return undefined
		try { const r = await credentials.resolve(ref); return r ? r.value : undefined } catch { return undefined }
	}

	async function discoverModels(id) {
		if (!llm) return []
		try {
			const lm = await llm.listModels(id)
			if (!Array.isArray(lm)) return []
			return lm.map((m) => (m && typeof m === 'object' ? m.id || m.name || '' : String(m))).filter(Boolean).slice(0, 12)
		} catch { return [] }
	}

	let latest = null
	let pending = null

	async function collect() {
		const cfgMap = await readSettingsProviders()
		let ids = Object.keys(cfgMap)
		if (ids.length === 0) {
			ids = ['zai-coding-cn', 'ark', 'minimax-cn', 'deepseek-official']
			for (const id of ids) cfgMap[id] = { models: [], keyEnv: undefined, baseURL: undefined }
		} else if (!cfgMap['deepseek-official']) {
			cfgMap['deepseek-official'] = { models: [], keyEnv: 'DEEPSEEK_API_KEY', baseURL: undefined }
			ids.push('deepseek-official')
		}

		let deflt = null
		try {
			if (settings) {
				const d = settings.get('agent-default-model')
				if (d && (d.provider || d.model)) deflt = { provider: d.provider ? String(d.provider) : null, model: d.model ? String(d.model) : null }
			}
		} catch { /* ignore */ }

		const providers = await Promise.all(ids.map(async (id) => {
			const cfg = cfgMap[id] || {}
			const s = staticFor(id)
			const keyEnv = cfg.keyEnv || s.key
			let models = cfg.models && cfg.models.length ? cfg.models.slice(0, 12) : []
			if (models.length === 0) models = await discoverModels(id)
			const entry = { id, kind: s.kind, models, error: null, data: null }

			if (s.kind === 'ark') {
				const ak = (await resolveKey('VOLC_ACCESSKEY')) || (await resolveKey('ARK_ACCESS_KEY_ID'))
				const sk = (await resolveKey('VOLC_SECRETKEY')) || (await resolveKey('ARK_SECRET_ACCESS_KEY'))
				if (!ak || !sk) {
					entry.error = 'Ark 需火山控制面 AK/SK（与模型 API Key 不同）。请配置 VOLC_ACCESSKEY / VOLC_SECRETKEY'
					return entry
				}
				const q = await queryArk(ak, sk, volcRegion(cfg.baseURL || s.base))
				entry.error = q.error || null
				if (q.ok) entry.data = { plan: q.plan, limits: q.limits }
				return entry
			}
			if (s.kind === 'unknown') { entry.error = '未识别的 provider，暂不支持配额查询'; return entry }
			if (!keyEnv) { entry.error = '未配置 API Key 环境变量'; return entry }
			const key = await resolveKey(keyEnv)
			if (!key) { entry.error = '未找到 API Key（' + keyEnv + '）'; return entry }
			if (s.kind === 'glm') {
				const q = await queryGlm(key, s.base)
				entry.error = q.error || null
				if (q.ok) entry.data = { limits: q.limits }
			} else if (s.kind === 'deepseek') {
				const q = await queryDeepseek(key)
				entry.error = q.error || null
				if (q.ok) entry.data = { isAvailable: q.isAvailable, total: q.total, parts: q.parts }
			} else if (s.kind === 'minimax') {
				const q = await queryMinimax(key)
				entry.error = q.error || null
				if (q.ok) entry.data = { models: q.models }
			}
			return entry
		}))

		const now = new Date()
		latest = {
			ok: true,
			scannedAtText: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
			default: deflt,
			providers,
		}
		return latest
	}

	function ensure() {
		if (pending) return pending
		pending = collect().catch((e) => {
			ctx.logger.warn(`[quota-panel] collect failed: ${e && e.message ? e.message : String(e)}`)
		}).finally(() => { pending = null })
		return pending
	}

	async function handler(_req, res) {
		const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
		try {
			if (latest === null) await ensure()
			res.writeHead(200, headers)
			res.end(JSON.stringify(latest ?? { ok: false, error: '尚无数据' }))
		} catch (e) {
			res.writeHead(200, headers)
			res.end(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }))
		}
	}

	ensure()
	ctx.interval(() => { ensure() }, intervalMs)
	ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: routePath, handler }), 'quota-panel: data route')
}

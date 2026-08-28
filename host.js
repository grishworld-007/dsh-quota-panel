return {
  apply(ctx) {
    const shell = ctx.get('shell')
    const credentials = ctx.get('credentials')
    const settings = ctx.get('settings')
    const llm = ctx.get('llm')
    const sp = ctx.get('sandboxPolicy')
    if (shell === undefined || credentials === undefined) {
      console.error('[quota] shell/credentials service unavailable; plugin inert')
      return
    }

    // DeepSeek 今日花费：日内基线（本地日），用于无平台 token 时的估算
    let dayBaseline = null

    // ---- pure-JS SHA-256 / HMAC-SHA256 (Host has no crypto builtin) ----
    function sha256Bytes(data) {
      const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2])
      const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19].slice()
      const l = data.length
      const total = Math.ceil((l + 1 + 8) / 64) * 64
      const msg = new Uint8Array(total)
      msg.set(data)
      msg[l] = 0x80
      const dv = new DataView(msg.buffer)
      dv.setUint32(total - 8, Math.floor((l * 8) / 0x100000000), false)
      dv.setUint32(total - 4, (l * 8) >>> 0, false)
      const w = new Uint32Array(64)
      function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0 }
      for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = ((msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3]) >>> 0
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
          const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
        }
        let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
        for (let i = 0; i < 64; i++) {
          const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
          const ch = (e & f) ^ (~e & g)
          const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
          const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
          const maj = (a & b) ^ (a & c) ^ (b & c)
          const t2 = (S0 + maj) >>> 0
          h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
      }
      const out = new Uint8Array(32)
      for (let i = 0; i < 8; i++) { out[i * 4] = (H[i] >>> 24) & 0xff; out[i * 4 + 1] = (H[i] >>> 16) & 0xff; out[i * 4 + 2] = (H[i] >>> 8) & 0xff; out[i * 4 + 3] = H[i] & 0xff }
      return out
    }
    function toHex(b) { let s = ''; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s }
    function hmac(key, data) {
      const BS = 64
      let k = key
      if (k.length > BS) k = sha256Bytes(k)
      const inner = new Uint8Array(BS + data.length)
      const outer = new Uint8Array(BS + 32)
      for (let i = 0; i < BS; i++) { const kv = i < k.length ? k[i] : 0; inner[i] = kv ^ 0x36; outer[i] = kv ^ 0x5c }
      inner.set(data, BS)
      const ih = sha256Bytes(inner)
      outer.set(ih, BS)
      return sha256Bytes(outer)
    }
    const te = new TextEncoder()
    function strToBytes(s) { return te.encode(s) }

    // ---- Volcengine Ark control-plane OpenAPI V4 signing (AK/SK) ----
    const VOLC_HOST = 'open.volcengineapi.com'
    const VOLC_VERSION = '2024-01-01'
    const VOLC_SERVICE = 'ark'
    const VOLC_CT = 'application/json; charset=utf-8'
    const VOLC_SH = 'host;x-date;x-content-sha256;content-type'
    const NL = String.fromCharCode(10)
    function volcUriEncode(s) {
      const unreserved = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~'
      let o = ''
      for (const ch of s) {
        if (unreserved.indexOf(ch) !== -1) o += ch
        else { const bs = strToBytes(ch); for (const b of bs) o += '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase() }
      }
      return o
    }
    function volcCanonicalQuery(action, region) {
      const p = [['Action', action], ['Region', region], ['Version', VOLC_VERSION]].sort(function (a, b) { return a[0] < b[0] ? -1 : 1 })
      return p.map(function (x) { return volcUriEncode(x[0]) + '=' + volcUriEncode(x[1]) }).join('&')
    }
    function volcXDate(now) {
      const iso = now.toISOString()
      return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + 'T' + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + 'Z'
    }
    function volcSign(ak, sk, region, q, bodyBytes) {
      const xDate = volcXDate(new Date())
      const shortDate = xDate.slice(0, 8)
      const xcs = toHex(sha256Bytes(bodyBytes))
      const canonicalHeaders = 'host:' + VOLC_HOST + NL + 'x-date:' + xDate + NL + 'x-content-sha256:' + xcs + NL + 'content-type:' + VOLC_CT + NL
      const canonicalRequest = 'POST' + NL + '/' + NL + q + NL + canonicalHeaders + NL + VOLC_SH + NL + xcs
      const scope = shortDate + '/' + region + '/' + VOLC_SERVICE + '/request'
      const stringToSign = 'HMAC-SHA256' + NL + xDate + NL + scope + NL + toHex(sha256Bytes(strToBytes(canonicalRequest)))
      const kDate = hmac(strToBytes(sk), strToBytes(shortDate))
      const kRegion = hmac(kDate, strToBytes(region))
      const kService = hmac(kRegion, strToBytes(VOLC_SERVICE))
      const kSigning = hmac(kService, strToBytes('request'))
      const signature = toHex(hmac(kSigning, strToBytes(stringToSign)))
      const authorization = 'HMAC-SHA256 Credential=' + ak + '/' + scope + ', SignedHeaders=' + VOLC_SH + ', Signature=' + signature
      return { xDate: xDate, xContentSha256: xcs, authorization: authorization }
    }
    function volcRegion(baseUrl) {
      if (baseUrl) {
        const rest = String(baseUrl).split('://')[1] || String(baseUrl)
        const host = rest.split('/')[0]
        const parts = host.split('.')
        for (const p of parts) if (p.indexOf('cn-') === 0 || p.indexOf('ap-') === 0) return p
      }
      return 'cn-beijing'
    }

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
      if (id.indexOf('zai') !== -1 || id.indexOf('bigmodel') !== -1) return { kind: 'glm', key: 'ZAI_CODING_CN_API_KEY', base: (id.indexOf('cn') !== -1 || id.indexOf('bigmodel') !== -1) ? 'https://open.bigmodel.cn' : 'https://api.z.ai' }
      if (id.indexOf('minimax') !== -1) return { kind: 'minimax', key: 'MINIMAX_CN_API_KEY', base: 'https://api.minimaxi.com' }
      if (id.indexOf('deepseek') !== -1) return { kind: 'deepseek', key: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com' }
      if (id.indexOf('ark') !== -1) return { kind: 'ark', key: 'ARK_API_KEY', base: 'https://ark.cn-beijing.volces.com/api/coding/v3' }
      return { kind: 'unknown', key: null }
    }

    function pad(n) { return n < 10 ? '0' + n : String(n) }
    function fmtMs(ms) {
      const d = new Date(ms)
      if (isNaN(d.getTime())) return String(ms)
      return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }
    function fmtReset(v) {
      if (v == null) return null
      if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? v : fmtMs(t) }
      if (typeof v === 'number') { if (v <= 0) return null; return fmtMs(v < 1e12 ? v * 1000 : v) }
      return String(v)
    }

    async function readSettingsProviders() {
      const map = {}
      try {
        if (settings) {
          const ns = settings.get('llm-pi-ai')
          if (ns && ns.providers && typeof ns.providers === 'object') {
            for (const id of Object.keys(ns.providers)) {
              const p = ns.providers[id] || {}
              const models = Array.isArray(p.models) ? p.models.map(function (m) {
                if (m && typeof m === 'object') return (typeof m.id === 'string' && m.id) ? m.id : (typeof m.name === 'string' ? m.name : '')
                return String(m)
              }).filter(Boolean) : []
              map[id] = { models: models, keyEnv: typeof p.apiKeyEnv === 'string' ? p.apiKeyEnv : undefined, baseURL: typeof p.baseURL === 'string' ? p.baseURL : undefined }
            }
          }
        }
      } catch (e) { /* ignore */ }
      return map
    }

    async function resolveKey(envName) {
      if (!envName) return undefined
      try { const r = await credentials.resolve(envName); return r ? r.value : undefined } catch (e) { return undefined }
    }

    async function discoverModels(id) {
      if (!llm) return []
      try {
        const lm = await llm.listModels(id)
        if (!Array.isArray(lm)) return []
        return lm.map(function (m) { return (m && typeof m === 'object') ? ((m.id) || (m.name) || '') : String(m) }).filter(Boolean).slice(0, 12)
      } catch (e) { return [] }
    }

    async function runShell(command, env) {
      async function attempt(withPolicy) {
        const req = { command: command, timeoutMs: 25000, stdoutMaxBytes: 65536, env: env || {} }
        if (withPolicy && sp && typeof sp.resolve === 'function') { try { req.sandboxPolicy = sp.resolve() } catch (e) {} }
        const spec = shell.resolve(req)
        return await shell.run(spec)
      }
      let result
      try { result = await attempt(true) } catch (e1) {
        try { result = await attempt(false) } catch (e2) { return { status: 0, body: '', error: '执行失败: ' + (e2 && e2.message ? e2.message : String(e2)) } }
      }
      const out = (result && result.stdout && typeof result.stdout.text === 'string') ? result.stdout.text : ''
      const marker = '__QK_STATUS__:'
      const idx = out.lastIndexOf(marker)
      let body = out
      let status = 0
      if (idx !== -1) { body = out.slice(0, idx); status = parseInt(out.slice(idx + marker.length).trim(), 10) || 0 }
      return { status: status, body: body.trim(), stderr: (result && result.stderr && result.stderr.text) || '' }
    }
    function bearerCurl(url) {
      return 'curl -sS -m 20 -H "Authorization: Bearer $QUOTA_KEY" -w "__QK_STATUS__:%{http_code}" "' + url + '"'
    }

    async function queryGlm(id, key, base) {
      const r = await runShell(bearerCurl(base + '/api/monitor/usage/quota/limit'), { QUOTA_KEY: key || '' })
      if (r.error) return { ok: false, error: r.error }
      if (r.status !== 200 || !r.body) return { ok: false, error: r.stderr || ('HTTP ' + r.status) }
      let j
      try { j = JSON.parse(r.body) } catch (e) { return { ok: false, error: '响应非 JSON' } }
      const data = j && j.data
      const limits = (data && data.limits) || []
      const rows = []
      for (const lim of limits) {
        if (lim.type === 'TIME_LIMIT') continue // 用户要求去掉 工具/搜索(月)
        let label = null
        if (lim.type === 'TOKENS_LIMIT' && lim.unit === 3) label = '5小时窗口'
        else if (lim.type === 'TOKENS_LIMIT' && lim.unit === 6) label = '周配额'
        else if (lim.type === 'TOKENS_LIMIT') label = 'Token 额度'
        else continue
        const used = (typeof lim.percentage === 'number') ? lim.percentage : (typeof lim.percentage === 'string' ? parseFloat(lim.percentage) : null)
        const remain = used == null ? null : Math.max(0, Math.min(100, Math.round((100 - used) * 10) / 10))
        rows.push({ label: label, usedPct: used == null ? null : Math.round(used * 10) / 10, remainPct: remain, remaining: (lim.remaining != null) ? lim.remaining : null, number: (lim.number != null) ? lim.number : null, resetAtText: fmtReset(lim.nextResetTime) })
      }
      return { ok: true, level: data && data.level ? String(data.level) : null, limits: rows }
    }

    async function queryDeepseek(key) {
      const r = await runShell(bearerCurl('https://api.deepseek.com/user/balance'), { QUOTA_KEY: key || '' })
      if (r.error) return { ok: false, error: r.error }
      if (r.status !== 200 || !r.body) return { ok: false, error: r.stderr || ('HTTP ' + r.status) }
      let j
      try { j = JSON.parse(r.body) } catch (e) { return { ok: false, error: '响应非 JSON' } }
      const infos = (j && j.balance_infos) || []
      const parts = []
      let total = 0
      for (const b of infos) {
        const cur = b.currency || 'CNY'
        const tb = parseFloat(b.total_balance) || 0
        total += tb
        parts.push({ currency: cur, total: tb, granted: b.granted_balance != null ? parseFloat(b.granted_balance) || 0 : null, toppedUp: b.topped_up_balance != null ? parseFloat(b.topped_up_balance) || 0 : null })
      }
      return { ok: true, isAvailable: j.is_available !== false, total: Math.round(total * 100) / 100, parts: parts }
    }

    const PLATFORM_USAGE_URL = 'https://platform.deepseek.com/api/v0/usage/cost'
    function localDateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
    async function queryDeepseekTodayCost(token) {
      const now = new Date()
      const url = PLATFORM_USAGE_URL + '?month=' + (now.getMonth() + 1) + '&year=' + now.getFullYear()
      const cmd = 'curl -sS -m 20 -H "Authorization: Bearer $QUOTA_PT" -H "Accept: application/json" -H "Origin: https://platform.deepseek.com" -H "Referer: https://platform.deepseek.com/usage" -w "__QK_STATUS__:%{http_code}" "' + url + '"'
      const r = await runShell(cmd, { QUOTA_PT: token })
      if (r.error) return { ok: false, error: r.error }
      if (r.status !== 200 || !r.body) return { ok: false, error: r.stderr || ('HTTP ' + r.status) }
      let j
      try { j = JSON.parse(r.body) } catch (e) { return { ok: false, error: '响应非 JSON' } }
      if (j && j.code != null && j.code !== 0) return { ok: false, error: '平台接口 code ' + j.code }
      const biz = (j && j.data && j.data.biz_data) || null
      const days = (biz && Array.isArray(biz.days)) ? biz.days : []
      const todayKey = localDateKey(now)
      let total = null
      for (const day of days) {
        if (!day || day.date !== todayKey) continue
        total = 0
        const entries = Array.isArray(day.data) ? day.data : []
        for (const me of entries) {
          const usages = (me && Array.isArray(me.usage)) ? me.usage : []
          for (const u of usages) {
            if (!u) continue
            const v = (u.cost != null) ? parseFloat(u.cost) : ((u.amount != null) ? parseFloat(u.amount) : NaN)
            if (!isNaN(v)) total += v
          }
        }
        break
      }
      if (total == null) return { ok: false, error: '无今日数据' }
      return { ok: true, todayCost: Math.round(total * 100) / 100 }
    }

    async function queryMinimax(key) {
      const r = await runShell(bearerCurl('https://api.minimaxi.com/v1/token_plan/remains'), { QUOTA_KEY: key || '' })
      if (r.error) return { ok: false, error: r.error }
      if (r.status !== 200 || !r.body) return { ok: false, error: r.stderr || ('HTTP ' + r.status) }
      let j
      try { j = JSON.parse(r.body) } catch (e) { return { ok: false, error: '响应非 JSON' } }
      const mrs = (j && j.model_remains) || []
      const models = []
      for (const m of mrs) {
        if (m.model_name === 'video') continue // 用户要求去掉 video
        models.push({
          name: m.model_name ? String(m.model_name) : '?',
          intervalRemainPct: m.current_interval_remaining_percent != null ? Math.round(parseFloat(m.current_interval_remaining_percent) * 10) / 10 : null,
          weeklyRemainPct: m.current_weekly_remaining_percent != null ? Math.round(parseFloat(m.current_weekly_remaining_percent) * 10) / 10 : null,
          weeklyEndText: fmtReset(m.weekly_end_time),
          intervalEndText: fmtReset(m.end_time),
        })
      }
      return { ok: true, models: models }
    }

    async function arkOpenApiCall(action, region, ak, sk) {
      const q = volcCanonicalQuery(action, region)
      const url = 'https://' + VOLC_HOST + '/?' + q
      const sig = volcSign(ak, sk, region, q, new Uint8Array(0))
      const command = 'curl -sS -m 20 -X POST -H "Content-Type: ' + VOLC_CT + '" -H "X-Date: $QK_XDATE" -H "X-Content-Sha256: $QK_XSHA" -H "Authorization: $QK_AUTH" --data-binary "" -w "__QK_STATUS__:%{http_code}" "' + url + '"'
      return await runShell(command, { QK_XDATE: sig.xDate, QK_XSHA: sig.xContentSha256, QK_AUTH: sig.authorization })
    }
    function arkResponseError(j) {
      const err = (j && j.ResponseMetadata && j.ResponseMetadata.Error) || (j && j.Error)
      if (!err) return null
      return { code: String(err.Code || ''), msg: String(err.Message || '') }
    }
    function arkIsAuth(code) {
      const c = String(code).toLowerCase()
      return c.indexOf('auth') !== -1 || c.indexOf('signature') !== -1 || c.indexOf('accessdenied') !== -1 || c.indexOf('denied') !== -1 || c.indexOf('unauthorized') !== -1 || c.indexOf('forbidden') !== -1 || c.indexOf('credential') !== -1 || c.indexOf('token') !== -1
    }
    function parseAfpTiers(result) {
      const map = [['AFPFiveHour', '5小时窗口'], ['AFPWeekly', '周配额'], ['AFPMonthly', '月配额']]
      const rows = []
      for (const kv of map) {
        const win = result[kv[0]]
        if (!win) continue
        const quota = parseFloat(win.Quota)
        if (!(quota > 0)) continue
        const used = parseFloat(win.Used) || 0
        const usedPct = Math.round((used / quota) * 1000) / 10
        rows.push({ label: kv[1], usedPct: usedPct, remainPct: Math.max(0, Math.min(100, Math.round((100 - usedPct) * 10) / 10)), remaining: null, number: null, resetAtText: fmtReset(win.ResetTime) })
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
        if (lv === 'session' || lv === '5h' || lv === 'fivehour' || lv === 'five_hour' || lv === 'rolling_5h') label = '5小时窗口'
        else if (lv === 'weekly' || lv === 'week' || lv === '7d') label = '周配额'
        else if (lv === 'monthly' || lv === 'month') label = '月配额'
        else continue
        let used = item.Percent != null ? parseFloat(item.Percent) : NaN
        if (isNaN(used)) used = item.UsedPercent != null ? parseFloat(item.UsedPercent) : NaN
        if (isNaN(used)) used = item.UsagePercent != null ? parseFloat(item.UsagePercent) : NaN
        if (isNaN(used)) used = 0
        used = Math.round(used * 10) / 10
        rows.push({ label: label, usedPct: used, remainPct: Math.max(0, Math.min(100, Math.round((100 - used) * 10) / 10)), remaining: null, number: null, resetAtText: fmtReset(item.ResetTime != null ? item.ResetTime : item.ResetTimestamp) })
      }
      return rows
    }
    async function queryArk(ak, sk, region) {
      // 1) Agent Plan
      let r = await arkOpenApiCall('GetAFPUsage', region, ak, sk)
      if (r.error) return { ok: false, error: r.error }
      if (r.status === 200 && r.body) {
        let j = null
        try { j = JSON.parse(r.body) } catch (e) { j = null }
        if (j) {
          const err = arkResponseError(j)
          if (err) {
            if (arkIsAuth(err.code)) return { ok: false, error: 'Ark 鉴权失败（' + err.code + '）: ' + err.msg }
            return { ok: false, error: 'Ark API 错误（' + err.code + '）: ' + err.msg }
          }
          const result = j.Result || j
          const tiers = parseAfpTiers(result)
          if (tiers.length) {
            const pt = result.PlanType ? String(result.PlanType).trim() : ''
            return { ok: true, plan: pt ? ('Agent Plan ' + pt) : 'Agent Plan', limits: tiers }
          }
        }
      } else if (r.status !== 200) {
        let j = null
        try { j = JSON.parse(r.body || '{}') } catch (e) { j = null }
        if (j) { const err = arkResponseError(j); if (err && arkIsAuth(err.code)) return { ok: false, error: 'Ark 鉴权失败（HTTP ' + r.status + '，' + err.code + '）: ' + err.msg } }
      }
      // 2) Coding Plan
      r = await arkOpenApiCall('GetCodingPlanUsage', region, ak, sk)
      if (r.error) return { ok: false, error: r.error }
      if (r.status === 200 && r.body) {
        let j = null
        try { j = JSON.parse(r.body) } catch (e) { j = null }
        if (j) {
          const err = arkResponseError(j)
          if (err) {
            if (arkIsAuth(err.code)) return { ok: false, error: 'Ark 鉴权失败（' + err.code + '）: ' + err.msg }
            return { ok: false, error: 'Ark API 错误（' + err.code + '）: ' + err.msg }
          }
          const result = j.Result || j
          const tiers = parseCodingTiers(result)
          if (tiers.length) return { ok: true, plan: 'Coding Plan', limits: tiers }
          return { ok: false, error: '未找到生效的 Ark 套餐（签名通过）。原始: ' + String(r.body).slice(0, 300) }
        }
      } else if (r.status !== 200) {
        return { ok: false, error: 'Ark HTTP ' + r.status + ': ' + String(r.stderr || r.body).slice(0, 200) }
      }
      return { ok: false, error: '未找到生效的 Ark Agent/Coding 套餐' }
    }

    harness.handle('quota', async function (args) {
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
      } catch (e) {}

      const providers = await Promise.all(ids.map(async function (id) {
        const cfg = cfgMap[id] || {}
        const s = staticFor(id)
        const keyEnv = cfg.keyEnv || s.key
        let models = (cfg.models && cfg.models.length) ? cfg.models.slice(0, 12) : []
        if (models.length === 0) models = await discoverModels(id)
        const entry = { id: id, kind: s.kind, models: models, error: null, data: null }

        if (s.kind === 'ark') {
          const ak = (await resolveKey('VOLC_ACCESSKEY')) || (await resolveKey('ARK_ACCESS_KEY_ID'))
          const sk = (await resolveKey('VOLC_SECRETKEY')) || (await resolveKey('ARK_SECRET_ACCESS_KEY'))
          if (!ak || !sk) { entry.error = 'Ark 需火山控制面 AK/SK（与模型 API Key 不同）。请配置 VOLC_ACCESSKEY / VOLC_SECRETKEY，或 ARK_ACCESS_KEY_ID / ARK_SECRET_ACCESS_KEY'; return entry }
          const region = volcRegion(cfg.baseURL || s.base)
          const q = await queryArk(ak, sk, region)
          entry.error = q.error || null
          if (q.ok) entry.data = { plan: q.plan, limits: q.limits }
          return entry
        }
        if (s.kind === 'unknown') { entry.error = '未识别的 provider，暂不支持配额查询'; return entry }
        if (!keyEnv) { entry.error = '未配置 API Key 环境变量'; return entry }
        const key = await resolveKey(keyEnv)
        if (!key) { entry.error = '未找到 API Key（' + keyEnv + '）'; return entry }
        if (s.kind === 'glm') { const q = await queryGlm(id, key, s.base); entry.error = q.error || null; if (q.ok) entry.data = { level: q.level, limits: q.limits } }
        else if (s.kind === 'deepseek') {
          const q = await queryDeepseek(key)
          entry.error = q.error || null
          if (q.ok) {
            entry.data = { isAvailable: q.isAvailable, total: q.total, parts: q.parts }
            let spend = null
            const pt = await resolveKey('DEEPSEEK_PLATFORM_TOKEN')
            if (pt) {
              const c = await queryDeepseekTodayCost(pt)
              if (c.ok) spend = { value: c.todayCost, source: 'official' }
            }
            if (!spend) {
              const now = new Date()
              const dk = localDateKey(now)
              if (!dayBaseline || dayBaseline.date !== dk) dayBaseline = { date: dk, balance: q.total, atText: pad(now.getHours()) + ':' + pad(now.getMinutes()) }
              spend = { value: Math.max(0, Math.round((dayBaseline.balance - q.total) * 100) / 100), source: 'estimate', sinceText: dayBaseline.atText }
            }
            entry.data.todaySpend = spend
          }
        }
        else if (s.kind === 'minimax') { const q = await queryMinimax(key); entry.error = q.error || null; if (q.ok) entry.data = { models: q.models } }
        return entry
      }))

      const now = new Date()
      return {
        ok: true,
        scannedAtText: pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
        default: deflt,
        providers: providers,
      }
    })
  },
}

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(
      '.q-root{position:fixed;top:72px;right:16px;z-index:50;display:flex;flex-direction:column;max-height:44vh;pointer-events:auto;font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--q-bg);color:var(--q-fg);border:1px solid var(--q-border);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.22);overflow:hidden;--q-bg:#fff;--q-fg:#1f2328;--q-muted:#6b7280;--q-border:#e5e7eb;--q-hover:#f3f4f6}' +
      '.q-header{display:flex;align-items:center;gap:6px;padding:6px 10px}' +
      '.q-title{font-weight:600;font-size:12.5px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.q-time{font-size:10px;color:var(--q-muted);flex:none}' +
      '.q-btn{cursor:pointer;border:none;background:transparent;color:var(--q-muted);font-size:13px;line-height:1;padding:2px 5px;border-radius:5px;flex:none}' +
      '.q-btn:hover{background:var(--q-hover);color:var(--q-fg)}' +
      '.q-list{overflow-y:auto;flex:1;padding:3px 0;min-height:0}' +
      '.q-card{padding:4px 10px;border-top:1px solid var(--q-border)}' +
      '.q-card:first-child{border-top:none}' +
      '.q-cardhead{display:flex;align-items:center;gap:6px}' +
      '.q-prov{font-weight:600;font-size:11.5px}' +
      '.q-kind{font-size:9.5px;color:var(--q-muted);background:var(--q-hover);border-radius:999px;padding:0 6px;line-height:1.5}' +
      '.q-body{margin-top:1px}' +
      '.q-row{display:flex;align-items:center;gap:6px;margin:3px 0}' +
      '.q-row-label{flex:none;width:62px;font-size:10.5px;color:var(--q-muted)}' +
      '.q-bar{flex:1;height:5px;background:var(--q-border);border-radius:999px;overflow:hidden}' +
      '.q-fill{height:100%;border-radius:999px}' +
      '.q-row-pct{flex:none;min-width:40px;text-align:right;font-size:11px;font-weight:600}' +
      '.q-baltotal{font-size:12px;font-weight:600}' +
      '.q-mm{margin:2px 0}' +
      '.q-mm-name{font-size:11px;font-weight:600;margin:2px 0}' +
      '.q-empty{padding:10px 8px;text-align:center;color:var(--q-muted);font-size:11.5px}' +
      '.q-error{padding:6px 0;color:#dc2626;font-size:11.5px;word-break:break-word}' +
      '@media (prefers-color-scheme: dark){.q-root{--q-bg:#1c1f24;--q-fg:#e6e8eb;--q-muted:#9aa0a6;--q-border:#33383f;--q-hover:#282c33}}'
    )

    function clampPct(p) { if (p == null || isNaN(p)) return 0; return Math.max(0, Math.min(100, p)) }
    function remainColor(p) {
      if (p == null) return '#9ca3af'
      if (p <= 30) return '#ef4444'
      if (p <= 70) return '#f59e0b'
      return '#10b981'
    }

    function Panel() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [open, setOpen] = React.useState(true)

      function refresh() {
        setLoading(true)
        host.call('quota', {}).then(
          function (res) { setData(res); setError(null); setLoading(false) },
          function (err) { setError((err && err.message) ? err.message : String(err)); setLoading(false) },
        )
      }

      React.useEffect(function () {
        refresh()
        const stop = ctx.interval(refresh, 60000)
        return stop
      }, [])

      const providers = (data && data.providers) || []
      const deflt = (data && data.default) || null

      // 统一：条与数字都表示「剩余百分比」（与 MiniMax 风格一致）；tip 为悬停提示（重置时间等）
      function remainBar(label, pct, key, tip) {
        const props = { className: 'q-row', key: key }
        if (tip) props.title = tip
        return React.createElement('div', props,
          React.createElement('span', { className: 'q-row-label' }, label),
          React.createElement('div', { className: 'q-bar' },
            React.createElement('div', { className: 'q-fill', style: { width: clampPct(pct) + '%', background: remainColor(pct) } }),
          ),
          React.createElement('span', { className: 'q-row-pct' }, pct != null ? pct + '%' : ''),
        )
      }

      function card(p) {
        const kindLabel = { glm: '智谱/GLM 配额', deepseek: 'DeepSeek 余额', minimax: 'MiniMax 套餐', ark: '方舟/Ark 套餐', unknown: '未识别' }[p.kind] || p.kind
        const isDefault = deflt && deflt.provider === p.id
        let body = null
        if (p.error) {
          body = React.createElement('div', { className: 'q-error' }, p.error)
        } else if (!p.data) {
          body = React.createElement('div', { className: 'q-empty' }, '查询中…')
        } else if (p.kind === 'glm') {
          const d = p.data
          const rows = (d.limits || []).map(function (lim, i) { return remainBar(lim.label, lim.remainPct, i, lim.resetAtText ? ('重置 ' + lim.resetAtText) : null) })
          body = React.createElement('div', { className: 'q-body' }, rows.length ? rows : React.createElement('div', { className: 'q-empty' }, '无配额数据'))
        } else if (p.kind === 'ark') {
          const d = p.data
          const rows = (d.limits || []).map(function (lim, i) { return remainBar(lim.label, lim.remainPct, i, lim.resetAtText ? ('重置 ' + lim.resetAtText) : null) })
          body = React.createElement('div', { className: 'q-body' }, rows.length ? rows : React.createElement('div', { className: 'q-empty' }, '无配额数据'))
        } else if (p.kind === 'deepseek') {
          const d = p.data
          const ts = d.todaySpend
          let spendText = ''
          if (ts && ts.value != null) spendText = ' · 今日 ¥' + String(ts.value)
          let balTip = null
          if (Array.isArray(d.parts) && d.parts.length) {
            balTip = d.parts.map(function (b) {
              return (b.currency || 'CNY') + ' 合计 ' + b.total + (b.granted != null && b.toppedUp != null ? '（赠送 ' + b.granted + ' / 充值 ' + b.toppedUp + '）' : '')
            }).join('；')
          }
          if (ts) {
            const src = ts.source === 'official' ? '今日消费来自平台官方账单' : ('自 ' + (ts.sinceText || '--:--') + ' 起按余额差估算（重启后重新基线）')
            balTip = balTip ? (balTip + '；' + src) : src
          }
          const balProps = { className: 'q-baltotal' }
          if (balTip) balProps.title = balTip
          body = React.createElement('div', { className: 'q-body' },
            React.createElement('div', balProps, (d.isAvailable ? '' : '（不可用）') + '余额 ¥' + String(d.total) + spendText),
          )
        } else if (p.kind === 'minimax') {
          const d = p.data
          const rows = (d.models || []).map(function (m, i) {
            return React.createElement('div', { className: 'q-mm', key: i },
              React.createElement('div', { className: 'q-mm-name', title: m.weeklyEndText ? ('周重置 ' + m.weeklyEndText) : undefined }, m.name),
              m.intervalRemainPct != null ? remainBar('区间', m.intervalRemainPct, null, m.intervalEndText ? ('区间重置 ' + m.intervalEndText) : null) : null,
              m.weeklyRemainPct != null ? remainBar('周', m.weeklyRemainPct, null, m.weeklyEndText ? ('周重置 ' + m.weeklyEndText) : null) : null,
            )
          })
          body = React.createElement('div', { className: 'q-body' }, rows)
        }
        const modelsTip = (p.models && p.models.length) ? ('模型：' + p.models.join(' · ')) : null
        const headProps = { className: 'q-cardhead' }
        if (modelsTip) headProps.title = modelsTip
        return React.createElement('div', { className: 'q-card', key: p.id },
          React.createElement('div', headProps,
            React.createElement('span', { className: 'q-prov' }, (isDefault ? '● ' : '') + p.id),
            React.createElement('span', { className: 'q-kind' }, kindLabel),
          ),
          body,
        )
      }

      const header = React.createElement('div', { className: 'q-header' },
        React.createElement('span', { className: 'q-title' }, '⚡ 模型配额'),
        data && data.scannedAtText ? React.createElement('span', { className: 'q-time' }, data.scannedAtText) : null,
        React.createElement('button', { className: 'q-btn', title: '刷新', onClick: refresh }, loading ? '…' : '⟳'),
        open
          ? React.createElement('button', { className: 'q-btn', title: '收起', onClick: function () { setOpen(false) } }, '−')
          : React.createElement('button', { className: 'q-btn', title: '展开', onClick: function () { setOpen(true) } }, '＋'),
      )

      if (!open) {
        return React.createElement('div', { className: 'q-root', style: { width: 'auto' } }, header)
      }

      let body
      if (error) {
        body = React.createElement('div', { className: 'q-error' }, '加载失败：' + error)
      } else if (!data) {
        body = React.createElement('div', { className: 'q-empty' }, loading ? '正在查询各家配额…' : '暂无数据')
      } else if (providers.length === 0) {
        body = React.createElement('div', { className: 'q-empty' }, '未发现已配置的模型 provider')
      } else {
        body = React.createElement('div', { className: 'q-list' }, providers.map(card))
      }

      return React.createElement('div', { className: 'q-root', style: { width: 300 } },
        header,
        body,
      )
    }

    slots.inject('shell.overlay', function () {
      return slots.register(
        { name: 'shell.overlay', id: 'quota-panel', order: 50, label: '模型配额' },
        function () { return React.createElement(Panel) },
      )
    })
  },
}

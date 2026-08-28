/**
 * quota-panel — browser half (boot-graph bundle).
 *
 * Format: a classic script that registers its CJS factory with the shell's
 * ModuleLoader (`window.__ModuleLoader__.load`). React comes from the
 * shell-seeded module table (`require("react")`); everything else is plain
 * browser code — the panel fetches `/quota-panel/data.json` (served by this
 * package's host half through the webServer service) on load and every 60s.
 */
window.__ModuleLoader__.load({
	id: "quota-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		const CSS = [
			'.q-root{position:fixed;top:72px;right:16px;z-index:50;display:flex;flex-direction:column;max-height:44vh;pointer-events:auto;font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--q-bg);color:var(--q-fg);border:1px solid var(--q-border);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.22);overflow:hidden;--q-bg:#fff;--q-fg:#1f2328;--q-muted:#6b7280;--q-border:#e5e7eb;--q-hover:#f3f4f6}',
			'.q-header{display:flex;align-items:center;gap:6px;padding:6px 10px}',
			'.q-title{font-weight:600;font-size:12.5px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.q-time{font-size:10px;color:var(--q-muted);flex:none}',
			'.q-btn{cursor:pointer;border:none;background:transparent;color:var(--q-muted);font-size:13px;line-height:1;padding:2px 5px;border-radius:5px;flex:none}',
			'.q-btn:hover{background:var(--q-hover);color:var(--q-fg)}',
			'.q-list{overflow-y:auto;flex:1;padding:3px 0;min-height:0}',
			'.q-card{padding:4px 10px;border-top:1px solid var(--q-border)}',
			'.q-card:first-child{border-top:none}',
			'.q-cardhead{display:flex;align-items:center;gap:6px}',
			'.q-prov{font-weight:600;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.q-kind{font-size:9.5px;color:var(--q-muted);background:var(--q-hover);border-radius:999px;padding:0 6px;line-height:1.5;flex:none}',
			'.q-body{margin-top:1px}',
			'.q-row{display:flex;align-items:center;gap:6px;margin:3px 0}',
			'.q-row-label{flex:none;width:62px;font-size:10.5px;color:var(--q-muted)}',
			'.q-bar{flex:1;height:5px;background:var(--q-border);border-radius:999px;overflow:hidden}',
			'.q-fill{height:100%;border-radius:999px}',
			'.q-row-pct{flex:none;min-width:40px;text-align:right;font-size:11px;font-weight:600}',
			'.q-baltotal{font-size:12px;font-weight:600}',
			'.q-mm{margin:2px 0}',
			'.q-mm-name{font-size:11px;font-weight:600;margin:2px 0}',
			'.q-empty{padding:10px 8px;text-align:center;color:var(--q-muted);font-size:11.5px}',
			'.q-error{padding:6px 0;color:#dc2626;font-size:11.5px;word-break:break-word}',
			'@media (prefers-color-scheme: dark){.q-root{--q-bg:#1c1f24;--q-fg:#e6e8eb;--q-muted:#9aa0a6;--q-border:#33383f;--q-hover:#282c33}}',
		].join("");

		function clampPct(p) { if (p == null || isNaN(p)) return 0; return Math.max(0, Math.min(100, p)); }
		function remainColor(p) {
			if (p == null) return "#9ca3af";
			if (p <= 30) return "#ef4444";
			if (p <= 70) return "#f59e0b";
			return "#10b981";
		}
		function countdownText(ms) {
			if (ms == null) return null;
			const diff = ms - Date.now();
			if (diff <= 0) return "已重置";
			const mins = Math.floor(diff / 60000);
			const d = Math.floor(mins / 1440);
			const h = Math.floor((mins % 1440) / 60);
			const m = mins % 60;
			if (d > 0) return d + "天" + h + "小时后";
			if (h > 0) return h + "小时" + m + "分后";
			return m + "分后";
		}
		function resetTip(ms, text) {
			const cd = countdownText(ms);
			if (cd == null && text == null) return null;
			if (cd != null && text != null) return "重置倒计时 " + cd + "（" + text + "）";
			return cd != null ? "重置倒计时 " + cd : "重置 " + text;
		}

		function Panel() {
			const [data, setData] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [loading, setLoading] = React.useState(false);
			const [open, setOpen] = React.useState(true);

			function refresh() {
				setLoading(true);
				fetch("/quota-panel/data.json", { cache: "no-store" })
					.then(function (r) { return r.json(); })
					.then(function (res) {
						if (res && res.ok === false && res.error) { setError(res.error); setData(null); }
						else { setData(res); setError(null); }
						setLoading(false);
					})
					.catch(function (err) {
						setError(String(err && err.message ? err.message : err));
						setLoading(false);
					});
			}

			React.useEffect(function () {
				refresh();
				return ctx.interval(refresh, 60000);
			}, []);

			const providers = (data && data.providers) || [];
			const deflt = (data && data.default) || null;

			function remainBar(label, pct, key, tip) {
				const props = { className: "q-row", key: key };
				if (tip) props.title = tip;
				return React.createElement("div", props,
					React.createElement("span", { className: "q-row-label" }, label),
					React.createElement("div", { className: "q-bar" },
						React.createElement("div", { className: "q-fill", style: { width: clampPct(pct) + "%", background: remainColor(pct) } }),
					),
					React.createElement("span", { className: "q-row-pct" }, pct != null ? pct + "%" : ""),
				);
			}

			function card(p) {
				const kindLabel = { glm: "GLM", deepseek: "余额", minimax: "MiniMax", ark: "Ark", unknown: "?" }[p.kind] || p.kind;
				const isDefault = deflt && deflt.provider === p.id;
				let body = null;
				if (p.error) {
					body = React.createElement("div", { className: "q-error" }, p.error);
				} else if (!p.data) {
					body = React.createElement("div", { className: "q-empty" }, "查询中…");
				} else if (p.kind === "glm" || p.kind === "ark") {
					const rows = (p.data.limits || []).map(function (lim, i) { return remainBar(lim.label, lim.remainPct, i, resetTip(lim.resetAtMs, lim.resetAtText)); });
					body = React.createElement("div", { className: "q-body" }, rows.length ? rows : React.createElement("div", { className: "q-empty" }, "无配额数据"));
				} else if (p.kind === "deepseek") {
					const d = p.data;
					let balTip = null;
					if (Array.isArray(d.parts) && d.parts.length) {
						balTip = d.parts.map(function (b) {
							return (b.currency || "CNY") + " 合计 " + b.total + (b.granted != null && b.toppedUp != null ? "（赠送 " + b.granted + " / 充值 " + b.toppedUp + "）" : "");
						}).join("；");
					}
					const balProps = { className: "q-baltotal" };
					if (balTip) balProps.title = balTip;
					body = React.createElement("div", { className: "q-body" },
						React.createElement("div", balProps, (d.isAvailable ? "" : "（不可用）") + "余额 ¥" + String(d.total)),
					);
				} else if (p.kind === "minimax") {
					const rows = (p.data.models || []).map(function (m, i) {
						return React.createElement("div", { className: "q-mm", key: i },
							React.createElement("div", { className: "q-mm-name" }, m.name),
							m.intervalRemainPct != null ? remainBar("区间", m.intervalRemainPct, null, resetTip(m.intervalEndMs, m.intervalEndText)) : null,
							m.weeklyRemainPct != null ? remainBar("周", m.weeklyRemainPct, null, resetTip(m.weeklyEndMs, m.weeklyEndText)) : null,
						);
					});
					body = React.createElement("div", { className: "q-body" }, rows);
				}
				let cardTip = null;
				if (p.data && !p.error) {
					const parts = [];
					if (p.kind === "glm" || p.kind === "ark") {
						for (const lim of p.data.limits || []) {
							const cd = countdownText(lim.resetAtMs);
							if (cd != null) parts.push(lim.label + "：" + cd);
						}
					} else if (p.kind === "minimax") {
						for (const m of p.data.models || []) {
							const a = countdownText(m.intervalEndMs);
							const b = countdownText(m.weeklyEndMs);
							if (a != null || b != null) parts.push(m.name + "：" + (a != null ? "区间 " + a : "") + (a != null && b != null ? "；" : "") + (b != null ? "周 " + b : ""));
						}
					}
					if (parts.length) cardTip = p.id + " 重置倒计时 — " + parts.join("；");
				}
				const modelsTip = p.models && p.models.length ? "模型：" + p.models.join(" · ") : null;
				const headProps = { className: "q-cardhead" };
				if (modelsTip) headProps.title = modelsTip;
				const cardProps = { className: "q-card", key: p.id };
				if (cardTip) cardProps.title = cardTip;
				return React.createElement("div", cardProps,
					React.createElement("div", headProps,
						React.createElement("span", { className: "q-prov" }, (isDefault ? "● " : "") + p.id),
						React.createElement("span", { className: "q-kind" }, kindLabel),
					),
					body,
				);
			}

			const header = React.createElement("div", { className: "q-header" },
				React.createElement("span", { className: "q-title" }, "⚡ 模型配额"),
				data && data.scannedAtText ? React.createElement("span", { className: "q-time" }, data.scannedAtText) : null,
				React.createElement("button", { className: "q-btn", title: "刷新", onClick: refresh }, loading ? "…" : "⟳"),
				open
					? React.createElement("button", { className: "q-btn", title: "收起", onClick: function () { setOpen(false); } }, "−")
					: React.createElement("button", { className: "q-btn", title: "展开", onClick: function () { setOpen(true); } }, "＋"),
			);

			if (!open) {
				return React.createElement("div", { className: "q-root", style: { width: "auto" } }, header);
			}

			let body;
			if (error) {
				body = React.createElement("div", { className: "q-error" }, "加载失败：" + error);
			} else if (!data) {
				body = React.createElement("div", { className: "q-empty" }, loading ? "正在查询各家配额…" : "暂无数据");
			} else if (providers.length === 0) {
				body = React.createElement("div", { className: "q-empty" }, "未发现已配置的模型 provider");
			} else {
				body = React.createElement("div", { className: "q-list" }, providers.map(card));
			}

			return React.createElement("div", { className: "q-root", style: { width: 200 } },
				header,
				body,
			);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			const tag = document.createElement("style");
			tag.textContent = CSS;
			document.head.appendChild(tag);
			ctx.effect(function () {
				return function () { tag.remove(); };
			}, "quota-panel: styles");
			slots.inject("shell.overlay", function () {
				return slots.register(
					{ name: "shell.overlay", id: "quota-panel", order: 50, label: "模型配额" },
					function () { return React.createElement(Panel); },
				);
			});
		}

		exports.name = "quota-panel";
		exports.inject = ["timer"];
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map

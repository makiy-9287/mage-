/* app.js — config, data layer (Supabase realtime or mock demo), UI rendering */
const SUPABASE_URL = "https://nxxcqhkpeuuxouonhraq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lM8eKzaRNPvMGrIFlKGByw_YZbVYrgb";
const RPD_LIMIT = 20;        // per Gemini model (matches ai_daily_rpd_limit in the bot)
const STALE_MS = 60000;      // engine considered stale after 60s without a stats update

const $ = s => document.querySelector(s);
const LS = (() => { try { return JSON.parse(localStorage.getItem("crt_cfg") || "{}"); } catch { return {}; } })();
const CFG_URL = LS.url || SUPABASE_URL, CFG_KEY = LS.key || SUPABASE_ANON_KEY;
const okCfg = !/^YOUR_/.test(CFG_URL) && !/^YOUR_/.test(CFG_KEY) && CFG_URL && CFG_KEY;
const DEMO = LS.demo === true || !okCfg;

const S = { wl: {}, tr: {}, st: null, filter: "ALL", tab: "active", sym: null, tid: null, tf: "1h", tg: { crt: 1, walls: 1, zones: 1 }, sig: "", act: new Set() };
const ACTIVE = ["PENDING_LIMIT", "ACTIVE", "TP1_HIT", "TP2_HIT"];
const CLOSED = ["TP3_HIT", "BE_STOPPED", "SL_HIT", "CANCELLED"];

const ms = v => { if (v == null) return 0; if (typeof v === "number") return v < 1e12 ? v * 1000 : v; const t = Date.parse(v); return isNaN(t) ? 0 : t; };
const tfmt = v => ms(v) ? new Date(ms(v)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
const cls = v => (num(v) > 0 ? "up" : num(v) < 0 ? "dn" : "");
const sgn = (v, d = 2) => (num(v) == null ? "–" : (v > 0 ? "+" : "") + (+v).toFixed(d));
const entryOf = t => num(t.filled_price) || num(t.limit_price);
const trades = () => Object.values(S.tr).sort((a, b) => ms(b.created_at) - ms(a.created_at));
const curTrade = () => S.tid ? S.tr[S.tid] : trades().find(t => t.symbol === S.sym && ACTIVE.includes(t.status));

/* ---------- rendering ---------- */
let raf = 0;
const render = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; rHead(); rWatch(); rInsp(); rBottom(); rChartHead(); syncChart(); }); };

function rHead() {
  const s = S.st || {}, age = Date.now() - ms(s.updated_at);
  const on = s.bot_status === "ONLINE" && age <= STALE_MS, stale = s.bot_status === "ONLINE" && age > STALE_MS;
  $("#bot").className = "pill " + (on ? "up" : stale ? "am" : "dn");
  $("#bot").textContent = on ? "🟢 ENGINE ONLINE" : stale ? `🟠 STALE ${Math.round(age / 1000)}s` : "🔴 SLEEPING";
  const rg = s.btc_regime || "NEUTRAL";
  $("#regime").className = "pill " + (rg === "BULLISH" ? "up" : rg === "BEARISH" ? "dn" : "");
  $("#regime").textContent = "BTC " + rg;
  $("#mode").className = "pill " + (DEMO ? "am" : "");
  $("#mode").textContent = DEMO ? "DEMO DATA" : "LIVE";
  const dec = (s.wins || 0) + (s.losses || 0), wr = dec ? Math.round((s.wins / dec) * 100) + "%" : "–";
  const used = s.ai_calls_used || {}, keys = Object.keys(used), tot = keys.reduce((a, k) => a + (+used[k] || 0), 0), cap = RPD_LIMIT * Math.max(1, keys.length);
  $("#kpis").innerHTML = `
    <div class="kpi"><span>Win rate</span><b class="num">${wr}</b></div>
    <div class="kpi"><span>Net PnL</span><b class="num ${cls(s.total_r)}">${sgn(s.total_r)}R</b></div>
    <div class="kpi"><span>Active / Pending</span><b class="num">${s.active ?? 0} / ${s.pending ?? 0}</b></div>
    <div class="kpi" title="${esc(keys.map(k => k + ": " + used[k] + "/" + RPD_LIMIT).join("\n"))}"><span>Gemini RPD</span><b class="num ${tot >= cap ? "dn" : ""}">${tot}/${cap}</b></div>`;
}

function rWatch() {
  S.act = new Set(trades().filter(t => ACTIVE.includes(t.status)).map(t => t.symbol));
  const list = Object.values(S.wl).filter(w => w.status !== "EXPIRED" && (S.filter === "ALL" || w.status === S.filter)).sort((a, b) => b.htf_score - a.htf_score);
  const sc = Math.max(0, ...list.map(w => +w.htf_score || 0)) > 10 ? 100 : 10;
  $("#wl").innerHTML = list.length ? list.map(w => {
    const bull = w.direction === "BULLISH";
    return `<div class="card ${S.sym === w.symbol ? "sel" : ""}" data-sym="${esc(w.symbol)}" tabindex="0">
      <div class="r1"><b>${esc(w.symbol.replace("USDT", ""))}<small>/USDT</small></b><span class="dir ${bull ? "up" : "dn"}">${esc(w.direction)}</span>${S.act.has(w.symbol) ? '<span class="bolt" title="Active signal">⚡</span>' : ""}<span class="st">${esc(w.status)}</span></div>
      <div class="r2"><span>${esc(w.crt_model)}</span><b class="mono">${fp(w.live_price)}</b></div>
      <div class="bar"><i style="width:${Math.min(100, ((+w.htf_score || 0) / sc) * 100)}%"></i><em>${esc(w.htf_score)}</em></div>
      <div class="r3 mono"><span>Spot <b class="${cls(w.spot_cvd_usd)}">${fu(w.spot_cvd_usd)}</b></span><span>Perp <b class="${cls(w.perp_cvd_usd)}">${fu(w.perp_cvd_usd)}</b></span><span>OBI <b class="${cls(w.obi_weighted)}">${sgn(w.obi_weighted)}</b></span></div></div>`;
  }).join("") : '<p class="empty">No pairs on the watchlist yet. The engine adds them after each 4H scan.</p>';
}

function rChartHead() {
  const w = S.wl[S.sym];
  $("#csym").innerHTML = S.sym ? `${esc(S.sym)}<small class="mono">${w ? fp(w.live_price) : ""}</small>` : "Select a pair";
  document.querySelectorAll("#tfs button").forEach(b => b.classList.toggle("on", b.dataset.tf === S.tf));
  document.querySelectorAll("#tgs button").forEach(b => b.classList.toggle("on", !!S.tg[b.dataset.tg]));
}

function syncChart() {
  if (!S.sym) return;
  const w = S.wl[S.sym], t = curTrade();
  const sig = JSON.stringify([w && [w.crt_high, w.crt_low, w.crt_eq, w.erl_level, w.whale_bid_walls, w.whale_ask_walls, w.liq_clusters_below, w.liq_clusters_above], t && [t.trade_id, t.filled_price, t.sl, t.tp1, t.tp2, t.tp3, t.closed_at], S.tg]);
  if (sig === S.sig) return;
  S.sig = sig; CRTChart.setOverlay(w, t, S.tg);
}

function rInsp() {
  const w = S.wl[S.sym] || {}, t = curTrade();
  if (!S.sym) { $("#insp").innerHTML = '<p class="empty">Pick a pair from the watchlist or trade history to see orderflow and AI analysis.</p>'; return; }
  const o = Math.max(-1, Math.min(1, num(w.obi_weighted) || 0)), fl = (n, v) => `<span class="flag ${v ? "on" : ""}">${n}${v ? "" : " – none"}</span>`;
  const walls = [...(w.whale_bid_walls || []).map(x => ({ ...x, s: "Bid" })), ...(w.whale_ask_walls || []).map(x => ({ ...x, s: "Ask" }))].sort((a, b) => b.usd - a.usd).slice(0, 6);
  let h = `<div class="box"><h3>Orderflow</h3>
    <div class="kv"><span>Spot CVD</span><b class="num ${cls(w.spot_cvd_usd)}">${fu(w.spot_cvd_usd)}</b></div>
    <div class="kv"><span>Perp CVD</span><b class="num ${cls(w.perp_cvd_usd)}">${fu(w.perp_cvd_usd)}</b></div>
    <div class="kv"><span>OBI (weighted)</span><b class="num ${cls(o)}">${sgn(o)}</b></div>
    <div class="gauge"><i style="left:${((o + 1) / 2) * 100}%"></i></div>
    <div class="kv"><span>Open interest</span><b class="num">${fu(w.oi_usd)}</b></div>
    <div class="kv"><span>Funding rate</span><b class="num ${cls(-w.funding_rate_pct)}">${num(w.funding_rate_pct) == null ? "–" : (+w.funding_rate_pct).toFixed(4) + "%"}</b></div>
    <div class="kv"><span>POC / VWAP</span><b class="num">${fp(w.poc)} / ${fp(w.vwap)}</b></div>
    <div class="flags">${fl("Absorption", w.absorption)}${fl("Tape burst", w.tape_burst)}${fl("CVD divergence", w.cvd_divergence)}</div></div>
    <div class="box"><h3>Whale walls</h3>${walls.length ? `<table><thead><tr><th>Side</th><th>Price</th><th>Size</th><th>Held</th></tr></thead><tbody>${walls.map(x => `<tr><td class="${x.s === "Bid" ? "up" : "dn"}">${x.s}</td><td class="num">${fp(x.price)}</td><td class="num">${fu(x.usd)}</td><td class="num">${x.persist_sec ?? "–"}s</td></tr>`).join("")}</tbody></table>` : '<p class="empty">No persistent walls detected.</p>'}</div>`;
  h += t ? `<div class="box"><h3>AI inspector — ${esc(t.symbol)} ${esc(t.direction)} (${esc(t.mode)})</h3>
    <div class="kv"><span>Decision</span><b class="${t.ai_decision === "APPROVE" ? "up" : "dn"}">${esc(t.ai_decision)}</b></div>
    <div class="kv"><span>Confidence</span><b class="num">${esc(t.ai_confidence)}%</b></div><div class="conf"><i style="width:${Math.min(100, +t.ai_confidence || 0)}%"></i></div>
    <div class="kv"><span>Model</span><b class="mono">${esc(t.ai_model_used)}</b></div>
    <div class="kv"><span>Entry model · score</span><b>${esc(t.entry_model)} · ${esc(t.quant_score)}</b></div>
    <div class="kv"><span>Status · RR</span><b>${esc(t.status)} · ${num(t.rr_ratio) ? (+t.rr_ratio).toFixed(2) : "–"}</b></div>
    ${t.news_catalyst ? `<div class="kv"><span>News catalyst</span><b class="am" style="text-align:right">${esc(t.news_catalyst)}</b></div>` : ""}
    <p class="reason">${esc(t.ai_reasoning) || "No reasoning recorded."}</p></div>`
    : '<div class="box"><h3>AI inspector</h3><p class="empty">No signal for this pair yet.</p></div>';
  $("#insp").innerHTML = h;
}

function rBottom() {
  document.querySelectorAll("#btabs button").forEach(b => b.classList.toggle("on", b.dataset.t === S.tab));
  const all = trades(), row = (t, cells) => `<tr data-sym="${esc(t.symbol)}" data-tid="${esc(t.trade_id)}" class="${S.tid === t.trade_id ? "sel" : ""}">${cells}</tr>`;
  const dirc = t => `<span class="${t.direction === "LONG" ? "up" : "dn"}">${esc(t.direction)}</span>`;
  const tbl = (head, rows) => rows ? `<div class="tw"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : null;
  let out;
  if (S.tab === "active") {
    out = tbl(["Symbol", "Mode", "Side", "Entry", "SL", "TP1", "TP2", "TP3", "Status", "Left", "R", "AI"],
      all.filter(t => ACTIVE.includes(t.status)).map(t => row(t, `<td><b>${esc(t.symbol)}</b></td><td>${esc(t.mode)}</td><td>${dirc(t)}</td><td class="num">${fp(entryOf(t))}</td><td class="num dn">${fp(t.sl)}</td><td class="num up">${fp(t.tp1)}</td><td class="num up">${fp(t.tp2)}</td><td class="num up">${fp(t.tp3)}</td><td><span class="tag">${esc(t.status)}</span></td><td class="num">${Math.round((num(t.remaining_pct) ?? 1) * 100)}%</td><td class="num ${cls(t.pnl_r)}">${sgn(t.pnl_r)}</td><td class="num">${esc(t.ai_confidence)}%</td>`)).join(""));
  } else if (S.tab === "history") {
    out = tbl(["Opened", "Symbol", "Mode", "Side", "Entry", "SL", "Result", "R", "RR", "Closed"],
      all.filter(t => CLOSED.includes(t.status)).map(t => row(t, `<td>${tfmt(t.created_at)}</td><td><b>${esc(t.symbol)}</b></td><td>${esc(t.mode)}</td><td>${dirc(t)}</td><td class="num">${fp(entryOf(t))}</td><td class="num">${fp(t.sl)}</td><td><span class="tag">${esc(t.status)}</span></td><td class="num ${cls(t.pnl_r)}">${sgn(t.pnl_r)}</td><td class="num">${num(t.rr_ratio) ? (+t.rr_ratio).toFixed(2) : "–"}</td><td>${tfmt(t.closed_at)}</td>`)).join(""));
  } else if (S.tab === "rejected") {
    out = tbl(["Time", "Symbol", "Mode", "Side", "Quant", "Model", "Conf", "Reasoning"],
      all.filter(t => t.ai_decision === "REJECT" || t.status === "REJECTED").map(t => row(t, `<td>${tfmt(t.created_at)}</td><td><b>${esc(t.symbol)}</b></td><td>${esc(t.mode)}</td><td>${dirc(t)}</td><td class="num">${esc(t.quant_score)}</td><td class="mono">${esc(t.ai_model_used)}</td><td class="num">${esc(t.ai_confidence)}%</td><td class="wrap">${esc(t.ai_reasoning)}</td>`)).join(""));
  } else {
    const bm = (S.st && S.st.by_mode) || {};
    out = `<div class="modes">${["SCALP", "DAY", "SWING"].map(m => {
      const c = all.filter(t => t.mode === m && CLOSED.includes(t.status) && t.status !== "CANCELLED"), w = c.filter(t => t.pnl_r > 0).length, r = c.reduce((a, t) => a + (+t.pnl_r || 0), 0), d = bm[m] || {};
      return `<div class="box"><h3>${m}</h3>
        <div class="kv"><span>Closed trades</span><b class="num">${c.length}</b></div>
        <div class="kv"><span>Win rate</span><b class="num">${c.length ? Math.round((w / c.length) * 100) + "%" : "–"}</b></div>
        <div class="kv"><span>Net R</span><b class="num ${cls(r)}">${sgn(r)}R</b></div>
        <div class="kv"><span>Avg R / trade</span><b class="num ${cls(r)}">${c.length ? sgn(r / c.length) : "–"}</b></div>
        <div class="kv"><span>Today</span><b class="num">${d.trades ?? 0} trades · ${d.wins ?? 0}W · <span class="${cls(d.r)}">${sgn(d.r ?? 0)}R</span></b></div></div>`;
    }).join("")}</div>`;
  }
  $("#bbody").innerHTML = out || '<p class="empty">Nothing here yet.</p>';
}

/* ---------- interactions ---------- */
function pick(sym, tid) {
  const changed = sym !== S.sym;
  S.sym = sym; S.tid = tid || null; S.sig = "";
  if (changed || !tid) CRTChart.load(sym, S.tf); else if (S.tf) { /* same symbol: just swap overlay */ }
  render();
  if (innerWidth <= 900) $("#chead").scrollIntoView({ behavior: "smooth", block: "start" });
}
function onPick(e) { const el = e.target.closest("[data-sym]"); if (el) pick(el.dataset.sym, el.dataset.tid); }
$("#wl").addEventListener("click", onPick);
$("#wl").addEventListener("keydown", e => { if (e.key === "Enter") onPick(e); });
$("#bbody").addEventListener("click", onPick);
$("#wtabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.filter = b.dataset.f; document.querySelectorAll("#wtabs button").forEach(x => x.classList.toggle("on", x === b)); render(); } });
$("#btabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.tab = b.dataset.t; render(); } });
$("#tfs").addEventListener("click", e => { const b = e.target.closest("button"); if (b && S.sym) { S.tf = b.dataset.tf; CRTChart.load(S.sym, S.tf); render(); } });
$("#tgs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.tg[b.dataset.tg] = S.tg[b.dataset.tg] ? 0 : 1; render(); } });
$("#gear").onclick = () => { $("#f-url").value = LS.url || ""; $("#f-key").value = LS.key || ""; $("#f-demo").checked = LS.demo === true || !okCfg; $("#modal").hidden = false; };
$("#f-cancel").onclick = () => { $("#modal").hidden = true; };
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") $("#modal").hidden = true; });
$("#mform").addEventListener("submit", e => {
  e.preventDefault();
  localStorage.setItem("crt_cfg", JSON.stringify({ url: $("#f-url").value.trim(), key: $("#f-key").value.trim(), demo: $("#f-demo").checked }));
  location.reload();
});
CRTChart.onNote = m => { $("#note").hidden = !m; $("#note").textContent = m; };

/* ---------- data: live Supabase ---------- */
const keyOf = { algo_watchlist: ["wl", "symbol"], algo_signals_trades: ["tr", "trade_id"] };

async function startLive() {
  const sb = supabase.createClient(CFG_URL, CFG_KEY);
  const load = async () => {
    const [w, t, d] = await Promise.all([
      sb.from("algo_watchlist").select("*"),
      sb.from("algo_signals_trades").select("*").order("created_at", { ascending: false }).limit(500),
      sb.from("algo_daily_stats").select("*").order("date_sl", { ascending: false }).limit(1)
    ]);
    const err = w.error || t.error || d.error;
    if (err) { CRTChart.onNote("Supabase error: " + err.message + " — check URL/key and RLS read policies."); return; }
    S.wl = Object.fromEntries(w.data.map(r => [r.symbol, r]));
    S.tr = Object.fromEntries(t.data.map(r => [r.trade_id, r]));
    S.st = d.data[0] || null;
    render();
  };
  await load();
  const ch = sb.channel("algo-live");
  Object.keys(keyOf).forEach(tb => ch.on("postgres_changes", { event: "*", schema: "public", table: tb }, p => {
    const [bag, k] = keyOf[tb];
    if (p.eventType === "DELETE") delete S[bag][p.old[k]]; else S[bag][p.new[k]] = p.new;
    render();
  }));
  ch.on("postgres_changes", { event: "*", schema: "public", table: "algo_daily_stats" }, p => {
    if (p.new && (!S.st || String(p.new.date_sl) >= String(S.st.date_sl))) { S.st = p.new; render(); }
  });
  ch.subscribe();
  setInterval(load, 30000);   // safety net if realtime drops
  setInterval(rHead, 5000);   // keeps the stale-engine badge honest
}

/* ---------- data: mock demo ---------- */
async function startDemo() {
  const base = { BTCUSDT: 97000, ETHUSDT: 3400, SOLUSDT: 210, BNBUSDT: 690, XRPUSDT: 2.4, DOGEUSDT: 0.38, LINKUSDT: 24, AVAXUSDT: 42 };
  try {   // seed with real prices so overlays line up with the real Binance chart
    const r = await fetch("https://data-api.binance.vision/api/v3/ticker/price?symbols=" + encodeURIComponent(JSON.stringify(Object.keys(base))));
    (await r.json()).forEach(x => (base[x.symbol] = +x.price));
  } catch (e) { /* keep fallbacks */ }
  const R = (a, b) => a + Math.random() * (b - a), now = Date.now(), models = ["Sweep & Reclaim", "Turtle Soup", "Judas Swing", "Inside-bar CRT"];
  Object.entries(base).forEach(([s, p], i) => {
    const bull = i % 3 !== 1, r = p * R(0.02, 0.04), wall = (k, side) => ({ price: p + side * r * k, usd: R(5e5, 4e6), persist_sec: Math.round(R(30, 900)) });
    S.wl[s] = { symbol: s, crt_model: models[i % 4], direction: bull ? "BULLISH" : "BEARISH", crt_high: p + r, crt_low: p - r, crt_eq: p, erl_level: p + (bull ? 1 : -1) * r * 1.6,
      irl_zone: { low: p - r * 0.3, high: p - r * 0.1, mid: p - r * 0.2 }, htf_score: Math.round(R(55, 95)), volume_24h_usdt: R(5e7, 5e9), status: i % 4 === 3 ? "TRIGGERED" : "WATCHING",
      live_price: p, spot_cvd_usd: R(-4e6, 6e6), perp_cvd_usd: R(-9e6, 1.2e7), obi_weighted: R(-0.6, 0.6), oi_usd: R(5e7, 3e9), funding_rate_pct: R(-0.02, 0.04),
      cvd_divergence: Math.random() > 0.6, absorption: Math.random() > 0.5, tape_burst: Math.random() > 0.7, poc: p * 0.998, vwap: p * 1.001,
      whale_bid_walls: [wall(0.5, -1), wall(0.9, -1)], whale_ask_walls: [wall(0.6, 1), wall(1.1, 1)],
      liq_clusters_below: [{ price: p - r * 1.3, usd: R(2e6, 3e7) }], liq_clusters_above: [{ price: p + r * 1.3, usd: R(2e6, 3e7) }], updated_at: now };
  });
  const specs = [["BTCUSDT", "DAY", "LONG", "ACTIVE", 5, 0, 91], ["ETHUSDT", "SCALP", "SHORT", "TP1_HIT", 3, 0.5, 84], ["SOLUSDT", "SWING", "LONG", "PENDING_LIMIT", 1, 0, 88],
    ["BNBUSDT", "DAY", "LONG", "TP3_HIT", 30, 3.2, 90], ["XRPUSDT", "SCALP", "SHORT", "SL_HIT", 40, -1, 78], ["DOGEUSDT", "SCALP", "LONG", "BE_STOPPED", 52, 0, 80],
    ["LINKUSDT", "SWING", "SHORT", "TP2_HIT", 70, 2.1, 86], ["AVAXUSDT", "DAY", "LONG", "SL_HIT", 90, -1, 75], ["ETHUSDT", "DAY", "SHORT", "REJECTED", 8, 0, 41], ["SOLUSDT", "SCALP", "LONG", "REJECTED", 12, 0, 38]];
  specs.forEach(([s, mode, dir, st, hrs, pnl, conf], i) => {
    const p = base[s], L = dir === "LONG" ? 1 : -1, risk = p * 0.006, e = p - L * risk * (st === "PENDING_LIMIT" ? 0.2 : 0.6), id = "T" + (1000 + i);
    const rej = st === "REJECTED", closed = CLOSED.includes(st), t0 = now - hrs * 3600e3;
    S.tr[id] = { trade_id: id, symbol: s, mode, direction: dir, crt_model: models[i % 4], entry_model: ["OB retest", "FVG fill", "IRL tap"][i % 3], quant_score: 70 + (i * 3) % 25,
      ai_model_used: "gemini-3.8-flash", ai_decision: rej ? "REJECT" : "APPROVE", ai_confidence: conf, news_catalyst: i % 3 === 0 ? "FOMC minutes today — volatility expected" : "",
      ai_reasoning: rej ? "Setup fights the BTC regime and spot CVD does not confirm the sweep. Skipping." : "4H CRT sweep with spot-led CVD, absorption at the IRL zone and thin asks above. Risk is well-defined below the sweep low.",
      entry_type: "LIMIT", limit_price: e, filled_price: st === "PENDING_LIMIT" || rej ? null : e, sl: e - L * risk, original_sl: e - L * risk, tp1: e + L * risk * 1.5, tp2: e + L * risk * 2.5, tp3: e + L * risk * 4,
      rr_ratio: 4, status: st, remaining_pct: st === "TP1_HIT" ? 0.5 : st === "TP2_HIT" ? 0.25 : 1, pnl_r: pnl, created_at: t0, filled_at: st === "PENDING_LIMIT" || rej ? null : t0 + 600e3,
      closed_at: closed ? t0 + 4 * 3600e3 : null, updated_at: now };
  });
  const tick = () => {
    const tr = trades();
    S.st = { date_sl: new Date().toISOString().slice(0, 10), total_signals: tr.length, wins: 2, losses: 2, breakevens: 1, pending: 1, active: 3, rejected: 2, cancelled: 0, win_rate: 50,
      total_r: tr.reduce((a, t) => a + (+t.pnl_r || 0), 0), by_mode: { SCALP: { trades: 3, wins: 1, r: 0.5 }, DAY: { trades: 3, wins: 1, r: 2.2 }, SWING: { trades: 2, wins: 1, r: 2.1 } },
      btc_regime: "BULLISH", ai_calls_used: { "gemini-4-hydrogen": 6, "gemini-3.8-flash": 11, "gemini-3.6-flash": 3 }, bot_status: "ONLINE", updated_at: Date.now() };
    Object.values(S.wl).forEach(w => { w.live_price *= 1 + R(-0.0006, 0.0006); w.spot_cvd_usd += R(-2e5, 2e5); w.perp_cvd_usd += R(-3e5, 3e5); w.obi_weighted = Math.max(-1, Math.min(1, w.obi_weighted + R(-0.05, 0.05))); });
    render();
  };
  tick(); setInterval(tick, 2500);
}

/* ---------- boot ---------- */
CRTChart.init($("#chart"));
rHead(); rWatch(); rInsp(); rBottom();
(DEMO ? startDemo() : startLive()).then(() => { const first = Object.values(S.wl).sort((a, b) => b.htf_score - a.htf_score)[0]; if (first && !S.sym) pick(first.symbol); });

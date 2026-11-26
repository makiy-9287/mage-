/* charts.js — Lightweight Charts v4.2 wrapper: live Binance candles + CRT / orderflow / position overlays */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => (v == null || v === "" || isNaN(+v) ? null : +v);
const fp = v => {
  v = num(v); if (v == null) return "–";
  const a = Math.abs(v);
  return v.toLocaleString("en-US", { maximumFractionDigits: a >= 1000 ? 1 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8 });
};
const fu = v => {
  v = num(v); if (v == null) return "–";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  return s + "$" + (a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(0) + "k" : a.toFixed(0));
};

/* TradingView-style position zones as a series primitive (drawn behind candles) */
class Zones {
  constructor() { this.z = []; }
  attached({ chart, series, requestUpdate }) { this.c = chart; this.s = series; this.u = requestUpdate; }
  detached() { this.c = this.s = this.u = null; }
  set(z) { this.z = z; if (this.u) this.u(); }
  updateAllViews() {}
  paneViews() {
    const me = this;
    return [{
      zOrder: () => "bottom",
      renderer: () => ({
        draw(target) {
          target.useBitmapCoordinateSpace(({ context: c, bitmapSize: b, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
            if (!me.c || !me.s) return;
            const ts = me.c.timeScale();
            for (const z of me.z) {
              const y1 = me.s.priceToCoordinate(z.a), y2 = me.s.priceToCoordinate(z.b), x0 = ts.timeToCoordinate(z.t0);
              if (y1 == null || y2 == null || x0 == null) continue;
              const x1 = z.t1 ? ts.timeToCoordinate(z.t1) : null;
              const X0 = Math.max(0, x0 * hr), X1 = x1 == null ? b.width : x1 * hr;
              if (X1 <= X0) continue;
              const Y = Math.min(y1, y2) * vr, H = Math.abs(y2 - y1) * vr;
              c.fillStyle = `rgba(${z.c},.16)`; c.fillRect(X0, Y, X1 - X0, H);
              c.strokeStyle = `rgba(${z.c},.6)`; c.lineWidth = hr; c.strokeRect(X0, Y, X1 - X0, H);
              c.fillStyle = `rgba(${z.c},.95)`; c.font = `${11 * vr}px Inter,sans-serif`;
              c.fillText(z.l, X0 + 6 * hr, Y + 14 * vr);
            }
          });
        }
      })
    }];
  }
}

const CRTChart = (() => {
  const TF = { "4h": 14400, "1h": 3600, "15m": 900, "5m": 300 };
  let chart, ser, zones, lines = [], ws, sym, tf = "1h", ver = 0, bars = [], ov = { wl: null, tr: null, tg: { crt: 1, walls: 1, zones: 1 } };
  const api = { onTick: null, onNote: null, tfs: TF };

  function init(el) {
    chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { color: "#0b0f14" }, textColor: "#7d8899", fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: "#141a22" }, horzLines: { color: "#141a22" } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#222a36" },
      timeScale: { borderColor: "#222a36", timeVisible: true, secondsVisible: false, rightOffset: 6 }
    });
    ser = chart.addCandlestickSeries({ upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350" });
    zones = new Zones();
    ser.attachPrimitive(zones);
  }

  function synth(base, t) {
    const step = TF[t], now = Math.floor(Date.now() / 1000 / step) * step, out = [];
    let p = base || 100;
    for (let i = 249; i >= 0; i--) {
      const o = p, c = o * (1 + (Math.random() - 0.5) * 0.012);
      out.push({ time: now - i * step, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c });
      p = c;
    }
    return out;
  }

  function closeWs() { if (ws) { ws.onclose = null; ws.onmessage = null; ws.close(); ws = null; } }

  function openWs(my) {
    ws = new WebSocket(`wss://data-stream.binance.vision/ws/${sym.toLowerCase()}@kline_${tf}`);
    ws.onmessage = e => {
      const k = (JSON.parse(e.data) || {}).k;
      if (!k || my !== ver) return;
      const b = { time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c };
      ser.update(b);
      const L = bars[bars.length - 1];
      if (L && L.time === b.time) bars[bars.length - 1] = b; else bars.push(b);
      if (api.onTick) api.onTick(b.close);
    };
    ws.onclose = () => { if (my === ver) setTimeout(() => { if (my === ver) openWs(my); }, 3000); };
  }

  async function load(s, t) {
    sym = s; tf = t; const my = ++ver; closeWs();
    let k, live = true;
    try {
      const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${t}&limit=250`);
      if (!r.ok) throw new Error(r.status);
      k = (await r.json()).map(x => ({ time: x[0] / 1000, open: +x[1], high: +x[2], low: +x[3], close: +x[4] }));
    } catch (e) {
      live = false;
      k = synth(ov.wl && num(ov.wl.live_price), t);
    }
    if (my !== ver) return;
    if (api.onNote) api.onNote(live ? "" : "Binance candles unreachable from this network — showing synthetic candles.");
    bars = k; ser.setData(k); chart.timeScale().fitContent(); draw();
    if (live) openWs(my);
  }

  const snap = ms => Math.max(Math.floor(ms / 1000 / TF[tf]) * TF[tf], bars.length ? bars[0].time : 0);

  function line(p, title, color, style = 2, w = 1) {
    p = num(p); if (!p) return;
    lines.push(ser.createPriceLine({ price: p, color, lineWidth: w, lineStyle: style, axisLabelVisible: true, title }));
  }

  function draw() {
    if (!ser) return;
    lines.forEach(l => ser.removePriceLine(l)); lines = [];
    zones.set([]);
    const { wl, tr, tg } = ov;
    if (wl && tg.crt) {
      line(wl.crt_high, "CRT High", "#7aa2ff", 0);
      line(wl.crt_low, "CRT Low", "#7aa2ff", 0);
      line(wl.crt_eq, "50% EQ", "#9aa4b5", 1);
      line(wl.erl_level, "ERL", "#c792ea", 0);
    }
    if (wl && tg.walls) {
      (wl.whale_bid_walls || []).forEach(w => line(w.price, "Bid " + fu(w.usd), "#26a69a", 1));
      (wl.whale_ask_walls || []).forEach(w => line(w.price, "Ask " + fu(w.usd), "#ef5350", 1));
      [...(wl.liq_clusters_below || []), ...(wl.liq_clusters_above || [])].forEach(w => line(w.price, "Liq " + fu(w.usd), "#f5a524", 2));
    }
    if (tr) {
      const e = num(tr.filled_price) || num(tr.limit_price);
      line(e, "ENTRY", "#e6edf7", 0, 2);
      line(tr.sl, "SL", "#ef5350", 0, 2);
      line(tr.tp1, "TP1", "#26a69a", 2);
      line(tr.tp2, "TP2", "#26a69a", 2);
      line(tr.tp3, "TP3", "#26a69a", 0, 2);
      if (tg.zones && e && bars.length) {
        const t0 = snap(tr.filled_at || tr.created_at), t1 = tr.closed_at ? snap(tr.closed_at) : null;
        const tp = num(tr.tp3) || num(tr.tp2) || num(tr.tp1);
        const z = [];
        if (num(tr.sl)) z.push({ t0, t1, a: e, b: +tr.sl, c: "239,83,80", l: "SL zone" });
        if (tp) z.push({ t0, t1, a: e, b: tp, c: "38,166,154", l: "TP zone" });
        zones.set(z);
      }
    }
  }

  api.init = init;
  api.load = load;
  api.setOverlay = (wl, tr, tg) => { ov = { wl, tr, tg }; if (bars.length) draw(); };
  return api;
})();

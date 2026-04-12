import { useState, useEffect, useRef, useCallback } from "react";

const PAIRS = [
  { symbol: "BTCUSDT", name: "BTC/USDT", full: "Bitcoin" },
  { symbol: "ETHUSDT", name: "ETH/USDT", full: "Ethereum" },
  { symbol: "SOLUSDT", name: "SOL/USDT", full: "Solana" },
  { symbol: "BNBUSDT", name: "BNB/USDT", full: "BNB" },
  { symbol: "XRPUSDT", name: "XRP/USDT", full: "Ripple" },
  { symbol: "ADAUSDT", name: "ADA/USDT", full: "Cardano" },
  { symbol: "DOGEUSDT", name: "DOGE/USDT", full: "Dogecoin" },
  { symbol: "AVAXUSDT", name: "AVAX/USDT", full: "Avalanche" },
  { symbol: "DOTUSDT", name: "DOT/USDT", full: "Polkadot" },
  { symbol: "LINKUSDT", name: "LINK/USDT", full: "Chainlink" },
];

const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"];
const TF_MAP = { "1m": "1", "5m": "5", "15m": "15", "1H": "60", "4H": "240", "1D": "D" };
const BINANCE_TF = { "1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "4h", "1D": "1d" };
const MODES = ["SPOT", "FUTURES", "SCALP", "SWING"];
const API_BASE = "/api";

function fmt(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return parseFloat(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function CryptoAgent() {
  const [prices, setPrices] = useState({});
  const [changes, setChanges] = useState({});
  const [selected, setSelected] = useState(PAIRS[0]);
  const [tf, setTf] = useState("15m");
  const [mode, setMode] = useState("SPOT");
  const [signals, setSignals] = useState([]);
  const [pairSigs, setPairSigs] = useState({});
  const [loading, setLoading] = useState(false);
  const [clock, setClock] = useState(now());
  const [indicators, setIndicators] = useState(null);
  const [indLoading, setIndLoading] = useState(false);
  const [wsStatus, setWsStatus] = useState("CONNECTING");
  const [lastUpdate, setLastUpdate] = useState(null);
  const wsRef = useRef(null);
  const reconnectRef = useRef(0);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setClock(now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ─── Fetch initial prices via REST API (instant, no delay) ───
  useEffect(() => {
    async function fetchInitialPrices() {
      try {
        const [priceRes, tickerRes] = await Promise.all([
          fetch(`${API_BASE}/prices`),
          fetch(`${API_BASE}/ticker`),
        ]);
        const priceData = await priceRes.json();
        const tickerData = await tickerRes.json();

        const newPrices = {};
        const newChanges = {};
        for (const p of PAIRS) {
          if (priceData[p.symbol]) newPrices[p.symbol] = priceData[p.symbol];
        }
        for (const t of tickerData) {
          if (PAIRS.find(p => p.symbol === t.symbol)) {
            newChanges[t.symbol] = t.priceChangePercent;
            if (!newPrices[t.symbol]) newPrices[t.symbol] = t.lastPrice;
          }
        }
        setPrices(prev => ({ ...prev, ...newPrices }));
        setChanges(prev => ({ ...prev, ...newChanges }));
        setLastUpdate(now());
      } catch (err) {
        console.error("Initial price fetch failed:", err);
      }
    }
    fetchInitialPrices();
  }, []);

  // ─── Binance WebSocket for real-time updates ───
  useEffect(() => {
    function connect() {
      const streams = PAIRS.map(p => `${p.symbol.toLowerCase()}@ticker`).join("/");
      const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsStatus("LIVE");
        reconnectRef.current = 0;
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (!msg.data) return;
          const d = msg.data;
          const sym = d.s;
          const price = parseFloat(d.c);
          const chg = parseFloat(d.P);
          setPrices(prev => ({ ...prev, [sym]: price }));
          setChanges(prev => ({ ...prev, [sym]: chg }));
          setLastUpdate(now());
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        setWsStatus("RECONNECTING");
        const delay = Math.min(1000 * 2 ** reconnectRef.current, 30000);
        reconnectRef.current++;
        setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => { wsRef.current?.close(); };
  }, []);

  // ─── Fetch REAL indicators from backend ───
  useEffect(() => {
    let cancelled = false;
    async function fetchIndicators() {
      setIndLoading(true);
      try {
        const interval = BINANCE_TF[tf];
        const res = await fetch(`${API_BASE}/indicators/${selected.symbol}?interval=${interval}&limit=200`);
        const data = await res.json();
        if (!cancelled) setIndicators(data);
      } catch (err) {
        console.error("Indicator fetch error:", err);
        if (!cancelled) setIndicators(null);
      }
      if (!cancelled) setIndLoading(false);
    }
    fetchIndicators();
    const interval = setInterval(fetchIndicators, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selected.symbol, tf]);

  // TradingView chart URL
  const tvUrl = `https://s.tradingview.com/widgetembed/?frameElementId=tv-chart&symbol=BINANCE:${selected.symbol}&interval=${TF_MAP[tf]}&hidesidetoolbar=0&hidetoptoolbar=0&symboledit=0&saveimage=0&toolbarbg=080c14&studies=RSI%40tv-basicstudies%1FMACD%40tv-basicstudies%1FVolume%40tv-basicstudies&hideideas=1&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&locale=en`;

  // ─── Generate Signal via Backend ───
  const analyzeSignal = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selected.symbol,
          name: selected.name,
          full: selected.full,
          mode,
          timeframe: tf,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const newSig = {
        ...data,
        pair: selected.name,
        symbol: selected.symbol,
        mode,
        tf,
        time: now(),
        id: Date.now(),
        engine: data.engine || "ai",
      };
      setSignals(prev => [newSig, ...prev.slice(0, 19)]);
      setPairSigs(prev => ({ ...prev, [selected.symbol]: data.signal }));
    } catch (err) {
      console.error("Signal error:", err);
      setSignals(prev => [{
        error: true,
        errorMsg: err.message,
        pair: selected.name,
        time: now(),
        id: Date.now(),
      }, ...prev.slice(0, 19)]);
    }
    setLoading(false);
  }, [selected, mode, tf]);

  const sigColor = (s) => s === "BUY" ? "#00f5a0" : s === "SELL" ? "#ff3d6b" : "#ffd166";
  const sigBg = (s) => s === "BUY" ? "rgba(0,245,160,0.12)" : s === "SELL" ? "rgba(255,61,107,0.12)" : "rgba(255,209,102,0.1)";
  const sigBorder = (s) => s === "BUY" ? "rgba(0,245,160,0.3)" : s === "SELL" ? "rgba(255,61,107,0.3)" : "rgba(255,209,102,0.25)";

  const ind = indicators || {};
  const rsiVal = ind.rsi?.value;
  const macdVal = ind.macd;
  const volData = ind.volume;
  const trendData = ind.trend;
  const bbData = ind.bollinger;
  const atrData = ind.atr;
  const srData = ind.supportResistance;

  return (
    <div style={{ background: "#080c14", color: "#e8f0f8", fontFamily: "'Segoe UI', sans-serif", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", fontSize: 13 }}>

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", borderBottom: "1px solid #1e2d42", background: "rgba(8,12,20,0.98)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "monospace", fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: wsStatus === "LIVE" ? "#00f5a0" : "#ffd166", boxShadow: `0 0 10px ${wsStatus === "LIVE" ? "#00f5a0" : "#ffd166"}`, animation: "pulse 2s infinite" }} />
          CRYPTO<span style={{ color: "#00f5a0" }}>AGENT</span>
          <span style={{ fontSize: 9, color: "#4a6080", fontWeight: 400, marginLeft: 4 }}>v2.0</span>
        </div>
        <div style={{ display: "flex", gap: 18, fontFamily: "monospace", fontSize: 10, color: "#4a6080", alignItems: "center" }}>
          <span style={{ color: wsStatus === "LIVE" ? "#00f5a0" : "#ffd166", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: wsStatus === "LIVE" ? "#00f5a0" : "#ffd166", display: "inline-block" }} />
            {wsStatus}
          </span>
          {lastUpdate && <span>Updated: {lastUpdate}</span>}
          <span>{clock}</span>
          <span>BINANCE</span>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 340px", flex: 1, overflow: "hidden" }}>

        {/* LEFT — Pair List */}
        <div style={{ borderRight: "1px solid #1e2d42", display: "flex", flexDirection: "column", overflow: "hidden", background: "#0d1320" }}>
          <div style={{ padding: "10px 16px", fontSize: 10, color: "#4a6080", fontFamily: "monospace", letterSpacing: 2, borderBottom: "1px solid #1e2d42" }}>⬡ MARKETS</div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {PAIRS.map(p => {
              const price = prices[p.symbol];
              const chg = changes[p.symbol] || 0;
              const sig = pairSigs[p.symbol];
              const isActive = p.symbol === selected.symbol;
              return (
                <div key={p.symbol} onClick={() => setSelected(p)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", cursor: "pointer", borderBottom: "1px solid rgba(30,45,66,0.4)", background: isActive ? "rgba(0,245,160,0.06)" : "transparent", borderLeft: isActive ? "2px solid #00f5a0" : "2px solid transparent", transition: "all 0.15s" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "#4a6080", fontFamily: "monospace", marginTop: 2 }}>{p.full}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12 }}>{price ? "$" + fmt(price) : "—"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: chg >= 0 ? "#00f5a0" : "#ff3d6b" }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</div>
                  </div>
                  {sig && (
                    <div style={{ fontSize: 9, fontFamily: "monospace", padding: "2px 6px", borderRadius: 3, background: sigBg(sig), color: sigColor(sig), border: `1px solid ${sigBorder(sig)}`, marginLeft: 6, letterSpacing: 1 }}>{sig}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER — Chart + Indicators */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px solid #1e2d42", background: "#0d1320", flexWrap: "wrap", flexShrink: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 17, marginRight: 6 }}>{selected.name}</span>
            <span style={{ fontFamily: "monospace", fontSize: 15, color: "#00f5a0", marginRight: 10 }}>
              {prices[selected.symbol] ? "$" + fmt(prices[selected.symbol]) : "—"}
            </span>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: (changes[selected.symbol] || 0) >= 0 ? "#00f5a0" : "#ff3d6b", marginRight: 8 }}>
              {(changes[selected.symbol] || 0) >= 0 ? "+" : ""}{(changes[selected.symbol] || 0).toFixed(2)}%
            </span>
            {TIMEFRAMES.map(t => (
              <button key={t} onClick={() => setTf(t)} style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${tf === t ? "#00f5a0" : "#1e2d42"}`, background: tf === t ? "rgba(0,245,160,0.08)" : "transparent", color: tf === t ? "#00f5a0" : "#4a6080", fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>{t}</button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
              {MODES.map(m => (
                <button key={m} onClick={() => setMode(m)} style={{ padding: "4px 9px", borderRadius: 4, border: `1px solid ${mode === m ? "#00d4ff" : "#1e2d42"}`, background: mode === m ? "rgba(0,212,255,0.08)" : "transparent", color: mode === m ? "#00d4ff" : "#4a6080", fontFamily: "monospace", fontSize: 10, cursor: "pointer", letterSpacing: 1 }}>{m}</button>
              ))}
            </div>
          </div>

          {/* TradingView */}
          <div style={{ flex: 1, background: "#080c14", position: "relative" }}>
            <iframe key={`${selected.symbol}-${tf}`} src={tvUrl} style={{ width: "100%", height: "100%", border: "none" }} title="chart" />
          </div>

          {/* Real Indicator Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6, padding: "8px 12px", borderTop: "1px solid #1e2d42", background: "#080c14", flexShrink: 0 }}>
            {[
              {
                label: "RSI (14)",
                val: rsiVal != null ? rsiVal.toFixed(1) : "—",
                status: ind.rsi?.status || "—",
                color: rsiVal > 70 ? "#ff3d6b" : rsiVal < 30 ? "#00f5a0" : "#ffd166"
              },
              {
                label: "MACD",
                val: macdVal?.histogram != null ? (macdVal.histogram >= 0 ? "+" : "") + macdVal.histogram.toFixed(4) : "—",
                status: macdVal?.crossover?.replace("_", " ") || "—",
                color: macdVal?.crossover?.includes("BULLISH") ? "#00f5a0" : "#ff3d6b"
              },
              {
                label: "VOLUME",
                val: volData?.ratio != null ? volData.ratio.toFixed(2) + "x" : "—",
                status: volData?.status || "—",
                color: volData?.ratio > 1.3 ? "#00f5a0" : volData?.ratio < 0.5 ? "#ff3d6b" : "#4a6080"
              },
              {
                label: "TREND",
                val: trendData?.trend?.replace(/_/g, " ") || "—",
                status: trendData?.goldenCross ? "GOLDEN CROSS" : trendData?.deathCross ? "DEATH CROSS" : "—",
                color: trendData?.strength > 0 ? "#00f5a0" : trendData?.strength < 0 ? "#ff3d6b" : "#ffd166"
              },
              {
                label: "BB POSITION",
                val: bbData?.position != null ? bbData.position.toFixed(0) + "%" : "—",
                status: bbData?.width != null ? "W:" + bbData.width.toFixed(1) + "%" : "—",
                color: bbData?.position > 80 ? "#ff3d6b" : bbData?.position < 20 ? "#00f5a0" : "#ffd166"
              },
              {
                label: "ATR (14)",
                val: atrData?.value != null ? "$" + atrData.value.toFixed(2) : "—",
                status: atrData?.percent != null ? atrData.percent.toFixed(2) + "% VOL" : "—",
                color: atrData?.percent > 3 ? "#ff3d6b" : "#4a6080"
              },
            ].map(item => (
              <div key={item.label} style={{ background: "#0f1c2e", border: "1px solid #1e2d42", borderRadius: 5, padding: "6px 8px", position: "relative" }}>
                {indLoading && <div style={{ position: "absolute", top: 3, right: 5, width: 4, height: 4, borderRadius: "50%", background: "#ffd166", animation: "pulse 1s infinite" }} />}
                <div style={{ fontFamily: "monospace", fontSize: 8, color: "#4a6080", letterSpacing: 1 }}>{item.label}</div>
                <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, marginTop: 2, color: item.color }}>{item.val}</div>
                <div style={{ fontFamily: "monospace", fontSize: 8, marginTop: 1, color: item.color, opacity: 0.8 }}>{item.status}</div>
              </div>
            ))}
          </div>

          {/* S/R Levels + EMAs */}
          {srData && (srData.nearestSupport || srData.nearestResistance) && (
            <div style={{ display: "flex", gap: 12, padding: "5px 12px", borderTop: "1px solid #1e2d42", background: "#080c14", fontFamily: "monospace", fontSize: 10, flexShrink: 0 }}>
              {srData.nearestSupport && <span style={{ color: "#00f5a0" }}>▼ Support: ${fmt(srData.nearestSupport)}</span>}
              {srData.nearestResistance && <span style={{ color: "#ff3d6b" }}>▲ Resistance: ${fmt(srData.nearestResistance)}</span>}
              {ind.emas?.ema50 && <span style={{ color: "#4a6080" }}>EMA50: ${fmt(ind.emas.ema50)}</span>}
              {ind.emas?.ema200 && <span style={{ color: "#4a6080" }}>EMA200: ${fmt(ind.emas.ema200)}</span>}
            </div>
          )}
        </div>

        {/* RIGHT — Signals */}
        <div style={{ borderLeft: "1px solid #1e2d42", display: "flex", flexDirection: "column", overflow: "hidden", background: "#0d1320" }}>
          <div style={{ padding: "10px 16px", fontSize: 10, color: "#4a6080", fontFamily: "monospace", letterSpacing: 2, borderBottom: "1px solid #1e2d42", display: "flex", justifyContent: "space-between" }}>
            <span>⚡ AI SIGNALS</span>
            <span>{signals.filter(s => !s.error).length} signals</span>
          </div>

          <button onClick={analyzeSignal} disabled={loading}
            style={{ margin: "12px 14px 4px", padding: "12px", background: loading ? "#1e2d42" : "linear-gradient(135deg,#00f5a0,#00d4ff)", color: loading ? "#4a6080" : "#050a10", fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 2, border: "none", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer", transition: "all 0.2s" }}>
            {loading ? "⏳ ANALYZING REAL DATA..." : "⚡ GENERATE SIGNAL"}
          </button>

          <div style={{ overflowY: "auto", flex: 1, padding: "8px 14px 14px" }}>
            {signals.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 16px", color: "#4a6080", fontFamily: "monospace", fontSize: 11, lineHeight: 2 }}>
                <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>◎</div>
                Select a pair and click<br />GENERATE SIGNAL<br />for real TA-powered analysis
              </div>
            )}

            {signals.map(sig => sig.error ? (
              <div key={sig.id} style={{ background: "#0f1c2e", border: "1px solid #1e2d42", borderRadius: 8, padding: 14, marginBottom: 12, borderLeft: "3px solid #ffd166" }}>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: "#ffd166" }}>⚠ Signal Error</div>
                <div style={{ fontFamily: "monospace", fontSize: 10, color: "#4a6080", marginTop: 6, lineHeight: 1.7 }}>{sig.errorMsg || `Error for ${sig.pair} at ${sig.time}`}</div>
              </div>
            ) : (
              <div key={sig.id} style={{ background: "#0f1c2e", border: `1px solid #1e2d42`, borderRadius: 8, padding: 14, marginBottom: 12, borderLeft: `3px solid ${sigColor(sig.signal)}`, animation: "fadeIn 0.3s ease" }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{sig.pair}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 9, color: "#4a6080", marginTop: 2 }}>
                      {sig.time} · {sig.mode} · {sig.engine === "rule-based" ? "TA ENGINE" : "AI+TA"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 4, background: sigBg(sig.signal), color: sigColor(sig.signal), border: `1px solid ${sigBorder(sig.signal)}`, letterSpacing: 2 }}>{sig.signal}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 9, color: "#4a6080", marginTop: 3 }}>R:R <span style={{ color: "#00d4ff" }}>{sig.riskReward}</span></div>
                  </div>
                </div>

                {/* Levels */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                  {[
                    { label: "ENTRY", val: sig.entry, color: "#00d4ff" },
                    { label: "STOP LOSS", val: sig.stopLoss, color: "#ff3d6b" },
                    { label: "TAKE PROFIT", val: sig.takeProfit, color: "#00f5a0" },
                  ].map(lv => (
                    <div key={lv.label} style={{ background: "rgba(8,12,20,0.6)", border: "1px solid #1e2d42", borderRadius: 5, padding: "6px 8px" }}>
                      <div style={{ fontFamily: "monospace", fontSize: 8, color: "#4a6080", letterSpacing: 1 }}>{lv.label}</div>
                      <div style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: lv.color, marginTop: 3 }}>${fmt(lv.val)}</div>
                    </div>
                  ))}
                </div>

                {/* Confidence bar */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 9, color: "#4a6080", marginBottom: 4 }}>
                    <span>CONFIDENCE</span>
                    <span style={{ color: "#e8f0f8" }}>{sig.confidence}%</span>
                  </div>
                  <div style={{ height: 4, background: "#1e2d42", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: sig.confidence + "%", background: sig.confidence >= 75 ? "#00f5a0" : sig.confidence >= 50 ? "#ffd166" : "#ff3d6b", borderRadius: 2, transition: "width 1s ease" }} />
                  </div>
                </div>

                {/* Reason */}
                <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7a9abf", lineHeight: 1.7, borderTop: "1px solid #1e2d42", paddingTop: 10 }}>{sig.reason}</div>

                {/* Warning */}
                {sig.warning && (
                  <div style={{ fontFamily: "monospace", fontSize: 9, color: "#ffd166", marginTop: 8, opacity: 0.85 }}>⚠ {sig.warning}</div>
                )}

                <div style={{ fontFamily: "monospace", fontSize: 9, color: "#4a6080", marginTop: 8, padding: "2px 7px", border: "1px solid #1e2d42", borderRadius: 3, display: "inline-block", letterSpacing: 1 }}>{sig.mode} · {sig.tf}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:#1e2d42;border-radius:2px}
      `}</style>
    </div>
  );
}

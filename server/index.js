import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { calculateIndicators, fetchKlines, fetchAllPrices, fetchTickerStats } from "./indicators.js";
import { generateSignal } from "./tradingEngine.js";

// Load .env manually (no dotenv dependency)
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(resolve(__dirname, "../.env"), "utf8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ─── Health check ───
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// ─── Current prices for all pairs via Binance REST ───
app.get("/api/prices", async (req, res) => {
  try {
    const prices = await fetchAllPrices();
    res.json(prices);
  } catch (err) {
    console.error("Price fetch error:", err.message);
    res.status(502).json({ error: "Failed to fetch prices from Binance" });
  }
});

// ─── 24hr ticker stats for all pairs ───
app.get("/api/ticker", async (req, res) => {
  try {
    const stats = await fetchTickerStats();
    res.json(stats);
  } catch (err) {
    console.error("Ticker fetch error:", err.message);
    res.status(502).json({ error: "Failed to fetch ticker stats" });
  }
});

// ─── Real technical indicators ───
app.get("/api/indicators/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const interval = req.query.interval || "1m";
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);

    const klines = await fetchKlines(symbol.toUpperCase(), interval, limit);
    const indicators = calculateIndicators(klines);

    res.json({
      symbol: symbol.toUpperCase(),
      interval,
      candles: klines.length,
      lastPrice: klines[klines.length - 1]?.close,
      timestamp: Date.now(),
      ...indicators,
    });
  } catch (err) {
    console.error("Indicator error:", err.message);
    res.status(502).json({ error: "Failed to compute indicators: " + err.message });
  }
});

// ─── AI Signal Generation ───
app.post("/api/signal", async (req, res) => {
  try {
    const { symbol, name, full, mode, timeframe } = req.body;
    if (!symbol || !name) {
      return res.status(400).json({ error: "Missing symbol or name" });
    }

    const tfMap = { "1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "4h", "1D": "1d" };
    const interval = tfMap[timeframe] || "1m";

    // Fetch real market data
    const [klines, klines4h, klines1d] = await Promise.all([
      fetchKlines(symbol, interval, 200),
      fetchKlines(symbol, "4h", 100),
      fetchKlines(symbol, "1d", 50),
    ]);

    const indicators = calculateIndicators(klines);
    const htfIndicators = calculateIndicators(klines4h);
    const dailyIndicators = calculateIndicators(klines1d);

    const currentPrice = klines[klines.length - 1]?.close;
    const ticker = await fetchTickerStats(symbol);

    const signal = await generateSignal({
      symbol, name, full, mode, timeframe, interval,
      currentPrice,
      ticker: ticker[0] || {},
      indicators,
      htfIndicators,
      dailyIndicators,
      klines: klines.slice(-20),
    });

    res.json(signal);
  } catch (err) {
    console.error("Signal generation error:", err.message);
    res.status(500).json({ error: "Signal generation failed: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  🚀 CryptoAgent API Server running on http://localhost:${PORT}`);
  console.log(`  📊 Endpoints:`);
  console.log(`     GET  /api/health`);
  console.log(`     GET  /api/prices`);
  console.log(`     GET  /api/ticker`);
  console.log(`     GET  /api/indicators/:symbol?interval=1m`);
  console.log(`     POST /api/signal\n`);
});

// ═══════════════════════════════════════════════════════════════
// Real Technical Indicators Engine — Calculates from Binance klines
// ═══════════════════════════════════════════════════════════════

const BINANCE_BASE = "https://api.binance.com";

// ─── Binance Data Fetchers ───

export async function fetchAllPrices() {
  const res = await fetch(`${BINANCE_BASE}/api/v3/ticker/price`);
  if (!res.ok) throw new Error(`Binance prices: ${res.status}`);
  const data = await res.json();
  const map = {};
  for (const item of data) {
    map[item.symbol] = parseFloat(item.price);
  }
  return map;
}

export async function fetchTickerStats(symbol) {
  const url = symbol
    ? `${BINANCE_BASE}/api/v3/ticker/24hr?symbol=${symbol}`
    : `${BINANCE_BASE}/api/v3/ticker/24hr`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ticker: ${res.status}`);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : [data];
  return arr.map(t => ({
    symbol: t.symbol,
    priceChange: parseFloat(t.priceChange),
    priceChangePercent: parseFloat(t.priceChangePercent),
    highPrice: parseFloat(t.highPrice),
    lowPrice: parseFloat(t.lowPrice),
    volume: parseFloat(t.volume),
    quoteVolume: parseFloat(t.quoteVolume),
    openPrice: parseFloat(t.openPrice),
    lastPrice: parseFloat(t.lastPrice),
    count: t.count,
  }));
}

export async function fetchKlines(symbol, interval, limit = 200) {
  const res = await fetch(
    `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`Binance klines ${symbol} ${interval}: ${res.status}`);
  const data = await res.json();
  return data.map(k => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
    quoteVolume: parseFloat(k[7]),
    trades: k[8],
  }));
}

// ─── Core Math Helpers ───

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

function emaArray(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let e = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result.push(e);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    result.push(e);
  }
  return result;
}

function stdDev(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

// ─── Technical Indicator Calculations ───

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return { value: null, values: [] };
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const rsiValues = [];

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - 100 / (1 + rs));
  }

  return {
    value: rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null,
    values: rsiValues,
    status: rsiValues.length > 0
      ? rsiValues[rsiValues.length - 1] > 70 ? "OVERBOUGHT"
        : rsiValues[rsiValues.length - 1] < 30 ? "OVERSOLD"
        : "NEUTRAL"
      : "UNKNOWN",
  };
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { macd: null, signal: null, histogram: null, crossover: "NONE" };
  const fastEma = emaArray(closes, fast);
  const slowEma = emaArray(closes, slow);

  const offset = slow - fast;
  const macdLine = [];
  for (let i = 0; i < slowEma.length; i++) {
    macdLine.push(fastEma[i + offset] - slowEma[i]);
  }

  const signalLine = emaArray(macdLine, signal);
  const sigOffset = macdLine.length - signalLine.length;
  const histogram = [];
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + sigOffset] - signalLine[i]);
  }

  const lastMACD = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const lastHist = histogram[histogram.length - 1];
  const prevHist = histogram.length > 1 ? histogram[histogram.length - 2] : 0;

  let crossover = "NONE";
  if (lastHist > 0 && prevHist <= 0) crossover = "BULLISH_CROSS";
  else if (lastHist < 0 && prevHist >= 0) crossover = "BEARISH_CROSS";
  else if (lastHist > 0) crossover = "BULLISH";
  else crossover = "BEARISH";

  return {
    macd: lastMACD,
    signal: lastSignal,
    histogram: lastHist,
    crossover,
    increasing: lastHist > prevHist,
  };
}

function calcEMAs(closes) {
  return {
    ema9: ema(closes, 9),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
  };
}

function calcBollingerBands(closes, period = 20, mult = 2) {
  if (closes.length < period) return { upper: null, middle: null, lower: null, width: null, position: null };
  const middle = sma(closes, period);
  const sd = stdDev(closes, period);
  const upper = middle + mult * sd;
  const lower = middle - mult * sd;
  const currentPrice = closes[closes.length - 1];
  const width = ((upper - lower) / middle) * 100;
  const position = ((currentPrice - lower) / (upper - lower)) * 100;

  return { upper, middle, lower, width, position: Math.min(100, Math.max(0, position)) };
}

function calcATR(klines, period = 14) {
  if (klines.length < period + 1) return { value: null, percent: null };
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const high = klines[i].high;
    const low = klines[i].low;
    const prevClose = klines[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  const lastPrice = klines[klines.length - 1].close;
  return { value: atr, percent: (atr / lastPrice) * 100 };
}

function calcVolume(klines, period = 20) {
  const volumes = klines.map(k => k.volume);
  const avgVol = sma(volumes, period);
  const currentVol = volumes[volumes.length - 1];
  const ratio = avgVol ? currentVol / avgVol : 1;
  return {
    current: currentVol,
    average: avgVol,
    ratio,
    status: ratio > 1.5 ? "HIGH" : ratio > 1.0 ? "ABOVE_AVG" : ratio > 0.5 ? "NORMAL" : "LOW",
  };
}

function calcSupportResistance(klines, lookback = 50) {
  const recent = klines.slice(-lookback);
  const highs = recent.map(k => k.high).sort((a, b) => b - a);
  const lows = recent.map(k => k.low).sort((a, b) => a - b);
  const currentPrice = klines[klines.length - 1].close;

  // Cluster nearby levels
  function cluster(levels, threshold = 0.005) {
    const clusters = [];
    const used = new Set();
    for (let i = 0; i < levels.length; i++) {
      if (used.has(i)) continue;
      let sum = levels[i];
      let count = 1;
      for (let j = i + 1; j < levels.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(levels[j] - levels[i]) / levels[i] < threshold) {
          sum += levels[j];
          count++;
          used.add(j);
        }
      }
      clusters.push({ level: sum / count, strength: count });
      used.add(i);
    }
    return clusters.sort((a, b) => b.strength - a.strength).slice(0, 5);
  }

  const resistanceLevels = cluster(highs).filter(l => l.level > currentPrice);
  const supportLevels = cluster(lows).filter(l => l.level < currentPrice);

  return {
    resistance: resistanceLevels.map(l => l.level),
    support: supportLevels.map(l => l.level),
    nearestResistance: resistanceLevels[0]?.level || null,
    nearestSupport: supportLevels[0]?.level || null,
  };
}

function calcTrend(closes, emas) {
  const price = closes[closes.length - 1];
  const { ema9, ema20, ema50, ema200 } = emas;

  let trend = "NEUTRAL";
  let strength = 0;

  if (ema50 && ema200) {
    if (ema50 > ema200 && price > ema50) { trend = "STRONG_UPTREND"; strength = 4; }
    else if (ema50 > ema200 && price > ema200) { trend = "UPTREND"; strength = 3; }
    else if (ema50 < ema200 && price < ema50) { trend = "STRONG_DOWNTREND"; strength = -4; }
    else if (ema50 < ema200 && price < ema200) { trend = "DOWNTREND"; strength = -3; }
    else { trend = "CONSOLIDATION"; strength = 0; }
  } else if (ema20) {
    if (price > ema20) { trend = "SHORT_UPTREND"; strength = 2; }
    else { trend = "SHORT_DOWNTREND"; strength = -2; }
  }

  let goldenCross = false;
  let deathCross = false;
  if (ema50 && ema200) {
    goldenCross = ema50 > ema200;
    deathCross = ema50 < ema200;
  }

  return { trend, strength, goldenCross, deathCross };
}

// ─── Master Calculation ───

export function calculateIndicators(klines) {
  const closes = klines.map(k => k.close);
  const emas = calcEMAs(closes);
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes, 12, 26, 9);
  const bollinger = calcBollingerBands(closes, 20, 2);
  const atr = calcATR(klines, 14);
  const volume = calcVolume(klines, 20);
  const sr = calcSupportResistance(klines, 50);
  const trend = calcTrend(closes, emas);

  return {
    rsi,
    macd,
    emas,
    bollinger,
    atr,
    volume,
    supportResistance: sr,
    trend,
  };
}

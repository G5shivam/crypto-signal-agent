// ═══════════════════════════════════════════════════════════════
// Trading Signal Engine — Real TA + LLM-powered analysis
// ═══════════════════════════════════════════════════════════════

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function buildSystemPrompt() {
  return `You are a professional crypto trading analyst with 15+ years of experience. You manage a $50M institutional crypto fund. You MUST follow these strict trading rules:

## CORE TRADING RULES

### 1. TREND FOLLOWING (Weight: 30%)
- ONLY enter BUY positions when EMA50 > EMA200 (Golden Cross active) or price is in a confirmed uptrend
- ONLY enter SELL/SHORT positions when EMA50 < EMA200 (Death Cross active) or price is in a confirmed downtrend
- In CONSOLIDATION, prefer HOLD unless other signals are exceptionally strong
- Never trade against the primary trend unless there's extreme divergence

### 2. RSI RULES (Weight: 20%)
- RSI > 70: OVERBOUGHT — Look for SELL/exit long, but wait for price confirmation
- RSI < 30: OVERSOLD — Look for BUY opportunity, but wait for trend support
- RSI 40-60: NEUTRAL — Use other indicators for direction
- RSI divergence (price makes new high but RSI doesn't) = strong reversal signal

### 3. MACD RULES (Weight: 20%)
- BULLISH CROSS (MACD crosses above signal line): BUY signal
- BEARISH CROSS (MACD crosses below signal line): SELL signal
- Histogram increasing: strengthens current signal
- Histogram decreasing: weakening momentum, prepare for reversal

### 4. BOLLINGER BANDS (Weight: 10%)
- Price touching lower band + RSI oversold = strong BUY zone
- Price touching upper band + RSI overbought = strong SELL zone
- Band squeeze (width < 3%) = expect volatility breakout, wait for direction
- Price position below 20% = buy zone, above 80% = sell zone

### 5. VOLUME CONFIRMATION (Weight: 10%)
- Signals are STRONGER when volume is above average (ratio > 1.2)
- Breakouts without volume confirmation are likely false
- High volume + trend alignment = high confidence

### 6. SUPPORT/RESISTANCE (Weight: 10%)
- BUY near strong support levels with bullish confirmation
- SELL near strong resistance levels with bearish confirmation
- Breakout above resistance with volume = strong BUY
- Breakdown below support with volume = strong SELL

## RISK MANAGEMENT (MANDATORY)
- Stop Loss MUST be placed at logical technical levels (below support for BUY, above resistance for SELL)
- Stop Loss distance should be 1-2x ATR from entry
- Take Profit should give minimum Risk:Reward of 1:2
- For SCALP mode: tighter stops (0.5-1x ATR), quicker targets (1:1.5 minimum)
- For SWING mode: wider stops (1.5-3x ATR), larger targets (1:3 minimum)
- For FUTURES mode: account for leverage — tighter stops, precise entries
- For SPOT mode: standard R:R with bias towards holding

## CONFIDENCE SCORING
Calculate confidence based on how many signals align:
- 5+ signals aligned = 80-95%
- 3-4 signals aligned = 60-79%
- 1-2 signals aligned = 40-59%
- Conflicting signals = 20-39% (usually HOLD)

## MULTI-TIMEFRAME RULE
- Higher timeframe trend MUST align with entry timeframe for high confidence
- If daily trend is bearish but 1m shows buy signal, reduce confidence by 20%
- Perfect alignment (daily + 4h + entry TF) = add 10% confidence

## OUTPUT FORMAT
Respond ONLY with valid JSON. No markdown, no explanation outside JSON:
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": <number 0-100>,
  "entry": <exact price number>,
  "stopLoss": <exact price number>,
  "takeProfit": <exact price number>,
  "riskReward": "1:X.X",
  "reason": "3-4 sentences citing specific indicator values and which rules triggered this signal. Be precise — mention exact RSI value, MACD crossover status, EMA alignment, BB position, volume ratio. Explain the confluence.",
  "warning": "One sentence about the primary risk."
}`;
}

function buildAnalysisPrompt(data) {
  const { symbol, name, full, mode, timeframe, currentPrice, ticker, indicators, htfIndicators, dailyIndicators, klines } = data;

  const ind = indicators;
  const htf = htfIndicators;
  const daily = dailyIndicators;

  // Recent candles summary
  const recentCandles = klines.slice(-5).map(k =>
    `  O:${k.open.toFixed(2)} H:${k.high.toFixed(2)} L:${k.low.toFixed(2)} C:${k.close.toFixed(2)} Vol:${k.volume.toFixed(1)}`
  ).join("\n");

  return `Analyze this REAL market data for ${name} (${full}) and generate a trading signal.

═══ MARKET OVERVIEW ═══
Asset: ${symbol}
Current Price: $${currentPrice}
24H Change: ${ticker.priceChangePercent?.toFixed(2) || "N/A"}%
24H High: $${ticker.highPrice || "N/A"}
24H Low: $${ticker.lowPrice || "N/A"}  
24H Volume: ${ticker.volume?.toLocaleString() || "N/A"} ${symbol.replace("USDT", "")}
24H Quote Volume: $${ticker.quoteVolume?.toLocaleString() || "N/A"}
Trading Mode: ${mode}
Timeframe: ${timeframe}

═══ ENTRY TIMEFRAME (${timeframe}) INDICATORS ═══
RSI (14): ${ind.rsi?.value?.toFixed(2) || "N/A"} — Status: ${ind.rsi?.status || "N/A"}
MACD Line: ${ind.macd?.macd?.toFixed(4) || "N/A"}
MACD Signal: ${ind.macd?.signal?.toFixed(4) || "N/A"}
MACD Histogram: ${ind.macd?.histogram?.toFixed(4) || "N/A"}
MACD Crossover: ${ind.macd?.crossover || "N/A"} (Momentum ${ind.macd?.increasing ? "INCREASING" : "DECREASING"})
EMA 9: $${ind.emas?.ema9?.toFixed(2) || "N/A"}
EMA 20: $${ind.emas?.ema20?.toFixed(2) || "N/A"}
EMA 50: $${ind.emas?.ema50?.toFixed(2) || "N/A"}
EMA 200: $${ind.emas?.ema200?.toFixed(2) || "N/A"}
Bollinger Upper: $${ind.bollinger?.upper?.toFixed(2) || "N/A"}
Bollinger Middle: $${ind.bollinger?.middle?.toFixed(2) || "N/A"}
Bollinger Lower: $${ind.bollinger?.lower?.toFixed(2) || "N/A"}
Bollinger Width: ${ind.bollinger?.width?.toFixed(2) || "N/A"}%
Bollinger Position: ${ind.bollinger?.position?.toFixed(1) || "N/A"}%
ATR (14): $${ind.atr?.value?.toFixed(2) || "N/A"} (${ind.atr?.percent?.toFixed(2) || "N/A"}% of price)
Volume Ratio: ${ind.volume?.ratio?.toFixed(2) || "N/A"}x average — Status: ${ind.volume?.status || "N/A"}
Trend: ${ind.trend?.trend || "N/A"} (Strength: ${ind.trend?.strength || 0})
Golden Cross: ${ind.trend?.goldenCross ? "YES" : "NO"} | Death Cross: ${ind.trend?.deathCross ? "YES" : "NO"}
Nearest Support: $${ind.supportResistance?.nearestSupport?.toFixed(2) || "N/A"}
Nearest Resistance: $${ind.supportResistance?.nearestResistance?.toFixed(2) || "N/A"}

═══ HIGHER TIMEFRAME (4H) INDICATORS ═══
RSI: ${htf.rsi?.value?.toFixed(2) || "N/A"} — ${htf.rsi?.status || "N/A"}
MACD Crossover: ${htf.macd?.crossover || "N/A"}
Trend: ${htf.trend?.trend || "N/A"}
Golden Cross: ${htf.trend?.goldenCross ? "YES" : "NO"}

═══ DAILY INDICATORS ═══
RSI: ${daily.rsi?.value?.toFixed(2) || "N/A"} — ${daily.rsi?.status || "N/A"}
MACD Crossover: ${daily.macd?.crossover || "N/A"}
Trend: ${daily.trend?.trend || "N/A"}
Golden Cross: ${daily.trend?.goldenCross ? "YES" : "NO"}

═══ LAST 5 CANDLES (${timeframe}) ═══
${recentCandles}

Now analyze all data above and generate the trading signal. Follow ALL trading rules strictly.`;
}

export async function generateSignal(data) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || apiKey === "your-api-key-here") {
    // Fallback: rule-based signal using real indicators
    return generateRuleBasedSignal(data);
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildAnalysisPrompt(data);

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const result = await res.json();
  if (result.error) throw new Error(result.error.message);

  const text = result.content?.[0]?.text || "";
  if (!text) throw new Error("Empty AI response");

  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    throw new Error("Failed to parse AI response");
  }
}

// ─── Rule-Based Signal Engine (uses real indicators, no LLM) ───

function generateRuleBasedSignal(data) {
  const { currentPrice, indicators: ind, htfIndicators: htf, dailyIndicators: daily, mode, ticker } = data;

  let score = 0; // positive = bullish, negative = bearish
  const reasons = [];

  // 1. RSI Analysis (weight: 20)
  const rsi = ind.rsi?.value;
  if (rsi !== null && rsi !== undefined) {
    if (rsi < 30) { score += 20; reasons.push(`RSI at ${rsi.toFixed(1)} is oversold — strong buy zone`); }
    else if (rsi < 40) { score += 10; reasons.push(`RSI at ${rsi.toFixed(1)} approaching oversold territory`); }
    else if (rsi > 70) { score -= 20; reasons.push(`RSI at ${rsi.toFixed(1)} is overbought — sell pressure expected`); }
    else if (rsi > 60) { score -= 5; reasons.push(`RSI at ${rsi.toFixed(1)} approaching overbought zone`); }
    else { reasons.push(`RSI at ${rsi.toFixed(1)} is neutral`); }
  }

  // 2. MACD Analysis (weight: 20)
  const macd = ind.macd;
  if (macd?.crossover) {
    if (macd.crossover === "BULLISH_CROSS") { score += 20; reasons.push("MACD bullish crossover — fresh buy signal"); }
    else if (macd.crossover === "BEARISH_CROSS") { score -= 20; reasons.push("MACD bearish crossover — fresh sell signal"); }
    else if (macd.crossover === "BULLISH" && macd.increasing) { score += 10; reasons.push("MACD bullish with increasing momentum"); }
    else if (macd.crossover === "BULLISH") { score += 5; reasons.push("MACD bullish but momentum fading"); }
    else if (macd.crossover === "BEARISH" && !macd.increasing) { score -= 10; reasons.push("MACD bearish with increasing selling pressure"); }
    else if (macd.crossover === "BEARISH") { score -= 5; reasons.push("MACD bearish but selling pressure easing"); }
  }

  // 3. Trend/EMA Analysis (weight: 30)
  const trend = ind.trend;
  if (trend) {
    if (trend.strength >= 3) { score += 30; reasons.push(`${trend.trend} — EMA alignment strongly bullish${trend.goldenCross ? " (Golden Cross active)" : ""}`); }
    else if (trend.strength >= 1) { score += 15; reasons.push(`${trend.trend} — moderate bullish bias`); }
    else if (trend.strength <= -3) { score -= 30; reasons.push(`${trend.trend} — EMA alignment strongly bearish${trend.deathCross ? " (Death Cross active)" : ""}`); }
    else if (trend.strength <= -1) { score -= 15; reasons.push(`${trend.trend} — moderate bearish bias`); }
    else { reasons.push("Trend is neutral/consolidating"); }
  }

  // 4. Bollinger Bands (weight: 10)
  const bb = ind.bollinger;
  if (bb?.position !== null && bb?.position !== undefined) {
    if (bb.position < 15) { score += 10; reasons.push(`Price at ${bb.position.toFixed(0)}% of Bollinger — near lower band support`); }
    else if (bb.position > 85) { score -= 10; reasons.push(`Price at ${bb.position.toFixed(0)}% of Bollinger — near upper band resistance`); }
    if (bb.width < 3) { reasons.push(`Bollinger squeeze detected (width ${bb.width.toFixed(1)}%) — expect volatility breakout`); }
  }

  // 5. Volume (weight: 10)
  const vol = ind.volume;
  if (vol?.ratio) {
    if (vol.ratio > 1.5 && score > 0) { score += 10; reasons.push(`High volume (${vol.ratio.toFixed(1)}x avg) confirms bullish move`); }
    else if (vol.ratio > 1.5 && score < 0) { score -= 10; reasons.push(`High volume (${vol.ratio.toFixed(1)}x avg) confirms bearish move`); }
    else if (vol.ratio < 0.5) { score = Math.round(score * 0.7); reasons.push(`Low volume (${vol.ratio.toFixed(1)}x avg) — weak conviction`); }
  }

  // 6. HTF Confluence
  if (htf?.trend?.strength >= 2 && score > 0) { score += 10; reasons.push("4H timeframe confirms bullish bias"); }
  else if (htf?.trend?.strength <= -2 && score < 0) { score -= 10; reasons.push("4H timeframe confirms bearish bias"); }
  else if (htf?.trend?.strength >= 2 && score < 0) { score += 5; reasons.push("WARNING: 4H trend is bullish — trading against higher TF"); }
  else if (htf?.trend?.strength <= -2 && score > 0) { score -= 5; reasons.push("WARNING: 4H trend is bearish — trading against higher TF"); }

  // Daily trend check
  if (daily?.trend?.strength >= 2 && score > 0) { score += 5; }
  else if (daily?.trend?.strength <= -2 && score < 0) { score -= 5; }

  // Determine signal
  let signal, confidence;
  const absScore = Math.abs(score);
  if (score >= 25) { signal = "BUY"; confidence = Math.min(95, 55 + absScore); }
  else if (score <= -25) { signal = "SELL"; confidence = Math.min(95, 55 + absScore); }
  else if (score >= 10) { signal = "BUY"; confidence = Math.min(65, 40 + absScore); }
  else if (score <= -10) { signal = "SELL"; confidence = Math.min(65, 40 + absScore); }
  else { signal = "HOLD"; confidence = Math.max(30, 50 - absScore); }

  // Calculate levels
  const atr = ind.atr?.value || currentPrice * 0.01;
  const sr = ind.supportResistance;

  let stopLoss, takeProfit, atrMult;
  if (mode === "SCALP") { atrMult = 0.8; }
  else if (mode === "SWING") { atrMult = 2.0; }
  else if (mode === "FUTURES") { atrMult = 1.0; }
  else { atrMult = 1.5; }

  if (signal === "BUY") {
    stopLoss = sr?.nearestSupport ? Math.min(currentPrice - atr * atrMult, sr.nearestSupport * 0.998) : currentPrice - atr * atrMult;
    takeProfit = sr?.nearestResistance ? Math.max(currentPrice + atr * atrMult * 2.5, sr.nearestResistance) : currentPrice + atr * atrMult * 2.5;
  } else if (signal === "SELL") {
    stopLoss = sr?.nearestResistance ? Math.max(currentPrice + atr * atrMult, sr.nearestResistance * 1.002) : currentPrice + atr * atrMult;
    takeProfit = sr?.nearestSupport ? Math.min(currentPrice - atr * atrMult * 2.5, sr.nearestSupport) : currentPrice - atr * atrMult * 2.5;
  } else {
    stopLoss = currentPrice - atr * 1.5;
    takeProfit = currentPrice + atr * 1.5;
  }

  const rr = (Math.abs(takeProfit - currentPrice) / Math.abs(stopLoss - currentPrice)).toFixed(1);

  // Pick top 3-4 reasons for the summary
  const topReasons = reasons.slice(0, 4).join(". ") + ".";

  let warning;
  if (ind.atr?.percent > 3) warning = "High volatility (ATR " + ind.atr.percent.toFixed(1) + "%) — use reduced position size.";
  else if (vol?.ratio < 0.5) warning = "Low volume environment — breakouts may be false.";
  else if (bb?.width < 3) warning = "Bollinger squeeze — expect sharp move in either direction.";
  else warning = "Crypto markets are volatile — always use stop-loss and manage position size.";

  return {
    signal,
    confidence: Math.round(confidence),
    entry: parseFloat(currentPrice.toFixed(2)),
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    takeProfit: parseFloat(takeProfit.toFixed(2)),
    riskReward: `1:${rr}`,
    reason: topReasons,
    warning,
    engine: "rule-based",
  };
}

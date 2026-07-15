import type { Candle } from "./types";

export interface RiskStats {
  high52: number | null;
  low52: number | null;
  fromHigh: number | null; // % below 52w high
  annVol: number | null; // annualized volatility %
  maxDrawdown: number | null; // worst peak-to-trough %, negative
  ret1m: number | null;
  ret6m: number | null;
  ret1y: number | null;
}

function pctReturn(closes: number[], days: number): number | null {
  if (closes.length <= days) return null;
  const a = closes[closes.length - 1 - days];
  const b = closes[closes.length - 1];
  if (!a || a <= 0) return null;
  return (b / a - 1) * 100;
}

export function computeRiskStats(candles: Candle[]): RiskStats {
  if (candles.length < 30) {
    return { high52: null, low52: null, fromHigh: null, annVol: null, maxDrawdown: null, ret1m: null, ret6m: null, ret1y: null };
  }
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1];
  const window = candles.slice(-252);

  const high52 = Math.max(...window.map((c) => c.h));
  const low52 = Math.min(...window.map((c) => c.l));
  const fromHigh = high52 > 0 ? (last / high52 - 1) * 100 : null;

  // daily log returns over last year for volatility
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i - 1].c > 0) rets.push(Math.log(window[i].c / window[i - 1].c));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1);
  const annVol = Math.sqrt(variance) * Math.sqrt(252) * 100;

  // max drawdown over full history
  let peak = closes[0];
  let maxDD = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = c / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }

  const round = (v: number | null, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
  return {
    high52: round(high52, 2),
    low52: round(low52, 2),
    fromHigh: round(fromHigh),
    annVol: round(annVol),
    maxDrawdown: round(maxDD * 100),
    ret1m: round(pctReturn(closes, 21)),
    ret6m: round(pctReturn(closes, 126)),
    ret1y: round(pctReturn(closes, 252)),
  };
}

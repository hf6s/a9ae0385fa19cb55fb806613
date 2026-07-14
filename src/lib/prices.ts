/**
 * Free, keyless daily OHLC history from Yahoo Finance's chart API — used for
 * the trend filter (50/200-day MAs), momentum returns, and the price charts.
 */

import type { Candle } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

function yahooSymbol(ticker: string): string {
  // BRK.B -> BRK-B
  return ticker.replace(/\./g, "-");
}

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

async function fetchChart(symbol: string, keep: number, range = "2y"): Promise<Candle[] | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const host = HOSTS[attempt % HOSTS.length]; // alternate hosts across retries
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 429 || res.status === 999) {
        await new Promise((r) => setTimeout(r, 8_000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
          continue;
        }
        return null;
      }
      const json = (await res.json()) as {
        chart?: {
          result?: {
            timestamp?: number[];
            indicators?: {
              quote?: { open?: number[]; high?: number[]; low?: number[]; close?: number[] }[];
            };
          }[];
        };
      };
      const result = json.chart?.result?.[0];
      const ts = result?.timestamp;
      const q = result?.indicators?.quote?.[0];
      if (!ts || !q?.close) return null;

      const candles: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = q.close[i];
        if (c === null || c === undefined || !Number.isFinite(c)) continue;
        candles.push({
          t: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          o: q.open?.[i] ?? c,
          h: q.high?.[i] ?? c,
          l: q.low?.[i] ?? c,
          c,
        });
      }
      if (candles.length < 60) return null;
      return candles.slice(-keep);
    } catch {
      if (attempt >= 3) return null;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  return null;
}

export async function dailyHistory(
  ticker: string,
  keep = 420,
  range = "2y",
): Promise<Candle[] | null> {
  return fetchChart(yahooSymbol(ticker), keep, range);
}

/** S&P 500 daily candles (^GSPC) for relative-strength / benchmarking. */
export async function sp500History(keep = 420, range = "2y"): Promise<Candle[] | null> {
  return fetchChart("^GSPC", keep, range);
}

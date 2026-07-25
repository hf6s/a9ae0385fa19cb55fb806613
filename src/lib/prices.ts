/**
 * Daily OHLC history for the trend filter (50/200-day MAs), momentum returns,
 * charts and the backtest.
 *
 * EODHD is the primary source. Two reasons it beats the old free path:
 *   1. It answers from datacenter IPs, so scans work in CI, not only from a
 *      residential connection.
 *   2. It serves delisted tickers, which the backtest needs to stop pretending
 *      failed companies never existed.
 *
 * Yahoo stays as a keyless fallback so the repo still runs without a key.
 * Note: candle `c` is the RAW close, matching the previous Yahoo behaviour.
 * EODHD also returns `adjusted_close` (dividend adjusted); switching to it
 * would change every momentum number, so that is a deliberate migration, not
 * a side effect of changing provider.
 */

import type { Candle } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

function yahooSymbol(ticker: string): string {
  // BRK.B -> BRK-B
  return ticker.replace(/\./g, "-");
}

/** BRK.B -> BRK-B.US, ^GSPC -> GSPC.INDX */
function eodhdSymbol(ticker: string): string {
  if (ticker === "^GSPC") return "GSPC.INDX";
  return `${ticker.replace(/\./g, "-")}.US`;
}

/** "2y" | "10y" -> ISO start date. */
function rangeStart(range: string): string {
  const years = Number(range.replace(/[^0-9.]/g, "")) || 2;
  const d = new Date();
  d.setFullYear(d.getFullYear() - Math.ceil(years));
  return d.toISOString().slice(0, 10);
}

interface EodhdBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close?: number;
  volume?: number;
}

async function fetchEodhd(
  ticker: string,
  keep: number,
  range: string,
): Promise<Candle[] | null> {
  const key = process.env.EODHD_API_KEY;
  if (!key) return null;

  const url =
    `https://eodhd.com/api/eod/${encodeURIComponent(eodhdSymbol(ticker))}` +
    `?api_token=${key}&fmt=json&period=d&from=${rangeStart(range)}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 4_000 * (attempt + 1)));
        continue;
      }
      // 404 means no such symbol; retrying will not help.
      if (res.status === 404) return null;
      if (!res.ok) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
          continue;
        }
        return null;
      }
      const rows = (await res.json()) as EodhdBar[];
      if (!Array.isArray(rows) || rows.length === 0) return null;

      const candles: Candle[] = [];
      for (const r of rows) {
        if (!Number.isFinite(r.close)) continue;
        candles.push({
          t: r.date,
          o: Number.isFinite(r.open) ? r.open : r.close,
          h: Number.isFinite(r.high) ? r.high : r.close,
          l: Number.isFinite(r.low) ? r.low : r.close,
          // Raw close is the price actually traded that day, which is what
          // market cap and valuation ratios need. It is NOT split-adjusted.
          c: r.close,
          // Split- and dividend-adjusted. Returns and momentum must use this.
          a: Number.isFinite(r.adjusted_close) ? r.adjusted_close : r.close,
        });
      }
      // Same floor the Yahoo path uses: too little history means the 50/200-day
      // trend filters silently skip, letting thin-history names through Stage 1.
      if (candles.length < 60) return null;
      return candles.slice(-keep);
    } catch {
      if (attempt >= 2) return null;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  return null;
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
          // Yahoo's chart close is already split-adjusted but not dividend
          // adjusted. Close enough for the fallback; the paid feed is exact.
          a: c,
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
  const paid = await fetchEodhd(ticker, keep, range);
  if (paid) return paid;
  return fetchChart(yahooSymbol(ticker), keep, range);
}

/** S&P 500 daily candles for relative-strength / benchmarking. */
export async function sp500History(keep = 420, range = "2y"): Promise<Candle[] | null> {
  const paid = await fetchEodhd("^GSPC", keep, range);
  if (paid) return paid;
  return fetchChart("^GSPC", keep, range);
}

/** True when the paid feed is configured; used to report data source in output. */
export function usingPaidPrices(): boolean {
  return Boolean(process.env.EODHD_API_KEY);
}

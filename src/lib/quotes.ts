/**
 * Current prices for whatever someone actually holds.
 *
 * WHY THIS EXISTS SEPARATELY FROM prices.ts. That file fetches daily history,
 * one request per ticker, because charts and the scan need a series. A
 * portfolio page needs one number per holding and needs it often, and paying a
 * full history download per holding per refresh would be absurd. The paid feed
 * answers up to a couple of dozen symbols in a single request, so twenty
 * holdings cost one round trip instead of twenty.
 *
 * WHAT "CURRENT" MEANS, HONESTLY. The feed returns the time its price printed,
 * and that is what gets passed on rather than the time of the request. A
 * delayed quote labelled "live", or a Friday close labelled "now", is how
 * someone ends up acting on a number that is not the number. The caller decides
 * what to say about the age; this file only reports it.
 *
 * A symbol the feed has no price for is left out. It is never zero, and never
 * silently the previous close.
 */

import { envValue } from "./env-value";
import { eodhdSymbol } from "./prices";

export interface Quote {
  ticker: string;
  price: number;
  /** Previous session's close, for the day's move. Null when not supplied. */
  prevClose: number | null;
  /** ISO time the feed says this price printed. */
  at: string;
}

/**
 * Symbols per request.
 *
 * The feed accepts more, but a request that names too many is one request that
 * can fail for all of them. Twenty keeps a typical portfolio to a single call
 * while capping the blast radius.
 */
export const BATCH = 20;

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) return items.length > 0 ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface RealTimeRow {
  code?: string;
  close?: number | string;
  previousClose?: number | string;
  timestamp?: number | string;
}

/** A field that may arrive as a number, a numeric string, or the text "NA". */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Turns a real-time response into quotes keyed by the ticker that was asked
 * for.
 *
 * The feed answers in its own symbol namespace (BRK.B goes out as BRK-B.US and
 * comes back the same way), so the mapping has to be reversed here or every
 * ticker with a dot in it would silently go unpriced. A single-symbol request
 * returns a bare object rather than an array, which is the sort of difference
 * that works in testing with two holdings and breaks with one.
 */
export function parseQuotes(payload: unknown, wanted: string[]): Record<string, Quote> {
  const bySymbol = new Map(wanted.map((t) => [eodhdSymbol(t).toUpperCase(), t]));
  const rows: RealTimeRow[] = Array.isArray(payload)
    ? (payload as RealTimeRow[])
    : payload && typeof payload === "object"
      ? [payload as RealTimeRow]
      : [];

  const out: Record<string, Quote> = {};
  for (const row of rows) {
    const code = typeof row.code === "string" ? row.code.toUpperCase() : "";
    const ticker = bySymbol.get(code);
    const price = num(row.close);
    // No price is no quote. Falling back to the previous close here would hand
    // back yesterday's number wearing today's timestamp.
    if (!ticker || price === null || price <= 0) continue;

    const ts = num(row.timestamp);
    out[ticker] = {
      ticker,
      price,
      prevClose: num(row.previousClose),
      // The feed's own print time, in seconds. Without one there is nothing
      // honest to say about age, so the epoch stands in and the caller can see
      // it is not a real time.
      at: new Date((ts ?? 0) * 1000).toISOString(),
    };
  }
  return out;
}

/**
 * Fetches quotes for every ticker, in as few requests as possible.
 *
 * A batch that fails is skipped rather than failing the lot: nineteen current
 * prices and one stale is a better page than no page.
 */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  const key = envValue("EODHD_API_KEY");
  if (!key || tickers.length === 0) return {};

  const batches = chunk([...new Set(tickers)], BATCH);
  const results = await Promise.all(
    batches.map(async (batch) => {
      const symbols = batch.map(eodhdSymbol);
      const url =
        `https://eodhd.com/api/real-time/${encodeURIComponent(symbols[0])}` +
        `?api_token=${key}&fmt=json` +
        (symbols.length > 1 ? `&s=${symbols.slice(1).map(encodeURIComponent).join(",")}` : "");
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return {};
        return parseQuotes(await res.json(), batch);
      } catch {
        return {};
      }
    }),
  );

  return Object.assign({}, ...results) as Record<string, Quote>;
}

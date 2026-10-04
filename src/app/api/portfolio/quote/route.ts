import { NextResponse } from "next/server";
import { MAX_HOLDINGS, normaliseTicker } from "@/lib/portfolio";
import { fetchQuotes, type Quote } from "@/lib/quotes";

/**
 * Current prices for a portfolio, refreshed while the page is open.
 *
 * The holdings page polls this about once a minute. That is cheap because the
 * paid feed answers twenty symbols per request and because the answer is held
 * here for CACHE_MS: several devices, several tabs and a page that re-renders
 * all share one call. A whole trading day of one portfolio polling every minute
 * is a few hundred calls against a budget of a hundred thousand.
 *
 * It never fails loudly. Without a key, or with the feed down, it answers with
 * no quotes and the page keeps the closing prices it already has, saying so.
 * A portfolio that shows yesterday's close and admits it is fine; one that
 * shows a blank screen because a quote server hiccuped is not.
 */

export const dynamic = "force-dynamic";

/**
 * How long one answer is reused.
 *
 * Shorter than the page's polling interval, so a refresh usually gets a new
 * price, but long enough that several viewers cost one call rather than one
 * each.
 */
const CACHE_MS = 45_000;

interface Entry {
  quotes: Record<string, Quote>;
  at: number;
}

// Per-instance. Public closing prices only - nothing here identifies anyone,
// and the key is the sorted ticker list, not a session.
const cache = new Map<string, Entry>();

/** Keeps the map from growing without bound on a long-lived instance. */
function sweep(now: number) {
  if (cache.size < 64) return;
  for (const [key, entry] of cache) {
    if (now - entry.at > CACHE_MS) cache.delete(key);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tickers = [
    ...new Set(
      (url.searchParams.get("t") ?? "")
        .split(",")
        .map(normaliseTicker)
        .filter((t) => t.length > 0 && t.length <= 12),
    ),
  ]
    .sort()
    .slice(0, MAX_HOLDINGS);

  if (tickers.length === 0) {
    return NextResponse.json({ quotes: {}, missing: [], at: new Date().toISOString() });
  }

  const key = tickers.join(",");
  const now = Date.now();
  sweep(now);

  const hit = cache.get(key);
  let quotes: Record<string, Quote>;
  let cached = false;

  if (hit && now - hit.at < CACHE_MS) {
    quotes = hit.quotes;
    cached = true;
  } else {
    quotes = await fetchQuotes(tickers);
    // Only a useful answer is worth keeping. Caching an empty result would turn
    // one failed request into forty-five seconds of pretending there are no
    // prices.
    if (Object.keys(quotes).length > 0) cache.set(key, { quotes, at: now });
  }

  return NextResponse.json({
    quotes,
    missing: tickers.filter((t) => !quotes[t]),
    at: new Date(hit && cached ? hit.at : now).toISOString(),
    cached,
  });
}

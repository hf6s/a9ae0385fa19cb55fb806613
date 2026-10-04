import { NextResponse } from "next/server";
import { getHistory, getPriceAsOf, getRankings } from "@/lib/data";
import { dailyHistory, sp500History, usingPaidPrices } from "@/lib/prices";
import { CHART_LAG_DAYS, daysBetween, MAX_HOLDINGS, normaliseTicker, type Bar } from "@/lib/portfolio";
import type { Candle } from "@/lib/types";

/**
 * Daily closes for a set of holdings, plus the index to compare them against.
 *
 * WHY NOT JUST READ THE SCAN. The scan carries a price for every ranked stock,
 * and for most holdings that is enough. But a portfolio contains whatever
 * someone actually bought, including names the model has never ranked, and a
 * value chart needs a series rather than one number. So this answers from the
 * scan's own history files first and only reaches for the paid feed for tickers
 * the project has never downloaded.
 *
 * SPEND. The feed is a paid subscription with a daily call budget, and this is
 * a public endpoint, so the budget is protected rather than trusted: a request
 * may name at most MAX_HOLDINGS tickers, and anything downloaded is memoised
 * for an hour so a page that re-renders costs nothing.
 *
 * That cap used to be six, which was wrong by an order of magnitude and broke
 * the thing this endpoint exists for: someone holding twenty ordinary stocks
 * got ten of them priced and ten reported as missing, because only the handful
 * the scan happens to cover and six more could be fetched. The budget is a
 * hundred thousand calls a day; a full portfolio is forty. Downloads run a few
 * at a time so a large portfolio does not arrive as one burst and earn a rate
 * limit.
 *
 * WHICH CLOSE. The paid feed's raw close is not split-adjusted - a 4:1 split
 * reads as a 75% loss on it - while the adjusted close is scaled to a different
 * base and so does not equal what the shares are worth today. Both are needed
 * and neither works alone, so the adjusted series is rescaled to meet the latest
 * raw close: the last point is exactly today's share price, and everything
 * behind it is continuous through splits and credits dividends received. That
 * makes the chart a total-return line, which is the only fair comparison
 * against an index measured the same way.
 */

export const dynamic = "force-dynamic";

/** Tickers named in one request. Matches the holdings ceiling. */
const MAX_TICKERS = MAX_HOLDINGS;
/**
 * Tickers one request may download from the paid feed.
 *
 * A whole portfolio, because a portfolio is the unit this serves. Anything less
 * leaves holdings unpriced and silently absent from the totals.
 */
const MAX_LIVE = MAX_HOLDINGS;
/** Downloads in flight at once, to stay under the feed's rate limit. */
const LIVE_CONCURRENCY = 6;
/**
 * How far behind the newest local file a stored series may be before it is
 * treated as abandoned and downloaded again. Matches the chart's own tolerance
 * for lag, so a file that would be dropped from the chart is refreshed instead.
 */
const STALE_LOCAL_DAYS = CHART_LAG_DAYS;
const LIVE_TTL_MS = 60 * 60 * 1000;
const BENCH_TTL_MS = 6 * 60 * 60 * 1000;

interface Cached {
  bars: Bar[];
  at: number;
}

// Per-instance, so it survives a page re-render and dies with the instance.
// Nothing here is user data: it is public closing prices.
const liveCache = new Map<string, Cached>();
let benchCache: Cached | null = null;

/**
 * Candles to a plain close series, continuous through splits.
 *
 * The scale factor is computed once from the last bar: adjusted closes move
 * with total return, and multiplying the whole series by (rawLast / adjLast)
 * lands the final point on the real share price without breaking that.
 */
function toBars(candles: Candle[]): Bar[] {
  if (candles.length === 0) return [];
  const last = candles[candles.length - 1];
  const adjLast = last.a ?? last.c;
  const scale = adjLast > 0 ? last.c / adjLast : 1;
  return candles
    .filter((c) => Number.isFinite(c.c) && c.c > 0)
    .map((c) => ({ t: c.t, c: (c.a ?? c.c) * scale }));
}

function cached(key: string, ttl: number): Bar[] | null {
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.bars;
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = (url.searchParams.get("t") ?? "")
    .split(",")
    .map(normaliseTicker)
    .filter((t) => t.length > 0 && t.length <= 12);

  // Duplicates in, one lookup out.
  const tickers = [...new Set(requested)].slice(0, MAX_TICKERS);
  if (tickers.length === 0) {
    return NextResponse.json({ series: {}, bench: [], missing: [], source: "none" });
  }

  const series: Record<string, Bar[]> = {};
  const missing: string[] = [];
  const needLive: string[] = [];

  // Read every local file first, then decide which are still current.
  const local = new Map<string, Bar[]>();
  for (const t of tickers) {
    const candles = getHistory(t);
    if (candles && candles.length > 0) local.set(t, toBars(candles));
  }

  /*
    ABANDONED FILES MUST NOT WIN OVER LIVE DATA.

    The history folder accumulates downloads from every universe the scan has
    ever covered, and it only refreshes the tickers in the current one. So a
    name the scan dropped keeps a file that stopped updating months ago - and
    preferring local data meant serving that instead of fetching the real thing.
    One such file, on a holding the owner still owns, cut six weeks off the
    chart for every other holding.

    The scan writes all of its files on the same day, so the close the current
    universe carries dates the live set. Anything much older than that was
    abandoned, and is refetched. In the ordinary case every file shares that
    date, nothing is stale, and nothing is downloaded.

    The reference has to come from the scan's own universe rather than from the
    newest file in the request. A portfolio of twenty ordinary large caps - none
    of which this small-cap scan ranks - can consist entirely of abandoned
    files, and measuring them against each other would find them all perfectly
    current and serve every one of them stale.
  */
  const ranked = getRankings()?.stocks ?? [];
  const freshestLocal =
    getPriceAsOf(ranked.map((r) => r.ticker)) ??
    [...local.values()].reduce((max, bars) => {
      const t = bars[bars.length - 1].t;
      return t > max ? t : max;
    }, "");

  for (const t of tickers) {
    const bars = local.get(t);
    if (bars) {
      const end = bars[bars.length - 1].t;
      if (daysBetween(end, freshestLocal) <= STALE_LOCAL_DAYS) {
        series[t] = bars;
        continue;
      }
      // Stale: fall through to a live download, but keep it as the fallback so
      // a failed fetch leaves an old chart rather than no chart.
    }
    const memo = cached(t, LIVE_TTL_MS);
    if (memo) {
      series[t] = memo;
      continue;
    }
    needLive.push(t);
  }

  // Everything past the live cap is reported as missing rather than silently
  // valued at zero, so the page can say which holdings it could not price.
  for (const t of needLive.slice(MAX_LIVE)) missing.push(t);

  // A shared queue rather than one promise per ticker: forty simultaneous
  // downloads is how a paid feed answers with 429s instead of prices.
  const queue = needLive.slice(0, MAX_LIVE);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(LIVE_CONCURRENCY, queue.length) }, async () => {
      for (let i = next++; i < queue.length; i = next++) {
        const t = queue[i];
        try {
          const candles = await dailyHistory(t, 520, "2y");
          if (candles && candles.length > 0) {
            const bars = toBars(candles);
            liveCache.set(t, { bars, at: Date.now() });
            series[t] = bars;
          } else if (local.has(t)) {
            series[t] = local.get(t)!;
          } else {
            missing.push(t);
          }
        } catch {
          if (local.has(t)) series[t] = local.get(t)!;
          else missing.push(t);
        }
      }
    }),
  );

  let bench: Bar[] = [];
  if (benchCache && Date.now() - benchCache.at < BENCH_TTL_MS) {
    bench = benchCache.bars;
  } else {
    try {
      const candles = await sp500History(520, "2y");
      if (candles && candles.length > 0) {
        bench = toBars(candles);
        benchCache = { bars: bench, at: Date.now() };
      }
    } catch {
      // No benchmark is a missing line on the chart, not a failed request: the
      // portfolio's own value is the part that matters and it is already here.
    }
  }

  return NextResponse.json({
    series,
    bench,
    missing,
    source: usingPaidPrices() ? "eodhd" : "fallback",
  });
}

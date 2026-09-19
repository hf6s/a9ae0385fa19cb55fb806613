/**
 * Trailing dividends per share, for the spec's dividend-cut sell rule.
 *
 * WHAT THIS CAN AND CANNOT DECIDE. The spec's rule is "sell if the company
 * cuts its dividend due to distress". Only the first half of that is in the
 * data. Whether a cut was distress or a deliberate shift to buybacks is a
 * judgement no dividend feed contains, and a board moving capital return from
 * dividends to repurchases has not stopped returning capital.
 *
 * So this reports the cut, and the exits page pairs it with the health filters
 * the stock is already being scored against. A cut in a company that still
 * passes Stage 1 reads differently from a cut in one that has started failing
 * it, and showing both is more honest than guessing at intent.
 *
 * Companies that pay nothing are not "cutting" anything; they return 0 and the
 * caller must treat a 0-to-0 comparison as no signal at all.
 */

import { envValue } from "./env-value";

/** One dividend payment as EODHD reports it. */
interface DividendRow {
  date?: string;
  value?: number;
}

/**
 * Sum of dividends per share paid in the 12 months before `asOf`.
 *
 * Returns null when the feed is unavailable or errored, which is deliberately
 * different from 0. Zero means "pays no dividend", null means "we do not
 * know", and a sell rule must never fire on the second.
 */
export async function trailingDividend(
  ticker: string,
  asOf: Date = new Date(),
): Promise<number | null> {
  const key = envValue("EODHD_API_KEY");
  if (!key) return null;

  const from = new Date(asOf);
  from.setFullYear(from.getFullYear() - 2);
  const url =
    `https://eodhd.com/api/div/${encodeURIComponent(ticker)}.US` +
    `?api_token=${key}&fmt=json&from=${from.toISOString().slice(0, 10)}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3_000 * (attempt + 1)));
        continue;
      }
      // 404 is a real answer for a symbol with no dividend record, but it is
      // indistinguishable from a bad symbol, so it stays null rather than 0.
      if (!res.ok) return null;
      const rows = (await res.json()) as DividendRow[];
      if (!Array.isArray(rows)) return null;
      return sumTrailing(rows, asOf);
    } catch {
      await new Promise((r) => setTimeout(r, 1_500));
    }
  }
  return null;
}

/** Sum the last twelve months of payments. Exported for testing. */
export function sumTrailing(rows: DividendRow[], asOf: Date): number {
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const asOfISO = asOf.toISOString().slice(0, 10);
  let total = 0;
  for (const r of rows) {
    if (!r.date || typeof r.value !== "number" || !Number.isFinite(r.value)) continue;
    if (r.date > cutoffISO && r.date <= asOfISO) total += r.value;
  }
  return Math.round(total * 10000) / 10000;
}

export type DividendChange = "cut" | "suspended" | "raised" | "steady" | "none" | "unknown";

/**
 * Classify the move between two trailing-dividend readings.
 *
 * The 10% band exists because trailing-twelve-month sums wobble on timing
 * alone: a payment landing either side of a period boundary moves the total
 * without the company having changed anything. Firing a sell rule on that
 * would produce alerts that are pure calendar artefact.
 */
export function classifyDividend(
  previous: number | null | undefined,
  current: number | null | undefined,
  band = 0.1,
): DividendChange {
  if (previous === null || previous === undefined) return "unknown";
  if (current === null || current === undefined) return "unknown";
  if (previous === 0 && current === 0) return "none";
  if (previous === 0) return "raised"; // initiated
  if (current === 0) return "suspended";
  const change = current / previous - 1;
  if (change < -band) return "cut";
  if (change > band) return "raised";
  return "steady";
}

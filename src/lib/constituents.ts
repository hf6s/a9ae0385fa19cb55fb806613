/**
 * Point-in-time S&P 500 membership.
 *
 * The backtest previously used TODAY's member list for all of history, which
 * bakes in two separate biases:
 *   1. Survivorship: companies that failed or were acquired (SIVB, FRC, TWTR)
 *      are missing entirely, so the strategy could never have bought them and
 *      never suffers their collapse.
 *   2. Lookahead: companies added to the index recently are treated as
 *      investable years before they joined.
 *
 * Source: github.com/fja05680/sp500 (MIT), a CSV of index membership snapshots
 * from 1996 to present. Cached on disk after first download.
 */

import fs from "node:fs";
import path from "node:path";

const CSV_URL =
  "https://raw.githubusercontent.com/fja05680/sp500/master/S%26P%20500%20Historical%20Components%20%26%20Changes%20(Updated).csv";
const CACHE = path.join(process.cwd(), "data", "sp500-membership.json");

export interface Membership {
  /** Snapshot dates, ascending. */
  dates: string[];
  /** Members at each snapshot, parallel to `dates`. */
  sets: string[][];
}

function parseCsv(text: string): Membership {
  const lines = text.trim().split("\n").slice(1); // drop header
  const dates: string[] = [];
  const sets: string[][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const date = line.slice(0, comma).trim();
    const tickers = line
      .slice(comma + 1)
      .replace(/"/g, "")
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || tickers.length === 0) continue;
    dates.push(date);
    sets.push(tickers);
  }
  // The file is chronological, but sort defensively so asOf can binary-search.
  const order = dates.map((d, i) => i).sort((a, b) => dates[a].localeCompare(dates[b]));
  return { dates: order.map((i) => dates[i]), sets: order.map((i) => sets[i]) };
}

export async function loadMembership(): Promise<Membership> {
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE, "utf8")) as Membership;
    if (cached.dates?.length > 0) return cached;
  } catch {
    /* fall through to download */
  }
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`constituents fetch failed: ${res.status}`);
  const parsed = parseCsv(await res.text());
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(parsed));
  } catch {
    /* cache is best effort */
  }
  return parsed;
}

/** Members as of `date`, using the latest snapshot at or before it. */
export function membersAsOf(m: Membership, date: string): Set<string> {
  let lo = 0;
  let hi = m.dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (m.dates[mid] <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Before the first snapshot, fall back to the earliest one available.
  return new Set(m.sets[found >= 0 ? found : 0]);
}

/** Every ticker that held membership at any point at or after `fromDate`. */
export function everMembers(m: Membership, fromDate: string): string[] {
  const all = new Set<string>();
  for (let i = 0; i < m.dates.length; i++) {
    if (m.dates[i] < fromDate) continue;
    for (const t of m.sets[i]) all.add(t);
  }
  // Include the snapshot in force at fromDate, not only those after it.
  for (const t of membersAsOf(m, fromDate)) all.add(t);
  return [...all].sort();
}

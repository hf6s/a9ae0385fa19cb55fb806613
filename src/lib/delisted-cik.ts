/**
 * Resolves DELISTED tickers to SEC CIK numbers.
 *
 * Why this exists: SEC's company_tickers.json lists only companies that still
 * file. Ask it for SIVB, FRC, TWTR or ATVI and you get nothing, so a backtest
 * cannot score any company that later failed or was acquired. That is the
 * mechanism behind survivorship bias in the results.
 *
 * The filings themselves never disappear. Only the ticker index drops them. So
 * this bridges the gap in two hops:
 *   1. ticker  -> company name   (EODHD's delisted symbol list)
 *   2. name    -> CIK            (SEC's cik-lookup-data.txt, ~1M rows incl. dead registrants)
 *
 * Matching is EXACT on a normalized name, never fuzzy. A wrong match would
 * silently attach one company's fundamentals to another company's prices, which
 * is far worse than leaving a name unscored. Unresolved tickers are reported so
 * coverage can be stated honestly rather than assumed.
 */

import fs from "node:fs";
import path from "node:path";

// Contact address for SEC fair-access; override with SEC_CONTACT in .env.local.
const UA = `Factor20/0.1 (contact: ${process.env.SEC_CONTACT ?? "set-SEC_CONTACT-to-a-real-email"})`;
const CACHE = path.join(process.cwd(), "data", "delisted-cik-cache.json");

/** Upper-case, strip punctuation and common suffixes so both sides compare alike. */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(INC|CORP|CORPORATION|COMPANY|CO|LTD|LLC|LP|PLC|HOLDINGS?|GROUP|THE|CLASS [A-C]|COM|NEW)\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface CacheShape {
  resolved: Record<string, string>; // ticker -> CIK (10 digits)
  unresolved: string[];
}

function loadCache(): CacheShape {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8")) as CacheShape;
  } catch {
    return { resolved: {}, unresolved: [] };
  }
}

function saveCache(c: CacheShape): void {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(c));
  } catch {
    /* cache is best effort */
  }
}

let tickerToName: Map<string, string> | null = null;
let nameToCik: Map<string, string> | null = null;

/** EODHD's delisted US symbol list: Code -> Name. */
async function loadDelistedNames(): Promise<Map<string, string>> {
  if (tickerToName) return tickerToName;
  tickerToName = new Map();
  const key = process.env.EODHD_API_KEY;
  if (!key) return tickerToName;
  try {
    const res = await fetch(
      `https://eodhd.com/api/exchange-symbol-list/US?delisted=1&fmt=json&api_token=${key}`,
    );
    if (!res.ok) return tickerToName;
    const rows = (await res.json()) as { Code?: string; Name?: string }[];
    for (const r of rows) {
      if (r.Code && r.Name && !tickerToName.has(r.Code.toUpperCase())) {
        tickerToName.set(r.Code.toUpperCase(), r.Name);
      }
    }
  } catch {
    /* leave empty; callers degrade to unresolved */
  }
  return tickerToName;
}

/** SEC's full registrant index: normalized name -> CIK. ~40MB, fetched once. */
async function loadNameToCik(): Promise<Map<string, string>> {
  if (nameToCik) return nameToCik;
  nameToCik = new Map();
  try {
    const res = await fetch("https://www.sec.gov/Archives/edgar/cik-lookup-data.txt", {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return nameToCik;
    const text = await res.text();
    for (const line of text.split("\n")) {
      // Format: COMPANY NAME:0000123456:
      const idx = line.lastIndexOf(":", line.length - 2);
      if (idx <= 0) continue;
      const name = line.slice(0, idx);
      const cik = line.slice(idx + 1).replace(/:/g, "").trim();
      if (!/^\d+$/.test(cik)) continue;
      const norm = normalizeName(name);
      // Keep the FIRST occurrence: the file is alphabetical, and later
      // duplicates are usually unrelated entities sharing a shortened name.
      if (norm && !nameToCik.has(norm)) nameToCik.set(norm, cik.padStart(10, "0"));
    }
  } catch {
    /* leave empty */
  }
  return nameToCik;
}

export interface DelistedResolution {
  resolve: (ticker: string) => string | null;
  stats: () => { resolved: number; unresolved: number };
  persist: () => void;
}

/**
 * Builds the resolver once, reusing the on-disk cache. Both source files are
 * large, so this is deliberately a one-time cost per process.
 */
export async function buildDelistedResolver(): Promise<DelistedResolution> {
  const cache = loadCache();
  const names = await loadDelistedNames();
  const ciks = await loadNameToCik();
  const unresolved = new Set(cache.unresolved);

  return {
    resolve(ticker: string): string | null {
      const t = ticker.toUpperCase();
      if (cache.resolved[t]) return cache.resolved[t];
      if (unresolved.has(t)) return null;

      const name = names.get(t) ?? names.get(t.replace(/-/g, "."));
      if (!name) {
        unresolved.add(t);
        return null;
      }
      const cik = ciks.get(normalizeName(name));
      if (!cik) {
        unresolved.add(t);
        return null;
      }
      cache.resolved[t] = cik;
      return cik;
    },
    stats() {
      return { resolved: Object.keys(cache.resolved).length, unresolved: unresolved.size };
    },
    persist() {
      cache.unresolved = [...unresolved];
      saveCache(cache);
    },
  };
}

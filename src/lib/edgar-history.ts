/**
 * Point-in-time historical annual fundamentals from SEC EDGAR "company facts".
 *
 * src/lib/edgar.ts returns only the LATEST values (for the live scan). This
 * module keeps the FULL annual history and tags each fiscal year with the date
 * it first became public (earliest SEC filing date), so a backtest can ask
 * "what did the market know as of date D?" and never peek at numbers that were
 * not yet filed. That is what makes the free EDGAR backtest honest about
 * lookahead bias.
 *
 * Results are cached to data/edgar-history-cache.json so re-running a backtest
 * does not re-download ~500 multi-MB filings every time.
 */

import fs from "node:fs";
import path from "node:path";
import { envValue } from "./env-value";

// Contact address for SEC fair-access; override with SEC_CONTACT in .env.local.
// SEC fair-access requires a REAL contact address, and the value must be read
// at call time: loadEnv() runs after imports, so a module-level read misses
// .env.local entirely. envValue also strips the byte-order mark that piped
// secrets carry, which otherwise makes fetch throw on the header.
const ua = () =>
  `Factor20/0.1 (contact: ${envValue("SEC_CONTACT") ?? "set-SEC_CONTACT-to-a-real-email"})`;

interface FactEntry {
  end: string;
  val: number;
  fp?: string;
  form?: string;
  filed?: string;
}

interface CompanyFacts {
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, FactEntry[]> }>;
    dei?: Record<string, { units?: Record<string, FactEntry[]> }>;
  };
}

/** One fiscal year of raw statement items, as originally filed. */
export interface AnnualRecord {
  end: string; // fiscal year-end (ISO date)
  filed: string; // earliest date this fiscal year's 10-K data became public
  assets: number | null;
  currentAssets: number | null;
  currentLiab: number | null;
  totalLiab: number | null;
  equity: number | null;
  retained: number | null;
  ebit: number | null; // operating income
  revenue: number | null;
  cogs: number | null;
  netIncome: number | null;
  cfo: number | null; // cash from operations
  capex: number | null;
  debt: number | null; // long-term + short-term
  dAndA: number | null;
  cash: number | null;
  shares: number | null;
}

export interface TickerHistory {
  ticker: string;
  records: AnnualRecord[]; // newest fiscal year first
}

let cikMap: Map<string, string> | null = null;

/**
 * Reports the first distinct failure once per process.
 *
 * Silently swallowing every failure here meant a BOM in SEC_CONTACT — which
 * makes fetch THROW on the header rather than return a status — looked
 * identical to SEC being down. A whole CI scan reported "no SEC filings" for
 * all 40 tickers with nothing to explain why.
 */
const secReported = new Set<string>();
function reportSec(what: string): void {
  if (secReported.has(what)) return;
  secReported.add(what);
  console.log(`  [sec] ${what}`);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": ua() } });
      if (res.status === 429 || res.status === 403) {
        reportSec(`HTTP ${res.status} — check SEC_CONTACT is a real address`);
        await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        reportSec(`HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      reportSec(`request threw: ${(err as Error).message.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  return null;
}

/**
 * Ticker -> CIK for current filers.
 *
 * Two failure modes have burned us here, so both are guarded:
 *
 *   1. Memoizing an EMPTY map on failure. Every lookup then returned "no such
 *      company", a whole backtest silently ran on a fraction of its universe,
 *      and the empties were written to the disk cache.
 *   2. NOT memoizing the failure. Each of 40 tickers re-ran a five-minute
 *      backoff, and a CI scan burned three hours before timing out.
 *
 * So: one attempt per process, a disk copy as fallback, and a hard stop if
 * neither works. The index is ~1MB and changes slowly, so a cached copy is a
 * fine substitute for a transient outage.
 */
function cikMapPath(): string {
  return path.join(process.cwd(), "data", "cik-map.json");
}

let cikMapFailed = false;

async function loadCikMap(): Promise<Map<string, string>> {
  if (cikMap) return cikMap;
  if (cikMapFailed) {
    throw new Error("SEC ticker index unavailable (already failed once this run).");
  }

  const toMap = (json: Record<string, { cik_str: number; ticker: string }>) => {
    const m = new Map<string, string>();
    for (const e of Object.values(json)) {
      if (e && e.ticker) m.set(e.ticker.toUpperCase(), String(e.cik_str).padStart(10, "0"));
    }
    return m;
  };

  // Two quick attempts, not a five-minute vigil: the disk copy covers outages.
  let json: Record<string, { cik_str: number; ticker: string }> | null = null;
  for (let attempt = 0; attempt < 2 && !json; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 5_000));
    json = await fetchJson<Record<string, { cik_str: number; ticker: string }>>(
      "https://www.sec.gov/files/company_tickers.json",
    );
  }

  if (json) {
    const map = toMap(json);
    if (map.size >= 1000) {
      cikMap = map;
      try {
        fs.mkdirSync(path.dirname(cikMapPath()), { recursive: true });
        fs.writeFileSync(cikMapPath(), JSON.stringify(json));
      } catch {
        /* cache is best effort */
      }
      return cikMap;
    }
  }

  try {
    const cached = JSON.parse(fs.readFileSync(cikMapPath(), "utf8"));
    const map = toMap(cached);
    if (map.size >= 1000) {
      console.log("  SEC unreachable; using the cached ticker index (" + map.size + " entries).");
      cikMap = map;
      return cikMap;
    }
  } catch {
    /* no usable cache */
  }

  cikMapFailed = true;
  throw new Error(
    "SEC company_tickers.json unavailable and no cached copy in data/cik-map.json. " +
      "Refusing to continue, since an empty ticker index silently produces a " +
      "universe with no fundamentals.",
  );
}

/** All annual (10-K, full-year) entries across candidate tags, grouped by fiscal-year end. */
function collectAnnual(
  facts: CompanyFacts,
  tags: string[],
  taxonomy: "us-gaap" | "dei" = "us-gaap",
  unit?: string,
): Map<string, FactEntry[]> {
  const tax = facts.facts?.[taxonomy];
  const byEnd = new Map<string, FactEntry[]>();
  if (!tax) return byEnd;
  for (const tag of tags) {
    const units = tax[tag]?.units;
    if (!units) continue;
    const entries =
      (unit ? units[unit] : units["USD"] ?? units["shares"] ?? Object.values(units)[0]) ?? [];
    for (const e of entries) {
      if (
        e.form?.startsWith("10-K") &&
        (e.fp === "FY" || e.fp === undefined) &&
        Number.isFinite(e.val)
      ) {
        const arr = byEnd.get(e.end) ?? [];
        arr.push(e);
        byEnd.set(e.end, arr);
      }
    }
  }
  return byEnd;
}

interface Point {
  val: number;
  filed: string;
}

/**
 * Per fiscal-year end, keep the value from the EARLIEST filing it appeared in.
 * A fiscal year's numbers show up first in that year's own 10-K, then again as
 * prior-year comparatives in later 10-Ks. The earliest filing is when the
 * market first learned the figure — that is the point-in-time date we want.
 */
function pickEarliest(byEnd: Map<string, FactEntry[]>): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const [end, arr] of byEnd) {
    let best = arr[0];
    for (const e of arr) if ((e.filed ?? "9999") < (best.filed ?? "9999")) best = e;
    out.set(end, { val: best.val, filed: best.filed ?? end });
  }
  return out;
}

/**
 * Debt tags are subsets of one another (convertible notes ⊂ long-term debt),
 * so per end take the LARGEST magnitude (broadest measure); keep the earliest
 * filing date among the debt entries at that end.
 */
function pickLargest(byEnd: Map<string, FactEntry[]>): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const [end, arr] of byEnd) {
    let best = arr[0];
    let earliest = arr[0].filed ?? "9999";
    for (const e of arr) {
      if (Math.abs(e.val) > Math.abs(best.val)) best = e;
      if ((e.filed ?? "9999") < earliest) earliest = e.filed ?? "9999";
    }
    out.set(end, { val: best.val, filed: earliest });
  }
  return out;
}

const REVENUE_TAGS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
];

/** Build the full annual history for one company from its companyfacts blob. */
function deriveHistory(facts: CompanyFacts): AnnualRecord[] {
  const assets = pickEarliest(collectAnnual(facts, ["Assets"]));
  const currentAssets = pickEarliest(collectAnnual(facts, ["AssetsCurrent"]));
  const currentLiab = pickEarliest(collectAnnual(facts, ["LiabilitiesCurrent"]));
  const totalLiab = pickEarliest(collectAnnual(facts, ["Liabilities"]));
  const equity = pickEarliest(
    collectAnnual(facts, [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ]),
  );
  const retained = pickEarliest(collectAnnual(facts, ["RetainedEarningsAccumulatedDeficit"]));
  const ebit = pickEarliest(collectAnnual(facts, ["OperatingIncomeLoss"]));
  const revenue = pickEarliest(collectAnnual(facts, REVENUE_TAGS));
  const cogs = pickEarliest(
    collectAnnual(facts, ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"]),
  );
  const netIncome = pickEarliest(collectAnnual(facts, ["NetIncomeLoss"]));
  const cfo = pickEarliest(
    collectAnnual(facts, [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ]),
  );
  const capex = pickEarliest(
    collectAnnual(facts, [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
    ]),
  );
  const longTermDebt = pickLargest(
    collectAnnual(facts, [
      "LongTermDebtNoncurrent",
      "LongTermDebt",
      "LongTermDebtAndCapitalLeaseObligations",
      "ConvertibleLongTermNotesPayable",
    ]),
  );
  const shortTermDebt = pickLargest(
    collectAnnual(facts, ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"]),
  );
  const dAndA = pickEarliest(
    collectAnnual(facts, [
      "DepreciationDepletionAndAmortization",
      "DepreciationAmortizationAndAccretionNet",
      "DepreciationAndAmortization",
    ]),
  );
  const cash = pickEarliest(
    collectAnnual(facts, [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ]),
  );
  const shares = pickEarliest(
    collectAnnual(facts, ["EntityCommonStockSharesOutstanding"], "dei", "shares"),
  );
  const sharesWa = pickEarliest(
    collectAnnual(facts, [
      "WeightedAverageNumberOfSharesOutstandingBasic",
      "WeightedAverageNumberOfDilutedSharesOutstanding",
    ]),
  );

  // Anchor the fiscal-year list on years that have a balance sheet or revenue.
  const ends = new Set<string>([...assets.keys(), ...revenue.keys()]);
  const records: AnnualRecord[] = [];
  for (const end of ends) {
    const debtLt = longTermDebt.get(end);
    const debtSt = shortTermDebt.get(end);
    const debt =
      debtLt || debtSt ? (debtLt?.val ?? 0) + (debtSt?.val ?? 0) : null;
    const sh = shares.get(end) ?? sharesWa.get(end);

    // filed = latest of the field filings for this year, i.e. the point at
    // which the whole fiscal year became public.
    let filed = "";
    for (const p of [
      assets.get(end),
      revenue.get(end),
      netIncome.get(end),
      equity.get(end),
      cfo.get(end),
    ]) {
      if (p && p.filed > filed) filed = p.filed;
    }
    if (!filed) filed = end;

    records.push({
      end,
      filed,
      assets: assets.get(end)?.val ?? null,
      currentAssets: currentAssets.get(end)?.val ?? null,
      currentLiab: currentLiab.get(end)?.val ?? null,
      totalLiab: totalLiab.get(end)?.val ?? null,
      equity: equity.get(end)?.val ?? null,
      retained: retained.get(end)?.val ?? null,
      ebit: ebit.get(end)?.val ?? null,
      revenue: revenue.get(end)?.val ?? null,
      cogs: cogs.get(end)?.val ?? null,
      netIncome: netIncome.get(end)?.val ?? null,
      cfo: cfo.get(end)?.val ?? null,
      capex: capex.get(end)?.val ?? null,
      debt,
      dAndA: dAndA.get(end)?.val ?? null,
      cash: cash.get(end)?.val ?? null,
      shares: sh?.val ?? null,
    });
  }

  records.sort((a, b) => (a.end < b.end ? 1 : -1)); // newest first
  return records;
}

/** Fetch full annual history for one ticker. Returns [] if EDGAR has nothing. */
/** CIK for a currently-filing ticker, or null. Delisted names need the resolver. */
export async function cikForTicker(ticker: string): Promise<string | null> {
  const map = await loadCikMap();
  return (
    map.get(ticker.toUpperCase().replace(/\./g, "-")) ?? map.get(ticker.toUpperCase()) ?? null
  );
}

/**
 * @param cikOverride CIK to use when SEC's ticker index does not list the
 * company. That index covers current filers only, so delisted names (SIVB,
 * FRC, TWTR) need one supplied by the caller — see src/lib/delisted-cik.ts.
 */
export async function edgarHistory(
  ticker: string,
  cikOverride?: string | null,
): Promise<AnnualRecord[]> {
  const map = await loadCikMap();
  const cik =
    map.get(ticker.toUpperCase().replace(/\./g, "-")) ??
    map.get(ticker.toUpperCase()) ??
    cikOverride ??
    null;
  if (!cik) return [];
  const facts = await fetchJson<CompanyFacts>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
  );
  await new Promise((r) => setTimeout(r, 150)); // SEC fair-access pacing
  if (!facts) return [];
  return deriveHistory(facts);
}

/**
 * Most recent fiscal year known as of `dateISO` (filed on or before it), plus
 * the prior year, for year-over-year growth. Records must be newest-first.
 */
export function asOf(
  records: AnnualRecord[],
  dateISO: string,
): { fy0: AnnualRecord; fy1: AnnualRecord | null } | null {
  for (let i = 0; i < records.length; i++) {
    if (records[i].filed <= dateISO) {
      return { fy0: records[i], fy1: records[i + 1] ?? null };
    }
  }
  return null;
}

// ---------- disk cache ----------

interface CacheFile {
  version: number;
  fetchedAt: string;
  histories: Record<string, AnnualRecord[]>;
}

const CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function cachePath(): string {
  return path.join(process.cwd(), "data", "edgar-history-cache.json");
}

export function loadHistoryCache(): Record<string, AnnualRecord[]> {
  try {
    const raw = fs.readFileSync(cachePath(), "utf8").replace(/^﻿/, "");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.version !== CACHE_VERSION) return {};
    if (Date.now() - Date.parse(parsed.fetchedAt) > CACHE_MAX_AGE_MS) return {};
    return parsed.histories ?? {};
  } catch {
    return {};
  }
}

export function saveHistoryCache(histories: Record<string, AnnualRecord[]>): void {
  const file: CacheFile = {
    version: CACHE_VERSION,
    fetchedAt: new Date().toISOString(),
    histories,
  };
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(file));
  } catch {
    /* best effort */
  }
}

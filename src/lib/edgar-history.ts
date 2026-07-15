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

const UA = "Factor20/0.1 (contact: factor20-bot@users.noreply.github.com)";

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

async function fetchJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429 || res.status === 403) {
        await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  return null;
}

async function loadCikMap(): Promise<Map<string, string>> {
  if (cikMap) return cikMap;
  const json = await fetchJson<Record<string, { cik_str: number; ticker: string }>>(
    "https://www.sec.gov/files/company_tickers.json",
  );
  cikMap = new Map();
  if (json) {
    for (const entry of Object.values(json)) {
      cikMap.set(entry.ticker.toUpperCase(), String(entry.cik_str).padStart(10, "0"));
    }
  }
  return cikMap;
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
export async function edgarHistory(ticker: string): Promise<AnnualRecord[]> {
  const map = await loadCikMap();
  const cik =
    map.get(ticker.toUpperCase().replace(/\./g, "-")) ?? map.get(ticker.toUpperCase());
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

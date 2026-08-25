/**
 * SEC EDGAR XBRL "company facts" — official, free, keyless statement-level
 * data. Used to compute the model inputs no free market-data tier exposes:
 * Altman Z-Score, Piotroski F-Score, accrual ratio, FCF growth,
 * Gross Profit / Assets, and Debt/EBITDA.
 *
 * SEC fair-access rules: identify yourself via User-Agent, stay under
 * 10 req/s. We fetch sequentially with a small delay.
 */

import { envValue } from "./env-value";

// SEC fair-access rules want a contact address in the User-Agent. Set
// SEC_CONTACT in .env.local to your own; the default keeps a personal address
// out of a public repo.
// SEC's fair-access policy requires a REAL contact address. A noreply
// placeholder is answered with 403 on every request, which silently starves
// the whole pipeline of fundamentals. Set SEC_CONTACT in .env.local.
// SEC fair-access requires a REAL contact address, and the value must be read
// at call time: loadEnv() runs after imports, so a module-level read misses
// .env.local entirely. envValue also strips the byte-order mark that piped
// secrets carry, which otherwise makes fetch throw on the header.
const ua = () =>
  `Factor20/0.1 (contact: ${envValue("SEC_CONTACT") ?? "set-SEC_CONTACT-to-a-real-email"})`;

interface FactEntry {
  end: string;
  val: number;
  fy?: number;
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

export interface EdgarDerived {
  altmanZ: number | null;
  piotroskiF: number | null; // 0-9, scaled if some criteria uncomputable
  accrualRatio: number | null; // (NI - CFO) / Assets — lower is better
  fcfGrowth: number | null; // % yoy
  grossProfitToAssets: number | null; // %
  debtToEbitda: number | null;
}

let cikMap: Map<string, string> | null = null;

async function fetchJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": ua() } });
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

/**
 * Latest annual (10-K, FY) values, newest-first, up to `count` fiscal years.
 *
 * Companies switch XBRL tags over time (e.g. "Revenues" ->
 * "RevenueFromContractWithCustomer..."), leaving stale data under old tags.
 * So instead of taking the first candidate tag with data, evaluate all
 * candidates and use the one with the most recent period end — and reject
 * the result entirely if even that is older than ~18 months.
 */
function annualSeries(
  facts: CompanyFacts,
  tags: string[],
  count = 3,
  taxonomy: "us-gaap" | "dei" = "us-gaap",
  unit?: string,
): number[] {
  const tax = facts.facts?.[taxonomy];
  if (!tax) return [];

  let best: FactEntry[] | null = null;
  for (const tag of tags) {
    const units = tax[tag]?.units;
    if (!units) continue;
    const entries =
      (unit ? units[unit] : units["USD"] ?? units["shares"] ?? Object.values(units)[0]) ?? [];
    const annual = entries.filter(
      (e) =>
        e.form?.startsWith("10-K") &&
        (e.fp === "FY" || e.fp === undefined) &&
        Number.isFinite(e.val),
    );
    if (annual.length === 0) continue;
    // Dedupe by period end, keep the most recently filed value for each
    const byEnd = new Map<string, FactEntry>();
    for (const e of annual) {
      const prev = byEnd.get(e.end);
      if (!prev || (e.filed ?? "") > (prev.filed ?? "")) byEnd.set(e.end, e);
    }
    const sorted = [...byEnd.values()].sort((a, b) => (a.end < b.end ? 1 : -1));
    if (sorted.length === 0) continue;
    if (!best || sorted[0].end > best[0].end) best = sorted;
  }
  if (!best) return [];

  // Reject stale series — newest fiscal-year end must be within ~18 months
  const newest = new Date(best[0].end).getTime();
  if (Date.now() - newest > 550 * 24 * 3600 * 1000) return [];

  return best.slice(0, count).map((e) => e.val);
}

const at = (arr: number[], i: number): number | null =>
  arr.length > i && Number.isFinite(arr[i]) ? arr[i] : null;

/**
 * Like annualSeries, but among fresh candidate tags picks the one with the
 * LARGEST newest value instead of the most recent end date. Debt tags are
 * subsets of each other (convertible notes ⊂ long-term debt), so recency
 * alone can select a small subset tag and understate leverage — for a
 * hard Debt/EBITDA filter, overstating beats understating.
 */
function annualSeriesMax(facts: CompanyFacts, tags: string[], count = 3): number[] {
  let best: number[] = [];
  for (const tag of tags) {
    const series = annualSeries(facts, [tag], count);
    if (series.length === 0) continue;
    if (best.length === 0 || Math.abs(series[0]) > Math.abs(best[0])) best = series;
  }
  return best;
}

/**
 * Fetch and derive fundamentals for one ticker.
 * `marketCapUsd` — current market cap in USD (for Altman Z's MVE / TL term).
 */
export async function edgarFundamentals(
  ticker: string,
  marketCapUsd: number,
): Promise<EdgarDerived | null> {
  const map = await loadCikMap();
  const cik = map.get(ticker.toUpperCase().replace(/\./g, "-")) ?? map.get(ticker.toUpperCase());
  if (!cik) return null;

  const facts = await fetchJson<CompanyFacts>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
  );
  await new Promise((r) => setTimeout(r, 150)); // fair-access pacing
  if (!facts) return null;

  const assets = annualSeries(facts, ["Assets"]);
  const currentAssets = annualSeries(facts, ["AssetsCurrent"]);
  const currentLiab = annualSeries(facts, ["LiabilitiesCurrent"]);
  const totalLiab = annualSeries(facts, ["Liabilities"]);
  const retained = annualSeries(facts, ["RetainedEarningsAccumulatedDeficit"]);
  const ebit = annualSeries(facts, ["OperatingIncomeLoss"]);
  const revenue = annualSeries(facts, [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
  ]);
  const cogs = annualSeries(facts, [
    "CostOfRevenue",
    "CostOfGoodsAndServicesSold",
    "CostOfGoodsSold",
  ]);
  const netIncome = annualSeries(facts, ["NetIncomeLoss"]);
  const cfo = annualSeries(facts, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ]);
  const capex = annualSeries(facts, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
  ]);
  const longTermDebt = annualSeriesMax(facts, [
    "LongTermDebtNoncurrent",
    "LongTermDebt",
    "LongTermDebtAndCapitalLeaseObligations",
    "ConvertibleLongTermNotesPayable",
  ]);
  const shortTermDebt = annualSeriesMax(facts, [
    "LongTermDebtCurrent",
    "DebtCurrent",
    "ShortTermBorrowings",
  ]);
  const dAndA = annualSeries(facts, [
    "DepreciationDepletionAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
    "DepreciationAndAmortization",
  ]);
  const shares = annualSeries(facts, ["EntityCommonStockSharesOutstanding"], 3, "dei", "shares");

  const ta0 = at(assets, 0);
  const ta1 = at(assets, 1);

  // ---- Altman Z (original manufacturing formula; null for banks/insurers
  //      where working-capital tags don't exist — Z isn't valid there anyway)
  let altmanZ: number | null = null;
  {
    const ca = at(currentAssets, 0);
    const cl = at(currentLiab, 0);
    const tl = at(totalLiab, 0);
    const re = at(retained, 0);
    const eb = at(ebit, 0);
    const rev = at(revenue, 0);
    if (ta0 && ta0 > 0 && ca !== null && cl !== null && tl && tl > 0 && re !== null && eb !== null && rev !== null) {
      altmanZ =
        1.2 * ((ca - cl) / ta0) +
        1.4 * (re / ta0) +
        3.3 * (eb / ta0) +
        0.6 * (marketCapUsd / tl) +
        1.0 * (rev / ta0);
      altmanZ = Math.round(altmanZ * 100) / 100;
    }
  }

  // ---- Accrual ratio: (NI − CFO) / Total Assets
  let accrualRatio: number | null = null;
  {
    const ni = at(netIncome, 0);
    const c = at(cfo, 0);
    if (ni !== null && c !== null && ta0 && ta0 > 0) {
      accrualRatio = Math.round(((ni - c) / ta0) * 1000) / 1000;
    }
  }

  // ---- FCF growth (yoy, %)
  let fcfGrowth: number | null = null;
  {
    const c0 = at(cfo, 0), c1 = at(cfo, 1);
    const x0 = at(capex, 0) ?? 0, x1 = at(capex, 1) ?? 0;
    if (c0 !== null && c1 !== null) {
      const f0 = c1 - x1;
      const f1 = c0 - x0;
      if (f0 !== 0) fcfGrowth = Math.round(((f1 - f0) / Math.abs(f0)) * 1000) / 10;
    }
  }

  // ---- Gross Profit / Assets (Novy-Marx quality), %
  let grossProfitToAssets: number | null = null;
  {
    const rev = at(revenue, 0);
    const cg = at(cogs, 0);
    if (rev !== null && cg !== null && ta0 && ta0 > 0) {
      grossProfitToAssets = Math.round(((rev - cg) / ta0) * 1000) / 10;
    }
  }

  // ---- Debt / EBITDA
  let debtToEbitda: number | null = null;
  {
    const eb = at(ebit, 0);
    const da = at(dAndA, 0);
    const debt = (at(longTermDebt, 0) ?? 0) + (at(shortTermDebt, 0) ?? 0);
    if (eb !== null && da !== null && eb + da > 0) {
      debtToEbitda = Math.round((debt / (eb + da)) * 100) / 100;
    }
  }

  // ---- Piotroski F-Score (scaled to /9 when ≥7 criteria computable)
  let piotroskiF: number | null = null;
  {
    let earned = 0;
    let possible = 0;
    const test = (cond: boolean | null) => {
      if (cond === null) return;
      possible++;
      if (cond) earned++;
    };
    const ni0 = at(netIncome, 0), ni1 = at(netIncome, 1);
    const c0 = at(cfo, 0);
    const rev0 = at(revenue, 0), rev1 = at(revenue, 1);
    const cg0 = at(cogs, 0), cg1 = at(cogs, 1);
    const ltd0 = at(longTermDebt, 0), ltd1 = at(longTermDebt, 1);
    const ca0 = at(currentAssets, 0), ca1 = at(currentAssets, 1);
    const cl0 = at(currentLiab, 0), cl1 = at(currentLiab, 1);
    const sh0 = at(shares, 0), sh1 = at(shares, 1);

    test(ni0 !== null ? ni0 > 0 : null); // 1. positive net income
    test(c0 !== null ? c0 > 0 : null); // 2. positive CFO
    test(
      ni0 !== null && ni1 !== null && ta0 && ta1 ? ni0 / ta0 > ni1 / ta1 : null,
    ); // 3. improving ROA
    test(c0 !== null && ni0 !== null ? c0 > ni0 : null); // 4. CFO > NI (low accruals)
    test(ltd0 !== null && ltd1 !== null && ta0 && ta1 ? ltd0 / ta0 <= ltd1 / ta1 : null); // 5. leverage down
    test(
      ca0 !== null && cl0 !== null && ca1 !== null && cl1 !== null && cl0 > 0 && cl1 > 0
        ? ca0 / cl0 > ca1 / cl1
        : null,
    ); // 6. current ratio up
    test(sh0 !== null && sh1 !== null ? sh0 <= sh1 * 1.02 : null); // 7. no meaningful dilution
    test(
      rev0 !== null && cg0 !== null && rev1 !== null && cg1 !== null && rev0 > 0 && rev1 > 0
        ? (rev0 - cg0) / rev0 > (rev1 - cg1) / rev1
        : null,
    ); // 8. gross margin up
    test(rev0 !== null && rev1 !== null && ta0 && ta1 ? rev0 / ta0 > rev1 / ta1 : null); // 9. asset turnover up

    if (possible >= 7) piotroskiF = Math.round((earned / possible) * 9);
  }

  return { altmanZ, piotroskiF, accrualRatio, fcfGrowth, grossProfitToAssets, debtToEbitda };
}

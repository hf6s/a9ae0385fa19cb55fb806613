/**
 * Factor20 scoring engine.
 *
 * Implements the transparent, evidence-based ranking model:
 *   Stage 1  — elimination filters (liquidity, financial health, profitability, trend)
 *   Stage 2  — four factor scores (Quality 30%, Value 25%, Momentum 25%, Growth 20%),
 *              each metric normalized by percentile across the surviving universe
 *   Stage 3  — penalties
 *   Stage 4  — final score = weighted factors − penalties
 *   Stage 5  — descending rank, top 20 recommended
 *
 * Free-tier data policy: when a metric is unavailable for the whole universe
 * (e.g. accrual ratio, Altman Z on Finnhub free), its weight is renormalized
 * across the remaining metrics of that factor, and the gap is reported in
 * `skippedFilters`. When a metric is missing for a single stock, that stock
 * gets the universe median percentile (50) for that metric.
 */

import type { FactorScores, Penalty } from "./types";

// ---------- raw per-stock input assembled by the scan ----------

export interface StockInput {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  marketCap: number; // USD millions
  avgDollarVolume: number; // USD, daily
  closes: number[]; // daily closes, oldest -> newest
  spxCloses: number[]; // S&P 500 closes for relative strength

  // fundamentals (null = unavailable)
  currentRatio: number | null;
  interestCoverage: number | null;
  netMargin: number | null; // %
  grossMargin: number | null; // %
  operatingMargin: number | null; // %
  roe: number | null; // %
  roic: number | null; // % (Finnhub ROI as proxy)
  debtToEquity: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  pfcf: number | null;
  evToEbitda: number | null;
  revenueGrowth: number | null; // % yoy
  epsGrowth: number | null; // % yoy
  revenuePerShare: number | null;
  latestSurprisePct: number | null; // most recent earnings surprise, %

  // derived from SEC EDGAR filings (null until fetched / when uncomputable)
  altmanZ: number | null;
  piotroskiF: number | null; // 0-9
  accrualRatio: number | null; // (NI - CFO) / Assets, lower is better
  fcfGrowth: number | null; // % yoy
  grossProfitToAssets: number | null; // %
  debtToEbitda: number | null;

  // from Finnhub insider transactions (last 6 months, shares)
  insiderBought: number | null;
  insiderSold: number | null;
}

export interface FilterResult {
  passed: boolean;
  failures: string[];
}

// ---------- Stage 1: elimination filters ----------

export function stage1Filter(s: StockInput): FilterResult {
  const failures: string[] = [];

  // Liquidity / universe
  if (s.marketCap <= 2000) failures.push("market cap ≤ $2B");
  if (s.avgDollarVolume <= 10_000_000) failures.push("avg dollar volume ≤ $10M");
  if (s.price <= 10) failures.push("price ≤ $10");
  if (s.revenuePerShare !== null && s.revenuePerShare <= 0) failures.push("no revenue");

  // Financial health (applied only when data exists — free-tier gaps documented)
  if (s.currentRatio !== null && s.currentRatio <= 1.2) failures.push("current ratio ≤ 1.2");
  if (s.interestCoverage !== null && s.interestCoverage <= 4)
    failures.push("interest coverage ≤ 4");

  // Profitability
  if (s.netMargin !== null && s.netMargin <= 0) failures.push("negative net income");
  const fcfMargin = derivedFcfMargin(s);
  if (fcfMargin !== null && fcfMargin <= 0) failures.push("negative free cash flow");

  // Trend filter
  const ma50 = smaOf(s.closes, 50);
  const ma200 = smaOf(s.closes, 200);
  const last = s.closes[s.closes.length - 1];
  if (ma200 !== null && last <= ma200) failures.push("price below 200-day MA");
  if (ma50 !== null && ma200 !== null && ma50 <= ma200) failures.push("50-day MA below 200-day MA");

  return { passed: failures.length === 0, failures };
}

/** Second-pass filters that need SEC EDGAR data (run for provisional survivors only). */
export function edgarFilter(s: StockInput): FilterResult {
  const failures: string[] = [];
  if (s.debtToEbitda !== null && s.debtToEbitda >= 3) failures.push("Debt/EBITDA ≥ 3");
  if (s.altmanZ !== null && s.altmanZ <= 2) failures.push("Altman Z ≤ 2");
  return { passed: failures.length === 0, failures };
}

/** Gross margin > sector median (computed across the scanned universe). */
export function sectorMedianGrossMargins(stocks: StockInput[]): Map<string, number> {
  const bySector = new Map<string, number[]>();
  for (const s of stocks) {
    if (s.grossMargin === null) continue;
    const arr = bySector.get(s.sector) ?? [];
    arr.push(s.grossMargin);
    bySector.set(s.sector, arr);
  }
  const medians = new Map<string, number>();
  for (const [sector, values] of bySector) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    medians.set(
      sector,
      values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2,
    );
  }
  return medians;
}

// ---------- Stage 2: factor scores ----------

interface MetricSpec {
  weight: number;
  /** higher = better after this transform */
  extract: (s: StockInput) => number | null;
}

function derivedFcfMargin(s: StockInput): number | null {
  // FCF margin = FCF / Revenue = (P/S) / (P/FCF); both are per-share consistent.
  if (s.ps === null || s.pfcf === null || s.pfcf === 0) return null;
  const m = s.ps / s.pfcf;
  return Number.isFinite(m) ? m * 100 : null;
}

function smaOf(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function trailingReturn(closes: number[], days: number, skip = 0): number | null {
  const end = closes.length - 1 - skip;
  const start = end - days;
  if (start < 0 || end <= start) return null;
  return closes[end] / closes[start] - 1;
}

const QUALITY: MetricSpec[] = [
  { weight: 0.25, extract: (s) => s.roic },
  // Gross Profit / Assets (EDGAR); gross margin as fallback proxy
  { weight: 0.2, extract: (s) => s.grossProfitToAssets ?? s.grossMargin },
  { weight: 0.15, extract: (s) => s.operatingMargin },
  { weight: 0.15, extract: (s) => derivedFcfMargin(s) },
  { weight: 0.15, extract: (s) => s.roe },
  { weight: 0.05, extract: (s) => (s.debtToEquity === null ? null : -s.debtToEquity) },
  { weight: 0.05, extract: (s) => (s.accrualRatio === null ? null : -s.accrualRatio) },
];

const VALUE: MetricSpec[] = [
  { weight: 0.3, extract: (s) => (s.pe && s.pe > 0 ? 1 / s.pe : null) }, // earnings yield
  { weight: 0.3, extract: (s) => (s.pfcf && s.pfcf > 0 ? 1 / s.pfcf : null) }, // FCF yield
  { weight: 0.2, extract: (s) => (s.evToEbitda && s.evToEbitda > 0 ? -s.evToEbitda : null) },
  { weight: 0.1, extract: (s) => (s.pb && s.pb > 0 ? -s.pb : null) },
  { weight: 0.1, extract: (s) => (s.ps && s.ps > 0 ? -s.ps : null) },
];

const MOMENTUM: MetricSpec[] = [
  // 12-month return excluding the last month (~252 and ~21 trading days)
  { weight: 0.4, extract: (s) => trailingReturn(s.closes, 231, 21) },
  { weight: 0.3, extract: (s) => trailingReturn(s.closes, 126) }, // ~6 months
  {
    weight: 0.2,
    extract: (s) => {
      const stock = trailingReturn(s.closes, 252);
      const spx = trailingReturn(s.spxCloses, 252);
      return stock === null || spx === null ? null : stock - spx;
    },
  },
  {
    weight: 0.1,
    extract: (s) => {
      const ma200 = smaOf(s.closes, 200);
      const last = s.closes[s.closes.length - 1];
      return ma200 === null ? null : last / ma200 - 1;
    },
  },
];

const GROWTH: MetricSpec[] = [
  { weight: 0.35, extract: (s) => s.revenueGrowth },
  { weight: 0.3, extract: (s) => s.epsGrowth },
  { weight: 0.2, extract: (s) => s.fcfGrowth }, // from EDGAR cash-flow statements
  { weight: 0.15, extract: () => null }, // forward EPS growth — needs paid analyst estimates
];

/**
 * Percentile rank (0–100) of each value within the universe.
 *
 * Equal values receive the SAME percentile, the average of the positions they
 * span. Ranking them by array position instead would hand one stock 0 and an
 * identical stock 100 on that metric, purely by accident of ordering.
 */
function percentileRanks(values: (number | null)[]): (number | null)[] {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null);
  if (present.length < 2) return values.map(() => null);
  const sorted = [...present].sort((a, b) => a.v - b.v);
  const ranks = new Array<number | null>(values.length).fill(null);
  const last = sorted.length - 1;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].v === sorted[i].v) j++;
    const pct = (((i + j) / 2) / last) * 100;
    for (let k = i; k <= j; k++) ranks[sorted[k].i] = pct;
    i = j + 1;
  }
  return ranks;
}

function scoreFactor(universe: StockInput[], specs: MetricSpec[]): number[] {
  // percentile per metric, then weighted with per-stock renormalization
  const perMetric = specs.map((spec) => percentileRanks(universe.map(spec.extract)));
  return universe.map((_, i) => {
    let total = 0;
    let weightSum = 0;
    specs.forEach((spec, m) => {
      const p = perMetric[m][i];
      if (p === null) return;
      total += p * spec.weight;
      weightSum += spec.weight;
    });
    if (weightSum === 0) return 50;
    return total / weightSum;
  });
}

export function computeFactorScores(universe: StockInput[]): FactorScores[] {
  const quality = scoreFactor(universe, QUALITY);
  const value = scoreFactor(universe, VALUE);
  const momentum = scoreFactor(universe, MOMENTUM);
  const growth = scoreFactor(universe, GROWTH);
  return universe.map((_, i) => ({
    quality: round1(quality[i]),
    value: round1(value[i]),
    momentum: round1(momentum[i]),
    growth: round1(growth[i]),
  }));
}

// ---------- Stage 3: penalties ----------

export function computePenalties(s: StockInput): Penalty[] {
  const penalties: Penalty[] = [];
  if (s.debtToEquity !== null && s.debtToEquity > 2) {
    penalties.push({ reason: "Debt/Equity > 2", points: 20 });
  }
  if (
    s.insiderSold !== null &&
    s.insiderBought !== null &&
    s.insiderSold > 0 &&
    s.insiderSold > 3 * s.insiderBought
  ) {
    penalties.push({ reason: "Insider selling > buying by large margin", points: 15 });
  }
  if (s.latestSurprisePct !== null && s.latestSurprisePct < -20) {
    penalties.push({ reason: "Earnings surprise < -20%", points: 15 });
  }
  if (s.piotroskiF !== null && s.piotroskiF < 5) {
    penalties.push({ reason: "Piotroski F-Score < 5", points: 10 });
  }
  if (s.altmanZ !== null && s.altmanZ < 3) {
    penalties.push({ reason: "Altman Z < 3", points: 10 });
  }
  // Remaining spec item not implemented: "accounting red flags" (-20) — no
  // objective free-data definition; the accrual ratio in Quality covers part of it.
  return penalties;
}

// ---------- Stage 4: final score ----------

/** Factor weights. The spec's defaults; the backtest can override to test tilts. */
export interface FactorWeights {
  quality: number;
  value: number;
  momentum: number;
  growth: number;
}

export const DEFAULT_WEIGHTS: FactorWeights = {
  quality: 0.3,
  value: 0.25,
  momentum: 0.25,
  growth: 0.2,
};

export function finalScore(
  scores: FactorScores,
  penalties: Penalty[],
  weights: FactorWeights = DEFAULT_WEIGHTS,
): number {
  const base =
    weights.quality * scores.quality +
    weights.value * scores.value +
    weights.momentum * scores.momentum +
    weights.growth * scores.growth;
  const penalty = penalties.reduce((a, p) => a + p.points, 0);
  return round1(Math.max(0, base - penalty));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const FREE_TIER_GAPS = [
  "Interest coverage > 4 filter — SEC filings do not expose interest expense as a reliable tag, so this Stage-1 rule is not applied",
  "Forward EPS growth (Growth 15%) — needs paid analyst estimates; weight renormalized",
  "Accounting red flags penalty (-20) — no objective free-data definition",
];

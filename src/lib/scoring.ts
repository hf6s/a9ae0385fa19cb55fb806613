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
  /** CFO / |net income|. Below 1 means reported profit outruns the cash. */
  cashConversion: number | null;
  /** (dividends + buybacks + debt paydown) / market cap, %. */
  shareholderYield: number | null;
  fcfGrowth: number | null; // % yoy
  grossProfitToAssets: number | null; // %
  debtToEbitda: number | null;
  /** Return on capital deployed since last year, not the level. */
  incrementalRoic: number | null;
  /** Annualized share-count change. Positive is dilution, negative is buybacks. */
  shareDilution: number | null;
  /** This year's revenue growth minus last year's: the second derivative. */
  growthAcceleration: number | null;

  // from Finnhub insider transactions (last 6 months, shares)
  insiderBought: number | null;
  insiderSold: number | null;
}

export interface FilterResult {
  passed: boolean;
  failures: string[];
}

// ---------- Stage 1: elimination filters ----------

/**
 * Which Stage-1 rules to apply.
 *
 * The defaults are the spec exactly. The options exist because measurement
 * showed these rules eject the companies that drove the index: Apple and
 * Amazon fail the current-ratio test (they run negative working capital by
 * design, which is market power, not distress), Microsoft and Meta fail the
 * trend test on any dip, and JP Morgan fails a free-cash-flow test that means
 * nothing for a bank.
 */
export interface FilterOptions {
  /** Current ratio > 1.2. Written for 1930s credit analysis. */
  currentRatio?: boolean;
  /** Price above the 200-day MA, and 50-day above 200-day. Pro-cyclical. */
  trend?: boolean;
  /** Skip working-capital and FCF rules for financials, where they mislead. */
  exemptFinancials?: boolean;
}

const ALL_FILTERS: Required<FilterOptions> = {
  currentRatio: true,
  trend: true,
  exemptFinancials: false,
};

export function stage1Filter(s: StockInput, opts: FilterOptions = {}): FilterResult {
  const o = { ...ALL_FILTERS, ...opts };
  const failures: string[] = [];
  const isFinancial = /financ|bank|insur/i.test(s.sector);
  const skipWorkingCapital = o.exemptFinancials && isFinancial;

  // Liquidity / universe
  if (s.marketCap <= 2000) failures.push("market cap ≤ $2B");
  if (s.avgDollarVolume <= 10_000_000) failures.push("avg dollar volume ≤ $10M");
  if (s.price <= 10) failures.push("price ≤ $10");
  if (s.revenuePerShare !== null && s.revenuePerShare <= 0) failures.push("no revenue");

  // Financial health (applied only when data exists — free-tier gaps documented)
  if (o.currentRatio && !skipWorkingCapital && s.currentRatio !== null && s.currentRatio <= 1.2) {
    failures.push("current ratio ≤ 1.2");
  }
  if (s.interestCoverage !== null && s.interestCoverage <= 4)
    failures.push("interest coverage ≤ 4");

  // Profitability
  if (s.netMargin !== null && s.netMargin <= 0) failures.push("negative net income");
  const fcfMargin = derivedFcfMargin(s);
  if (!skipWorkingCapital && fcfMargin !== null && fcfMargin <= 0) {
    failures.push("negative free cash flow");
  }

  // Trend filter
  if (o.trend) {
    const ma50 = smaOf(s.closes, 50);
    const ma200 = smaOf(s.closes, 200);
    const last = s.closes[s.closes.length - 1];
    if (ma200 !== null && last <= ma200) failures.push("price below 200-day MA");
    if (ma50 !== null && ma200 !== null && ma50 <= ma200)
      failures.push("50-day MA below 200-day MA");
  }

  return { passed: failures.length === 0, failures };
}

/** Second-pass filters that need SEC EDGAR data (run for provisional survivors only). */
export function edgarFilter(s: StockInput): FilterResult {
  const failures: string[] = [];
  if (s.debtToEbitda !== null && s.debtToEbitda >= 3) failures.push("Debt/EBITDA ≥ 3");
  if (s.altmanZ !== null && s.altmanZ <= 2) failures.push("Altman Z ≤ 2");
  return { passed: failures.length === 0, failures };
}

/**
 * Stage 1 applied to a whole universe at once.
 *
 * Every rule in `stage1Filter` looks at one stock in isolation. The spec's
 * gross-margin rule does not: it is relative to the sector median, so it can
 * only be evaluated once the whole cohort is known. That is exactly why it
 * ended up living in the scan script rather than the engine — and why the
 * backtest silently omitted it, measuring a looser model than the one the site
 * displayed. Both callers go through here now, so the live pipeline and the
 * tested pipeline cannot disagree about what Stage 1 means.
 */
export function stage1FilterUniverse(
  universe: StockInput[],
  opts: FilterOptions = {},
): FilterResult[] {
  const medians = sectorMedianGrossMargins(universe);
  return universe.map((s) => {
    const result = stage1Filter(s, opts);
    const median = medians.get(s.sector);
    if (s.grossMargin !== null && median !== undefined && s.grossMargin < median) {
      result.passed = false;
      result.failures.push("gross margin below sector median");
    }
    return result;
  });
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

/**
 * Variants that fold in the incremental signals.
 *
 * Kept as separate specs behind a flag rather than edited in place, so the
 * backtest can run the model with and without them and measure the difference
 * instead of assuming an improvement. Weight is taken from the existing
 * metrics proportionally, never added on top, or the comparison would confound
 * "new signal" with "quality counts for more now".
 */
const QUALITY_PLUS: MetricSpec[] = [
  { weight: 0.2, extract: (s) => s.roic },
  { weight: 0.15, extract: (s) => s.incrementalRoic },
  { weight: 0.15, extract: (s) => s.grossProfitToAssets ?? s.grossMargin },
  { weight: 0.13, extract: (s) => s.operatingMargin },
  { weight: 0.13, extract: (s) => derivedFcfMargin(s) },
  { weight: 0.14, extract: (s) => s.roe },
  { weight: 0.05, extract: (s) => (s.debtToEquity === null ? null : -s.debtToEquity) },
  { weight: 0.05, extract: (s) => (s.accrualRatio === null ? null : -s.accrualRatio) },
];

const GROWTH_PLUS: MetricSpec[] = [
  { weight: 0.3, extract: (s) => s.revenueGrowth },
  { weight: 0.25, extract: (s) => s.epsGrowth },
  { weight: 0.15, extract: (s) => s.fcfGrowth },
  { weight: 0.15, extract: (s) => s.growthAcceleration },
  { weight: 0.15, extract: () => null }, // forward EPS growth — needs paid estimates
];

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

/**
 * Quality with the F-Score folded in.
 *
 * Weight is taken from the existing metrics proportionally rather than added
 * on top: adding it would make Quality count for more than 30% of the final
 * score, and the comparison would then confound "F-Score helps" with "Quality
 * matters more than the spec says".
 */
const QUALITY_PIOTROSKI: MetricSpec[] = [
  { weight: 0.225, extract: (s) => s.roic },
  { weight: 0.18, extract: (s) => s.grossProfitToAssets ?? s.grossMargin },
  { weight: 0.135, extract: (s) => s.operatingMargin },
  { weight: 0.135, extract: (s) => derivedFcfMargin(s) },
  { weight: 0.135, extract: (s) => s.roe },
  { weight: 0.045, extract: (s) => (s.debtToEquity === null ? null : -s.debtToEquity) },
  { weight: 0.045, extract: (s) => (s.accrualRatio === null ? null : -s.accrualRatio) },
  { weight: 0.1, extract: (s) => s.piotroskiF },
];

/** Value with shareholder yield, weight taken proportionally from the rest. */
const VALUE_SHAREHOLDER: MetricSpec[] = [
  { weight: 0.255, extract: (s) => (s.pe && s.pe > 0 ? 1 / s.pe : null) },
  { weight: 0.255, extract: (s) => (s.pfcf && s.pfcf > 0 ? 1 / s.pfcf : null) },
  { weight: 0.17, extract: (s) => (s.evToEbitda && s.evToEbitda > 0 ? -s.evToEbitda : null) },
  { weight: 0.085, extract: (s) => (s.pb && s.pb > 0 ? -s.pb : null) },
  { weight: 0.085, extract: (s) => (s.ps && s.ps > 0 ? -s.ps : null) },
  { weight: 0.15, extract: (s) => s.shareholderYield },
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
 * The spec's "potential enhancements", each behind its own switch.
 *
 * They are options rather than edits to the model because the project's rule
 * is that a change earns its place by measurement. Every one of these has a
 * plausible story attached; so did the six factor tilts that lost.
 *
 * The seventh enhancement, analyst estimate revisions, has no switch: it needs
 * an estimates feed, and the data plan here is prices and filings.
 */
export interface EnhancementOptions {
  /** Rank Value and Quality inside each sector, not against the whole market. */
  sectorRelative?: boolean;
  /** Penalise extreme realised and downside volatility. */
  volatility?: boolean;
  /** Piotroski F-Score as a positive Quality input, not only a penalty. */
  piotroskiFactor?: boolean;
  /** Dividends + buybacks + debt paydown as a Value input. */
  shareholderYield?: boolean;
  /** Winsorised z-scores instead of percentile ranks. */
  zscore?: boolean;
}

/**
 * Below this many names, a sector is too small to rank within: in a cohort of
 * three, one company is handed 100 and another 0 on the strength of nothing.
 * Those fall back to the whole-market ranking.
 */
const MIN_SECTOR_COHORT = 8;

/**
 * Standardised score (0–100) from a winsorised z-score.
 *
 * Percentiles throw away magnitude: the top two companies are 100 and 99
 * whether the gap between them is a rounding error or a factor of three.
 * Z-scores keep it, at the cost of being pulled around by outliers — hence
 * clamping at ±3 standard deviations before mapping onto the same 0–100
 * range the rest of the engine works in.
 */
function zScores(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return values.map(() => null);
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  const variance = present.reduce((a, b) => a + (b - mean) ** 2, 0) / present.length;
  const sd = Math.sqrt(variance);
  // Every survivor identical on this metric: no information, so no separation.
  if (sd === 0) return values.map((v) => (v === null ? null : 50));
  return values.map((v) => {
    if (v === null) return null;
    const z = Math.max(-3, Math.min(3, (v - mean) / sd));
    return ((z + 3) / 6) * 100;
  });
}

/**
 * Normalise within each sector rather than across the market.
 *
 * A bank's price/book and a software company's are not comparable numbers, so
 * ranking them against each other mostly measures which industry you are in.
 * Sectors too thin to rank within fall back to the global ranking, which is
 * why the global pass is computed regardless.
 */
function normalize(
  universe: StockInput[],
  values: (number | null)[],
  norm: (v: (number | null)[]) => (number | null)[],
  sectorRelative: boolean,
): (number | null)[] {
  const global = norm(values);
  if (!sectorRelative) return global;

  const out = [...global];
  const groups = new Map<string, number[]>();
  universe.forEach((s, i) => {
    const key = s.sector || "Unknown";
    const arr = groups.get(key);
    if (arr) arr.push(i);
    else groups.set(key, [i]);
  });
  for (const idx of groups.values()) {
    if (idx.length < MIN_SECTOR_COHORT) continue; // keeps the global score
    const within = norm(idx.map((i) => values[i]));
    idx.forEach((i, k) => {
      out[i] = within[k];
    });
  }
  return out;
}

/** Annualised realised volatility from daily log returns, in percent. */
export function realizedVol(closes: number[], days = 252): number | null {
  if (closes.length < 60) return null;
  const window = closes.slice(-(days + 1));
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i - 1] > 0 && window[i] > 0) rets.push(Math.log(window[i] / window[i - 1]));
  }
  if (rets.length < 40) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(varr) * Math.sqrt(252) * 100;
}

/**
 * Downside deviation: the same calculation over losing days only.
 *
 * Volatility punishes a stock for rising quickly, which is not the risk
 * anyone is worried about. This measures the half that is.
 */
export function downsideVol(closes: number[], days = 252): number | null {
  if (closes.length < 60) return null;
  const window = closes.slice(-(days + 1));
  const downs: number[] = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i - 1] <= 0 || window[i] <= 0) continue;
    const r = Math.log(window[i] / window[i - 1]);
    if (r < 0) downs.push(r);
  }
  if (downs.length < 20) return null;
  const varr = downs.reduce((a, b) => a + b ** 2, 0) / downs.length;
  return Math.sqrt(varr) * Math.sqrt(252) * 100;
}

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

function scoreFactor(
  universe: StockInput[],
  specs: MetricSpec[],
  opts: { zscore?: boolean; sectorRelative?: boolean } = {},
): number[] {
  // normalise per metric, then weight with per-stock renormalization
  const norm = opts.zscore ? zScores : percentileRanks;
  const perMetric = specs.map((spec) =>
    normalize(universe, universe.map(spec.extract), norm, opts.sectorRelative === true),
  );
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

export function computeFactorScores(
  universe: StockInput[],
  opts: { newSignals?: boolean } & EnhancementOptions = {},
): FactorScores[] {
  const n = { zscore: opts.zscore, sectorRelative: false };
  /**
   * Sector-relative ranking applies to Value and Quality only, per the spec's
   * reasoning: those are the factors whose raw numbers differ structurally by
   * industry. Momentum and Growth are already comparable across sectors —
   * a 30% return is a 30% return — and ranking them within sector would just
   * discard the information that one industry is outrunning another.
   */
  const rel = { zscore: opts.zscore, sectorRelative: opts.sectorRelative === true };

  const qualitySpecs = opts.newSignals
    ? QUALITY_PLUS
    : opts.piotroskiFactor
      ? QUALITY_PIOTROSKI
      : QUALITY;
  const valueSpecs = opts.shareholderYield ? VALUE_SHAREHOLDER : VALUE;

  const quality = scoreFactor(universe, qualitySpecs, rel);
  const value = scoreFactor(universe, valueSpecs, rel);
  const momentum = scoreFactor(universe, MOMENTUM, n);
  const growth = scoreFactor(universe, opts.newSignals ? GROWTH_PLUS : GROWTH, n);
  return universe.map((_, i) => ({
    quality: round1(quality[i]),
    value: round1(value[i]),
    momentum: round1(momentum[i]),
    growth: round1(growth[i]),
  }));
}

// ---------- Stage 3: penalties ----------

export function computePenalties(
  s: StockInput,
  opts: { newSignals?: boolean; redFlags?: boolean } & EnhancementOptions = {},
): Penalty[] {
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
  /**
   * Dilution. Issuing 5%+ of the company a year transfers value away from
   * existing holders whatever the headline growth says, and it is the one
   * input here that was already being fetched and thrown away.
   */
  if (opts.newSignals && s.shareDilution !== null && s.shareDilution > 5) {
    penalties.push({ reason: "Share count growing > 5%/yr", points: 10 });
  }
  /**
   * The growth trap: growth decelerating hard WHILE the company burns cash.
   * Either alone is ordinary. Together they are the pattern of a business
   * whose story is running out before its funding does, so the penalty fires
   * only on the conjunction.
   */
  if (
    opts.newSignals &&
    s.growthAcceleration !== null &&
    s.growthAcceleration < -10 &&
    s.fcfGrowth !== null &&
    s.fcfGrowth < 0
  ) {
    penalties.push({ reason: "Growth decelerating with falling cash flow", points: 15 });
  }
  /**
   * Volatility. Two separate tests, because they catch different things: a
   * stock can be merely jumpy (high realised vol, symmetric) or genuinely
   * punishing (most of the movement to the downside). Thresholds are absolute
   * rather than relative because these are meant to catch the extremes, and a
   * top-decile cut would fire on ten percent of the universe by construction
   * however calm the market was that year.
   */
  if (opts.volatility) {
    const rv = realizedVol(s.closes);
    if (rv !== null && rv > 60) {
      penalties.push({ reason: "Realized volatility above 60%", points: 10 });
    }
    const dv = downsideVol(s.closes);
    if (dv !== null && dv > 45) {
      penalties.push({ reason: "Downside volatility above 45%", points: 10 });
    }
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
  /**
   * Accounting red flags.
   *
   * The spec asks for this without saying what counts, and the honest answer
   * is that the giveaways auditors look for — receivables outrunning revenue,
   * restatements, auditor changes — are not in the data this app pays for.
   * What IS visible is the oldest and best-evidenced signal of the family
   * (Sloan 1996): profit that the cash flow statement does not corroborate.
   *
   * Two readings of that gap are required together. `accrualRatio` scales it
   * by assets, `cashConversion` by earnings, so an asset-light firm with a
   * large gap and an asset-heavy firm with a small one are each caught by one
   * and cleared by the other. They share inputs, so this is not two
   * independent confirmations — it is one signal measured two ways, and it
   * fires only where both readings agree.
   */
  if (
    opts.redFlags !== false &&
    s.accrualRatio !== null &&
    s.accrualRatio > 0.1 &&
    s.cashConversion !== null &&
    s.cashConversion < 0.5
  ) {
    penalties.push({ reason: "Accounting red flags: earnings not backed by cash", points: 20 });
  }
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
  "Analyst estimate revisions — needs an estimates feed; not available on a prices-and-filings data plan",
  "Interest coverage > 4 filter — applied, but only for companies that tag interest expense in their filings; names that do not disclose it separately (many with no debt) are not tested on this rule",
  "Forward EPS growth (Growth 15%) — needs paid analyst estimates; weight renormalized",
  "Accounting red flags penalty (-20) — detected as accrual-based earnings quality only; receivables, restatements and auditor changes are not in the data plan",
];

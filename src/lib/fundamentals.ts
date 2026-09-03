/**
 * Builds a StockInput from SEC filings plus a price.
 *
 * Shared by the live scan and the backtest so both compute the same numbers
 * the same way. That matters twice over:
 *
 *   1. Correctness. The scan used to take its ratios from Finnhub while the
 *      backtest derived them from EDGAR, so the model being tested was not the
 *      model being shown. Any backtest result carried an unmeasured gap.
 *   2. It works from a server. Finnhub's free tier answers 401 to datacenter
 *      IPs, which is why every CI scan skipped all 503 tickers. SEC and EODHD
 *      both serve servers, so this path runs anywhere.
 *
 * Pass the fiscal years already filtered to what was public on the date being
 * scored — `asOf()` in edgar-history does that — and the result never peeks at
 * numbers the market did not have.
 */

import type { AnnualRecord } from "./edgar-history";
import type { StockInput } from "./scoring";

const num = (v: number | null | undefined): number | null =>
  v !== null && v !== undefined && Number.isFinite(v) ? v : null;

export interface BuildArgs {
  ticker: string;
  name: string;
  sector: string;
  /** Total-return closes, oldest to newest, ending at the date being scored. */
  closes: number[];
  spxCloses: number[];
  /** As-traded price on that date; market cap is this times shares. */
  price: number;
  fy0: AnnualRecord;
  fy1: AnnualRecord | null;
  /** Two years back, for trend growth and normalized earnings. */
  fy2?: AnnualRecord | null;
  /** Real 10-day average when known; the default assumes an index-level name. */
  avgDollarVolume?: number;
}

/**
 * Returns null when the company cannot be valued at all (no share count, no
 * revenue, no balance sheet). Such a name simply sits out rather than being
 * scored on guesses.
 */
export function buildStockInput({
  ticker,
  name,
  sector,
  closes,
  spxCloses,
  price,
  fy0,
  fy1,
  fy2 = null,
  avgDollarVolume = 1e12,
}: BuildArgs): StockInput | null {
  const shares = num(fy0.shares);
  const revenue = num(fy0.revenue);
  const assets = num(fy0.assets);
  if (!shares || shares <= 0 || revenue === null || assets === null || assets <= 0) return null;

  const mve = price * shares; // market value of equity, USD
  const marketCapM = mve / 1e6;

  const ni = num(fy0.netIncome);
  const equity = num(fy0.equity);
  const cfo = num(fy0.cfo);
  const capex = num(fy0.capex) ?? 0;
  const ebit = num(fy0.ebit);
  const da = num(fy0.dAndA);
  const cogs = num(fy0.cogs);
  const debt = num(fy0.debt);
  const cash = num(fy0.cash) ?? 0;
  const ca = num(fy0.currentAssets);
  const cl = num(fy0.currentLiab);
  const tl = num(fy0.totalLiab);
  const re = num(fy0.retained);
  const interest = num(fy0.interestExpense);
  const dividends = num(fy0.dividendsPaid) ?? 0;
  const buybacks = num(fy0.buybacks) ?? 0;
  const tax = num(fy0.taxExpense);
  const pretax = num(fy0.pretaxIncome);

  const fcf = cfo !== null ? cfo - capex : null;
  const ebitda = ebit !== null && da !== null ? ebit + da : null;

  // Valuation ratios. Units cancel in the percentile ranking, so market cap
  // being in dollars while some statement items differ is harmless — every
  // stock uses the same convention.
  // Earnings yield on NORMALIZED earnings: a single year's net income swings
  // with one-off charges and can be negative, which drops a stock out of the
  // value factor entirely. Averaging the years available is the Graham fix.
  const niYears = [ni, fy1 ? num(fy1.netIncome) : null, fy2 ? num(fy2.netIncome) : null].filter(
    (x): x is number => x !== null,
  );
  const niNorm = niYears.length > 0 ? niYears.reduce((a, b) => a + b, 0) / niYears.length : null;
  const pe = niNorm !== null && niNorm !== 0 ? mve / niNorm : null;
  const pb = equity !== null && equity > 0 ? mve / equity : null;
  const ps = revenue > 0 ? mve / revenue : null;
  const pfcf = fcf !== null && fcf !== 0 ? mve / fcf : null;
  const evToEbitda =
    ebitda !== null && ebitda > 0 && debt !== null ? (mve + debt - cash) / ebitda : null;

  const roe = equity !== null && equity > 0 && ni !== null ? (ni / equity) * 100 : null;
  // ROIC properly: NOPAT over invested capital.
  //
  // The old form divided pre-tax EBIT by equity+debt, which overstates return
  // (no tax) and overstates capital (cash sitting on the balance sheet is not
  // invested). Both errors are largest for cash-rich, low-tax companies, so the
  // metric was systematically biased — and it is the highest-weighted input in
  // the highest-weighted factor.
  const taxRate =
    pretax !== null && pretax > 0 && tax !== null ? Math.min(Math.max(tax / pretax, 0), 0.5) : 0.21;
  const nopat = ebit !== null ? ebit * (1 - taxRate) : null;
  const investedCapital =
    equity !== null && debt !== null ? equity + debt - Math.min(cash, debt + equity) : null;
  const roic =
    nopat !== null && investedCapital !== null && investedCapital > 0
      ? (nopat / investedCapital) * 100
      : null;
  const netMargin = revenue > 0 && ni !== null ? (ni / revenue) * 100 : null;
  const grossMargin = revenue > 0 && cogs !== null ? ((revenue - cogs) / revenue) * 100 : null;
  const operatingMargin = revenue > 0 && ebit !== null ? (ebit / revenue) * 100 : null;
  const grossProfitToAssets = cogs !== null ? ((revenue - cogs) / assets) * 100 : null;
  const debtToEquity = debt !== null && equity !== null && equity > 0 ? debt / equity : null;
  const accrualRatio = ni !== null && cfo !== null ? (ni - cfo) / assets : null;
  // Conversion against the ABSOLUTE value of earnings: a loss-making year
  // would otherwise flip the sign and read as excellent conversion.
  const cashConversion = ni !== null && cfo !== null && ni !== 0 ? cfo / Math.abs(ni) : null;
  const currentRatio = ca !== null && cl !== null && cl > 0 ? ca / cl : null;
  const debtToEbitda = debt !== null && ebitda !== null && ebitda > 0 ? debt / ebitda : null;

  // Growth, year over year
  const rev1 = fy1 ? num(fy1.revenue) : null;
  const ni1 = fy1 ? num(fy1.netIncome) : null;
  const sh1 = fy1 ? num(fy1.shares) : null;
  const sh2 = fy2 ? num(fy2.shares) : null;
  // Prefer a two-year CAGR over a single year-over-year jump: one weak or
  // strong year (a COVID quarter, an acquisition) otherwise dominates the
  // growth score entirely.
  const rev2 = fy2 ? num(fy2.revenue) : null;
  const revenueGrowth =
    rev2 !== null && rev2 > 0
      ? (Math.pow(revenue / rev2, 1 / 2) - 1) * 100
      : rev1 !== null && rev1 > 0
        ? (revenue / rev1 - 1) * 100
        : null;
  /**
   * Incremental ROIC: return on the capital deployed SINCE last year.
   *
   * Level ROIC says how good the business already is, which is largely a fact
   * about past decisions and is heavily priced in. What compounding needs is
   * whether NEW money still earns well, so this is the change in NOPAT over
   * the change in invested capital. Only meaningful when the company actually
   * deployed capital, hence the floor on the denominator: tiny deltas produce
   * meaningless ratios.
   */
  const ebit1 = fy1 ? num(fy1.ebit) : null;
  const equity1 = fy1 ? num(fy1.equity) : null;
  const debt1x = fy1 ? num(fy1.debt) : null;
  const cash1 = fy1 ? (num(fy1.cash) ?? 0) : null;
  let incrementalRoic: number | null = null;
  if (
    nopat !== null &&
    investedCapital !== null &&
    ebit1 !== null &&
    equity1 !== null &&
    debt1x !== null &&
    cash1 !== null
  ) {
    const nopat1 = ebit1 * (1 - taxRate);
    const ic1 = equity1 + debt1x - Math.min(cash1, debt1x + equity1);
    const dCapital = investedCapital - ic1;
    // At least 5% of the existing base, so noise in a flat year cannot dominate.
    if (ic1 > 0 && dCapital > ic1 * 0.05) {
      incrementalRoic = ((nopat - nopat1) / dCapital) * 100;
    }
  }

  /**
   * Share count change, annualized over the years available.
   *
   * Already pulled from EDGAR on every scan and never used for anything.
   * Positive means dilution, which silently taxes per-share compounding;
   * negative means buybacks.
   */
  let shareDilution: number | null = null;
  {
    const base = sh2 !== null && sh2 > 0 ? sh2 : sh1;
    const span = sh2 !== null && sh2 > 0 ? 2 : 1;
    if (base !== null && base > 0) {
      shareDilution = (Math.pow(shares / base, 1 / span) - 1) * 100;
    }
  }

  /**
   * Growth acceleration: this year's growth minus last year's.
   *
   * The second derivative, not the level. A company slowing from 40% to 25% and
   * one speeding up from 10% to 25% look identical on revenueGrowth and are
   * not the same investment.
   */
  let growthAcceleration: number | null = null;
  if (rev1 !== null && rev1 > 0 && rev2 !== null && rev2 > 0) {
    growthAcceleration = (revenue / rev1 - 1) * 100 - (rev1 / rev2 - 1) * 100;
  }

  /**
   * Shareholder yield: every route by which the company returned capital,
   * as a percentage of what the market pays for it.
   *
   * The spec asks for dividends, buybacks AND debt reduction rather than
   * dividends alone, and the reason is that the three are substitutes. A board
   * choosing buybacks over a dividend, or paying down debt instead of either,
   * has not stopped returning capital — a dividend-only screen just stops
   * seeing it. Debt paydown counts because retiring a claim ahead of equity
   * raises what the equity is worth, though only when it is a real reduction:
   * a company that simply refinanced shows no change here.
   */
  const debt1y = fy1 ? num(fy1.debt) : null;
  const debtReduction = debt !== null && debt1y !== null ? Math.max(0, debt1y - debt) : 0;
  const shareholderYield =
    mve > 0 ? ((dividends + buybacks + debtReduction) / mve) * 100 : null;

  let epsGrowth: number | null = null;
  if (ni !== null && ni1 !== null && sh1 !== null && sh1 > 0) {
    const eps0 = ni / shares;
    const eps1 = ni1 / sh1;
    if (eps1 > 0) epsGrowth = (eps0 / eps1 - 1) * 100;
  }
  let fcfGrowth: number | null = null;
  if (fy1) {
    const cfo1 = num(fy1.cfo);
    const capex1 = num(fy1.capex) ?? 0;
    if (cfo !== null && cfo1 !== null) {
      const f0 = cfo1 - capex1;
      const f1 = cfo - capex;
      if (f0 !== 0) fcfGrowth = ((f1 - f0) / Math.abs(f0)) * 100;
    }
  }

  // Altman Z (manufacturing form; null for names lacking working-capital tags)
  let altmanZ: number | null = null;
  if (ca !== null && cl !== null && tl !== null && tl > 0 && re !== null && ebit !== null) {
    altmanZ =
      1.2 * ((ca - cl) / assets) +
      1.4 * (re / assets) +
      3.3 * (ebit / assets) +
      0.6 * (mve / tl) +
      1.0 * (revenue / assets);
    altmanZ = Math.round(altmanZ * 100) / 100;
  }

  // Piotroski F (scaled to /9 when >=7 criteria are computable)
  let piotroskiF: number | null = null;
  {
    let earned = 0;
    let possible = 0;
    const test = (cond: boolean | null) => {
      if (cond === null) return;
      possible++;
      if (cond) earned++;
    };
    const ta1 = fy1 ? num(fy1.assets) : null;
    const ca1 = fy1 ? num(fy1.currentAssets) : null;
    const cl1 = fy1 ? num(fy1.currentLiab) : null;
    const cogs1 = fy1 ? num(fy1.cogs) : null;
    const debt1 = fy1 ? num(fy1.debt) : null;

    test(ni !== null ? ni > 0 : null);
    test(cfo !== null ? cfo > 0 : null);
    test(ni !== null && ni1 !== null && ta1 !== null && ta1 > 0 ? ni / assets > ni1 / ta1 : null);
    test(cfo !== null && ni !== null ? cfo > ni : null);
    test(
      debt !== null && debt1 !== null && ta1 !== null && ta1 > 0
        ? debt / assets <= debt1 / ta1
        : null,
    );
    test(
      ca !== null && cl !== null && ca1 !== null && cl1 !== null && cl > 0 && cl1 > 0
        ? ca / cl > ca1 / cl1
        : null,
    );
    test(sh1 !== null ? shares <= sh1 * 1.02 : null);
    test(
      cogs !== null && rev1 !== null && cogs1 !== null && rev1 > 0
        ? (revenue - cogs) / revenue > (rev1 - cogs1) / rev1
        : null,
    );
    test(rev1 !== null && ta1 !== null && ta1 > 0 ? revenue / assets > rev1 / ta1 : null);
    if (possible >= 7) piotroskiF = Math.round((earned / possible) * 9);
  }

  return {
    ticker,
    name,
    sector,
    price,
    marketCap: marketCapM,
    avgDollarVolume,
    closes,
    spxCloses,
    currentRatio,
    // The spec's "interest coverage > 4" filter sat inert because this was
    // always null. EBIT over interest expense, now that the tag is extracted.
    interestCoverage:
      ebit !== null && interest !== null && interest > 0 ? ebit / interest : null,
    netMargin,
    grossMargin,
    operatingMargin,
    roe,
    roic,
    incrementalRoic,
    shareDilution,
    growthAcceleration,
    debtToEquity,
    pe,
    pb,
    ps,
    pfcf,
    evToEbitda,
    revenueGrowth,
    epsGrowth,
    revenuePerShare: revenue / shares,
    // Filled by the caller when a live feed is reachable; the scoring engine
    // renormalizes around them when absent.
    latestSurprisePct: null,
    altmanZ,
    piotroskiF,
    accrualRatio,
    cashConversion,
    shareholderYield,
    fcfGrowth,
    grossProfitToAssets,
    debtToEbitda,
    insiderBought: null,
    insiderSold: null,
  };
}

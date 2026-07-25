/**
 * Factor20 backtest — the FULL four-factor model on free data.
 *
 * WHAT THIS TESTS: the exact live ranking engine (Quality 30 / Value 25 /
 * Momentum 25 / Growth 20, Stage-1 elimination filters, penalties) replayed
 * quarterly over ~10 years as a top-20 equal-weight portfolio vs the S&P 500.
 * It calls the same scoring.ts the live site uses, so there is zero drift
 * between what you see today and what the backtest measures.
 *
 * WHERE THE DATA COMES FROM (all free, no paid API):
 *   - Prices/trend/momentum: Yahoo Finance daily history.
 *   - Fundamentals (Quality/Value/Growth + health filters): SEC EDGAR
 *     companyfacts, read point-in-time — at each past rebalance only filings
 *     already public on that date are used, so there is no lookahead bias.
 *
 * HONEST LIMITATIONS (shown in the UI):
 *   - Universe is today's S&P 500 members across all history (survivorship
 *     bias — bankruptcies/acquisitions are absent, nudging results optimistic).
 *   - Price returns only (no dividends, either side); no trading costs/slippage.
 *   - Three live inputs have no free historical feed and are simply off in the
 *     backtest: insider-selling penalty, earnings-surprise penalty, forward-EPS
 *     growth (its weight renormalizes, exactly as the live model already does).
 *
 * Usage: npm run backtest   (~5-10 min first run; SEC filings then cached)
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/lib/env";
import { dailyHistory, sp500History } from "../src/lib/prices";
import {
  asOf,
  edgarHistory,
  loadHistoryCache,
  saveHistoryCache,
  type AnnualRecord,
} from "../src/lib/edgar-history";
import { everMembers, loadMembership, membersAsOf } from "../src/lib/constituents";
import { buildDelistedResolver } from "../src/lib/delisted-cik";
import {
  computeFactorScores,
  computePenalties,
  edgarFilter,
  finalScore,
  stage1Filter,
  type StockInput,
} from "../src/lib/scoring";

loadEnv();

const DATA_DIR = path.join(process.cwd(), "data");
const STATUS_PATH = path.join(DATA_DIR, "backtest-status.json");

const REBALANCE_DAYS = 63; // ~quarterly
const WARMUP_DAYS = 274; // 252 + 21 + buffer, so every momentum window is defined
const TOP_N = 20;

interface BtStatus {
  state: "running" | "done" | "error";
  phase: string;
  done: number;
  total: number;
  startedAt: string;
  phaseStartedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
}

const status: BtStatus = {
  state: "running",
  phase: "starting",
  done: 0,
  total: 0,
  startedAt: new Date().toISOString(),
  phaseStartedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function writeStatus(patch: Partial<BtStatus>): void {
  const phaseChanged = patch.phase && patch.phase !== status.phase;
  Object.assign(status, patch, { updatedAt: new Date().toISOString() });
  if (phaseChanged) status.phaseStartedAt = status.updatedAt;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  } catch {
    /* best effort */
  }
}

const CURRENT_NAMES_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

/** Ticker -> company name for current members; delisted names stay blank. */
async function fetchCurrentNames(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const res = await fetch(CURRENT_NAMES_URL);
    if (!res.ok) return out;
    const rows = (await res.text()).trim().split("\n").slice(1);
    for (const row of rows) {
      const cols = row.match(/("[^"]*"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, "").trim());
      if (cols && cols.length >= 2) out.set(cols[0].toUpperCase(), cols[1]);
    }
  } catch {
    /* names are cosmetic; the backtest runs without them */
  }
  return out;
}

// ---------- point-in-time StockInput ----------

const num = (v: number | null | undefined): number | null =>
  v !== null && v !== undefined && Number.isFinite(v) ? v : null;

/**
 * Assemble the exact StockInput the live scoring engine expects, from a price
 * window ending at the rebalance and the fundamentals known on that date.
 * Returns null when we cannot value the name (no shares / no revenue / no
 * balance sheet), in which case it simply sits out that quarter.
 */
function buildInput(
  ticker: string,
  name: string,
  closes: number[],
  spxCloses: number[],
  price: number,
  fy0: AnnualRecord,
  fy1: AnnualRecord | null,
): StockInput | null {
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

  const fcf = cfo !== null ? cfo - capex : null;
  const ebitda = ebit !== null && da !== null ? ebit + da : null;

  // Valuation ratios. Units cancel in the percentile ranking, so the market cap
  // being in dollars while some statement items differ is harmless — every
  // stock uses the same convention.
  const pe = ni !== null && ni !== 0 ? mve / ni : null;
  const pb = equity !== null && equity > 0 ? mve / equity : null;
  const ps = revenue > 0 ? mve / revenue : null;
  const pfcf = fcf !== null && fcf !== 0 ? mve / fcf : null;
  const evToEbitda =
    ebitda !== null && ebitda > 0 && debt !== null ? (mve + debt - cash) / ebitda : null;

  const roe = equity !== null && equity > 0 && ni !== null ? (ni / equity) * 100 : null;
  const roic =
    ebit !== null && equity !== null && debt !== null && equity + debt > 0
      ? (ebit / (equity + debt)) * 100 // pre-tax ROIC proxy
      : null;
  const netMargin = revenue > 0 && ni !== null ? (ni / revenue) * 100 : null;
  const grossMargin = revenue > 0 && cogs !== null ? ((revenue - cogs) / revenue) * 100 : null;
  const operatingMargin = revenue > 0 && ebit !== null ? (ebit / revenue) * 100 : null;
  const grossProfitToAssets = cogs !== null ? ((revenue - cogs) / assets) * 100 : null;
  const debtToEquity = debt !== null && equity !== null && equity > 0 ? debt / equity : null;
  const accrualRatio = ni !== null && cfo !== null ? (ni - cfo) / assets : null;
  const currentRatio = ca !== null && cl !== null && cl > 0 ? ca / cl : null;
  const debtToEbitda = debt !== null && ebitda !== null && ebitda > 0 ? debt / ebitda : null;

  // Growth (year over year), point-in-time
  const rev1 = fy1 ? num(fy1.revenue) : null;
  const ni1 = fy1 ? num(fy1.netIncome) : null;
  const sh1 = fy1 ? num(fy1.shares) : null;
  const revenueGrowth = rev1 !== null && rev1 > 0 ? (revenue / rev1 - 1) * 100 : null;
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

  // Piotroski F (scaled to /9 when >=7 criteria computable)
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
    sector: "",
    price,
    marketCap: marketCapM,
    avgDollarVolume: 1e12, // S&P 500 members are liquid by construction
    closes,
    spxCloses,
    currentRatio,
    interestCoverage: null, // no free historical interest-expense feed
    netMargin,
    grossMargin,
    operatingMargin,
    roe,
    roic,
    debtToEquity,
    pe,
    pb,
    ps,
    pfcf,
    evToEbitda,
    revenueGrowth,
    epsGrowth,
    revenuePerShare: revenue / shares,
    latestSurprisePct: null, // no free historical surprise feed
    altmanZ,
    piotroskiF,
    accrualRatio,
    fcfGrowth,
    grossProfitToAssets,
    debtToEbitda,
    insiderBought: null, // no free historical insider feed
    insiderSold: null,
  };
}

async function main() {
  console.log("Fetching 10y benchmark + point-in-time S&P 500 membership...");
  const spx = await sp500History(1_000_000, "10y");
  if (!spx || spx.length < WARMUP_DAYS + REBALANCE_DAYS) {
    throw new Error("insufficient benchmark history");
  }
  const dates = spx.map((c) => c.t);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const spxClose = spx.map((c) => c.c);
  const n = dates.length;

  // Universe = every company that was an index member at any point in the test
  // window, INCLUDING ones later delisted. That is the survivorship fix.
  const membership = await loadMembership();
  const tickers = everMembers(membership, dates[0]);
  const nameOf = await fetchCurrentNames();
  const currentMembers = membersAsOf(membership, dates[n - 1]);
  const goneCount = tickers.filter((t) => !currentMembers.has(t)).length;
  console.log(
    `Universe: ${tickers.length} historical members, of which ${goneCount} are no longer in the index.`,
  );

  // ---- 10y price history for every ticker, aligned to the benchmark calendar
  console.log(`Fetching 10y price history for ${tickers.length} tickers...`);
  writeStatus({ phase: "fetching 10y price history", total: tickers.length, done: 0 });
  const aligned = new Map<string, number[]>();
  /** Index of the last REAL trade for each ticker; past this it is delisted. */
  const lastRealIdx = new Map<string, number>();
  const CONCURRENCY = 3;
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((t) => dailyHistory(t, 1_000_000, "10y")));
    results.forEach((candles, j) => {
      if (!candles || candles.length < 300) return;
      const series = new Array<number>(n).fill(NaN);
      let lastReal = -1;
      for (const c of candles) {
        const idx = dateIndex.get(c.t);
        if (idx !== undefined) {
          series[idx] = c.c;
          if (idx > lastReal) lastReal = idx;
        }
      }
      if (lastReal < 0) return;
      // Carry the last price across market holidays and thin days. Anything
      // after lastReal is padding, never treated as tradeable.
      let last = NaN;
      for (let k = 0; k < n; k++) {
        if (Number.isFinite(series[k])) last = series[k];
        else if (Number.isFinite(last)) series[k] = last;
      }
      aligned.set(chunk[j], series);
      lastRealIdx.set(chunk[j], lastReal);
    });
    writeStatus({ done: Math.min(i + CONCURRENCY, tickers.length) });
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`Usable price history for ${aligned.size} tickers.`);

  // ---- SEC EDGAR fundamentals history (cached to disk between runs)
  // Delisted companies are absent from SEC's ticker index, so their CIKs come
  // from the name-based resolver. Without it they cannot be scored at all, and
  // the survivorship fix would be cosmetic.
  console.log("Fetching SEC EDGAR fundamentals history...");
  writeStatus({ phase: "fetching SEC filings", total: tickers.length, done: 0 });
  const resolver = await buildDelistedResolver();
  const cache = loadHistoryCache();
  const histories = new Map<string, AnnualRecord[]>();
  let edgarDone = 0;
  let viaResolver = 0;
  for (const t of tickers) {
    if (!aligned.has(t)) {
      edgarDone++;
      continue; // no prices -> can't use it anyway
    }
    let recs = cache[t];
    if (!recs) {
      const override = currentMembers.has(t) ? null : resolver.resolve(t);
      if (override) viaResolver++;
      recs = await edgarHistory(t, override);
      cache[t] = recs;
    }
    if (recs.length > 0) histories.set(t, recs);
    edgarDone++;
    if (edgarDone % 10 === 0) {
      writeStatus({ done: edgarDone });
      // Checkpoint: this phase runs for ~30 minutes over ~700 filings. Saving
      // only at the end means any interruption throws all of it away.
      saveHistoryCache(cache);
    }
  }
  saveHistoryCache(cache);
  resolver.persist();
  console.log(
    `Usable fundamentals history for ${histories.size} tickers ` +
      `(${viaResolver} delisted names resolved by name lookup).`,
  );

  // ---- simulate
  console.log("Simulating full model...");
  writeStatus({ phase: "simulating", total: n - WARMUP_DAYS, done: 0 });

  let strat = 1;
  let bench = 1;
  const curve: { t: string; strat: number; bench: number }[] = [];
  const periods: {
    start: string;
    end: string;
    holdings: string[];
    stratRet: number;
    benchRet: number;
  }[] = [];
  let holdings: string[] = [];
  let periodStartIdx = WARMUP_DAYS;
  let periodStartStrat = 1;
  let periodStartBench = 1;
  const dailyRets: number[] = [];

  // rolling average factor profile of the picked portfolio
  const attrib = { quality: 0, value: 0, momentum: 0, growth: 0, count: 0 };

  const closePeriod = (endIdx: number) => {
    if (holdings.length === 0 && periods.length === 0) return;
    periods.push({
      start: dates[periodStartIdx],
      end: dates[endIdx],
      holdings,
      stratRet: strat / periodStartStrat - 1,
      benchRet: bench / periodStartBench - 1,
    });
  };

  for (let i = WARMUP_DAYS; i < n; i++) {
    if ((i - WARMUP_DAYS) % REBALANCE_DAYS === 0) {
      if (i > WARMUP_DAYS) closePeriod(i);
      const date = dates[i];
      const spxWindow = spxClose.slice(0, i + 1);

      // Only companies actually in the index on this date are investable.
      const eligible = membersAsOf(membership, date);

      // Build point-in-time inputs for every name with prices + filed fundamentals
      const inputs: StockInput[] = [];
      for (const [ticker, series] of aligned) {
        if (!eligible.has(ticker)) continue;
        // Past its final trade the series is padding, so the name is untradeable.
        if ((lastRealIdx.get(ticker) ?? -1) < i) continue;
        if (!Number.isFinite(series[i]) || !Number.isFinite(series[i - WARMUP_DAYS + 1])) continue;
        const recs = histories.get(ticker);
        if (!recs) continue;
        const pit = asOf(recs, date);
        if (!pit) continue;
        const input = buildInput(
          ticker,
          nameOf.get(ticker) ?? ticker,
          series.slice(0, i + 1),
          spxWindow,
          series[i],
          pit.fy0,
          pit.fy1,
        );
        if (input) inputs.push(input);
      }

      // Live pipeline: Stage-1 filters -> EDGAR filters -> factor scores -> penalties
      const survivors1 = inputs.filter((s) => stage1Filter(s).passed);
      const survivors = survivors1.filter((s) => edgarFilter(s).passed);
      if (survivors.length >= TOP_N) {
        const scores = computeFactorScores(survivors);
        const ranked = survivors
          .map((s, k) => ({
            ticker: s.ticker,
            scores: scores[k],
            final: finalScore(scores[k], computePenalties(s)),
          }))
          .sort((a, b) => b.final - a.final);
        holdings = ranked.slice(0, TOP_N).map((x) => x.ticker);
        for (const h of ranked.slice(0, TOP_N)) {
          attrib.quality += h.scores.quality;
          attrib.value += h.scores.value;
          attrib.momentum += h.scores.momentum;
          attrib.growth += h.scores.growth;
          attrib.count++;
        }
      }
      // if too few survivors this quarter, keep prior holdings

      periodStartIdx = i;
      periodStartStrat = strat;
      periodStartBench = bench;
      writeStatus({ done: i - WARMUP_DAYS });
    }

    if (i === WARMUP_DAYS) {
      curve.push({ t: dates[i], strat: 1, bench: 1 });
      continue;
    }

    let dayRet = 0;
    if (holdings.length > 0) {
      let sum = 0;
      let count = 0;
      for (const t of holdings) {
        const s = aligned.get(t);
        if (!s) continue;
        // A holding that stops trading is liquidated at its last real price;
        // it contributes no return afterwards. Without this, the forward-filled
        // series makes a failed company look like it simply went flat.
        if ((lastRealIdx.get(t) ?? -1) < i) continue;
        const a = s[i - 1];
        const b = s[i];
        if (Number.isFinite(a) && Number.isFinite(b) && a > 0) {
          sum += b / a - 1;
          count++;
        }
      }
      dayRet = count > 0 ? sum / count : 0;
    }
    const benchRet = spxClose[i] / spxClose[i - 1] - 1;
    strat *= 1 + dayRet;
    bench *= 1 + benchRet;
    dailyRets.push(dayRet);
    curve.push({
      t: dates[i],
      strat: Math.round(strat * 10000) / 10000,
      bench: Math.round(bench * 10000) / 10000,
    });
  }
  closePeriod(n - 1);

  // ---- stats
  const years = (n - WARMUP_DAYS) / 252;
  const cagr = Math.pow(strat, 1 / years) - 1;
  const benchCagr = Math.pow(bench, 1 / years) - 1;
  const mean = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
  const vol =
    Math.sqrt(dailyRets.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyRets.length) *
    Math.sqrt(252);
  const sharpe = vol > 0 ? (mean * 252) / vol : 0;
  let peak = 1;
  let maxDD = 0;
  let benchPeak = 1;
  let benchMaxDD = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.strat);
    maxDD = Math.min(maxDD, p.strat / peak - 1);
    benchPeak = Math.max(benchPeak, p.bench);
    benchMaxDD = Math.min(benchMaxDD, p.bench / benchPeak - 1);
  }
  const beatCount = periods.filter((p) => p.stratRet > p.benchRet).length;
  const r1 = (v: number) => Math.round(v * 10) / 10;

  const result = {
    generatedAt: new Date().toISOString(),
    model: "full",
    strategy:
      "Full four-factor model (Quality 30 / Value 25 / Momentum 25 / Growth 20) with Stage-1 elimination filters and penalties — the exact live engine, top 20 equal-weight, quarterly rebalance",
    universe:
      `Point-in-time S&P 500 membership: ${tickers.length} companies that were index ` +
      `members at any time in the window, of which ${goneCount} have since left. ` +
      `${histories.size} had both 10y prices and SEC filings and could be scored.`,
    dataSources:
      "EODHD (prices, incl. delisted tickers) + SEC EDGAR companyfacts (fundamentals, point-in-time) + fja05680/sp500 (historical index membership)",
    caveats: [
      "Runs the identical scoring engine as the live site — no separate backtest logic",
      "Fundamentals read point-in-time: only filings public on each rebalance date are used (no lookahead)",
      "Only companies actually in the index on each rebalance date are investable, and delisted companies are included, so neither survivorship nor index-addition lookahead inflates these numbers",
      "A holding that stops trading is liquidated at its last quoted price. For a company that collapsed before delisting, most of the loss is captured; residual recovery value is not modelled",
      "Price returns only (no dividends, either side); no transaction costs or slippage",
      "Three live inputs have no free history and are off here: insider-selling penalty, earnings-surprise penalty, forward-EPS growth (weight renormalizes, as the live model already does)",
      "Past performance does not predict future results",
    ],
    stats: {
      years: r1(years),
      totalReturn: r1((strat - 1) * 100),
      benchTotalReturn: r1((bench - 1) * 100),
      cagr: r1(cagr * 100),
      benchCagr: r1(benchCagr * 100),
      maxDrawdown: r1(maxDD * 100),
      benchMaxDrawdown: r1(benchMaxDD * 100),
      annVol: r1(vol * 100),
      sharpe: Math.round(sharpe * 100) / 100,
      quartersTotal: periods.length,
      quartersBeatingIndex: beatCount,
    },
    factorProfile: attrib.count
      ? {
          quality: r1(attrib.quality / attrib.count),
          value: r1(attrib.value / attrib.count),
          momentum: r1(attrib.momentum / attrib.count),
          growth: r1(attrib.growth / attrib.count),
        }
      : null,
    curve,
    periods: periods.slice(-8).reverse(),
    currentHoldings: holdings,
  };

  fs.writeFileSync(path.join(DATA_DIR, "backtest.json"), JSON.stringify(result, null, 2));
  console.log(
    `\nBacktest done: strategy ${result.stats.totalReturn}% vs S&P 500 ${result.stats.benchTotalReturn}% over ${result.stats.years}y`,
  );
  console.log(
    `CAGR ${result.stats.cagr}% vs ${result.stats.benchCagr}% | MaxDD ${result.stats.maxDrawdown}% vs ${result.stats.benchMaxDrawdown}% | Sharpe ${result.stats.sharpe}`,
  );
}

main()
  .then(() => writeStatus({ state: "done", phase: "complete", finishedAt: new Date().toISOString() }))
  .catch((err) => {
    console.error(err);
    writeStatus({
      state: "error",
      error: (err as Error).message,
      finishedAt: new Date().toISOString(),
    });
    process.exit(1);
  });

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
import { dailyHistory } from "../src/lib/prices";
import {
  asOf,
  cikForTicker,
  edgarHistory,
  loadHistoryCache,
  saveHistoryCache,
  type AnnualRecord,
} from "../src/lib/edgar-history";
import { everMembers, loadMembership, membersAsOf } from "../src/lib/constituents";
import { buildDelistedResolver } from "../src/lib/delisted-cik";
import { SectorLookup } from "../src/lib/sectors";
import { buildStockInput } from "../src/lib/fundamentals";
import {
  computeFactorScores,
  computePenalties,
  edgarFilter,
  finalScore,
  stage1FilterUniverse,
  DEFAULT_WEIGHTS,
  type FactorWeights,
  type FilterOptions,
  type StockInput,
} from "../src/lib/scoring";

loadEnv();

const DATA_DIR = path.join(process.cwd(), "data");
const STATUS_PATH = path.join(DATA_DIR, "backtest-status.json");

/**
 * Trading days between rebalances. 63 is ~quarterly, per the spec. Shorter
 * holds ("swing") lean harder on momentum and cost more in turnover, which the
 * cost model charges honestly: 21 is ~monthly, 42 is ~two months.
 */
const REBALANCE_DAYS = Number(argValue("--rebalance")) || 63;

/**
 * Stage-1 rules to relax. Measured cause for each: the current-ratio rule
 * ejects Apple and Amazon, the trend rules eject Microsoft and Meta on any
 * dip, and free-cash-flow rules are meaningless for banks like JP Morgan.
 * Those are the companies that drove the index this period.
 */
const FILTER_OPTS: FilterOptions = {
  currentRatio: !process.argv.includes("--no-current-ratio"),
  trend: !process.argv.includes("--no-trend"),
  exemptFinancials: process.argv.includes("--exempt-financials"),
};
const WARMUP_DAYS = 274; // 252 + 21 + buffer, so every momentum window is defined
const TOP_N = Number(argValue("--top")) || 20;
/**
 * A held name is only sold once it falls past this rank, not the moment it
 * leaves the top N. Without the buffer a stock oscillating around rank 20 is
 * bought and sold every quarter, which is why turnover ran at 48% and cost
 * drag at 0.4%/yr. Standard practice in factor portfolios.
 */
const EXIT_RANK = Number(argValue("--exit-rank")) || TOP_N;
/** Max holdings from any one sector. 0 disables the cap. */
const MAX_PER_SECTOR = Number(argValue("--max-sector")) || 0;
/**
 * Sectors are always needed now: Stage 1's gross-margin rule is measured
 * against the sector median, so a run without them would silently skip a
 * filter the live scan applies. Resolution is one cached SEC lookup per
 * company, so this costs nothing after the first run.
 */
const NEEDS_SECTORS = true;

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
/**
 * How far back to test. Capped by SEC XBRL, not by price history: company
 * facts begin around 2009, and only ~550 of the 668 scoreable companies have
 * filings by 2012. Reaching further back would rank a handful of names against
 * each other and call it a strategy.
 */
const WINDOW = "15y";
/**
 * One-way trading cost as a fraction of trade value: commission plus half the
 * bid/ask spread plus slippage. 10bp is a fair retail estimate for liquid US
 * large caps. Every replaced holding costs this twice, once to sell and once
 * to buy, on 1/TOP_N of the portfolio.
 */
const COST_ONE_WAY = 0.001;

/**
 * Market-timing overlay: sit in cash whenever the index itself is below its
 * own 200-day average at a rebalance.
 *
 * A genuinely different strategy family from factor selection — this is Faber's
 * trend rule. It cannot pick better stocks; it tries to avoid being invested
 * during drawdowns at all. Cash earns nothing here, which is conservative.
 */
const CASH_WHEN_BEAR = process.argv.includes("--cash-when-bear");

/**
 * Where to write the result.
 *
 * Sweeps used to let every run write data/backtest.json and then copy it out,
 * which meant the published result silently became whatever ran last. A 2x
 * leveraged run reached the file that way, and the homepage reads it for the
 * performance claim. Experiments must name their own --out; only an unflagged
 * run may touch the canonical file.
 */
const OUT_PATH = argValue("--out");

/**
 * Fold in the incremental signals: incremental ROIC and growth acceleration
 * inside the factors, dilution and growth-trap as penalties.
 *
 * Off by default so an unflagged run is the untouched control. Nothing about
 * the harness changes between the two, only which metric specs are selected,
 * which is the only way the difference measures the signals rather than the
 * experiment.
 */
const NEW_SIGNALS = process.argv.includes("--new-signals");
/**
 * The spec's accounting-red-flags penalty is on by default, since it is part
 * of the model. This turns it off so a run can measure what it is worth,
 * rather than the penalty being adopted on the strength of its rationale.
 */
const RED_FLAGS = !process.argv.includes("--no-red-flags");

/**
 * Leverage on the whole portfolio, with a borrowing cost on the margin.
 *
 * This is the arithmetically honest answer to "I want double the index":
 * you do not need better stock selection, you need 2x exposure. What it costs
 * is symmetric — a 43% drawdown becomes 86%, which is a wiped-out account, not
 * a bad year. Included so that trade-off is measured rather than imagined.
 */
const LEVERAGE = Number(argValue("--leverage")) || 1;
/** Annual margin rate charged on the borrowed portion. */
const BORROW_RATE = 0.05;

/**
 * Factor tilt under test, as "quality,value,momentum,growth".
 *
 * The spec's weights are one hypothesis, not a law. The value and quality tilt
 * they encode was punished hard across this sample, so testing alternatives is
 * legitimate research — provided the set is decided up front and every result
 * is reported, not just the winner.
 */
function parseWeights(): FactorWeights {
  const raw = argValue("--weights");
  if (!raw) return DEFAULT_WEIGHTS;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error('--weights needs four non-negative numbers: "quality,value,momentum,growth"');
  }
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error("--weights must not sum to zero");
  // Normalize so any set of four numbers is a valid tilt.
  return {
    quality: parts[0] / sum,
    value: parts[1] / sum,
    momentum: parts[2] / sum,
    growth: parts[3] / sum,
  };
}
const WEIGHTS = parseWeights();

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

async function main() {
  console.log("Fetching 10y benchmark + point-in-time S&P 500 membership...");
  // Benchmark is SPY, not the ^GSPC index. The index is price-only: over this
  // window it returns 481.6% while the same exposure with dividends reinvested
  // returns 664.3%. Since the strategy now compounds dividends, measuring it
  // against a price index would hand it a ~180 point head start.
  const spx = await dailyHistory("SPY", 1_000_000, WINDOW);
  if (!spx || spx.length < WARMUP_DAYS + REBALANCE_DAYS) {
    throw new Error("insufficient benchmark history");
  }
  const dates = spx.map((c) => c.t);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const spxClose = spx.map((c) => c.a ?? c.c);
  const n = dates.length;

  // Universe = every company that was an index member at any point in the test
  // window, INCLUDING ones later delisted. That is the survivorship fix.
  //
  // --wide swaps the S&P 500 for the point-in-time liquid universe built by
  // `npm run universe-pit`, which is what the live site actually ranks. There
  // membership is not a gate; the model's own size and liquidity filters are.
  const membership = await loadMembership();
  const wide = process.argv.includes("--wide");
  const pitPath = path.join(DATA_DIR, "universe-pit.json");
  let tickers: string[];
  if (wide) {
    if (!fs.existsSync(pitPath)) {
      throw new Error("data/universe-pit.json missing — run `npm run universe-pit` first");
    }
    tickers = (JSON.parse(fs.readFileSync(pitPath, "utf8")) as { tickers: string[] }).tickers;
    console.log(`Wide universe: ${tickers.length} liquid US common stocks, delisted included.`);
  } else {
    tickers = everMembers(membership, dates[0]);
  }
  const nameOf = await fetchCurrentNames();
  const currentMembers = membersAsOf(membership, dates[n - 1]);
  const goneCount = tickers.filter((t) => !currentMembers.has(t)).length;
  if (!wide) {
    console.log(
      `Universe: ${tickers.length} historical members, of which ${goneCount} are no longer in the index.`,
    );
  }

  // ---- 10y price history for every ticker, aligned to the benchmark calendar
  console.log(`Fetching 10y price history for ${tickers.length} tickers...`);
  writeStatus({ phase: "fetching 10y price history", total: tickers.length, done: 0 });
  /** Total-return series: drives returns, momentum and the moving averages. */
  const aligned = new Map<string, number[]>();
  /** As-traded series: drives market cap and every valuation ratio. */
  const alignedRaw = new Map<string, number[]>();
  /** Daily dollar volume, for the liquidity filter on a wide universe. */
  const alignedDollarVol = new Map<string, number[]>();
  /** Index of the last REAL trade for each ticker; past this it is delisted. */
  const lastRealIdx = new Map<string, number>();
  const CONCURRENCY = 3;
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((t) => dailyHistory(t, 1_000_000, WINDOW)));
    results.forEach((candles, j) => {
      if (!candles || candles.length < 300) return;
      const series = new Array<number>(n).fill(NaN);
      const raw = new Array<number>(n).fill(NaN);
      const dollarVol = new Array<number>(n).fill(NaN);
      let lastReal = -1;
      for (const c of candles) {
        const idx = dateIndex.get(c.t);
        if (idx !== undefined) {
          series[idx] = c.a ?? c.c;
          raw[idx] = c.c;
          if (c.v !== undefined) dollarVol[idx] = c.v * c.c;
          if (idx > lastReal) lastReal = idx;
        }
      }
      if (lastReal < 0) return;
      // Carry the last price across market holidays and thin days. Anything
      // after lastReal is padding, never treated as tradeable.
      let last = NaN;
      let lastRaw = NaN;
      for (let k = 0; k < n; k++) {
        if (Number.isFinite(series[k])) last = series[k];
        else if (Number.isFinite(last)) series[k] = last;
        if (Number.isFinite(raw[k])) lastRaw = raw[k];
        else if (Number.isFinite(lastRaw)) raw[k] = lastRaw;
      }
      aligned.set(chunk[j], series);
      alignedRaw.set(chunk[j], raw);
      alignedDollarVol.set(chunk[j], dollarVol);
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
  let missing = 0;
  for (const t of tickers) {
    if (!aligned.has(t)) {
      edgarDone++;
      continue; // no prices -> can't use it anyway
    }
    // An empty array is a cached MISS, not a cached hit. Treating it as a hit
    // made one rate-limited run poison the cache permanently: every retry
    // short-circuited on the empty result and the universe never recovered.
    let recs = cache[t];
    if (!recs || recs.length === 0) {
      const override = resolver.resolve(t);
      if (override) viaResolver++;
      recs = await edgarHistory(t, override);
      if (recs.length > 0) cache[t] = recs;
      else missing++;
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

  // Sectors, only when the cap is in use. One cached SEC call per company.
  const sectorByTicker = new Map<string, string>();
  if (NEEDS_SECTORS) {
    console.log("Resolving sectors from SEC SIC codes...");
    writeStatus({ phase: "sectors", total: histories.size, done: 0 });
    const sectors = new SectorLookup();
    let done = 0;
    for (const t of histories.keys()) {
      const cik = (await cikForTicker(t)) ?? resolver.resolve(t);
      sectorByTicker.set(t, await sectors.get(t, cik));
      if (++done % 25 === 0) {
        writeStatus({ done });
        sectors.save();
      }
    }
    sectors.save();
    const unknown = [...sectorByTicker.values()].filter((s) => s === "Unknown").length;
    console.log(`  sectors for ${sectorByTicker.size - unknown}/${sectorByTicker.size} companies.`);
  }
  const priced = aligned.size;
  const coverage = priced > 0 ? (histories.size / priced) * 100 : 0;
  console.log(
    `Usable fundamentals history for ${histories.size}/${priced} priced tickers ` +
      `(${coverage.toFixed(0)}% coverage, ${viaResolver} resolved by name lookup, ${missing} without filings).`,
  );
  // Below this, the "universe" is whatever happened to resolve, and the result
  // describes a sample nobody chose. A rate-limited SEC produced exactly that.
  if (coverage < 40) {
    throw new Error(
      `Fundamentals coverage is only ${coverage.toFixed(0)}% of priced tickers. ` +
        `Refusing to publish a backtest over a universe this incomplete — ` +
        `SEC was probably rate limiting. Wait and re-run.`,
    );
  }

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
  /** Portfolio weights, reset at each rebalance and drifting in between. */
  let weights: number[] = [];
  let periodStartIdx = WARMUP_DAYS;
  let periodStartStrat = 1;
  let periodStartBench = 1;
  const dailyRets: number[] = [];

  // rolling average factor profile of the picked portfolio
  const attrib = { quality: 0, value: 0, momentum: 0, growth: 0, count: 0 };
  let totalCostDrag = 0;
  let turnoverSum = 0;
  let turnoverCount = 0;
  const rebalanceStats = { candidates: 0, afterStage1: 0, survivors: 0, count: 0 };

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

      // Trend overlay: if the index is below its own 200-day average, hold
      // nothing until the next rebalance.
      if (CASH_WHEN_BEAR) {
        const w = spxClose.slice(Math.max(0, i - 199), i + 1);
        const ma200 = w.length >= 200 ? w.reduce((a, b) => a + b, 0) / w.length : null;
        if (ma200 !== null && spxClose[i] < ma200) {
          holdings = [];
          weights = [];
          periodStartIdx = i;
          periodStartStrat = strat;
          periodStartBench = bench;
          writeStatus({ done: i - WARMUP_DAYS });
          continue;
        }
      }

      // Only companies actually in the index on this date are investable.
      const eligible = membersAsOf(membership, date);

      // Build point-in-time inputs for every name with prices + filed fundamentals
      const inputs: StockInput[] = [];
      for (const [ticker, series] of aligned) {
        // Index membership gates the S&P run. On the wide universe the model's
        // own size and liquidity filters do that job instead.
        if (!wide && !eligible.has(ticker)) continue;
        // Past its final trade the series is padding, so the name is untradeable.
        if ((lastRealIdx.get(ticker) ?? -1) < i) continue;
        if (!Number.isFinite(series[i]) || !Number.isFinite(series[i - WARMUP_DAYS + 1])) continue;
        const recs = histories.get(ticker);
        if (!recs) continue;
        const pit = asOf(recs, date);
        if (!pit) continue;
        // Signals use the total-return series; valuation uses the as-traded
        // price, since market cap is price times shares actually outstanding.
        const tradedPrice = alignedRaw.get(ticker)?.[i];
        if (!Number.isFinite(tradedPrice)) continue;
        // 10-day average dollar volume ending at this rebalance, matching the
        // live scan's liquidity input.
        const volSeries = alignedDollarVol.get(ticker);
        let avgDollarVolume = 1e12; // S&P members are liquid by construction
        if (wide && volSeries) {
          let sum = 0;
          let cnt = 0;
          for (let k = Math.max(0, i - 9); k <= i; k++) {
            if (Number.isFinite(volSeries[k])) {
              sum += volSeries[k];
              cnt++;
            }
          }
          avgDollarVolume = cnt > 0 ? sum / cnt : 0;
        }
        const input = buildStockInput({
          ticker,
          name: nameOf.get(ticker) ?? ticker,
          sector: sectorByTicker.get(ticker) ?? "", // needed for the financials exemption
          closes: series.slice(0, i + 1),
          spxCloses: spxWindow,
          price: tradedPrice as number,
          fy0: pit.fy0,
          fy1: pit.fy1,
          fy2: pit.fy2,
          avgDollarVolume,
        });
        if (input) inputs.push(input);
      }

      // Live pipeline: Stage-1 filters -> EDGAR filters -> factor scores -> penalties
      const stage1 = stage1FilterUniverse(inputs, FILTER_OPTS);
      const survivors1 = inputs.filter((_, i) => stage1[i].passed);
      const survivors = survivors1.filter((s) => edgarFilter(s).passed);
      // Work actually done per rebalance. If these collapse, the run is
      // ranking a handful of names and finishing fast for the wrong reason.
      rebalanceStats.candidates += inputs.length;
      rebalanceStats.afterStage1 += survivors1.length;
      rebalanceStats.survivors += survivors.length;
      rebalanceStats.count++;
      if (rebalanceStats.count <= 3 || rebalanceStats.count % 20 === 0) {
        console.log(
          `  ${date}: ${inputs.length} scored -> ${survivors1.length} past stage 1 -> ${survivors.length} investable`,
        );
      }
      if (survivors.length >= TOP_N) {
        const scores = computeFactorScores(survivors, { newSignals: NEW_SIGNALS });
        const ranked = survivors
          .map((s, k) => ({
            ticker: s.ticker,
            scores: scores[k],
            final: finalScore(scores[k], computePenalties(s, { newSignals: NEW_SIGNALS, redFlags: RED_FLAGS }), WEIGHTS),
          }))
          .sort((a, b) => b.final - a.final);
        // Selection: keep what still ranks inside the exit buffer, then fill
        // the rest from the top, honouring the per-sector cap.
        const rankOf = new Map(ranked.map((r, idx) => [r.ticker, idx + 1]));
        const sectorCount = new Map<string, number>();
        const sectorOf = (t: string) => sectorByTicker.get(t) ?? "Unknown";
        const fits = (t: string) => {
          if (MAX_PER_SECTOR <= 0) return true;
          const s = sectorOf(t);
          if (s === "Unknown") return true; // never penalise missing data
          return (sectorCount.get(s) ?? 0) < MAX_PER_SECTOR;
        };
        const take = (t: string) => {
          const s = sectorOf(t);
          sectorCount.set(s, (sectorCount.get(s) ?? 0) + 1);
        };

        const next: string[] = [];
        for (const t of holdings) {
          const r = rankOf.get(t);
          if (r !== undefined && r <= EXIT_RANK && next.length < TOP_N && fits(t)) {
            next.push(t);
            take(t);
          }
        }
        for (const r of ranked) {
          if (next.length >= TOP_N) break;
          if (next.includes(r.ticker)) continue;
          if (!fits(r.ticker)) continue;
          next.push(r.ticker);
          take(r.ticker);
        }
        // Charge for the names actually swapped: each costs a sell and a buy
        // on one position's worth of the portfolio.
        const held = new Set(holdings);
        const changed = next.filter((t) => !held.has(t)).length;
        const turnover = holdings.length === 0 ? next.length / TOP_N : changed / TOP_N;
        const cost = holdings.length === 0
          ? turnover * COST_ONE_WAY // initial build: buys only
          : turnover * COST_ONE_WAY * 2;
        strat *= 1 - cost;
        totalCostDrag += cost;
        turnoverSum += turnover;
        turnoverCount++;
        holdings = next;
        // Fresh equal weights at each rebalance; they drift until the next one.
        weights = new Array(holdings.length).fill(1 / Math.max(1, holdings.length));
        const chosen = new Set(next);
        for (const h of ranked.filter((r) => chosen.has(r.ticker))) {
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
      // Positions DRIFT between rebalances.
      //
      // Averaging daily returns equally, as this did, silently assumes the
      // portfolio is rebalanced back to equal weight every single day. That is
      // not a strategy anyone runs, it pays none of the turnover it would cost,
      // and on volatile names it manufactures return out of daily noise. A
      // holding that doubles should become a bigger share of the portfolio
      // until the next rebalance, which is what actually happens when you own
      // shares.
      let weighted = 0;
      let live = 0;
      for (let k = 0; k < holdings.length; k++) {
        const t = holdings[k];
        const s = aligned.get(t);
        if (!s || (lastRealIdx.get(t) ?? -1) < i) {
          weights[k] = 0; // stopped trading: liquidated at its last real price
          continue;
        }
        const a = s[i - 1];
        const b = s[i];
        if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;
        const r = b / a - 1;
        weighted += weights[k] * r;
        live += weights[k];
      }
      // Cash from dead positions earns nothing rather than being redeployed
      // for free, so scale by the share still invested.
      dayRet = live > 0 ? weighted : 0;

      // Carry weights forward by their own growth.
      let tot = 0;
      for (let k = 0; k < holdings.length; k++) {
        const t = holdings[k];
        const s = aligned.get(t);
        if (weights[k] === 0 || !s || (lastRealIdx.get(t) ?? -1) < i) continue;
        const a = s[i - 1];
        const b = s[i];
        if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;
        weights[k] *= b / a;
        tot += weights[k];
      }
      if (tot > 0) for (let k = 0; k < weights.length; k++) weights[k] /= tot;
    }
    const benchRet = spxClose[i] / spxClose[i - 1] - 1;
    // Leverage scales the day's return and charges interest on the borrowed part.
    const levered =
      LEVERAGE === 1
        ? dayRet
        : dayRet * LEVERAGE - ((LEVERAGE - 1) * BORROW_RATE) / 252;
    strat *= 1 + levered;
    bench *= 1 + benchRet;
    dailyRets.push(LEVERAGE === 1 ? dayRet : dayRet * LEVERAGE - ((LEVERAGE - 1) * BORROW_RATE) / 252);
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

  // Split the run in half. An edge present in both halves is a finding; one
  // that lives in a single half is a regime the sample happened to contain.
  const mid = Math.floor(curve.length / 2);
  const halfStats = (from: number, to: number) => {
    const a = curve[from];
    const b = curve[to];
    const yrs = (to - from) / 252;
    const sRet = b.strat / a.strat;
    const bRet = b.bench / a.bench;
    return {
      start: a.t,
      end: b.t,
      cagr: r1((Math.pow(sRet, 1 / yrs) - 1) * 100),
      benchCagr: r1((Math.pow(bRet, 1 / yrs) - 1) * 100),
      excess: r1(((Math.pow(sRet, 1 / yrs) - 1) - (Math.pow(bRet, 1 / yrs) - 1)) * 100),
    };
  };
  const subPeriods = curve.length > 504
    ? [halfStats(0, mid), halfStats(mid, curve.length - 1)]
    : [];

/**
 * Rolling returns over every possible start date, not just the one full run.
 *
 * A single headline CAGR hides how much of the result was the start date. The
 * quarterly model reads 14.3% vs 14.8%, which looks like a near-miss, but held
 * over any ten-year window inside this period it lost every single time. That
 * is the number a buyer needs, so it is computed here rather than asserted.
 */
  const rollingWindows = [1, 3, 5, 10]
    .map((yearsHeld) => {
      const win = Math.round(yearsHeld * 252);
      if (curve.length <= win) return null;
      const strat: number[] = [];
      const bench: number[] = [];
      let beat = 0;
      for (let i = win; i < curve.length; i++) {
        const s = (Math.pow(curve[i].strat / curve[i - win].strat, 1 / yearsHeld) - 1) * 100;
        const b = (Math.pow(curve[i].bench / curve[i - win].bench, 1 / yearsHeld) - 1) * 100;
        strat.push(s);
        bench.push(b);
        if (s > b) beat++;
      }
      const med = (a: number[]) => {
        const x = [...a].sort((m, n) => m - n);
        return x[Math.floor((x.length - 1) / 2)];
      };
      return {
        years: yearsHeld,
        windows: strat.length,
        stratWorst: r1(Math.min(...strat)),
        stratMedian: r1(med(strat)),
        stratBest: r1(Math.max(...strat)),
        benchWorst: r1(Math.min(...bench)),
        benchMedian: r1(med(bench)),
        benchBest: r1(Math.max(...bench)),
        beatPct: Math.round((beat / strat.length) * 100),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

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
      "EODHD (split- and dividend-adjusted prices, incl. delisted tickers; SPY as the total-return benchmark) + SEC EDGAR companyfacts (fundamentals, point-in-time) + fja05680/sp500 (historical index membership)",
    caveats: [
      "Runs the identical scoring engine as the live site — no separate backtest logic",
      "Fundamentals read point-in-time: only filings public on each rebalance date are used (no lookahead)",
      "Only companies actually in the index on each rebalance date are investable, and delisted companies are included, so neither survivorship nor index-addition lookahead inflates these numbers",
      "A holding that stops trading is liquidated at its last quoted price. For a company that collapsed before delisting, most of the loss is captured; residual recovery value is not modelled",
      "Total return on both sides: the strategy and the benchmark both reinvest dividends. The benchmark is SPY rather than the ^GSPC price index, which would otherwise understate the market by roughly 180 points over this window",
      "Signals and returns use split- and dividend-adjusted prices; valuation ratios use the as-traded price, since market cap is price times shares outstanding",
      `Trading costs ARE charged: ${COST_ONE_WAY * 10000}bp one-way on every position swapped at each rebalance, covering commission, half-spread and slippage. Taxes are not modelled and would matter in a taxable account`,
      "Window is capped by SEC XBRL coverage (company filings start ~2009), not by available price history",
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
      avgTurnoverPct: turnoverCount ? r1((turnoverSum / turnoverCount) * 100) : 0,
      costDragTotalPct: r1(totalCostDrag * 100),
      costDragAnnualPct: r1((totalCostDrag / years) * 100),
      oneWayCostBps: COST_ONE_WAY * 10000,
      topN: TOP_N,
      exitRank: EXIT_RANK,
      redFlags: RED_FLAGS,
      maxPerSector: MAX_PER_SECTOR,
      rebalanceDays: REBALANCE_DAYS,
      cashWhenBear: CASH_WHEN_BEAR,
      leverage: LEVERAGE,
      filters: {
        currentRatio: FILTER_OPTS.currentRatio,
        trend: FILTER_OPTS.trend,
        exemptFinancials: FILTER_OPTS.exemptFinancials,
      },
      weights: {
        quality: Math.round(WEIGHTS.quality * 100),
        value: Math.round(WEIGHTS.value * 100),
        momentum: Math.round(WEIGHTS.momentum * 100),
        growth: Math.round(WEIGHTS.growth * 100),
      },
      avgCandidatesPerRebalance: rebalanceStats.count
        ? Math.round(rebalanceStats.candidates / rebalanceStats.count)
        : 0,
      avgInvestablePerRebalance: rebalanceStats.count
        ? Math.round(rebalanceStats.survivors / rebalanceStats.count)
        : 0,
    },
    subPeriods,
    rollingWindows,
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

  const outPath = OUT_PATH ?? path.join(DATA_DIR, "backtest.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  if (OUT_PATH) console.log(`(experiment: wrote ${outPath}, published backtest untouched)`);
  console.log(
    `\nBacktest done: strategy ${result.stats.totalReturn}% vs S&P 500 ${result.stats.benchTotalReturn}% over ${result.stats.years}y`,
  );
  console.log(
    `CAGR ${result.stats.cagr}% vs ${result.stats.benchCagr}% | MaxDD ${result.stats.maxDrawdown}% vs ${result.stats.benchMaxDrawdown}% | Sharpe ${result.stats.sharpe}`,
  );
  console.log(
    `Work done: ${result.stats.avgCandidatesPerRebalance} companies scored per rebalance, ` +
      `${result.stats.avgInvestablePerRebalance} investable, across ${rebalanceStats.count} rebalances.`,
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

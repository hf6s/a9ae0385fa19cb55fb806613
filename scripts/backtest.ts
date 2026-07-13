/**
 * Factor20 backtest — Momentum composite + trend filter, 10 years.
 *
 * WHAT THIS TESTS (honestly): the price-based half of the model — the
 * Stage-1 trend filter (price > 200MA, 50MA > 200MA) and the Momentum
 * factor (40% 12-1m, 30% 6m, 20% relative strength, 10% distance above
 * 200MA) — as a top-20 equal-weight portfolio rebalanced quarterly,
 * against the S&P 500.
 *
 * WHAT IT CANNOT TEST on free data: the fundamental factors (Quality/
 * Value/Growth) — those need point-in-time historical fundamentals.
 * Known limitations, disclosed in the UI: current S&P 500 membership
 * (survivorship bias), price returns without dividends on both sides,
 * no transaction costs.
 *
 * Usage: npm run backtest        (~3-5 min, Yahoo data only, no API keys)
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/lib/env";
import { dailyHistory, sp500History } from "../src/lib/prices";

loadEnv();

const DATA_DIR = path.join(process.cwd(), "data");
const STATUS_PATH = path.join(DATA_DIR, "backtest-status.json");

const REBALANCE_DAYS = 63; // ~quarterly
const WARMUP_DAYS = 274; // 252 + 21 + buffer
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
  Object.assign(status, patch, { updatedAt: new Date().toISOString() });
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  } catch {
    /* best effort */
  }
}

const CONSTITUENTS_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

async function fetchTickers(): Promise<{ ticker: string; name: string }[]> {
  const res = await fetch(CONSTITUENTS_URL);
  if (!res.ok) throw new Error(`constituents fetch failed: ${res.status}`);
  const rows = (await res.text()).trim().split("\n").slice(1);
  const out: { ticker: string; name: string }[] = [];
  for (const row of rows) {
    const cols = row.match(/("[^"]*"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, "").trim());
    if (cols && cols.length >= 2) out.push({ ticker: cols[0], name: cols[1] });
  }
  return out;
}

function sma(closes: number[], end: number, period: number): number | null {
  if (end + 1 < period) return null;
  let sum = 0;
  for (let i = end - period + 1; i <= end; i++) {
    const v = closes[i];
    if (!Number.isFinite(v)) return null;
    sum += v;
  }
  return sum / period;
}

function ret(closes: number[], end: number, days: number, skip = 0): number | null {
  const e = end - skip;
  const s = e - days;
  if (s < 0) return null;
  const a = closes[s];
  const b = closes[e];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
  return b / a - 1;
}

function percentiles(values: (number | null)[]): (number | null)[] {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null);
  if (present.length < 2) return values.map(() => null);
  const sorted = [...present].sort((a, b) => a.v - b.v);
  const out = new Array<number | null>(values.length).fill(null);
  sorted.forEach((item, idx) => {
    out[item.i] = (idx / (sorted.length - 1)) * 100;
  });
  return out;
}

async function main() {
  console.log("Fetching S&P 500 tickers + 10y benchmark...");
  const tickers = await fetchTickers();
  const spx = await sp500History(1_000_000, "10y");
  if (!spx || spx.length < WARMUP_DAYS + REBALANCE_DAYS) {
    throw new Error("insufficient benchmark history");
  }
  const dates = spx.map((c) => c.t);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const spxClose = spx.map((c) => c.c);
  const n = dates.length;

  // ---- fetch 10y history for every ticker, aligned to the benchmark calendar
  console.log(`Fetching 10y history for ${tickers.length} tickers...`);
  writeStatus({ phase: "fetching 10y price history", total: tickers.length, done: 0 });

  const aligned = new Map<string, number[]>();
  const CONCURRENCY = 3;
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((t) => dailyHistory(t.ticker, 1_000_000, "10y")),
    );
    results.forEach((candles, j) => {
      if (!candles || candles.length < 300) return;
      const series = new Array<number>(n).fill(NaN);
      for (const c of candles) {
        const idx = dateIndex.get(c.t);
        if (idx !== undefined) series[idx] = c.c;
      }
      // forward-fill small gaps so daily returns stay defined
      let last = NaN;
      for (let k = 0; k < n; k++) {
        if (Number.isFinite(series[k])) last = series[k];
        else if (Number.isFinite(last)) series[k] = last;
      }
      aligned.set(chunk[j].ticker, series);
    });
    writeStatus({ done: Math.min(i + CONCURRENCY, tickers.length) });
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`Usable history for ${aligned.size} tickers.`);

  // ---- simulate
  console.log("Simulating...");
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
    // rebalance at the close of every 63rd trading day
    if ((i - WARMUP_DAYS) % REBALANCE_DAYS === 0) {
      if (i > WARMUP_DAYS) closePeriod(i);
      const tickersArr = [...aligned.keys()];
      const eligible = tickersArr.filter((t) => {
        const s = aligned.get(t)!;
        if (!Number.isFinite(s[i]) || !Number.isFinite(s[i - WARMUP_DAYS + 1])) return false;
        const ma200 = sma(s, i, 200);
        const ma50 = sma(s, i, 50);
        return ma200 !== null && ma50 !== null && s[i] > ma200 && ma50 > ma200;
      });
      const m12 = percentiles(eligible.map((t) => ret(aligned.get(t)!, i, 231, 21)));
      const m6 = percentiles(eligible.map((t) => ret(aligned.get(t)!, i, 126)));
      const rs = percentiles(
        eligible.map((t) => {
          const a = ret(aligned.get(t)!, i, 252);
          const b = ret(spxClose, i, 252);
          return a === null || b === null ? null : a - b;
        }),
      );
      const dist = percentiles(
        eligible.map((t) => {
          const s = aligned.get(t)!;
          const ma = sma(s, i, 200);
          return ma === null ? null : s[i] / ma - 1;
        }),
      );
      const scored = eligible
        .map((t, k) => ({
          t,
          score:
            0.4 * (m12[k] ?? 50) + 0.3 * (m6[k] ?? 50) + 0.2 * (rs[k] ?? 50) + 0.1 * (dist[k] ?? 50),
        }))
        .sort((a, b) => b.score - a.score);
      holdings = scored.slice(0, TOP_N).map((x) => x.t);
      periodStartIdx = i;
      periodStartStrat = strat;
      periodStartBench = bench;
      writeStatus({ done: i - WARMUP_DAYS });
    }

    if (i === WARMUP_DAYS) {
      curve.push({ t: dates[i], strat: 1, bench: 1 });
      continue;
    }

    // daily step
    let dayRet = 0;
    if (holdings.length > 0) {
      let sum = 0;
      let count = 0;
      for (const t of holdings) {
        const s = aligned.get(t)!;
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

  const result = {
    generatedAt: new Date().toISOString(),
    strategy:
      "Momentum composite (40% 12-1m / 30% 6m / 20% rel. strength / 10% >200MA) + trend filter, top 20 equal-weight, quarterly rebalance",
    universe: `Current S&P 500 members with 10y Yahoo history (${aligned.size} tickers)`,
    caveats: [
      "Tests only the price-based half of the model — Quality/Value/Growth need point-in-time fundamentals (paid data)",
      "Survivorship bias: uses today's index members across all history",
      "Price returns only (no dividends, either side); no transaction costs or slippage",
      "Past performance does not predict future results",
    ],
    stats: {
      years: Math.round(years * 10) / 10,
      totalReturn: Math.round((strat - 1) * 1000) / 10,
      benchTotalReturn: Math.round((bench - 1) * 1000) / 10,
      cagr: Math.round(cagr * 1000) / 10,
      benchCagr: Math.round(benchCagr * 1000) / 10,
      maxDrawdown: Math.round(maxDD * 1000) / 10,
      benchMaxDrawdown: Math.round(benchMaxDD * 1000) / 10,
      annVol: Math.round(vol * 1000) / 10,
      sharpe: Math.round(sharpe * 100) / 100,
      quartersTotal: periods.length,
      quartersBeatingIndex: beatCount,
    },
    curve,
    periods: periods.slice(-8).reverse(), // most recent 8 quarters for the UI
    currentHoldings: holdings,
  };

  fs.writeFileSync(path.join(DATA_DIR, "backtest.json"), JSON.stringify(result, null, 2));
  console.log(
    `\nBacktest done: strategy ${result.stats.totalReturn}% vs S&P 500 ${result.stats.benchTotalReturn}% over ${result.stats.years}y`,
  );
  console.log(`CAGR ${result.stats.cagr}% vs ${result.stats.benchCagr}% | MaxDD ${result.stats.maxDrawdown}% vs ${result.stats.benchMaxDrawdown}%`);
}

main()
  .then(() => writeStatus({ state: "done", phase: "complete", finishedAt: new Date().toISOString() }))
  .catch((err) => {
    console.error(err);
    writeStatus({ state: "error", error: (err as Error).message, finishedAt: new Date().toISOString() });
    process.exit(1);
  });

/**
 * Out-of-sample test: does a shorter holding period beat a longer one on data
 * the model has never seen?
 *
 * WHY THIS EXISTS. Every result so far comes from one 14-year US sample that
 * has now been examined twenty-odd times. The monthly-rebalance variant won
 * both halves of it, which is the strongest signal we have, and also exactly
 * what a lucky configuration looks like after eight tries. The only way to
 * tell those apart is data that had no hand in finding it.
 *
 * WHAT IT CAN AND CANNOT TEST. EODHD's fundamentals feed is not on this plan
 * (403), so the four-factor model cannot run abroad. Momentum needs only
 * prices, and momentum is precisely the mechanism a monthly rebalance is meant
 * to exploit, so that is what gets tested. A pass here says the mechanism
 * travels. It does not validate the quality, value or growth factors.
 *
 * FAIRNESS. Prices are in local currency, so the benchmark is an equal-weight
 * portfolio of the same eligible universe on the same exchange. Comparing a
 * GBP portfolio against a USD index would measure the pound, not the strategy.
 * Both sides rebalance on the same cadence and drift in between, so only stock
 * SELECTION separates the two lines.
 *
 * TWO BIASES THAT WERE IN THE FIRST VERSION, NOW FIXED. It unioned every name
 * that was ever in the liquid top 400 into a single set and tested all of them
 * from day one. Entering that set is something a company does after it grows,
 * so the union was a list of eventual winners handed to the model in advance.
 * Eligibility is now the most recent quarterly sample on or before each
 * rebalance, applied to the benchmark too. The shared calendar was also taken
 * from the single longest series, which dropped any day that one series was
 * missing for every other name as well; it is now the union of all dates.
 *
 * ONE BIAS THAT REMAINS. Names with under 300 bars are dropped, because
 * momentum needs a 200-day average and they cannot be scored at all. That
 * skips the shortest-lived listings, which skew toward failures. It applies
 * identically to the benchmark, so it should largely cancel in the excess,
 * but the absolute levels on both lines are flattered.
 *
 * Usage: npm run oos -- --exchange LSE --rebalance 21
 */

import { loadEnv } from "../src/lib/env";
import { envValue } from "../src/lib/env-value";
import { computeFactorScores, stage1Filter, type StockInput } from "../src/lib/scoring";

loadEnv();

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const EXCHANGE = argValue("--exchange") ?? "LSE";
const REBALANCE_DAYS = Number(argValue("--rebalance")) || 21;
const TOP_N = Number(argValue("--top")) || 20;
const YEARS = Number(argValue("--years")) || 12;
const WARMUP = 274;
const COST_ONE_WAY = 0.001;
/** Most-liquid names kept per sample date; ranking avoids currency assumptions. */
const LIQUID_KEEP = 400;

interface Bar {
  date: string;
  close: number;
  adjusted_close?: number;
  volume?: number;
}

const key = () => envValue("EODHD_API_KEY");

async function getJson<T>(url: string): Promise<T | null> {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) {
        await new Promise((x) => setTimeout(x, 3000 * (a + 1)));
        continue;
      }
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      await new Promise((x) => setTimeout(x, 1500));
    }
  }
  return null;
}

/**
 * Quarterly samples of the bulk file, kept SEPARATELY per sample date.
 *
 * The first version unioned every symbol that was ever top-400 by traded value
 * into one set and tested all of them from day one. That is look-ahead: a
 * company only enters the liquid 400 after it has grown, so the union is a
 * list of things that went on to do well. Keeping each date's set and asking
 * "what was liquid as of this rebalance" is what point-in-time actually means.
 */
interface UniverseSample {
  date: string;
  codes: Set<string>;
}

async function buildUniverse(): Promise<UniverseSample[]> {
  const dates: string[] = [];
  const now = new Date();
  for (let y = 0; y < YEARS; y++) {
    for (const m of [1, 4, 7, 10]) {
      const d = new Date(now);
      d.setFullYear(now.getFullYear() - y);
      d.setMonth(m, 15);
      if (d < now) dates.push(d.toISOString().slice(0, 10));
    }
  }
  dates.sort();

  const samples: UniverseSample[] = [];
  const everSeen = new Set<string>();
  for (const date of dates) {
    const rows = await getJson<{ code?: string; close?: number; volume?: number }[]>(
      `https://eodhd.com/api/eod-bulk-last-day/${EXCHANGE}?date=${date}&fmt=json&api_token=${key()}`,
    );
    if (!Array.isArray(rows) || rows.length === 0) continue;
    // Rank by traded value and keep the top slice, so no currency assumption.
    const ranked = rows
      .filter((r) => r.code && typeof r.close === "number" && typeof r.volume === "number")
      .map((r) => ({ code: r.code as string, v: (r.close as number) * (r.volume as number) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, LIQUID_KEEP);
    const codes = new Set(ranked.map((r) => r.code));
    for (const c of codes) everSeen.add(c);
    samples.push({ date, codes });
    process.stdout.write(`
  ${samples.length} samples, ${everSeen.size} distinct names   `);
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log("");
  return samples;
}

/**
 * What was liquid as of a given date: the most recent sample on or before it.
 * Before the first sample nothing is eligible, which is why the run starts
 * after WARMUP anyway.
 */
function eligibleAsOf(samples: UniverseSample[], date: string): Set<string> {
  let found: Set<string> | null = null;
  for (const s of samples) {
    if (s.date <= date) found = s.codes;
    else break;
  }
  return found ?? new Set<string>();
}

async function history(sym: string): Promise<Bar[] | null> {
  const from = new Date();
  from.setFullYear(from.getFullYear() - YEARS - 2);
  const rows = await getJson<Bar[]>(
    `https://eodhd.com/api/eod/${encodeURIComponent(sym)}.${EXCHANGE}?api_token=${key()}` +
      `&fmt=json&period=d&from=${from.toISOString().slice(0, 10)}`,
  );
  return Array.isArray(rows) && rows.length >= 300 ? rows : null;
}

/**
 * A StockInput carrying prices and nothing else. Fundamentals stay null, which
 * the scoring engine already handles by renormalizing, so momentum comes out of
 * the exact code path the US backtest uses with no reimplementation to drift.
 */
function priceOnlyInput(ticker: string, closes: number[], bench: number[]): StockInput {
  return {
    ticker,
    name: ticker,
    sector: "",
    price: closes[closes.length - 1],
    marketCap: 1e6,
    avgDollarVolume: 1e12,
    closes,
    spxCloses: bench,
    currentRatio: null,
    interestCoverage: null,
    netMargin: null,
    grossMargin: null,
    operatingMargin: null,
    roe: null,
    roic: null,
    debtToEquity: null,
    pe: null,
    pb: null,
    ps: null,
    pfcf: null,
    evToEbitda: null,
    revenueGrowth: null,
    epsGrowth: null,
    revenuePerShare: null,
    latestSurprisePct: null,
    altmanZ: null,
    piotroskiF: null,
    accrualRatio: null,
    fcfGrowth: null,
    grossProfitToAssets: null,
    debtToEbitda: null,
    incrementalRoic: null,
    shareDilution: null,
    growthAcceleration: null,
    insiderBought: null,
    insiderSold: null,
  };
}

async function main() {
  if (!key()) throw new Error("EODHD_API_KEY is not set");
  console.log(`Out-of-sample momentum test on ${EXCHANGE}, ${REBALANCE_DAYS}-day rebalance`);

  console.log("Building a point-in-time liquid universe...");
  const samples = await buildUniverse();
  if (samples.length === 0) throw new Error("no universe samples returned");
  const universe = [...new Set(samples.flatMap((x) => [...x.codes]))].sort();
  console.log(
    `  ${samples.length} quarterly samples, ${universe.length} distinct names ever liquid on ${EXCHANGE}`,
  );

  console.log("Fetching price history...");
  const series = new Map<string, Bar[]>();
  const CONC = 4;
  for (let i = 0; i < universe.length; i += CONC) {
    const chunk = universe.slice(i, i + CONC);
    const got = await Promise.all(chunk.map(history));
    got.forEach((h, j) => {
      if (h) series.set(chunk[j], h);
    });
    if (i % 40 === 0) process.stdout.write(`\r  ${i}/${universe.length}, kept ${series.size}   `);
  }
  console.log(`\n  usable history for ${series.size} names`);
  if (series.size < 50) throw new Error("too few names with history to test");

  // Shared calendar: the UNION of every date any name traded. Taking it from
  // the single longest series silently dropped every day that series happened
  // to be missing, for every other name too.
  const dateSet = new Set<string>();
  for (const bars of series.values()) for (const b of bars) dateSet.add(b.date);
  const dates = [...dateSet].sort();
  const idx = new Map(dates.map((d, i) => [d, i]));
  const n = dates.length;

  const aligned = new Map<string, number[]>();
  const lastReal = new Map<string, number>();
  for (const [sym, bars] of series) {
    const arr = new Array<number>(n).fill(NaN);
    let last = -1;
    for (const b of bars) {
      const i = idx.get(b.date);
      if (i !== undefined) {
        arr[i] = b.adjusted_close ?? b.close;
        if (i > last) last = i;
      }
    }
    if (last < 0) continue;
    let carry = NaN;
    for (let k = 0; k < n; k++) {
      if (Number.isFinite(arr[k])) carry = arr[k];
      else if (Number.isFinite(carry)) arr[k] = carry;
    }
    aligned.set(sym, arr);
    lastReal.set(sym, last);
  }

  // Benchmark: own the whole eligible universe, equal weight, rebalanced on the
  // SAME cadence as the strategy and drifting in between.
  //
  // Averaging daily returns instead assumes a daily rebalance back to equal
  // weight. On 1,500 volatile names that harvests noise and produced an
  // impossible 153% a year. Matching the strategy's mechanics exactly means
  // only stock SELECTION separates the two lines.
  //
  // Eligibility is point-in-time on BOTH sides. If the benchmark could hold
  // names the strategy was not yet allowed to pick, the gap between the lines
  // would measure the universe rather than the selection.
  const symbols = [...aligned.keys()];
  const benchDaily: number[] = new Array(n).fill(0);
  {
    let w: number[] = [];
    for (let i = 1; i < n; i++) {
      const liveAt = (k: number) => (lastReal.get(symbols[k]) ?? -1) >= i;
      if (w.length === 0 || (i - WARMUP) % REBALANCE_DAYS === 0) {
        const ok = eligibleAsOf(samples, dates[i]);
        const live: number[] = symbols.map((sym, k) => (liveAt(k) && ok.has(sym) ? 1 : 0));
        const cnt = live.reduce((a, b) => a + b, 0);
        w = live.map((x) => (cnt > 0 ? x / cnt : 0));
      }
      let ret = 0;
      for (let k = 0; k < symbols.length; k++) {
        if (w[k] === 0 || !liveAt(k)) continue;
        const s = aligned.get(symbols[k])!;
        const a = s[i - 1];
        const b = s[i];
        if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;
        ret += w[k] * (b / a - 1);
      }
      benchDaily[i] = ret;
      let tot = 0;
      for (let k = 0; k < symbols.length; k++) {
        if (w[k] === 0 || !liveAt(k)) {
          w[k] = 0;
          continue;
        }
        const s = aligned.get(symbols[k])!;
        const a = s[i - 1];
        const b = s[i];
        if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;
        w[k] *= b / a;
        tot += w[k];
      }
      if (tot > 0) for (let k = 0; k < w.length; k++) w[k] /= tot;
    }
  }
  const benchLevel: number[] = [1];
  for (let i = 1; i < n; i++) benchLevel[i] = benchLevel[i - 1] * (1 + benchDaily[i]);

  console.log("Simulating...");
  let strat = 1;
  let bench = 1;
  let holdings: string[] = [];
  let wts: number[] = [];
  let costDrag = 0;
  const curve: { t: string; strat: number; bench: number }[] = [];

  for (let i = WARMUP; i < n; i++) {
    if ((i - WARMUP) % REBALANCE_DAYS === 0) {
      const inputs: StockInput[] = [];
      const okNow = eligibleAsOf(samples, dates[i]);
      for (const [sym, s] of aligned) {
        if (!okNow.has(sym)) continue;
        if ((lastReal.get(sym) ?? -1) < i) continue;
        if (!Number.isFinite(s[i]) || !Number.isFinite(s[i - WARMUP + 1])) continue;
        inputs.push(priceOnlyInput(sym, s.slice(0, i + 1), benchLevel.slice(0, i + 1)));
      }
      // The same Stage-1 rules, minus the ones that need filings.
      const eligible = inputs.filter((s) => stage1Filter(s).passed);
      if (eligible.length >= TOP_N) {
        const scores = computeFactorScores(eligible);
        const next = eligible
          .map((s, k) => ({ t: s.ticker, m: scores[k].momentum }))
          .sort((a, b) => b.m - a.m)
          .slice(0, TOP_N)
          .map((x) => x.t);
        const held = new Set(holdings);
        const changed = next.filter((t) => !held.has(t)).length;
        const cost =
          holdings.length === 0
            ? (next.length / TOP_N) * COST_ONE_WAY
            : (changed / TOP_N) * COST_ONE_WAY * 2;
        strat *= 1 - cost;
        costDrag += cost;
        holdings = next;
        wts = new Array(holdings.length).fill(1 / Math.max(1, holdings.length));
      }
    }
    if (i > WARMUP) {
      // Positions drift between rebalances, same as the benchmark.
      let ret = 0;
      for (let k = 0; k < holdings.length; k++) {
        const s = aligned.get(holdings[k]);
        if (!s || wts[k] === 0 || (lastReal.get(holdings[k]) ?? -1) < i) continue;
        const a = s[i - 1];
        const b = s[i];
        if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;
        ret += wts[k] * (b / a - 1);
      }
      strat *= 1 + ret;
      let tot = 0;
      for (let k = 0; k < holdings.length; k++) {
        const s = aligned.get(holdings[k]);
        if (!s || wts[k] === 0 || (lastReal.get(holdings[k]) ?? -1) < i) {
          wts[k] = 0;
          continue;
        }
        const a = s[i - 1];
        const b = s[i];
        if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;
        wts[k] *= b / a;
        tot += wts[k];
      }
      if (tot > 0) for (let k = 0; k < wts.length; k++) wts[k] /= tot;
      bench *= 1 + benchDaily[i];
    }
    curve.push({ t: dates[i], strat, bench });
  }

  const yrs = (n - WARMUP) / 252;
  const cagr = (Math.pow(strat, 1 / yrs) - 1) * 100;
  const bCagr = (Math.pow(bench, 1 / yrs) - 1) * 100;
  const half = Math.floor(curve.length / 2);
  const seg = (a: number, b: number) => {
    const y = (b - a) / 252;
    const s = (Math.pow(curve[b].strat / curve[a].strat, 1 / y) - 1) * 100;
    const m = (Math.pow(curve[b].bench / curve[a].bench, 1 / y) - 1) * 100;
    return s - m;
  };
  const sign = (v: number) => (v > 0 ? "+" : "") + v.toFixed(1);

  console.log("");
  console.log(`=== ${EXCHANGE}, ${REBALANCE_DAYS}-day rebalance, ${yrs.toFixed(1)}y ===`);
  console.log(`  names tested        : ${aligned.size}`);
  console.log(`  strategy            : ${cagr.toFixed(1)}% a year`);
  console.log(`  equal-weight market : ${bCagr.toFixed(1)}% a year`);
  console.log(`  excess              : ${sign(cagr - bCagr)} pts`);
  console.log(`  cost drag           : ${((costDrag / yrs) * 100).toFixed(2)}% a year`);
  console.log(`  first half excess   : ${sign(seg(0, half))}`);
  console.log(`  second half excess  : ${sign(seg(half, curve.length - 1))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Nightly scan: universe -> filters -> factor scores -> rankings.json
 *
 * Usage:
 *   npm run scan                 # full S&P 500 universe (~25-35 min on free tier)
 *   npm run scan -- --limit 60   # first N tickers only (quick test, ~4 min)
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/lib/env";
import { finnhub, pickMetric } from "../src/lib/finnhub";
import { dailyHistory } from "../src/lib/prices";
import { edgarFundamentals } from "../src/lib/edgar";
import {
  computeFactorScores,
  computePenalties,
  edgarFilter,
  finalScore,
  FREE_TIER_GAPS,
  sectorMedianGrossMargins,
  stage1Filter,
  type StockInput,
} from "../src/lib/scoring";
import type { Candle, RankedStock, Rankings, ScanStatus } from "../src/lib/types";

loadEnv();

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_DIR = path.join(DATA_DIR, "history");
const STATUS_PATH = path.join(DATA_DIR, "scan-status.json");

const status: ScanStatus = {
  state: "running",
  mode: "sp500",
  phase: "starting",
  done: 0,
  total: 0,
  startedAt: new Date().toISOString(),
  phaseStartedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function writeStatus(patch: Partial<ScanStatus>): void {
  Object.assign(status, patch, { updatedAt: new Date().toISOString() });
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  } catch {
    /* status is best-effort */
  }
}

function startPhase(phase: string, total: number): void {
  Object.assign(status, {
    phase,
    total,
    done: 0,
    phaseStartedAt: new Date().toISOString(),
  });
  writeStatus({});
}

const CONSTITUENTS_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

interface Constituent {
  ticker: string;
  name: string;
  sector: string;
}

async function fetchUniverse(): Promise<Constituent[]> {
  // Prefer the full US common-stock universe if `npm run universe` has built it
  const universePath = path.join(DATA_DIR, "universe.json");
  const forceSp500 = process.argv.includes("--sp500");
  if (!forceSp500 && fs.existsSync(universePath)) {
    const u = JSON.parse(fs.readFileSync(universePath, "utf8")) as {
      generatedAt: string;
      tickers: Constituent[];
    };
    console.log(
      `Using data/universe.json (${u.tickers.length} US common stocks, built ${u.generatedAt.slice(0, 10)}).`,
    );
    status.mode = "universe";
    return u.tickers;
  }

  console.log("No data/universe.json — falling back to the S&P 500 list.");
  console.log("(Run `npm run universe` once to build the full US >$1.5B universe.)");
  const res = await fetch(CONSTITUENTS_URL);
  if (!res.ok) throw new Error(`Failed to fetch S&P 500 constituents: ${res.status}`);
  const text = await res.text();
  const rows = text.trim().split("\n").slice(1);
  const out: Constituent[] = [];
  for (const row of rows) {
    // CSV with possible quoted names containing commas
    const cols = row.match(/("[^"]*"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, "").trim());
    if (!cols || cols.length < 3) continue;
    out.push({ ticker: cols[0], name: cols[1], sector: cols[2] });
  }
  return out;
}

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

async function main() {
  const limit = Number(argValue("--limit")) || Infinity;

  console.log("Fetching S&P 500 constituent list...");
  let universe = await fetchUniverse();
  if (Number.isFinite(limit)) universe = universe.slice(0, limit);
  console.log(`Universe: ${universe.length} tickers`);

  console.log("Fetching S&P 500 index history (relative strength baseline)...");
  // SPY total return, matching the basis of the per-stock adjusted closes, so
  // relative strength compares like with like.
  const spx = await dailyHistory("SPY");
  if (!spx) throw new Error("Could not fetch ^SPX history from stooq");
  const spxCloses = spx.map((c) => c.a ?? c.c);

  const inputs: StockInput[] = [];
  const histories = new Map<string, Candle[]>();
  let done = 0;
  startPhase("market data", universe.length);

  for (const c of universe) {
    done++;
    writeStatus({ done });
    const label = `[${done}/${universe.length}] ${c.ticker}`;
    try {
      const [quote, profile, metricsRes, history] = await Promise.all([
        finnhub.quote(c.ticker),
        finnhub.profile(c.ticker),
        finnhub.metrics(c.ticker),
        dailyHistory(c.ticker),
      ]);
      if (!quote || !quote.c || !profile || !metricsRes || !history) {
        console.log(`${label} — skipped (missing data)`);
        continue;
      }
      const m = metricsRes.metric ?? {};
      const avgVolumeMillions = pickMetric(m, "10DayAverageTradingVolume");
      const avgDollarVolume =
        avgVolumeMillions !== null ? avgVolumeMillions * 1_000_000 * quote.c : 0;

      histories.set(c.ticker, history);
      inputs.push({
        ticker: c.ticker,
        name: profile.name || c.name,
        sector: c.sector,
        price: quote.c,
        marketCap: profile.marketCapitalization ?? 0,
        avgDollarVolume,
        // Momentum and the 50/200-day trend filter run on total-return closes.
        // Raw closes break across splits: a 4:1 split looks like a 75% drop.
        closes: history.map((x) => x.a ?? x.c),
        spxCloses,
        currentRatio: pickMetric(m, "currentRatioQuarterly", "currentRatioAnnual"),
        interestCoverage: pickMetric(
          m,
          "netInterestCoverageTTM",
          "netInterestCoverageAnnual",
        ),
        netMargin: pickMetric(m, "netProfitMarginTTM", "netProfitMarginAnnual"),
        grossMargin: pickMetric(m, "grossMarginTTM", "grossMarginAnnual"),
        operatingMargin: pickMetric(m, "operatingMarginTTM", "operatingMarginAnnual"),
        roe: pickMetric(m, "roeTTM", "roeRfy"),
        roic: pickMetric(m, "roiTTM", "roiAnnual"),
        debtToEquity: pickMetric(
          m,
          "totalDebt/totalEquityQuarterly",
          "totalDebt/totalEquityAnnual",
        ),
        pe: pickMetric(m, "peTTM", "peBasicExclExtraTTM", "peAnnual"),
        pb: pickMetric(m, "pbQuarterly", "pbAnnual"),
        ps: pickMetric(m, "psTTM", "psAnnual"),
        pfcf: pickMetric(m, "pfcfShareTTM", "pfcfShareAnnual"),
        evToEbitda: pickMetric(m, "evToEbitdaTTM", "currentEv/ebitdaTTM"),
        revenueGrowth: pickMetric(m, "revenueGrowthTTMYoy", "revenueGrowth3Y"),
        epsGrowth: pickMetric(m, "epsGrowthTTMYoy", "epsGrowth3Y"),
        revenuePerShare: pickMetric(m, "revenuePerShareTTM", "revenuePerShareAnnual"),
        latestSurprisePct: null, // filled below for survivors only (saves API calls)
        altmanZ: null,
        piotroskiF: null,
        accrualRatio: null,
        fcfGrowth: null,
        grossProfitToAssets: null,
        debtToEbitda: null,
        insiderBought: null,
        insiderSold: null,
      });
      console.log(`${label} — ok`);
    } catch (err) {
      console.log(`${label} — error: ${(err as Error).message}`);
    }
  }

  console.log(`\nFetched data for ${inputs.length} stocks. Applying Stage 1 filters...`);

  // Gross margin vs sector median (computed across everything we scanned)
  const gmMedians = sectorMedianGrossMargins(inputs);

  const provisional: StockInput[] = [];
  for (const s of inputs) {
    const result = stage1Filter(s);
    const median = gmMedians.get(s.sector);
    if (
      result.passed &&
      s.grossMargin !== null &&
      median !== undefined &&
      s.grossMargin < median
    ) {
      result.passed = false;
      result.failures.push("gross margin below sector median");
    }
    if (result.passed) provisional.push(s);
  }
  console.log(`${provisional.length} stocks passed the market-data filters.`);

  // SEC EDGAR pass: Altman Z, Piotroski, accruals, FCF growth, GP/Assets, Debt/EBITDA
  console.log("Fetching SEC EDGAR fundamentals for provisional survivors...");
  startPhase("SEC EDGAR fundamentals", provisional.length);
  const survivors: StockInput[] = [];
  let edgarOk = 0;
  for (const s of provisional) {
    writeStatus({ done: status.done + 1 });
    const ed = await edgarFundamentals(s.ticker, s.marketCap * 1_000_000);
    if (ed) {
      edgarOk++;
      s.altmanZ = ed.altmanZ;
      s.piotroskiF = ed.piotroskiF;
      s.accrualRatio = ed.accrualRatio;
      s.fcfGrowth = ed.fcfGrowth;
      s.grossProfitToAssets = ed.grossProfitToAssets;
      s.debtToEbitda = ed.debtToEbitda;
    }
    const result = edgarFilter(s);
    if (result.passed) survivors.push(s);
    else console.log(`  ${s.ticker} eliminated: ${result.failures.join(", ")}`);
  }
  console.log(
    `EDGAR data for ${edgarOk}/${provisional.length}; ${survivors.length} passed all filters.`,
  );

  if (survivors.length < 3) {
    console.log("Too few survivors to rank meaningfully — try a larger --limit or full scan.");
  }

  // Earnings-surprise + insider-transaction penalty inputs, survivors only
  console.log("Fetching earnings surprises + insider transactions for survivors...");
  startPhase("penalty inputs", survivors.length);
  const sixMonthsAgo = new Date(Date.now() - 183 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const in60Days = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const nextEarnings = new Map<string, string>();
  for (const s of survivors) {
    writeStatus({ done: status.done + 1 });
    const [earnings, insider, calendar] = await Promise.all([
      finnhub.earnings(s.ticker),
      finnhub.insiderTransactions(s.ticker, sixMonthsAgo),
      finnhub.earningsCalendar(s.ticker, today, in60Days),
    ]);
    if (earnings && earnings.length > 0 && earnings[0].surprisePercent !== null) {
      s.latestSurprisePct = earnings[0].surprisePercent;
    }
    if (insider?.data) {
      let bought = 0;
      let sold = 0;
      for (const tx of insider.data) {
        if (typeof tx.change !== "number") continue;
        if (tx.change > 0) bought += tx.change;
        else sold += -tx.change;
      }
      s.insiderBought = bought;
      s.insiderSold = sold;
    }
    const upcoming = calendar?.earningsCalendar
      ?.map((e) => e.date)
      .filter((d) => d >= today)
      .sort()[0];
    if (upcoming) nextEarnings.set(s.ticker, upcoming);
  }

  // Stage 2-5
  const factorScores = computeFactorScores(survivors);
  const ranked: RankedStock[] = survivors
    .map((s, i) => {
      const penalties = computePenalties(s);
      const score = finalScore(factorScores[i], penalties);
      return {
        rank: 0,
        ticker: s.ticker,
        name: s.name,
        sector: s.sector,
        price: s.price,
        marketCap: s.marketCap,
        scores: factorScores[i],
        penalties,
        finalScore: score,
        recommended: false,
        nextEarningsDate: nextEarnings.get(s.ticker) ?? null,
        metrics: {
          pe: s.pe,
          pb: s.pb,
          ps: s.ps,
          pfcf: s.pfcf,
          roe: s.roe,
          roic: s.roic,
          grossMargin: s.grossMargin,
          operatingMargin: s.operatingMargin,
          netMargin: s.netMargin,
          debtToEquity: s.debtToEquity,
          currentRatio: s.currentRatio,
          revenueGrowth: s.revenueGrowth,
          epsGrowth: s.epsGrowth,
          latestSurprisePct: s.latestSurprisePct,
          altmanZ: s.altmanZ,
          piotroskiF: s.piotroskiF,
          fcfGrowth: s.fcfGrowth,
          debtToEbitda: s.debtToEbitda,
          grossProfitToAssets: s.grossProfitToAssets,
        },
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    // One slot per company: drop lower-ranked duplicate share classes (GOOG/GOOGL)
    .filter(
      (s, i, arr) => arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === i,
    )
    .map((s, i) => ({ ...s, rank: i + 1, recommended: i < 20 }));

  const rankings: Rankings = {
    generatedAt: new Date().toISOString(),
    universeScanned: inputs.length,
    passedFilters: survivors.length,
    skippedFilters: FREE_TIER_GAPS,
    stocks: ranked,
  };

  // Guard: a near-empty result means the price source blocked us (Yahoo blocks
  // datacenter IPs, so CI runners often get zero history). Never overwrite good
  // data with an empty scan — abort with a non-zero exit instead.
  const MIN_SURVIVORS = 5;
  if (ranked.length < MIN_SURVIVORS) {
    throw new Error(
      `Only ${ranked.length} survivors (< ${MIN_SURVIVORS}); likely a data-source block. ` +
        `Refusing to overwrite existing rankings.json.`,
    );
  }

  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  // Keep the previous scan for rank-change display on the dashboard
  const rankingsPath = path.join(DATA_DIR, "rankings.json");
  if (fs.existsSync(rankingsPath)) {
    fs.copyFileSync(rankingsPath, path.join(DATA_DIR, "rankings-prev.json"));
  }
  fs.writeFileSync(rankingsPath, JSON.stringify(rankings, null, 2));

  // Append compact per-scan snapshot for score/rank history (last 90 scans)
  const historyPath = path.join(DATA_DIR, "score-history.json");
  const history: { date: string; entries: Record<string, { r: number; s: number }> }[] =
    fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, "utf8")) : [];
  const entries: Record<string, { r: number; s: number }> = {};
  for (const s of ranked) entries[s.ticker] = { r: s.rank, s: s.finalScore };
  history.push({ date: rankings.generatedAt.slice(0, 10), entries });
  fs.writeFileSync(historyPath, JSON.stringify(history.slice(-90)));
  // Price-history files for chart pages — cap at 120 to keep the repo lean
  for (const s of ranked.slice(0, 120)) {
    const h = histories.get(s.ticker);
    if (h) {
      fs.writeFileSync(path.join(HISTORY_DIR, `${s.ticker}.json`), JSON.stringify(h));
    }
  }

  console.log(`\nWrote data/rankings.json — ${ranked.length} survivors ranked.`);
  console.log("Top 5:");
  for (const s of ranked.slice(0, 5)) {
    console.log(
      `  #${s.rank} ${s.ticker.padEnd(6)} ${String(s.finalScore).padStart(5)}  ` +
        `Q${s.scores.quality} V${s.scores.value} M${s.scores.momentum} G${s.scores.growth}`,
    );
  }
}

main()
  .then(() => {
    writeStatus({ state: "done", phase: "complete", finishedAt: new Date().toISOString() });
  })
  .catch((err) => {
    console.error(err);
    writeStatus({
      state: "error",
      error: (err as Error).message,
      finishedAt: new Date().toISOString(),
    });
    process.exit(1);
  });

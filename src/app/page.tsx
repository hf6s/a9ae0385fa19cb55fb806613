import HomeView, { type Spotlight } from "@/components/HomeView";
import { type Stat } from "@/components/StatTiles";
import fs from "node:fs";
import path from "node:path";
import { getAnalyses, getHistory, getPrevRankings, getRankings } from "@/lib/data";
import type { Rankings, RollingWindow } from "@/lib/types";

export const dynamic = "force-dynamic";

function prevRanks(): Record<string, number> {
  const prev = getPrevRankings();
  if (!prev) return {};
  return Object.fromEntries(prev.stocks.map((s) => [s.ticker, s.rank]));
}

function buildStats(rankings: Rankings): Stat[] {
  const top20 = rankings.stocks.slice(0, 20);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const avgScore = avg(top20.map((s) => s.finalScore));
  const factorAvgs = {
    Quality: avg(top20.map((s) => s.scores.quality)),
    Value: avg(top20.map((s) => s.scores.value)),
    Momentum: avg(top20.map((s) => s.scores.momentum)),
    Growth: avg(top20.map((s) => s.scores.growth)),
  };
  const strongest = Object.entries(factorAvgs).sort((a, b) => b[1] - a[1])[0];
  return [
    { label: "Universe scanned", value: rankings.universeScanned, sub: "US common stocks" },
    { label: "Passed all filters", value: rankings.passedFilters, sub: "elimination survivors" },
    { label: "Avg top-20 score", value: avgScore, sub: "of 100", decimals: 1 },
    {
      label: "Strongest factor today",
      value: strongest[1],
      sub: strongest[0],
      decimals: 0,
    },
  ];
}

/** Last ~90 trading days of closes, downsampled to 30 points, per ticker. */
function buildSparks(tickers: string[]): Record<string, number[]> {
  const sparks: Record<string, number[]> = {};
  for (const t of tickers) {
    const h = getHistory(t);
    if (!h || h.length < 30) continue;
    const closes = h.slice(-90).map((c) => c.c);
    const step = closes.length / 30;
    const points: number[] = [];
    for (let i = 0; i < 30; i++) {
      points.push(Math.round(closes[Math.min(closes.length - 1, Math.floor(i * step))] * 100) / 100);
    }
    sparks[t] = points;
  }
  return sparks;
}

/**
 * The backtest's own verdict, read from the result file rather than written
 * into the page. A hardcoded claim about performance goes stale the moment a
 * backtest re-runs, and a stale performance claim is the kind that misleads.
 */
function honestVerdict(): {
  cagr: number;
  benchCagr: number;
  years: number;
  rolling: RollingWindow[];
} | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "data", "backtest.json"), "utf8");
    const bt = JSON.parse(raw) as {
      stats: { cagr: number; benchCagr: number; years: number };
      rollingWindows?: RollingWindow[];
    };
    return {
      cagr: bt.stats.cagr,
      benchCagr: bt.stats.benchCagr,
      years: bt.stats.years,
      rolling: bt.rollingWindows ?? [],
    };
  } catch {
    return null;
  }
}

export default function Home() {
  const rankings = getRankings();

  if (!rankings) {
    return (
      <main>
        <div className="empty-state">
          <p>
            No rankings yet. Run <code>npm run scan</code> to scan the universe, then{" "}
            <code>npm run analyze</code> for the AI write-ups.
          </p>
        </div>
      </main>
    );
  }

  const generated = new Date(rankings.generatedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const metaLine =
    `Scanned ${rankings.universeScanned} stocks · ${rankings.passedFilters} passed all ` +
    `elimination filters · updated ${generated}`;

  // The landing view spotlights the top-ranked stock; the full table is one
  // click away and stays the default once the reader switches to it.
  const top = rankings.stocks[0];
  const analysis = top ? getAnalyses()?.analyses[top.ticker] : undefined;
  const spotlight: Spotlight | null = top
    ? {
        stock: top,
        candles: getHistory(top.ticker) ?? [],
        analysisText: analysis?.text ?? null,
        analysisModel: analysis?.model ?? null,
      }
    : null;

  return (
    <main>
      <HomeView
        stocks={rankings.stocks}
        sparks={buildSparks(rankings.stocks.map((s) => s.ticker))}
        prevRanks={prevRanks()}
        stats={buildStats(rankings)}
        metaLine={metaLine}
        spotlight={spotlight}
        verdict={honestVerdict()}
      />
    </main>
  );
}

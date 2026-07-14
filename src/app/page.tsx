import RankingsExplorer from "@/components/RankingsExplorer";
import StatTiles, { type Stat } from "@/components/StatTiles";
import { getHistory, getPrevRankings, getRankings } from "@/lib/data";
import type { Rankings } from "@/lib/types";

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

  return (
    <main>
      <StatTiles stats={buildStats(rankings)} />
      <p className="meta-line">
        Scanned {rankings.universeScanned} stocks · {rankings.passedFilters} passed all
        elimination filters · updated {generated}
      </p>
      <RankingsExplorer
        stocks={rankings.stocks}
        sparks={buildSparks(rankings.stocks.map((s) => s.ticker))}
        prevRanks={prevRanks()}
      />
      <p className="disclaimer">
        Factor20 ranks stocks with a mechanical, transparent factor model and AI-written
        commentary. Holding-period presets re-weight the same four factor scores — shorter
        horizons emphasize momentum, longer horizons emphasize quality and value, following
        the academic evidence on factor decay. Nothing here is investment advice or a
        recommendation to buy or sell any security. Do your own research.
      </p>
    </main>
  );
}

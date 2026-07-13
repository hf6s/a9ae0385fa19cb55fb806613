import RankingsExplorer from "@/components/RankingsExplorer";
import { getHistory, getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

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
      <p className="meta-line">
        Scanned {rankings.universeScanned} stocks · {rankings.passedFilters} passed all
        elimination filters · updated {generated}
      </p>
      <RankingsExplorer
        stocks={rankings.stocks}
        sparks={buildSparks(rankings.stocks.map((s) => s.ticker))}
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

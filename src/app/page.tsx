import RankingsExplorer from "@/components/RankingsExplorer";
import { getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

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
      <RankingsExplorer stocks={rankings.stocks} />
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

import Link from "next/link";
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
      <table className="rankings">
        <thead>
          <tr>
            <th>#</th>
            <th>Company</th>
            <th style={{ textAlign: "right" }}>Price</th>
            <th style={{ textAlign: "right" }}>Score</th>
            <th style={{ textAlign: "right" }}>Q</th>
            <th style={{ textAlign: "right" }}>V</th>
            <th style={{ textAlign: "right" }}>M</th>
            <th style={{ textAlign: "right" }}>G</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rankings.stocks.map((s) => (
            <tr key={s.ticker} className="row">
              <td className="rank-cell">{s.rank}</td>
              <td>
                <Link href={`/stock/${s.ticker}`}>
                  <span className="ticker">{s.ticker}</span>{" "}
                  <span className="name-dim">{s.name}</span>
                </Link>
              </td>
              <td style={{ textAlign: "right" }}>${s.price.toFixed(2)}</td>
              <td style={{ textAlign: "right" }} className="score-strong">
                {s.finalScore.toFixed(1)}
              </td>
              <td style={{ textAlign: "right" }}>
                <span className="factor-mini">{Math.round(s.scores.quality)}</span>
              </td>
              <td style={{ textAlign: "right" }}>
                <span className="factor-mini">{Math.round(s.scores.value)}</span>
              </td>
              <td style={{ textAlign: "right" }}>
                <span className="factor-mini">{Math.round(s.scores.momentum)}</span>
              </td>
              <td style={{ textAlign: "right" }}>
                <span className="factor-mini">{Math.round(s.scores.growth)}</span>
              </td>
              <td>
                {s.recommended ? <span className="badge">Top 20</span> : (
                  <span className="watch">watch</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="disclaimer">
        Factor20 ranks stocks with a mechanical, transparent factor model and AI-written
        commentary. Nothing here is investment advice or a recommendation to buy or sell any
        security. Do your own research.
      </p>
    </main>
  );
}

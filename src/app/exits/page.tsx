import Link from "next/link";
import { getPrevRankings, getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

const SCORE_SELL_LINE = 70;

interface Exit {
  ticker: string;
  name: string;
  rule: string;
  detail: string;
}

export default function ExitsPage() {
  const rankings = getRankings();
  const prev = getPrevRankings();

  if (!rankings) {
    return (
      <main>
        <div className="empty-state">
          <p>No scan data yet.</p>
        </div>
      </main>
    );
  }

  const currentTickers = new Set(rankings.stocks.map((s) => s.ticker));
  const currentTop20 = new Set(rankings.stocks.slice(0, 20).map((s) => s.ticker));
  const currentTop50 = new Set(rankings.stocks.slice(0, 50).map((s) => s.ticker));

  // Signals that need a previous scan to compare against
  const droppedExits: Exit[] = [];
  if (prev) {
    for (const s of prev.stocks.slice(0, 50)) {
      if (!currentTickers.has(s.ticker)) {
        droppedExits.push({
          ticker: s.ticker,
          name: s.name,
          rule: "Failed filters",
          detail: `Was #${s.rank}; no longer passes the elimination filters`,
        });
      } else if (prev.stocks.slice(0, 20).some((p) => p.ticker === s.ticker) && !currentTop20.has(s.ticker)) {
        const now = rankings.stocks.find((x) => x.ticker === s.ticker)!;
        droppedExits.push({
          ticker: s.ticker,
          name: s.name,
          rule: "Left top 20",
          detail: `#${s.rank} → #${now.rank}`,
        });
      } else if (!currentTop50.has(s.ticker)) {
        const now = rankings.stocks.find((x) => x.ticker === s.ticker)!;
        droppedExits.push({
          ticker: s.ticker,
          name: s.name,
          rule: "Fell below top 50",
          detail: `#${s.rank} → #${now.rank}`,
        });
      }
    }
  }

  // Standing signal: recommended (top-20) names already under the score-70 sell line
  const belowLine = rankings.stocks
    .slice(0, 20)
    .filter((s) => s.finalScore < SCORE_SELL_LINE)
    .map((s) => ({
      ticker: s.ticker,
      name: s.name,
      rule: "Score < 70",
      detail: `Final score ${s.finalScore.toFixed(1)} — under the sell-rule threshold`,
    }));

  const row = (e: Exit) => (
    <tr key={`${e.ticker}-${e.rule}`} className="row">
      <td>
        <Link href={`/stock/${e.ticker}`}>
          <span className="ticker">{e.ticker}</span> <span className="name-dim">{e.name}</span>
        </Link>
      </td>
      <td><span className="exit-rule">{e.rule}</span></td>
      <td className="name-dim">{e.detail}</td>
    </tr>
  );

  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Exit signals</h1>
      <p className="meta-line">
        The other half of the strategy — the model&apos;s sell rules applied to the latest scan.
        Nothing here is advice.
      </p>

      <section>
        <h2>Dropped since last scan</h2>
        {!prev ? (
          <div className="analysis">
            <p className="name-dim">
              This compares each scan to the previous one — the first comparison appears after
              the next nightly scan runs.
            </p>
          </div>
        ) : droppedExits.length === 0 ? (
          <div className="analysis">
            <p className="name-dim">No stocks dropped out of the top 50 since the last scan.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="rankings">
              <thead>
                <tr><th>Company</th><th>Rule</th><th>Detail</th></tr>
              </thead>
              <tbody>{droppedExits.map(row)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Top-20 names under the score-70 line</h2>
        {belowLine.length === 0 ? (
          <div className="analysis">
            <p className="name-dim">Every current top-20 stock is above the 70 sell threshold.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="rankings">
              <thead>
                <tr><th>Company</th><th>Rule</th><th>Detail</th></tr>
              </thead>
              <tbody>{belowLine.map(row)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>The model&apos;s sell rules</h2>
        <div className="analysis">
          <p>Sell immediately if any apply: price drops below the 200-day MA · final score falls below 70 · cuts dividend due to distress · negative earnings · fails the financial-health filters · falls outside the top 50 ranked stocks.</p>
          <p className="name-dim" style={{ marginTop: 8 }}>
            Factor20 detects the filter-based rules (dropping out of the ranked set, leaving
            the top 50, score below 70). Dividend cuts and same-day 200-MA breaks need
            intraday data beyond the nightly scan.
          </p>
        </div>
      </section>

      <p className="disclaimer">Not investment advice.</p>
    </main>
  );
}

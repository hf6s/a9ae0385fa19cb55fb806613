import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import ScanControl from "@/components/ScanControl";
import { getAnalyses, getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const rankings = getRankings();
  const analyses = getAnalyses();
  const universeBuilt = fs.existsSync(path.join(process.cwd(), "data", "universe.json"));

  const growthLeaders = rankings
    ? [...rankings.stocks].sort((a, b) => b.scores.growth - a.scores.growth).slice(0, 10)
    : [];

  const fmt = (v: number | null | undefined, suffix = "") =>
    v === null || v === undefined ? "—" : `${Math.round(v * 10) / 10}${suffix}`;

  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Dashboard</h1>

      <div className="cards">
        <ScanControl universeBuilt={universeBuilt} />
        <div className="card">
          <div className="label">Latest data</div>
          {rankings ? (
            <>
              <p>
                {rankings.universeScanned} scanned · {rankings.passedFilters} survivors ·{" "}
                {rankings.stocks.length} ranked
              </p>
              <p className="name-dim">
                Scan:{" "}
                {new Date(rankings.generatedAt).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              <p className="name-dim">
                AI write-ups: {analyses ? Object.keys(analyses.analyses).length : 0}
                {analyses &&
                  ` · ${new Date(analyses.generatedAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}`}
              </p>
            </>
          ) : (
            <p className="name-dim">No scan data yet.</p>
          )}
        </div>
      </div>

      <section>
        <h2>Growth leaders</h2>
        <p className="name-dim" style={{ marginBottom: 14 }}>
          The 10 survivors with the highest Growth-factor scores (revenue, EPS and FCF
          growth percentiles). A mechanical screen — pair with the 3–6 month holding
          presets on the rankings page. Not investment advice.
        </p>
        <table className="rankings">
          <thead>
            <tr>
              <th>Company</th>
              <th style={{ textAlign: "right" }}>Growth</th>
              <th style={{ textAlign: "right" }}>Revenue yoy</th>
              <th style={{ textAlign: "right" }}>EPS yoy</th>
              <th style={{ textAlign: "right" }}>FCF yoy</th>
              <th style={{ textAlign: "right" }}>Overall score</th>
            </tr>
          </thead>
          <tbody>
            {growthLeaders.map((s) => (
              <tr key={s.ticker} className="row">
                <td>
                  <Link href={`/stock/${s.ticker}`}>
                    <span className="ticker">{s.ticker}</span>{" "}
                    <span className="name-dim">{s.name}</span>
                  </Link>
                </td>
                <td style={{ textAlign: "right" }} className="score-strong">
                  {s.scores.growth.toFixed(1)}
                </td>
                <td style={{ textAlign: "right" }}>{fmt(s.metrics.revenueGrowth, "%")}</td>
                <td style={{ textAlign: "right" }}>{fmt(s.metrics.epsGrowth, "%")}</td>
                <td style={{ textAlign: "right" }}>{fmt(s.metrics.fcfGrowth, "%")}</td>
                <td style={{ textAlign: "right" }}>{s.finalScore.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="disclaimer">
        Scan triggering works when the site runs locally. On the deployed site, scans and AI
        analysis refresh automatically every night via GitHub Actions.
      </p>
    </main>
  );
}

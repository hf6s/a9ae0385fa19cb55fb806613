import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import BacktestControl from "@/components/BacktestControl";
import NextScanCountdown from "@/components/NextScanCountdown";
import ScanControl from "@/components/ScanControl";
import { getAnalyses, getRankings } from "@/lib/data";
import type { Rankings } from "@/lib/types";

export const dynamic = "force-dynamic";

function getPrevRankings(): Rankings | null {
  const file = path.join(process.cwd(), "data", "rankings-prev.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Rankings;
}

export default function Dashboard() {
  const rankings = getRankings();
  const prev = getPrevRankings();
  const analyses = getAnalyses();
  const dataDir = path.join(process.cwd(), "data");
  const universeBuilt = fs.existsSync(path.join(dataDir, "universe.json"));
  const hasBacktest = fs.existsSync(path.join(dataDir, "backtest.json"));

  const growthLeaders = rankings
    ? [...rankings.stocks].sort((a, b) => b.scores.growth - a.scores.growth).slice(0, 10)
    : [];

  // Sector breakdown of the top 20
  const sectorCounts = new Map<string, number>();
  for (const s of rankings?.stocks.slice(0, 20) ?? []) {
    sectorCounts.set(s.sector, (sectorCounts.get(s.sector) ?? 0) + 1);
  }
  const sectors = [...sectorCounts.entries()].sort((a, b) => b[1] - a[1]);

  // Score distribution of all survivors (10-point buckets)
  const buckets = new Array(10).fill(0);
  for (const s of rankings?.stocks ?? []) {
    buckets[Math.min(9, Math.floor(s.finalScore / 10))]++;
  }
  const maxBucket = Math.max(...buckets, 1);

  // Rank movers vs previous scan (within current top 30)
  const movers: { ticker: string; delta: number; rank: number }[] = [];
  if (prev && rankings) {
    const prevRank = new Map(prev.stocks.map((s) => [s.ticker, s.rank]));
    for (const s of rankings.stocks.slice(0, 30)) {
      const p = prevRank.get(s.ticker);
      if (p !== undefined && p !== s.rank) {
        movers.push({ ticker: s.ticker, delta: p - s.rank, rank: s.rank });
      }
    }
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  const fmt = (v: number | null | undefined, suffix = "") =>
    v === null || v === undefined ? "—" : `${Math.round(v * 10) / 10}${suffix}`;

  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Dashboard</h1>

      <div className="cards">
        <ScanControl universeBuilt={universeBuilt} />
        <BacktestControl hasResult={hasBacktest} />
      </div>

      <div className="cards">
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
                AI write-ups: {analyses ? Object.keys(analyses.analyses).length : 0} · Universe:{" "}
                {universeBuilt ? "full US >$1.5B" : "S&P 500 (fallback)"}
              </p>
            </>
          ) : (
            <p className="name-dim">No scan data yet.</p>
          )}
        </div>
        <NextScanCountdown />
        <div className="card">
          <div className="label">Score distribution (survivors)</div>
          <div className="histo">
            {buckets.map((count, i) => (
              <div key={i} className="histo-col" title={`${i * 10}–${i * 10 + 9}: ${count}`}>
                <div
                  className="histo-bar"
                  style={{ height: `${(count / maxBucket) * 100}%` }}
                />
                <span className="histo-label">{i * 10}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="label">Top-20 sectors</div>
          {sectors.length === 0 ? (
            <p className="name-dim">—</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {sectors.slice(0, 6).map(([sector, count]) => (
                <div key={sector} className="sector-row">
                  <span className="sector-name">{sector}</span>
                  <div className="sector-track">
                    <div
                      className="sector-fill"
                      style={{ width: `${(count / 20) * 100}%` }}
                    />
                  </div>
                  <span className="name-dim">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {movers.length > 0 && (
          <div className="card">
            <div className="label">Movers since last scan (top 30)</div>
            <div style={{ display: "grid", gap: 4 }}>
              {movers.slice(0, 6).map((m) => (
                <p key={m.ticker}>
                  <Link href={`/stock/${m.ticker}`} className="ticker">
                    {m.ticker}
                  </Link>{" "}
                  <span className={m.delta > 0 ? "score-strong" : "penalty"}>
                    {m.delta > 0 ? "▲" : "▼"} {Math.abs(m.delta)}
                  </span>{" "}
                  <span className="name-dim">now #{m.rank}</span>
                </p>
              ))}
            </div>
          </div>
        )}
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
        Scan and backtest triggering works when the site runs locally. On the deployed site,
        scans and AI analysis refresh automatically every night via GitHub Actions.
      </p>
    </main>
  );
}

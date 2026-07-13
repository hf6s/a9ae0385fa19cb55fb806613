import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import EquityChart, { type EquityPoint } from "@/components/EquityChart";

export const dynamic = "force-dynamic";

interface BacktestResult {
  generatedAt: string;
  strategy: string;
  universe: string;
  caveats: string[];
  stats: {
    years: number;
    totalReturn: number;
    benchTotalReturn: number;
    cagr: number;
    benchCagr: number;
    maxDrawdown: number;
    benchMaxDrawdown: number;
    annVol: number;
    sharpe: number;
    quartersTotal: number;
    quartersBeatingIndex: number;
  };
  curve: EquityPoint[];
  periods: {
    start: string;
    end: string;
    holdings: string[];
    stratRet: number;
    benchRet: number;
  }[];
  currentHoldings: string[];
}

function getBacktest(): BacktestResult | null {
  const file = path.join(process.cwd(), "data", "backtest.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as BacktestResult;
}

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export default function BacktestPage() {
  const bt = getBacktest();

  if (!bt) {
    return (
      <main>
        <div className="empty-state">
          <p>
            No backtest yet — run one from the <Link href="/dashboard">dashboard</Link> or
            with <code>npm run backtest</code> (~4 min, uses only free price data).
          </p>
        </div>
      </main>
    );
  }

  const s = bt.stats;
  const winRate = Math.round((s.quartersBeatingIndex / s.quartersTotal) * 100);

  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Backtest — momentum + trend</h1>
      <p className="meta-line">
        {bt.strategy} · {bt.universe} · run{" "}
        {new Date(bt.generatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
      </p>

      <div className="cards">
        <div className="card">
          <div className="label">Total return · {s.years}y</div>
          <div className="big" style={{ color: "var(--accent)" }}>{pct(s.totalReturn)}</div>
          <p className="name-dim">S&P 500: {pct(s.benchTotalReturn)}</p>
        </div>
        <div className="card">
          <div className="label">CAGR</div>
          <div className="big">{pct(s.cagr)}</div>
          <p className="name-dim">S&P 500: {pct(s.benchCagr)}</p>
        </div>
        <div className="card">
          <div className="label">Max drawdown</div>
          <div className="big" style={{ color: "var(--red)" }}>{s.maxDrawdown.toFixed(1)}%</div>
          <p className="name-dim">S&P 500: {s.benchMaxDrawdown.toFixed(1)}%</p>
        </div>
        <div className="card">
          <div className="label">Sharpe · quarters beating index</div>
          <div className="big">{s.sharpe.toFixed(2)}</div>
          <p className="name-dim">
            {s.quartersBeatingIndex}/{s.quartersTotal} quarters ({winRate}%)
          </p>
        </div>
      </div>

      <section>
        <h2>Growth of $1</h2>
        <div className="chart-box">
          <EquityChart curve={bt.curve} />
        </div>
      </section>

      <section>
        <h2>Recent rebalances</h2>
        <table className="rankings">
          <thead>
            <tr>
              <th>Quarter</th>
              <th style={{ textAlign: "right" }}>Strategy</th>
              <th style={{ textAlign: "right" }}>S&P 500</th>
              <th>Holdings</th>
            </tr>
          </thead>
          <tbody>
            {bt.periods.map((p) => (
              <tr key={p.start} className="row">
                <td className="name-dim">
                  {p.start} → {p.end}
                </td>
                <td
                  style={{ textAlign: "right" }}
                  className={p.stratRet >= p.benchRet ? "score-strong" : "penalty"}
                >
                  {pct(p.stratRet * 100)}
                </td>
                <td style={{ textAlign: "right" }}>{pct(p.benchRet * 100)}</td>
                <td className="name-dim" style={{ fontSize: 12, maxWidth: 420 }}>
                  {p.holdings.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>What this backtest is (and isn't)</h2>
        <div className="analysis">
          <ul style={{ paddingLeft: 18, display: "grid", gap: 8 }}>
            {bt.caveats.map((c) => (
              <li key={c} className="name-dim">{c}</li>
            ))}
          </ul>
        </div>
      </section>

      <p className="disclaimer">
        Backtests are hypothetical and produced by the same transparent rules shown above.
        Nothing here is investment advice.
      </p>
    </main>
  );
}

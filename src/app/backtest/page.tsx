import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import EquityChart, { type EquityPoint } from "@/components/EquityChart";

export const dynamic = "force-dynamic";

interface BacktestResult {
  generatedAt: string;
  model?: string;
  strategy: string;
  universe: string;
  dataSources?: string;
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
    avgTurnoverPct?: number;
    costDragAnnualPct?: number;
    oneWayCostBps?: number;
  };
  subPeriods?: {
    start: string;
    end: string;
    cagr: number;
    benchCagr: number;
    excess: number;
  }[];
  factorProfile?: {
    quality: number;
    value: number;
    momentum: number;
    growth: number;
  } | null;
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
            with <code>npm run backtest</code> (~5-10 min, free Yahoo prices + SEC EDGAR
            filings, no paid API).
          </p>
        </div>
      </main>
    );
  }

  const s = bt.stats;
  const winRate = Math.round((s.quartersBeatingIndex / s.quartersTotal) * 100);
  const isFull = bt.model === "full";
  const factors = bt.factorProfile
    ? ([
        { key: "quality", label: "Quality", color: "var(--q)" },
        { key: "value", label: "Value", color: "var(--v)" },
        { key: "momentum", label: "Momentum", color: "var(--m)" },
        { key: "growth", label: "Growth", color: "var(--g)" },
      ] as const)
    : null;

  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>
        {isFull ? "Backtest — full four-factor model" : "Backtest — momentum + trend"}
      </h1>
      <p className="meta-line">
        {bt.strategy} · {bt.universe} · run{" "}
        {new Date(bt.generatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
      </p>
      {bt.dataSources && (
        <p className="meta-line" style={{ marginTop: 2 }}>
          Data: {bt.dataSources} — free, no paid API.
        </p>
      )}

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

      {bt.subPeriods && bt.subPeriods.length === 2 && (
        <section>
          <h2>Does the edge hold up across time?</h2>
          <p className="name-dim" style={{ marginBottom: 14, maxWidth: 760 }}>
            A headline number can hide an edge that only existed in one stretch of market
            history. Splitting the test in half shows whether this strategy beat the market
            consistently, or only in a favourable regime.
          </p>
          <div className="cards">
            {bt.subPeriods.map((p, i) => (
              <div className="card" key={p.start}>
                <div className="label">
                  {i === 0 ? "First half" : "Second half"} · {p.start.slice(0, 4)}–
                  {p.end.slice(0, 4)}
                </div>
                <div
                  className="big"
                  style={{ color: p.excess >= 0 ? "var(--accent)" : "var(--red)" }}
                >
                  {pct(p.excess)}
                </div>
                <p className="name-dim">
                  strategy {p.cagr.toFixed(1)}% vs market {p.benchCagr.toFixed(1)}% a year
                </p>
              </div>
            ))}
            {(() => {
              const bothPositive = bt.subPeriods!.every((p) => p.excess > 0);
              return (
                <div className="card" style={{ gridColumn: "span 2" }}>
                  <div className="label">Read this before trusting the headline</div>
                  <p>
                    {bothPositive
                      ? "The strategy beat the market in both halves. That is a stronger result than a single total return, though still one market history."
                      : "The strategy did NOT beat the market in both halves. The overall edge comes from one period, not from consistent outperformance, so treat the headline number as regime-dependent rather than reliable."}
                  </p>
                  {s.costDragAnnualPct !== undefined && (
                    <p className="name-dim" style={{ marginTop: 8, fontSize: 12 }}>
                      Returns are after {s.oneWayCostBps ?? 10}bp one-way trading costs, which
                      remove about {s.costDragAnnualPct.toFixed(1)}% a year at{" "}
                      {s.avgTurnoverPct?.toFixed(0) ?? "—"}% average quarterly turnover. Taxes
                      are not modelled.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </section>
      )}

      <section>
        <h2>Growth of $1</h2>
        <div className="chart-box">
          <EquityChart curve={bt.curve} />
        </div>
      </section>

      {factors && bt.factorProfile && (
        <section>
          <h2>Average factor profile of the picks</h2>
          <div className="analysis">
            <p className="name-dim" style={{ marginBottom: 14 }}>
              Mean percentile score of the 20 holdings across every rebalance. Shows which
              factors the model actually leaned on to build these portfolios.
            </p>
            {factors.map((f) => {
              const v = bt.factorProfile![f.key];
              return (
                <div key={f.key} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{f.label}</span>
                    <span className="score-strong">{v.toFixed(0)}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${v}%`, background: f.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2>Recent rebalances</h2>
        <div className="table-scroll">
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
        </div>
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

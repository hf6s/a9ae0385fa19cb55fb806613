"use client";

import Link from "next/link";
import { useState } from "react";
import PriceChart from "@/components/PriceChart";
import RankingsExplorer from "@/components/RankingsExplorer";
import StatTiles, { type Stat } from "@/components/StatTiles";
import type { Candle, RankedStock, RollingWindow } from "@/lib/types";

const FACTOR_META = [
  { key: "quality", label: "Quality", weight: "30%", color: "var(--q)" },
  { key: "value", label: "Value", weight: "25%", color: "var(--v)" },
  { key: "momentum", label: "Momentum", weight: "25%", color: "var(--m)" },
  { key: "growth", label: "Growth", weight: "20%", color: "var(--g)" },
] as const;

export interface Spotlight {
  stock: RankedStock;
  candles: Candle[];
  analysisText: string | null;
  analysisModel: string | null;
}

const fmt = (v: number | null | undefined, suffix = "") =>
  v === null || v === undefined ? "—" : `${Math.round(v * 100) / 100}${suffix}`;


export interface Verdict {
  cagr: number;
  benchCagr: number;
  years: number;
  rolling: RollingWindow[];
}

/**
 * Returns over every possible start date, not just the single full run.
 *
 * One headline CAGR hides how much of a result was the start date. Quarterly
 * reads 14.3% against 14.8%, which looks like a near-miss, yet held over any
 * ten-year window inside the period it lost every time. Showing the hit rate
 * next to the range is the only version of this that is not flattering.
 */
function RollingTable({ rows }: { rows: RollingWindow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rolling">
      <div className="label">Held for how long, starting when?</div>
      <div className="rolling-scroll">
        <table className="rolling-table">
          <thead>
            <tr>
              <th>Holding period</th>
              <th>This model</th>
              <th>S&amp;P 500</th>
              <th>Model ahead</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.years}>
                <th scope="row">
                  {r.years} year{r.years > 1 ? "s" : ""}
                  <span className="name-dim"> · {r.windows.toLocaleString()} windows</span>
                </th>
                <td>
                  {r.stratWorst.toFixed(1)}% to {r.stratBest.toFixed(1)}%
                  <span className="name-dim"> · mid {r.stratMedian.toFixed(1)}%</span>
                </td>
                <td>
                  {r.benchWorst.toFixed(1)}% to {r.benchBest.toFixed(1)}%
                  <span className="name-dim"> · mid {r.benchMedian.toFixed(1)}%</span>
                </td>
                <td className={r.beatPct >= 50 ? "" : "rolling-bad"}>{r.beatPct}% of the time</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="name-dim rolling-note">
        Annualized return for every possible start date in the test window. The last column is
        how often the model finished ahead of the index. Longer holding periods are the honest
        test, and that is where it does worst.
      </p>
    </div>
  );
}

/**
 * What the tool is and is not, shown on BOTH home views.
 *
 * This is the disclosure a buyer needs, so it cannot sit behind a click. The
 * measured numbers come from the backtest result rather than the source, so a
 * re-run can never leave a stale performance claim on the page.
 */
function HonestSummary({
  verdict,
}: {
  verdict: Verdict | null;
}) {
  return (
    <section className="honesty">
      <h2>What this is, and what it isn&apos;t</h2>
      <div className="honesty-grid">
        <div className="honesty-card">
          <div className="label">What it does</div>
          <p>
            Scans US stocks every two days and ranks them on published academic criteria:
            quality, value, momentum and growth. Every number traces back to SEC filings and
            market prices, and the AI write-up explains why a company ranks where it does.
          </p>
        </div>
        <div className="honesty-card">
          <div className="label">What it does not do</div>
          {verdict ? (
            <p>
              Beat the market. Over {verdict.years} years the model returned{" "}
              <strong>{verdict.cagr.toFixed(1)}% a year</strong> against the S&amp;P 500&apos;s{" "}
              <strong>{verdict.benchCagr.toFixed(1)}%</strong>, after trading costs. Six
              different factor weightings and a 4,500-stock universe were tested. None beat
              the index either.
            </p>
          ) : (
            <p>
              Beat the market. The backtest measures this honestly rather than assuming it.
            </p>
          )}
        </div>
        <div className="honesty-card">
          <div className="label">Use it for</div>
          <p>
            Finding and understanding companies with strong fundamentals, and seeing the
            reasoning rather than a black-box score. Not as a system that outperforms.
          </p>
        </div>
      </div>
      {verdict && <RollingTable rows={verdict.rolling} />}
      <p className="name-dim" style={{ fontSize: 12, marginTop: 12 }}>
        The backtest is survivorship-corrected, uses point-in-time filings with no lookahead,
        charges trading costs, and reports both halves of its test period separately.{" "}
        <Link href="/backtest" style={{ color: "var(--accent)" }}>
          See the full results
        </Link>
        .
      </p>
    </section>
  );
}

export default function HomeView({
  stocks,
  sparks,
  prevRanks,
  stats,
  metaLine,
  spotlight,
  verdict,
}: {
  stocks: RankedStock[];
  sparks: Record<string, number[]>;
  prevRanks: Record<string, number>;
  stats: Stat[];
  metaLine: string;
  spotlight: Spotlight | null;
  /** Measured performance, straight from the backtest result. */
  verdict: Verdict | null;
}) {
  const [view, setView] = useState<"spotlight" | "list">(spotlight ? "spotlight" : "list");

  if (view === "list" || !spotlight) {
    return (
      <>
        {spotlight && (
          <button className="back-link view-switch" onClick={() => setView("spotlight")}>
            ← Back to #1 {spotlight.stock.ticker}
          </button>
        )}
        <StatTiles stats={stats} />
        <p className="meta-line">{metaLine}</p>
        <RankingsExplorer stocks={stocks} sparks={sparks} prevRanks={prevRanks} />
        <HonestSummary verdict={verdict} />

        <p className="disclaimer">
          Factor20 ranks stocks with a mechanical, transparent factor model and AI-written
          commentary. Holding-period presets re-weight the same four factor scores. Shorter
          horizons emphasize momentum, longer horizons emphasize quality and value, following the
          academic evidence on factor decay. Nothing here is investment advice or a recommendation
          to buy or sell any security. Do your own research.
        </p>
      </>
    );
  }

  const { stock, candles, analysisText, analysisModel } = spotlight;
  const m = stock.metrics;

  return (
    <section className="hero">
      <div className="hero-head">
        <span className="hero-rank">#1</span>
        <h1 className="hero-title">
          {stock.ticker} <span className="name-dim">{stock.name}</span>
        </h1>
        <span className="price-big">${stock.price.toFixed(2)}</span>
        <span className="badge">Score {stock.finalScore.toFixed(1)}</span>
        <button className="btn-outline" onClick={() => setView("list")}>
          View all top 20 →
        </button>
      </div>

      <p className="meta-line">
        {stock.sector} · Market cap ${Math.round(stock.marketCap / 1000)}B · Top-ranked on the
        latest scan
        {stock.penalties.length > 0 && (
          <>
            {" · "}
            {stock.penalties.map((p) => (
              <span key={p.reason} className="penalty">
                {p.reason} (−{p.points}){" "}
              </span>
            ))}
          </>
        )}
      </p>

      <div className="hero-grid">
        <div className="hero-left">
          <h2>Price · 50/200-day trend</h2>
          {candles.length > 0 ? (
            <div className="chart-box">
              <PriceChart candles={candles} />
            </div>
          ) : (
            <div className="empty-state">
              <p>No price history stored for {stock.ticker} yet.</p>
            </div>
          )}
        </div>

        <div className="hero-right">
          <h2>Why it ranks first</h2>
          <div className="hero-factors">
            {FACTOR_META.map((f) => {
              const score = stock.scores[f.key];
              return (
                <div className="hero-factor" key={f.key}>
                  <div className="hero-factor-head">
                    <span>
                      {f.label} <span className="name-dim">{f.weight}</span>
                    </span>
                    <strong>{score.toFixed(1)}</strong>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${score}%`, background: f.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="analysis hero-analysis">
            {analysisText ? (
              <>
                {analysisText.split(/\n\s*\n/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
                <p className="analysis-meta">
                  Written by {analysisModel} · interprets the factor model, not investment advice
                </p>
              </>
            ) : (
              <p className="name-dim">
                No AI write-up yet for {stock.ticker}. Run <code>npm run analyze</code>.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="hero-bottom">
        <h2>Key metrics</h2>
        <div className="cards">
          <div className="card">
            <div className="label">Valuation</div>
            <p>P/E {fmt(m.pe)} · P/B {fmt(m.pb)}</p>
            <p>P/S {fmt(m.ps)} · P/FCF {fmt(m.pfcf)}</p>
          </div>
          <div className="card">
            <div className="label">Profitability</div>
            <p>ROE {fmt(m.roe, "%")} · ROIC {fmt(m.roic, "%")}</p>
            <p>GM {fmt(m.grossMargin, "%")} · OM {fmt(m.operatingMargin, "%")}</p>
          </div>
          <div className="card">
            <div className="label">Balance sheet</div>
            <p>Debt/Equity {fmt(m.debtToEquity)} · Debt/EBITDA {fmt(m.debtToEbitda)}</p>
            <p>Altman Z {fmt(m.altmanZ)} · Piotroski F {fmt(m.piotroskiF)}/9</p>
          </div>
          <div className="card">
            <div className="label">Growth</div>
            <p>Revenue {fmt(m.revenueGrowth, "%")} yoy</p>
            <p>EPS {fmt(m.epsGrowth, "%")} yoy · FCF {fmt(m.fcfGrowth, "%")} yoy</p>
          </div>
        </div>

        <div className="hero-actions">
          <Link href={`/stock/${stock.ticker}`} className="btn-outline">
            Full {stock.ticker} page →
          </Link>
          <button className="btn-outline" onClick={() => setView("list")}>
            View all top 20 →
          </button>
        </div>
        <HonestSummary verdict={verdict} />

        <p className="disclaimer">{metaLine}. Nothing here is investment advice.</p>
      </div>
    </section>
  );
}

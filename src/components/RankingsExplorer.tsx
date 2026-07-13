"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RankedStock } from "@/lib/types";

/**
 * Holding-horizon presets. Evidence-based: momentum pays off over 3-12
 * months (Jegadeesh & Titman) and decays/reverses beyond that, while the
 * value and quality premia converge over multi-year horizons. Growth is
 * held constant. Penalties always apply in full.
 */
const HORIZONS = [
  { key: "3m", label: "3 mo", q: 0.2, v: 0.1, m: 0.5, g: 0.2 },
  { key: "6m", label: "6 mo", q: 0.25, v: 0.15, m: 0.4, g: 0.2 },
  { key: "1y", label: "1 yr", q: 0.3, v: 0.25, m: 0.25, g: 0.2 },
  { key: "2y", label: "2 yr", q: 0.35, v: 0.3, m: 0.15, g: 0.2 },
  { key: "4y", label: "4+ yr", q: 0.4, v: 0.35, m: 0.05, g: 0.2 },
] as const;

const CAPS = [
  { key: "all", label: "All (>$2B)", min: 0, max: Infinity },
  { key: "mid", label: "Mid $2–10B", min: 0, max: 10_000 },
  { key: "large", label: "Large $10–200B", min: 10_000, max: 200_000 },
  { key: "mega", label: "Mega $200B+", min: 200_000, max: Infinity },
] as const;

const DEFAULT_HORIZON = "1y";

const scoreClass = (v: number) => (v >= 60 ? "sc-hi" : v >= 40 ? "sc-mid" : "sc-lo");

export default function RankingsExplorer({ stocks }: { stocks: RankedStock[] }) {
  const [horizonKey, setHorizonKey] = useState<string>(DEFAULT_HORIZON);
  const [capKey, setCapKey] = useState<string>("all");

  const horizon = HORIZONS.find((h) => h.key === horizonKey) ?? HORIZONS[2];
  const cap = CAPS.find((c) => c.key === capKey) ?? CAPS[0];

  const ranked = useMemo(() => {
    return stocks
      .filter((s) => s.marketCap >= cap.min && s.marketCap < cap.max)
      .map((s) => {
        const base =
          horizon.q * s.scores.quality +
          horizon.v * s.scores.value +
          horizon.m * s.scores.momentum +
          horizon.g * s.scores.growth;
        const penalty = s.penalties.reduce((a, p) => a + p.points, 0);
        return { ...s, viewScore: Math.max(0, Math.round((base - penalty) * 10) / 10) };
      })
      .sort((a, b) => b.viewScore - a.viewScore);
  }, [stocks, horizon, cap]);

  return (
    <div>
      <div className="controls">
        <div className="control-group">
          <span className="control-label">Holding period</span>
          <div className="seg">
            {HORIZONS.map((h) => (
              <button
                key={h.key}
                className={h.key === horizonKey ? "active" : ""}
                onClick={() => setHorizonKey(h.key)}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
        <div className="control-group">
          <span className="control-label">Market cap</span>
          <div className="seg">
            {CAPS.map((c) => (
              <button
                key={c.key}
                className={c.key === capKey ? "active" : ""}
                onClick={() => setCapKey(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="weights-line">
        Weights for this horizon: Quality {Math.round(horizon.q * 100)}% · Value{" "}
        {Math.round(horizon.v * 100)}% · Momentum {Math.round(horizon.m * 100)}% · Growth{" "}
        {Math.round(horizon.g * 100)}%
        {horizonKey !== DEFAULT_HORIZON &&
          " — shorter holds lean on momentum; longer holds lean on quality and value"}
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
          {ranked.map((s, i) => (
            <tr key={s.ticker} className="row">
              <td className="rank-cell">{i + 1}</td>
              <td>
                <Link href={`/stock/${s.ticker}`}>
                  <span className="ticker">{s.ticker}</span>{" "}
                  <span className="name-dim">{s.name}</span>
                </Link>
              </td>
              <td style={{ textAlign: "right" }}>${s.price.toFixed(2)}</td>
              <td style={{ textAlign: "right" }} className="score-strong">
                {s.viewScore.toFixed(1)}
              </td>
              <td style={{ textAlign: "right" }}>
                <span className={`factor-mini ${scoreClass(s.scores.quality)}`}>
                  {Math.round(s.scores.quality)}
                </span>
              </td>
              <td style={{ textAlign: "right" }}>
                <span className={`factor-mini ${scoreClass(s.scores.value)}`}>
                  {Math.round(s.scores.value)}
                </span>
              </td>
              <td style={{ textAlign: "right" }}>
                <span className={`factor-mini ${scoreClass(s.scores.momentum)}`}>
                  {Math.round(s.scores.momentum)}
                </span>
              </td>
              <td style={{ textAlign: "right" }}>
                <span className={`factor-mini ${scoreClass(s.scores.growth)}`}>
                  {Math.round(s.scores.growth)}
                </span>
              </td>
              <td>
                {i < 20 ? <span className="badge">Top 20</span> : (
                  <span className="watch">watch</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranked.length === 0 && (
        <p className="name-dim" style={{ padding: "24px 12px" }}>
          No survivors in this market-cap range on the latest scan.
        </p>
      )}
    </div>
  );
}

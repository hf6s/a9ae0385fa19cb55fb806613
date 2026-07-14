"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { RankedStock } from "@/lib/types";

const WATCHLIST_KEY = "f20-watchlist";

export function readWatchlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function toggleWatch(ticker: string): string[] {
  const list = readWatchlist();
  const next = list.includes(ticker) ? list.filter((t) => t !== ticker) : [...list, ticker];
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  return next;
}

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

function Sparkline({ points }: { points: number[] }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 88;
  const h = 26;
  const path = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - 2 - ((p - min) / range) * (h - 4)}`)
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      <polyline
        points={path}
        fill="none"
        stroke={up ? "var(--accent)" : "var(--red)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function exportCsv(
  rows: (RankedStock & { viewScore: number })[],
  horizonLabel: string,
): void {
  const header = "rank,ticker,name,sector,price,score,quality,value,momentum,growth,penalties";
  const lines = rows.map((s, i) =>
    [
      i + 1,
      s.ticker,
      `"${s.name.replace(/"/g, '""')}"`,
      `"${s.sector}"`,
      s.price,
      s.viewScore,
      s.scores.quality,
      s.scores.value,
      s.scores.momentum,
      s.scores.growth,
      `"${s.penalties.map((p) => p.reason).join("; ")}"`,
    ].join(","),
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `factor20-${horizonLabel.replace(/\s/g, "")}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function RankingsExplorer({
  stocks,
  sparks = {},
  prevRanks = {},
}: {
  stocks: RankedStock[];
  sparks?: Record<string, number[]>;
  prevRanks?: Record<string, number>;
}) {
  const [horizonKey, setHorizonKey] = useState<string>(DEFAULT_HORIZON);
  const [capKey, setCapKey] = useState<string>("all");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchOnly, setWatchOnly] = useState(false);

  useEffect(() => {
    setWatchlist(readWatchlist());
  }, []);

  const horizon = HORIZONS.find((h) => h.key === horizonKey) ?? HORIZONS[2];
  const cap = CAPS.find((c) => c.key === capKey) ?? CAPS[0];

  const ranked = useMemo(() => {
    return stocks
      // one slot per company (duplicate share classes like GOOG/GOOGL)
      .filter(
        (s, i, arr) =>
          arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === i,
      )
      .filter((s) => s.marketCap >= cap.min && s.marketCap < cap.max)
      .filter((s) => !watchOnly || watchlist.includes(s.ticker))
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
  }, [stocks, horizon, cap, watchOnly, watchlist]);

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
        <div className="control-group">
          <div className="seg">
            <button
              className={watchOnly ? "active" : ""}
              onClick={() => setWatchOnly((w) => !w)}
              title="Show only starred stocks"
            >
              ★ Watchlist{watchlist.length > 0 ? ` (${watchlist.length})` : ""}
            </button>
          </div>
        </div>
      </div>
      <div className="weights-row">
        <p className="weights-line">
          Weights for this horizon: Quality {Math.round(horizon.q * 100)}% · Value{" "}
          {Math.round(horizon.v * 100)}% · Momentum {Math.round(horizon.m * 100)}% · Growth{" "}
          {Math.round(horizon.g * 100)}%
          {horizonKey !== DEFAULT_HORIZON &&
            " — shorter holds lean on momentum; longer holds lean on quality and value"}
        </p>
        <button className="csv-btn" onClick={() => exportCsv(ranked, horizon.label)}>
          ⤓ CSV
        </button>
      </div>

      <div className="table-scroll">
      <table className="rankings">
        <thead>
          <tr>
            <th>#</th>
            <th className="star-col"></th>
            <th>Company</th>
            <th className="spark-col"></th>
            <th style={{ textAlign: "right" }}>Price</th>
            <th style={{ textAlign: "right" }}>Score</th>
            <th style={{ textAlign: "right" }}>Q</th>
            <th style={{ textAlign: "right" }}>V</th>
            <th style={{ textAlign: "right" }}>M</th>
            <th style={{ textAlign: "right" }}>G</th>
            <th></th>
          </tr>
        </thead>
        <tbody key={`${horizonKey}-${capKey}`}>
          {ranked.map((s, i) => (
            <tr
              key={s.ticker}
              className="row row-in"
              style={{ animationDelay: `${Math.min(i, 25) * 18}ms` }}
            >
              <td className="rank-cell">
                {i + 1}
                {(() => {
                  const p = prevRanks[s.ticker];
                  if (p === undefined || p === s.rank) return null;
                  const up = p > s.rank;
                  return (
                    <span className={`delta ${up ? "sc-hi" : "sc-lo"}`} title={`was #${p}`}>
                      {up ? "▲" : "▼"}
                    </span>
                  );
                })()}
              </td>
              <td>
                <button
                  className={`star ${watchlist.includes(s.ticker) ? "on" : ""}`}
                  title={watchlist.includes(s.ticker) ? "Remove from watchlist" : "Add to watchlist"}
                  onClick={() => setWatchlist(toggleWatch(s.ticker))}
                >
                  ★
                </button>
              </td>
              <td>
                <Link href={`/stock/${s.ticker}`}>
                  <span className="ticker">{s.ticker}</span>{" "}
                  <span className="name-dim">{s.name}</span>
                </Link>
              </td>
              <td className="spark-col">
                {sparks[s.ticker] ? <Sparkline points={sparks[s.ticker]} /> : null}
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
      </div>
      {ranked.length === 0 && (
        <p className="name-dim" style={{ padding: "24px 12px" }}>
          No survivors in this market-cap range on the latest scan.
        </p>
      )}
    </div>
  );
}

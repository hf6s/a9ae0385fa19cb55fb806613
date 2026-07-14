"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FactorScores, RankedStock } from "@/lib/types";

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
const MAX_COMPARE = 4;

/** 0 (red) → 50 (amber) → 100 (green) heat color. */
function heatColor(v: number): string {
  const hue = (Math.max(0, Math.min(100, v)) / 100) * 132;
  return `hsl(${hue}, 58%, 42%)`;
}

function daysUntil(dateStr: string): number {
  return Math.ceil((Date.parse(dateStr) - Date.now()) / (24 * 3600 * 1000));
}

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

type Row = RankedStock & { viewScore: number; eff: FactorScores };

function exportCsv(rows: Row[], horizonLabel: string): void {
  const header = "rank,ticker,name,sector,price,score,quality,value,momentum,growth,penalties";
  const lines = rows.map((s, i) =>
    [
      i + 1,
      s.ticker,
      `"${s.name.replace(/"/g, '""')}"`,
      `"${s.sector}"`,
      s.price,
      s.viewScore,
      s.eff.quality,
      s.eff.value,
      s.eff.momentum,
      s.eff.growth,
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

/** Percentile rank of value within arr (0-100). */
function pctRank(value: number, arr: number[]): number {
  if (arr.length < 2) return 50;
  const below = arr.filter((x) => x < value).length;
  return (below / (arr.length - 1)) * 100;
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
  const router = useRouter();
  const [horizonKey, setHorizonKey] = useState<string>(DEFAULT_HORIZON);
  const [capKey, setCapKey] = useState<string>("all");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchOnly, setWatchOnly] = useState(false);
  const [sectorRel, setSectorRel] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);

  useEffect(() => {
    setWatchlist(readWatchlist());
  }, []);

  const horizon = HORIZONS.find((h) => h.key === horizonKey) ?? HORIZONS[2];
  const cap = CAPS.find((c) => c.key === capKey) ?? CAPS[0];

  const ranked: Row[] = useMemo(() => {
    const base = stocks
      .filter(
        (s, i, arr) =>
          arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === i,
      )
      .filter((s) => s.marketCap >= cap.min && s.marketCap < cap.max)
      .filter((s) => !watchOnly || watchlist.includes(s.ticker));

    // Sector-relative: re-percentile each factor within its sector so a bank is
    // scored against banks, not against software. Removes structural bias.
    let effScores: (s: RankedStock) => FactorScores;
    if (sectorRel) {
      const bySector = new Map<string, RankedStock[]>();
      for (const s of base) {
        const arr = bySector.get(s.sector) ?? [];
        arr.push(s);
        bySector.set(s.sector, arr);
      }
      const cols = (arr: RankedStock[], key: keyof FactorScores) =>
        arr.map((x) => x.scores[key]);
      effScores = (s) => {
        const peers = bySector.get(s.sector) ?? [s];
        return {
          quality: Math.round(pctRank(s.scores.quality, cols(peers, "quality")) * 10) / 10,
          value: Math.round(pctRank(s.scores.value, cols(peers, "value")) * 10) / 10,
          momentum: Math.round(pctRank(s.scores.momentum, cols(peers, "momentum")) * 10) / 10,
          growth: Math.round(pctRank(s.scores.growth, cols(peers, "growth")) * 10) / 10,
        };
      };
    } else {
      effScores = (s) => s.scores;
    }

    return base
      .map((s) => {
        const eff = effScores(s);
        const raw = horizon.q * eff.quality + horizon.v * eff.value + horizon.m * eff.momentum + horizon.g * eff.growth;
        const penalty = s.penalties.reduce((a, p) => a + p.points, 0);
        return { ...s, eff, viewScore: Math.max(0, Math.round((raw - penalty) * 10) / 10) };
      })
      .sort((a, b) => b.viewScore - a.viewScore);
  }, [stocks, horizon, cap, watchOnly, watchlist, sectorRel]);

  function toggleCompare(ticker: string) {
    setCompare((c) =>
      c.includes(ticker) ? c.filter((t) => t !== ticker) : c.length < MAX_COMPARE ? [...c, ticker] : c,
    );
  }

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
          <div className="seg">
            <button
              className={sectorRel ? "active" : ""}
              onClick={() => setSectorRel((s) => !s)}
              title="Score each factor within the stock's own sector"
            >
              ⇄ Sector-relative
            </button>
          </div>
        </div>
      </div>
      <div className="weights-row">
        <p className="weights-line">
          Weights: Quality {Math.round(horizon.q * 100)}% · Value {Math.round(horizon.v * 100)}% ·
          Momentum {Math.round(horizon.m * 100)}% · Growth {Math.round(horizon.g * 100)}%
          {sectorRel
            ? " — factors ranked within each sector"
            : horizonKey !== DEFAULT_HORIZON
              ? " — shorter holds lean on momentum; longer on quality/value"
              : ""}
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
              <th></th>
            </tr>
          </thead>
          <tbody key={`${horizonKey}-${capKey}-${sectorRel}`}>
            {ranked.map((s, i) => {
              const earnDays = s.nextEarningsDate ? daysUntil(s.nextEarningsDate) : null;
              return (
                <tr key={s.ticker} className="row row-in" style={{ animationDelay: `${Math.min(i, 25) * 18}ms` }}>
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
                    {earnDays !== null && earnDays >= 0 && earnDays <= 7 && (
                      <span className="earn-badge" title={`Earnings ${s.nextEarningsDate}`}>
                        ⚠ reports in {earnDays}d
                      </span>
                    )}
                  </td>
                  <td className="spark-col">
                    {sparks[s.ticker] ? <Sparkline points={sparks[s.ticker]} /> : null}
                  </td>
                  <td style={{ textAlign: "right" }}>${s.price.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }} className="score-strong">
                    {s.viewScore.toFixed(1)}
                  </td>
                  {(["quality", "value", "momentum", "growth"] as const).map((k) => (
                    <td key={k} style={{ textAlign: "right" }}>
                      <span className="heat" style={{ background: heatColor(s.eff[k]) }}>
                        {Math.round(s.eff[k])}
                      </span>
                    </td>
                  ))}
                  <td>
                    {i < 20 ? <span className="badge">Top 20</span> : <span className="watch">watch</span>}
                  </td>
                  <td className="compare-cell">
                    <button
                      className={compare.includes(s.ticker) ? "on" : ""}
                      onClick={() => toggleCompare(s.ticker)}
                      title="Add to compare"
                    >
                      {compare.includes(s.ticker) ? "✓" : "+"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ranked.length === 0 && (
        <p className="name-dim" style={{ padding: "24px 12px" }}>
          No survivors in this market-cap range on the latest scan.
        </p>
      )}

      {compare.length > 0 && (
        <div className="compare-tray">
          {compare.map((t) => (
            <span key={t} className="chip">
              {t}
              <button onClick={() => toggleCompare(t)} title="Remove">
                ✕
              </button>
            </span>
          ))}
          <button
            className="btn-outline"
            disabled={compare.length < 2}
            onClick={() => router.push(`/compare?t=${compare.join(",")}`)}
          >
            Compare {compare.length} →
          </button>
        </div>
      )}
    </div>
  );
}

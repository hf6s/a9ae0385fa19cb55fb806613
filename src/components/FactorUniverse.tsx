"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { RankedStock } from "@/lib/types";

const W = 1000;
const H = 620;
const PAD = 56;

type Axis = "value" | "momentum" | "quality" | "growth";

const AXES: { key: Axis; label: string }[] = [
  { key: "value", label: "Value" },
  { key: "momentum", label: "Momentum" },
  { key: "quality", label: "Quality" },
  { key: "growth", label: "Growth" },
];

function heat(v: number): string {
  const hue = (Math.max(0, Math.min(100, v)) / 100) * 132;
  return `hsl(${hue}, 62%, 48%)`;
}

function radius(marketCap: number): number {
  // marketCap in USD millions; log scale
  const r = (Math.log10(Math.max(1500, marketCap)) - 3) * 8;
  return Math.max(6, Math.min(30, r));
}

export default function FactorUniverse({ stocks }: { stocks: RankedStock[] }) {
  const router = useRouter();
  const [xAxis, setXAxis] = useState<Axis>("value");
  const [yAxis, setYAxis] = useState<Axis>("momentum");
  const [active, setActive] = useState<string | null>(null);

  const data = useMemo(
    () =>
      stocks
        .filter((s, i, arr) => arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === i)
        .map((s) => ({
          s,
          x: PAD + (s.scores[xAxis] / 100) * (W - 2 * PAD),
          y: H - PAD - (s.scores[yAxis] / 100) * (H - 2 * PAD),
          r: radius(s.marketCap),
        })),
    [stocks, xAxis, yAxis],
  );

  const sel = active ? data.find((d) => d.s.ticker === active) : null;

  return (
    <div>
      <div className="uni-controls">
        <div className="control-group">
          <span className="control-label">X</span>
          <div className="seg">
            {AXES.map((a) => (
              <button key={a.key} className={a.key === xAxis ? "active" : ""} onClick={() => setXAxis(a.key)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="control-group">
          <span className="control-label">Y</span>
          <div className="seg">
            {AXES.map((a) => (
              <button key={a.key} className={a.key === yAxis ? "active" : ""} onClick={() => setYAxis(a.key)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <span className="name-dim" style={{ fontSize: 12 }}>
          Bubble size = market cap · color = final score · tap a bubble
        </span>
      </div>

      <div className="uni-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="uni-svg" onClick={() => setActive(null)}>
          {/* grid */}
          {[0.25, 0.5, 0.75].map((g) => (
            <g key={g}>
              <line x1={PAD + g * (W - 2 * PAD)} y1={PAD} x2={PAD + g * (W - 2 * PAD)} y2={H - PAD} stroke="var(--border)" strokeWidth="1" />
              <line x1={PAD} y1={H - PAD - g * (H - 2 * PAD)} x2={W - PAD} y2={H - PAD - g * (H - 2 * PAD)} stroke="var(--border)" strokeWidth="1" />
            </g>
          ))}
          {/* frame */}
          <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} fill="none" stroke="var(--border)" strokeWidth="1.5" />
          {/* axis labels */}
          <text x={W / 2} y={H - 14} fill="var(--text-dim)" fontSize="15" textAnchor="middle">
            {AXES.find((a) => a.key === xAxis)?.label} score →
          </text>
          <text x={18} y={H / 2} fill="var(--text-dim)" fontSize="15" textAnchor="middle" transform={`rotate(-90 18 ${H / 2})`}>
            {AXES.find((a) => a.key === yAxis)?.label} score →
          </text>

          {/* bubbles */}
          {data.map((d, i) => (
            <circle
              key={d.s.ticker}
              cx={d.x}
              cy={d.y}
              r={d.r}
              fill={heat(d.s.finalScore)}
              fillOpacity={active && active !== d.s.ticker ? 0.18 : 0.72}
              stroke={active === d.s.ticker ? "var(--text)" : "transparent"}
              strokeWidth="2"
              className="uni-bubble"
              style={{ animationDelay: `${Math.min(i, 60) * 12}ms` }}
              onClick={(e) => {
                e.stopPropagation();
                setActive(active === d.s.ticker ? null : d.s.ticker);
              }}
              onMouseEnter={() => setActive(d.s.ticker)}
            />
          ))}
          {/* label a few top bubbles */}
          {data.slice(0, 8).map((d) => (
            <text key={d.s.ticker} x={d.x} y={d.y - d.r - 3} fill="var(--text-dim)" fontSize="11" textAnchor="middle" pointerEvents="none">
              {d.s.ticker}
            </text>
          ))}
        </svg>

        {sel && (
          <button
            className="uni-card"
            onClick={() => router.push(`/stock/${sel.s.ticker}`)}
            style={{
              left: `${(sel.x / W) * 100}%`,
              top: `${(sel.y / H) * 100}%`,
            }}
          >
            <span className="ticker">{sel.s.ticker}</span>
            <span className="name-dim" style={{ fontSize: 12 }}> {sel.s.name}</span>
            <div className="uni-card-scores">
              <span>Score {sel.s.finalScore.toFixed(1)}</span>
              <span>Q{Math.round(sel.s.scores.quality)}</span>
              <span>V{Math.round(sel.s.scores.value)}</span>
              <span>M{Math.round(sel.s.scores.momentum)}</span>
              <span>G{Math.round(sel.s.scores.growth)}</span>
            </div>
            <span className="uni-card-go">Open →</span>
          </button>
        )}
      </div>
    </div>
  );
}

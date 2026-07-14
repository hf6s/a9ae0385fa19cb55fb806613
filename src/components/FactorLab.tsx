"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RankedStock } from "@/lib/types";

interface Weights {
  q: number;
  v: number;
  m: number;
  g: number;
}

const FACTORS: { key: keyof Weights; scoreKey: "quality" | "value" | "momentum" | "growth"; label: string; color: string }[] = [
  { key: "q", scoreKey: "quality", label: "Quality", color: "var(--q)" },
  { key: "v", scoreKey: "value", label: "Value", color: "var(--v)" },
  { key: "m", scoreKey: "momentum", label: "Momentum", color: "var(--m)" },
  { key: "g", scoreKey: "growth", label: "Growth", color: "var(--g)" },
];

function Radar({ scores, size = 220 }: { scores: number[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 34;
  // axes: Quality top, Value right, Momentum bottom, Growth left
  const angles = [-90, 0, 90, 180].map((a) => (a * Math.PI) / 180);
  const point = (val: number, i: number) => {
    const d = (Math.max(0, Math.min(100, val)) / 100) * r;
    return [cx + d * Math.cos(angles[i]), cy + d * Math.sin(angles[i])];
  };
  const poly = scores.map((s, i) => point(s, i).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1];
  const labels = ["Q", "V", "M", "G"];
  return (
    <svg width={size} height={size} className="radar">
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={[0, 1, 2, 3].map((i) => point(ring * 100, i).join(",")).join(" ")}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1"
        />
      ))}
      {[0, 1, 2, 3].map((i) => {
        const [x, y] = point(100, i);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="var(--accent)" fillOpacity="0.28" stroke="var(--accent)" strokeWidth="2" />
      {labels.map((l, i) => {
        const [x, y] = point(122, i);
        return (
          <text key={l} x={x} y={y} fill="var(--text-dim)" fontSize="12" textAnchor="middle" dominantBaseline="middle">
            {l}
          </text>
        );
      })}
    </svg>
  );
}

export default function FactorLab({
  stocks,
  initial,
}: {
  stocks: RankedStock[];
  initial: Weights;
}) {
  const [w, setW] = useState<Weights>(initial);
  const [copied, setCopied] = useState(false);

  const total = w.q + w.v + w.m + w.g || 1;
  const norm = { q: w.q / total, v: w.v / total, m: w.m / total, g: w.g / total };

  const ranked = useMemo(() => {
    return stocks
      .filter((s, i, arr) => arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === i)
      .map((s) => {
        const raw =
          norm.q * s.scores.quality +
          norm.v * s.scores.value +
          norm.m * s.scores.momentum +
          norm.g * s.scores.growth;
        const penalty = s.penalties.reduce((a, p) => a + p.points, 0);
        return { s, score: Math.max(0, raw - penalty) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
  }, [stocks, norm.q, norm.v, norm.m, norm.g]);

  const top = ranked[0]?.s;

  function set(key: keyof Weights, value: number) {
    setW((prev) => ({ ...prev, [key]: value }));
    setCopied(false);
  }

  function copyLink() {
    const url = `${location.origin}/lab?q=${w.q}&v=${w.v}&m=${w.m}&g=${w.g}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
  }

  const presets: { label: string; w: Weights }[] = [
    { label: "Equal", w: { q: 25, v: 25, m: 25, g: 25 } },
    { label: "Default 1yr", w: { q: 30, v: 25, m: 25, g: 20 } },
    { label: "Deep value", w: { q: 20, v: 55, m: 10, g: 15 } },
    { label: "Pure momentum", w: { q: 10, v: 5, m: 75, g: 10 } },
    { label: "Quality growth", w: { q: 45, v: 10, m: 15, g: 30 } },
  ];

  return (
    <div className="lab">
      <div className="lab-controls">
        <div className="lab-sliders">
          {FACTORS.map((f) => (
            <div className="lab-slider" key={f.key}>
              <div className="lab-slider-head">
                <span style={{ color: f.color, fontWeight: 600 }}>{f.label}</span>
                <span className="lab-pct">{Math.round(norm[f.key] * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={w[f.key]}
                style={{ accentColor: f.color }}
                onChange={(e) => set(f.key, Number(e.target.value))}
              />
            </div>
          ))}
          <div className="lab-presets">
            {presets.map((p) => (
              <button key={p.label} className="chip-btn" onClick={() => { setW(p.w); setCopied(false); }}>
                {p.label}
              </button>
            ))}
            <button className="chip-btn accent" onClick={copyLink}>
              {copied ? "✓ Link copied" : "⧉ Share this mix"}
            </button>
          </div>
        </div>

        {top && (
          <div className="lab-radar-card">
            <div className="label">Top pick profile</div>
            <Radar scores={[top.scores.quality, top.scores.value, top.scores.momentum, top.scores.growth]} />
            <Link href={`/stock/${top.ticker}`} className="ticker" style={{ fontSize: 18 }}>
              {top.ticker}
            </Link>
            <p className="name-dim" style={{ fontSize: 13 }}>{top.name}</p>
          </div>
        )}
      </div>

      <div className="table-scroll">
        <table className="rankings">
          <thead>
            <tr>
              <th>#</th>
              <th>Company</th>
              <th style={{ textAlign: "right" }}>Your score</th>
              <th style={{ textAlign: "right" }}>Q</th>
              <th style={{ textAlign: "right" }}>V</th>
              <th style={{ textAlign: "right" }}>M</th>
              <th style={{ textAlign: "right" }}>G</th>
            </tr>
          </thead>
          <tbody key={`${w.q}-${w.v}-${w.m}-${w.g}`}>
            {ranked.map((r, i) => (
              <tr key={r.s.ticker} className="row row-in" style={{ animationDelay: `${Math.min(i, 15) * 22}ms` }}>
                <td className="rank-cell">{i + 1}</td>
                <td>
                  <Link href={`/stock/${r.s.ticker}`}>
                    <span className="ticker">{r.s.ticker}</span>{" "}
                    <span className="name-dim">{r.s.name}</span>
                  </Link>
                </td>
                <td style={{ textAlign: "right" }} className="score-strong">{r.score.toFixed(1)}</td>
                {FACTORS.map((f) => (
                  <td key={f.key} style={{ textAlign: "right" }} className="name-dim">
                    {Math.round(r.s.scores[f.scoreKey])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

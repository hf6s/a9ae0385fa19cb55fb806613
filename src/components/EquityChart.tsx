"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";

export interface EquityPoint {
  t: string;
  strat: number;
  bench: number;
}

function cssVar(name: string, fb: string): string {
  if (typeof window === "undefined") return fb;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
}

/**
 * Thin the series to at most `max` points so lightweight-charts' minimum bar
 * spacing can't clip a multi-year curve to the last few years on a narrow
 * viewport. Always keeps the first and last point so the full range shows.
 */
function downsample(curve: EquityPoint[], max = 450): EquityPoint[] {
  if (curve.length <= max) return curve;
  const step = Math.ceil(curve.length / max);
  const out: EquityPoint[] = [];
  for (let i = 0; i < curve.length; i += step) out.push(curve[i]);
  if (out[out.length - 1] !== curve[curve.length - 1]) out.push(curve[curve.length - 1]);
  return out;
}

export default function EquityChart({ curve }: { curve: EquityPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState(0);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const green = cssVar("--accent", "#4fd1a5");
    const blue = cssVar("--q", "#6ea8fe");
    const dim = cssVar("--text-dim", "#8b94a7");
    const border = cssVar("--border", "#232a37");
    const grid = cssVar("--bg-hover", "#171c26");

    const chart: IChartApi = createChart(containerRef.current, {
      height: 400,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: dim },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border },
      crosshair: { mode: 1 },
      autoSize: true,
    });

    const data = downsample(curve);
    const strat = chart.addLineSeries({ color: green, lineWidth: 2, priceLineVisible: false, title: "Strategy" });
    strat.setData(data.map((p) => ({ time: p.t, value: p.strat })));

    const bench = chart.addLineSeries({ color: blue, lineWidth: 1, priceLineVisible: false, title: "S&P 500" });
    bench.setData(data.map((p) => ({ time: p.t, value: p.bench })));

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [curve, theme]);

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%" }} />
      <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
        <span style={{ color: "var(--accent)" }}>—</span> Strategy (growth of $1)&nbsp;&nbsp;
        <span style={{ color: "var(--q)" }}>—</span> S&amp;P 500
      </p>
    </div>
  );
}

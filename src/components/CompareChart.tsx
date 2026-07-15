"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";
import type { Candle } from "@/lib/types";

const COLORS = ["#4fd1a5", "#6ea8fe", "#d7a24f", "#c496f0"];

function cssVar(name: string, fb: string): string {
  if (typeof window === "undefined") return fb;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
}

export default function CompareChart({
  series,
}: {
  series: { ticker: string; candles: Candle[] }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState(0);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!ref.current || series.length === 0) return;
    const dim = cssVar("--text-dim", "#8b94a7");
    const border = cssVar("--border", "#232a37");
    const grid = cssVar("--bg-hover", "#171c26");

    const chart: IChartApi = createChart(ref.current, {
      height: 360,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: dim },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border },
      autoSize: true,
    });

    series.forEach((s, i) => {
      const win = s.candles.slice(-252);
      if (win.length < 2) return;
      const base = win[0].c;
      const line = chart.addLineSeries({
        color: COLORS[i % COLORS.length],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: s.ticker,
      });
      line.setData(win.map((c) => ({ time: c.t, value: (c.c / base) * 100 })));
    });

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [series, theme]);

  return (
    <div>
      <div ref={ref} style={{ width: "100%" }} />
      <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
        Rebased to 100 at one year ago. Higher line = stronger price performance.{" "}
        {series.map((s, i) => (
          <span key={s.ticker} style={{ color: COLORS[i % COLORS.length], marginLeft: 8 }}>
            — {s.ticker}
          </span>
        ))}
      </p>
    </div>
  );
}

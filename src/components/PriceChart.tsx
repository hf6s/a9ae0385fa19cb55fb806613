"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi, type ISeriesApi } from "lightweight-charts";
import type { Candle } from "@/lib/types";

const RANGES = [
  { key: "1M", days: 21 },
  { key: "3M", days: 63 },
  { key: "6M", days: 126 },
  { key: "1Y", days: 252 },
  { key: "2Y", days: 100000 },
] as const;

function sma(candles: Candle[], period: number) {
  const out: { time: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c;
    if (i >= period) sum -= candles[i - period].c;
    if (i >= period - 1) out.push({ time: candles[i].t, value: sum / period });
  }
  return out;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function PriceChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<string>("1Y");
  const [mode, setMode] = useState<"area" | "candle">("area");
  const [showMA, setShowMA] = useState(true);
  const [theme, setTheme] = useState(0); // bump to force rebuild
  const [legend, setLegend] = useState<{ date: string; price: number; chg: number } | null>(null);

  // rebuild on theme toggle
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const view = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? 252;
    return candles.slice(-days);
  }, [candles, range]);

  const periodReturn = useMemo(() => {
    if (view.length < 2) return 0;
    return (view[view.length - 1].c / view[0].c - 1) * 100;
  }, [view]);

  useEffect(() => {
    if (!containerRef.current || view.length === 0) return;

    const green = cssVar("--accent", "#4fd1a5");
    const red = cssVar("--red", "#e06c75");
    const dim = cssVar("--text-dim", "#8b94a7");
    const border = cssVar("--border", "#232a37");
    const blue = cssVar("--q", "#6ea8fe");
    const amber = cssVar("--m", "#d7a24f");
    const grid = cssVar("--bg-hover", "#171c26");
    const up = view[view.length - 1].c >= view[0].c;

    const chart = createChart(containerRef.current, {
      height: 400,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: dim },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
    });
    chartRef.current = chart;

    let main: ISeriesApi<"Area"> | ISeriesApi<"Candlestick">;
    if (mode === "area") {
      const s = chart.addAreaSeries({
        lineColor: up ? green : red,
        topColor: up ? "rgba(79,209,165,0.30)" : "rgba(224,108,117,0.30)",
        bottomColor: "rgba(0,0,0,0)",
        lineWidth: 2,
        priceLineVisible: false,
      });
      s.setData(view.map((c) => ({ time: c.t, value: c.c })));
      main = s;
    } else {
      const s = chart.addCandlestickSeries({
        upColor: green,
        downColor: red,
        borderUpColor: green,
        borderDownColor: red,
        wickUpColor: green,
        wickDownColor: red,
      });
      s.setData(view.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c })));
      main = s;
    }

    if (showMA) {
      const ma50 = chart.addLineSeries({ color: blue, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      ma50.setData(sma(view, 50));
      const ma200 = chart.addLineSeries({ color: amber, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      ma200.setData(sma(view, 200));
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.size) {
        setLegend(null);
        return;
      }
      const d = param.seriesData.get(main) as { value?: number; close?: number } | undefined;
      const price = d?.value ?? d?.close;
      if (price === undefined) return;
      setLegend({
        date: String(param.time),
        price,
        chg: (price / view[0].c - 1) * 100,
      });
    });

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [view, mode, showMA, theme]);

  return (
    <div>
      <div className="chart-toolbar">
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.key} className={r.key === range ? "active" : ""} onClick={() => setRange(r.key)}>
              {r.key}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={mode === "area" ? "active" : ""} onClick={() => setMode("area")}>Area</button>
          <button className={mode === "candle" ? "active" : ""} onClick={() => setMode("candle")}>Candles</button>
        </div>
        <div className="seg">
          <button className={showMA ? "active" : ""} onClick={() => setShowMA((m) => !m)}>MA 50/200</button>
        </div>
        <span className={`chart-return ${periodReturn >= 0 ? "pos" : "neg"}`}>
          {periodReturn >= 0 ? "+" : ""}
          {periodReturn.toFixed(1)}% · {range}
        </span>
      </div>

      <div className="chart-host">
        {legend && (
          <div className="chart-legend">
            <strong>{legend.date}</strong> · ${legend.price.toFixed(2)} ·{" "}
            <span className={legend.chg >= 0 ? "pos" : "neg"}>
              {legend.chg >= 0 ? "+" : ""}
              {legend.chg.toFixed(1)}%
            </span>
          </div>
        )}
        <div ref={containerRef} style={{ width: "100%" }} />
      </div>

      {showMA && (
        <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
          <span style={{ color: "var(--q)" }}>—</span> 50-day MA&nbsp;&nbsp;
          <span style={{ color: "var(--m)" }}>—</span> 200-day MA
        </p>
      )}
    </div>
  );
}

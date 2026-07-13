"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";

export interface EquityPoint {
  t: string;
  strat: number;
  bench: number;
}

export default function EquityChart({ curve }: { curve: EquityPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart: IChartApi = createChart(containerRef.current, {
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b94a7",
      },
      grid: {
        vertLines: { color: "#1a2029" },
        horzLines: { color: "#1a2029" },
      },
      rightPriceScale: { borderColor: "#232a37" },
      timeScale: { borderColor: "#232a37" },
      autoSize: true,
    });

    const strat = chart.addLineSeries({
      color: "#4fd1a5",
      lineWidth: 2,
      priceLineVisible: false,
      title: "Strategy",
    });
    strat.setData(curve.map((p) => ({ time: p.t, value: p.strat })));

    const bench = chart.addLineSeries({
      color: "#6ea8fe",
      lineWidth: 1,
      priceLineVisible: false,
      title: "S&P 500",
    });
    bench.setData(curve.map((p) => ({ time: p.t, value: p.bench })));

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [curve]);

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%" }} />
      <p style={{ fontSize: 12, color: "#8b94a7", marginTop: 8 }}>
        <span style={{ color: "#4fd1a5" }}>—</span> Strategy (growth of $1)&nbsp;&nbsp;
        <span style={{ color: "#6ea8fe" }}>—</span> S&P 500
      </p>
    </div>
  );
}

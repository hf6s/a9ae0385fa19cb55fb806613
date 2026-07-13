"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";
import type { Candle } from "@/lib/types";

function smaSeries(candles: Candle[], period: number) {
  const out: { time: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c;
    if (i >= period) sum -= candles[i - period].c;
    if (i >= period - 1) out.push({ time: candles[i].t, value: sum / period });
  }
  return out;
}

export default function PriceChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart: IChartApi = createChart(containerRef.current, {
      height: 380,
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

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#4fd1a5",
      downColor: "#e06c75",
      borderUpColor: "#4fd1a5",
      borderDownColor: "#e06c75",
      wickUpColor: "#4fd1a5",
      wickDownColor: "#e06c75",
    });
    candleSeries.setData(
      candles.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c })),
    );

    const ma50 = chart.addLineSeries({
      color: "#6ea8fe",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma50.setData(smaSeries(candles, 50));

    const ma200 = chart.addLineSeries({
      color: "#d7a24f",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma200.setData(smaSeries(candles, 200));

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles]);

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%" }} />
      <p style={{ fontSize: 12, color: "#8b94a7", marginTop: 8 }}>
        <span style={{ color: "#6ea8fe" }}>—</span> 50-day MA&nbsp;&nbsp;
        <span style={{ color: "#d7a24f" }}>—</span> 200-day MA
      </p>
    </div>
  );
}

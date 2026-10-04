"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";
import { returnIndex, type CurvePoint } from "@/lib/portfolio";

/**
 * The portfolio against the alternative.
 *
 * Three lines, and the third is the one that stops the chart from flattering
 * anybody: the money paid in. A value line that climbs because more cash went
 * in looks identical to one that climbs because the picks worked, and only the
 * gap between value and deposits tells them apart.
 *
 * The benchmark line is not the S&P's return for the period. It is the same
 * payments, on the same dates, into the index - so a position bought last week
 * is compared against a week of the index, not a year of it.
 *
 * Percent mode switches both lines to a time-weighted return, which removes
 * deposits from the comparison entirely.
 */

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Thin to at most `max` points.
 *
 * Copied in spirit from the backtest chart: lightweight-charts enforces a
 * minimum bar spacing, and on a phone a two-year daily series gets clipped to
 * the last few months without this. The first and last points always survive so
 * the range on screen is the real one.
 */
function downsample(curve: CurvePoint[], max = 420): CurvePoint[] {
  if (curve.length <= max) return curve;
  const step = Math.ceil(curve.length / max);
  const out = curve.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== curve[curve.length - 1]) out.push(curve[curve.length - 1]);
  return out;
}

type Mode = "money" | "percent";

interface Legend {
  date: string;
  value: number;
  bench: number;
  basis: number;
}

export default function ValueChart({
  curve,
  hasBench,
  priceAsOf,
  earliestBuy,
  loading,
}: {
  curve: CurvePoint[];
  hasBench: boolean;
  /** Newest close available for any holding. */
  priceAsOf: string;
  /** Earliest buy date across the holdings. */
  earliestBuy: string;
  loading: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("money");
  const [theme, setTheme] = useState(0);
  const [legend, setLegend] = useState<Legend | null>(null);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const view = useMemo(() => downsample(curve), [curve]);
  const index = useMemo(() => returnIndex(view), [view]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || view.length < 2) return;

    const green = cssVar("--accent", "#4fd1a5");
    const blue = cssVar("--q", "#6ea8fe");
    const dim = cssVar("--text-dim", "#8b94a7");
    const border = cssVar("--border", "#232a37");
    const grid = cssVar("--bg-hover", "#171c26");

    const chart: IChartApi = createChart(host, {
      height: 360,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: dim },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border },
      crosshair: { mode: 1 },
      autoSize: true,
      localization: {
        priceFormatter: (v: number) =>
          mode === "money" ? money(v) : `${((v - 1) * 100).toFixed(1)}%`,
      },
    });

    if (mode === "money") {
      const area = chart.addAreaSeries({
        lineColor: green,
        topColor: "rgba(79,209,165,0.22)",
        bottomColor: "rgba(79,209,165,0)",
        lineWidth: 2,
        priceLineVisible: false,
        title: "Your holdings",
      });
      area.setData(view.map((p) => ({ time: p.t, value: p.value })));

      if (hasBench) {
        const bench = chart.addLineSeries({
          color: blue,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "Same money in the S&P 500",
        });
        bench.setData(view.map((p) => ({ time: p.t, value: p.bench })));
      }

      const paid = chart.addLineSeries({
        color: dim,
        lineWidth: 1,
        lineStyle: 2, // dashed: it is a reference, not a performance line
        priceLineVisible: false,
        lastValueVisible: false,
        title: "Money you paid in",
      });
      paid.setData(view.map((p) => ({ time: p.t, value: p.basis })));
    } else {
      const line = chart.addLineSeries({
        color: green,
        lineWidth: 2,
        priceLineVisible: false,
        title: "Your holdings",
      });
      line.setData(index.map((p) => ({ time: p.t, value: p.strat })));

      if (hasBench) {
        const bench = chart.addLineSeries({
          color: blue,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "S&P 500",
        });
        bench.setData(index.map((p) => ({ time: p.t, value: p.bench })));
      }
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.size) {
        setLegend(null);
        return;
      }
      const date = String(param.time);
      const point = view.find((p) => p.t === date);
      if (!point) return;
      setLegend({ date, value: point.value, bench: point.bench, basis: point.basis });
    });

    chart.timeScale().fitContent();

    /*
      And again whenever the width changes.

      autoSize resizes the canvas but keeps the bar spacing fitContent chose, so
      a chart built before the layout settled holds the spacing it worked out
      for a narrow box and anchors it to the right edge. The canvas then grows
      to full width with every point crammed into the last tenth of it and empty
      space to the left - which reads as "nothing happened until last week"
      rather than as a chart that has not been refitted.
    */
    const refit = () => chart.timeScale().fitContent();
    const frame = requestAnimationFrame(refit);
    const ro = new ResizeObserver(refit);
    ro.observe(host);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      chart.remove();
    };
  }, [view, index, mode, hasBench, theme]);

  if (curve.length < 2) {
    // Be specific about which of the two reasons it is. "Not enough data" sends
    // someone hunting for a bug in their own typing when the real answer is
    // that the scan has not run since they bought.
    const tooNew = earliestBuy.length > 0 && priceAsOf.length > 0 && earliestBuy > priceAsOf;
    return (
      <div className="empty-state">
        {loading ? (
          <p>Fetching prices…</p>
        ) : tooNew ? (
          <p>
            Nothing to draw yet. Your earliest buy is dated {earliestBuy}, and the newest close
            held for these stocks is {priceAsOf} — so there is no price history on the far side of
            the purchase. The line appears after the next scan.
          </p>
        ) : (
          <p>
            Nothing to draw yet. A line needs at least two trading days of prices after your
            earliest buy date.
          </p>
        )}
      </div>
    );
  }

  const last = view[view.length - 1];
  const lastIndex = index[index.length - 1];
  const ahead = last.value - last.bench;

  return (
    <div>
      <div className="chart-toolbar">
        <div className="seg">
          <button className={mode === "money" ? "active" : ""} onClick={() => setMode("money")}>
            Dollars
          </button>
          <button className={mode === "percent" ? "active" : ""} onClick={() => setMode("percent")}>
            Percent
          </button>
        </div>
        {hasBench && (
          <span className={`chart-return ${ahead >= 0 ? "pos" : "neg"}`}>
            {mode === "money" ? (
              <>
                {ahead >= 0 ? "+" : "−"}
                {money(Math.abs(ahead))} vs the index
              </>
            ) : (
              <>
                {lastIndex.strat >= lastIndex.bench ? "+" : "−"}
                {Math.abs((lastIndex.strat - lastIndex.bench) * 100).toFixed(1)} pts vs the index
              </>
            )}
          </span>
        )}
      </div>

      <div className="chart-host">
        {legend && (
          <div className="chart-legend">
            <strong>{legend.date}</strong> · {money(legend.value)}
            {hasBench ? <> · index {money(legend.bench)}</> : null} · paid in{" "}
            {money(legend.basis)}
          </div>
        )}
        <div ref={hostRef} style={{ width: "100%" }} />
      </div>

      <p className="chart-key">
        <span className="key-swatch" style={{ background: "var(--accent)" }} /> Your holdings
        {hasBench && (
          <>
            <span className="key-swatch" style={{ background: "var(--q)" }} /> Same money in the
            S&amp;P 500
          </>
        )}
        {mode === "money" && (
          <>
            <span className="key-swatch dashed" /> Money you paid in
          </>
        )}
      </p>
    </div>
  );
}

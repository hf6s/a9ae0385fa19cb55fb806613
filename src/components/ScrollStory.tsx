"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Scroll-linked motion for the invoice page.
 *
 * Everything here is driven by scroll POSITION, not by a one-shot trigger:
 * the reader's thumb moves the animation frame by frame, and moving back up
 * runs it backwards. That is the difference between this and Reveal, which
 * fires once when an element appears.
 *
 * Rules this file follows, because a janky page undermines the thing it is
 * selling:
 *   - only transform and opacity are animated, so nothing triggers layout
 *   - one rAF frame coalesces every scroll event, so a fast flick cannot
 *     queue hundreds of updates
 *   - state is written to the DOM node directly rather than through React
 *     state, so scrolling does not re-render the tree sixty times a second
 *   - prefers-reduced-motion disables all of it and leaves the page static
 *
 * Like Reveal, the markup renders in its FINAL state and script takes over
 * before the first paint. If the bundle never loads, the reader still gets a
 * readable invoice instead of an empty screen.
 */

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    ? (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
    : false;
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Subscribe to scroll with a single shared rAF tick. */
function useScrollTick(onTick: () => void, enabled = true) {
  useIsomorphicLayoutEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        onTick();
      });
    };
    onTick();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
    // onTick is stable per mount by construction (defined in the component
    // body and only reading refs), so this intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Hero that drifts and dims as the reader scrolls past it.
 *
 * The text moves at about a third of scroll speed, so the page appears to
 * slide over it. Fades out well before it leaves, which keeps it from
 * colliding visually with the section arriving underneath.
 */
export function ParallaxHero({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useScrollTick(() => {
    const el = ref.current;
    if (!el) return;
    const y = window.scrollY;
    const fadeOver = window.innerHeight * 0.65;
    const p = clamp01(y / fadeOver);
    el.style.transform = `translate3d(0, ${y * 0.32}px, 0) scale(${1 - p * 0.04})`;
    el.style.opacity = String(1 - p);
  });

  return (
    <div ref={ref} className="inv-parallax">
      {children}
    </div>
  );
}

/**
 * A number that counts up as its own section crosses the viewport.
 *
 * Scrubbed rather than triggered: half-scrolled shows half the value, and
 * scrolling back up counts it down again. The DOM text is the final value so
 * the correct number is what renders without script, and what a reader sees
 * if they land mid-page.
 */
export function ScrubNumber({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  className = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<string>("");

  const format = (n: number) =>
    `${prefix}${n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;

  useScrollTick(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const doc = document.documentElement;
    // At the very bottom of the page there is no scroll left to finish the
    // count with, so anything still mid-count freezes short. The invoice
    // total lives there, and $108.75 on a page that owes $114.99 is not a
    // cosmetic bug — it is the wrong number on a bill.
    const atPageBottom = doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 2;
    // Otherwise: starts as the element enters the bottom edge, finishes once
    // it is comfortably on screen rather than after it has left.
    const p = atPageBottom ? 1 : clamp01((vh - r.top) / (vh * 0.45));
    const next = format(value * p);
    if (next !== shown.current) {
      shown.current = next;
      el.textContent = next;
    }
  });

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}

/** Thin rail that fills with how far down the page the reader is. */
export function ScrollRail() {
  const ref = useRef<HTMLDivElement>(null);

  useScrollTick(() => {
    const el = ref.current;
    if (!el) return;
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    el.style.transform = `scaleY(${max > 0 ? clamp01(doc.scrollTop / max) : 0})`;
  });

  return (
    <div className="inv-rail" aria-hidden="true">
      <div ref={ref} className="inv-rail-fill" />
    </div>
  );
}

/**
 * Sticky panel whose caption changes as the reader scrolls through it.
 *
 * The section is tall; the panel pins while the reader passes, and each step
 * takes an equal share of that scroll distance. Reading position drives which
 * step shows, so nothing is on a timer the reader cannot control.
 */
export function StickySteps({ steps }: { steps: { head: string; body: string }[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useScrollTick(() => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const travel = r.height - window.innerHeight;
    if (travel <= 0) return;
    const p = clamp01(-r.top / travel);
    const idx = Math.min(steps.length - 1, Math.floor(p * steps.length));
    setActive((cur) => (cur === idx ? cur : idx));
  });

  return (
    // 62vh per step: enough scroll that each one reads as a deliberate beat,
    // short enough that five of them do not feel like a hostage situation on
    // a phone.
    <div ref={wrap} className="inv-sticky-wrap" style={{ height: `${steps.length * 62}vh` }}>
      <div className="inv-sticky">
        <ol className="inv-steps">
          {steps.map((s, i) => (
            <li key={s.head} className={i === active ? "is-active" : ""}>
              <span className="inv-step-n">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{s.head}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** One point of the backtest curve, already downsampled by the server. */
export interface CurvePoint {
  t: string;
  strat: number;
  bench: number;
}

/**
 * The real backtest equity curve, drawn by scrolling.
 *
 * This is the most load-bearing image on the page, so it is built from
 * data/backtest.json rather than drawn to look good: the strategy line ends
 * BELOW the benchmark, which is the true result. A chart that flattered the
 * strategy here would contradict the page's own text two screens further
 * down, and the reader would be right to disbelieve both.
 *
 * Geometry is computed in JS, not measured from the DOM: no getTotalLength,
 * no layout reads during scroll, and the tip marker lands exactly on a real
 * data point rather than an interpolation of the rendered path.
 */
export function ScrollCurve({ points, start = 10000 }: { points: CurvePoint[]; start?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const clip = useRef<SVGRectElement>(null);
  const tipS = useRef<SVGCircleElement>(null);
  const tipB = useRef<SVGCircleElement>(null);
  const valS = useRef<HTMLSpanElement>(null);
  const valB = useRef<HTMLSpanElement>(null);
  const dateEl = useRef<HTMLSpanElement>(null);

  const W = 1000;
  const H = 420;
  const PAD = 10;

  const geom = (() => {
    const max = Math.max(...points.map((p) => Math.max(p.strat, p.bench)));
    const min = Math.min(...points.map((p) => Math.min(p.strat, p.bench)), 1);
    const x = (i: number) => (i / (points.length - 1)) * W;
    const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
    const line = (key: "strat" | "bench") =>
      points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
    return {
      strat: line("strat"),
      bench: line("bench"),
      area: `${line("strat")} L${W},${H} L0,${H} Z`,
      xs: points.map((_, i) => x(i)),
      ysS: points.map((p) => y(p.strat)),
      ysB: points.map((p) => y(p.bench)),
    };
  })();

  const cash = (mult: number) =>
    `$${Math.round(start * mult).toLocaleString("en-US")}`;

  useScrollTick(() => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const travel = r.height - window.innerHeight;
    const doc = document.documentElement;
    const atBottom = doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 2;
    // Same rule as the counters: the chart must be able to finish. A curve
    // frozen at 80% would report a return the app never claimed.
    const p = atBottom ? 1 : travel > 0 ? clamp01(-r.top / travel) : clamp01((window.innerHeight - r.top) / window.innerHeight);
    const i = Math.min(points.length - 1, Math.max(0, Math.round(p * (points.length - 1))));

    if (clip.current) clip.current.setAttribute("width", String(Math.max(0.001, geom.xs[i])));
    if (tipS.current) {
      tipS.current.setAttribute("cx", String(geom.xs[i]));
      tipS.current.setAttribute("cy", String(geom.ysS[i]));
    }
    if (tipB.current) {
      tipB.current.setAttribute("cx", String(geom.xs[i]));
      tipB.current.setAttribute("cy", String(geom.ysB[i]));
    }
    if (valS.current) valS.current.textContent = cash(points[i].strat);
    if (valB.current) valB.current.textContent = cash(points[i].bench);
    if (dateEl.current) dateEl.current.textContent = points[i].t.slice(0, 7);
  });

  const last = points[points.length - 1];

  return (
    <div ref={wrap} className="inv-curve-wrap">
      <div className="inv-curve-sticky">
        <div className="inv-curve-head">
          <h3>$10,000, thirteen years, no guessing</h3>
          <p>Every rebalance the model would have made, including companies that went bankrupt.</p>
        </div>
        <div className="inv-curve-readout">
          <div className="inv-read inv-read-s">
            <span className="inv-read-k">This model</span>
            <span className="inv-read-v" ref={valS}>
              {cash(last.strat)}
            </span>
          </div>
          <div className="inv-read inv-read-b">
            <span className="inv-read-k">S&amp;P 500</span>
            <span className="inv-read-v" ref={valB}>
              {cash(last.bench)}
            </span>
          </div>
          <span className="inv-read-date" ref={dateEl}>
            {last.t.slice(0, 7)}
          </span>
        </div>
        <svg className="inv-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="invArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
            <filter id="invGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <clipPath id="invClip">
              <rect ref={clip} x="0" y="0" width="1000" height={H} />
            </clipPath>
          </defs>
          <g clipPath="url(#invClip)">
            <path d={geom.area} fill="url(#invArea)" />
            <path d={geom.bench} className="inv-line-bench" />
            <path d={geom.strat} className="inv-line-strat" filter="url(#invGlow)" />
          </g>
          <circle ref={tipB} r="4" className="inv-tip-bench" />
          <circle ref={tipS} r="5" className="inv-tip-strat" />
        </svg>
        <p className="inv-curve-note">
          It ends below the index. That is the real result, and it is on the site too.
        </p>
      </div>
    </div>
  );
}

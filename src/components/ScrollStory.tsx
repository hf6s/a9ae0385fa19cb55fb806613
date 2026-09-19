"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clamp01, dotGrid, funnelStage, pinnedProgress, scrubProgress, stepIndex } from "@/lib/scroll-math";

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
 *   - reduced motion silences the DECORATIVE effects only (see below)
 *
 * Like Reveal, the markup renders in its FINAL state and script takes over
 * before the first paint. If the bundle never loads, the reader still gets a
 * readable invoice instead of an empty screen.
 */

/**
 * Whether the OS asked for less movement.
 *
 * `?rm=1` forces it on and `?rm=0` forces it off, which is how this gets
 * tested at all: no emulator I can drive exposes the setting, and the phone
 * that has it switched on is not one I can attach a debugger to. The override
 * is read from the URL, so it costs a normal reader nothing.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const forced = new URLSearchParams(window.location.search).get("rm");
  if (forced === "1") return true;
  if (forced === "0") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Subscribe to scroll with a single shared rAF tick.
 *
 * REDUCED MOTION IS NOT AN OFF SWITCH FOR THE PAGE.
 *
 * It used to be: any consumer of this hook went silent when the OS asked for
 * reduced motion, and a phone with that setting on — which is common, and was
 * on the phone this page is built for — scrolled through a completely dead
 * document. The setting is a request to stop gratuitous movement, not a
 * request to stop showing what the product does.
 *
 * So the rule is per-effect. Anything that only drifts, floats or parallaxes
 * passes `decorative: true` and stands down. The machine, the counters and the
 * section reveals are content: they track the reader's own scroll position,
 * they move only because the reader moved, and they keep working.
 */
export function useScrollTick(
  onTick: () => void,
  { enabled = true, decorative = false }: { enabled?: boolean; decorative?: boolean } = {},
) {
  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;
    if (decorative && prefersReducedMotion()) return;
    let frame = 0;
    let lastRun = 0;
    const run = () => {
      frame = 0;
      lastRun = performance.now();
      onTick();
      // Counted so ?diag=1 can distinguish "the loop never ran" from "the loop
      // runs but nothing draws". Cheap, and only read by the diagnostic.
      const d = (window.__f20diag ??= {});
      d.ticks = (d.ticks ?? 0) + 1;
    };
    /**
     * Batching must never outrank correctness.
     *
     * The plain "skip if a frame is already pending" guard assumes rAF always
     * fires. A background tab pauses it, so the pending handle never clears
     * and every later scroll is dropped for good — observed in production
     * with the invoice total reading $0.00 and the hero stuck 1,100px from
     * where the page actually was. If a frame has been outstanding longer
     * than a slow frame could explain, rAF is not running and the update
     * happens inline instead.
     */
    const STALE_MS = 120;
    const schedule = () => {
      if (frame && performance.now() - lastRun > STALE_MS) {
        cancelAnimationFrame(frame);
        run();
        return;
      }
      if (frame) return;
      frame = requestAnimationFrame(run);
    };
    // Browsers pause rAF in a hidden tab, so a scroll that happens while the
    // page is in the background never gets its frame: the pending handle
    // stays set, every later scroll is swallowed by the guard, and the page
    // comes back showing a position the reader left long ago. Resetting on
    // the way back to visible repairs that.
    const onVisible = () => {
      if (document.hidden) return;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      onTick();
    };

    onTick();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // onTick is stable per mount by construction (defined in the component
    // body and only reading refs), so this intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, decorative]);
}

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
  }, { decorative: true });

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
    const doc = document.documentElement;
    const p = scrubProgress({
      top: el.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
      atPageBottom: doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 2,
    });
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
    const idx = stepIndex(
      pinnedProgress({ top: r.top, height: r.height, viewportHeight: window.innerHeight }),
      steps.length,
    );
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

/**
 * The scan, drawn as dots: everything scanned, what survives the filters,
 * what makes the list.
 *
 * Numbers come from the live scan file, so the picture cannot drift from
 * what the site actually did. It makes no claim about returns - it shows how
 * much gets thrown away, which is the part of the method worth seeing.
 *
 * Three stacked layers cross-fade instead of 905 dots being re-styled every
 * frame: that is three opacity writes per tick rather than nine hundred.
 */
export function ScrollFunnel({
  scanned,
  passed,
  picked,
  tickers,
}: {
  scanned: number;
  passed: number;
  picked: number;
  tickers: string[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const all = useRef<SVGGElement>(null);
  const pass = useRef<SVGGElement>(null);
  const pick = useRef<SVGGElement>(null);
  const num = useRef<HTMLSpanElement>(null);
  const lab = useRef<HTMLSpanElement>(null);
  const names = useRef<HTMLDivElement>(null);
  const shown = useRef("");

  const W = 1000;
  const H = 560;
  const COLS = 38;
  const grid = dotGrid(scanned, W, H, COLS);
  // The survivors are spread evenly through the field rather than clustered,
  // so the eye reads "these are scattered everywhere" instead of "the model
  // likes one corner of the alphabet".
  const passIdx = Array.from({ length: passed }, (_, i) => Math.floor((i * scanned) / passed));
  const pickIdx = Array.from({ length: picked }, (_, i) => passIdx[Math.floor((i * passed) / picked)]);

  useScrollTick(() => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const doc = document.documentElement;
    const p = pinnedProgress({
      top: r.top,
      height: r.height,
      viewportHeight: window.innerHeight,
      atPageBottom: doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 2,
    });
    const st = funnelStage(p, { scanned, passed, picked });
    if (all.current) all.current.style.opacity = String(st.allOpacity);
    if (pass.current) pass.current.style.opacity = String(st.passOpacity);
    if (pick.current) pick.current.style.opacity = String(st.pickOpacity);
    if (names.current) names.current.style.opacity = String(st.pickOpacity);
    const key = st.stage + ":" + st.count;
    if (key !== shown.current) {
      shown.current = key;
      if (num.current) num.current.textContent = st.count.toLocaleString("en-US");
      if (lab.current) lab.current.textContent = st.label;
    }
  });

  return (
    <div ref={wrap} className="inv-funnel-wrap">
      <div className="inv-funnel-sticky">
        <div className="inv-funnel-head">
          <span className="inv-funnel-n" ref={num}>
            {scanned.toLocaleString("en-US")}
          </span>
          <span className="inv-funnel-l" ref={lab}>
            scanned
          </span>
        </div>
        <svg className="inv-funnel" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <g ref={all} className="inv-dots-all">
            {grid.points.map((pt, i) => (
              <circle key={i} cx={pt.x} cy={pt.y} r={grid.r} />
            ))}
          </g>
          <g ref={pass} className="inv-dots-pass" style={{ opacity: 0 }}>
            {passIdx.map((i) => (
              <circle key={i} cx={grid.points[i].x} cy={grid.points[i].y} r={grid.r * 1.25} />
            ))}
          </g>
          <g ref={pick} className="inv-dots-pick" style={{ opacity: 0 }}>
            {pickIdx.map((i) => (
              <circle key={i} cx={grid.points[i].x} cy={grid.points[i].y} r={grid.r * 2.1} />
            ))}
          </g>
        </svg>
        <div ref={names} className="inv-funnel-names" style={{ opacity: 0 }}>
          {tickers.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

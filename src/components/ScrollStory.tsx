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

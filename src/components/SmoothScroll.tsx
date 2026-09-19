"use client";

import { useEffect } from "react";
import { prefersReducedMotion } from "@/components/ScrollStory";

/**
 * Inertia scrolling for the invoice page, and the single frame source that
 * every other animation on it runs from.
 *
 * WHY ONE SOURCE. Before this, each component ran its own requestAnimationFrame
 * loop. That is how a hidden tab left the invoice total reading $0.00: a paused
 * frame handle was never cleared and every later scroll was dropped. Lenis owns
 * the loop now, GSAP's ticker drives Lenis, and ScrollTrigger updates from
 * Lenis' own scroll event, so there is exactly one clock.
 *
 * WHY NOT SITE-WIDE. Hijacking scroll on the dashboard and the ranking tables
 * would fight the browser on the screens people actually work in. It is mounted
 * by /invoice alone.
 *
 * Lenis scrolls the real window rather than transforming a wrapper, so
 * `window.scrollY`, `getBoundingClientRect` and `position: sticky` all keep
 * working untouched — which is what the funnel, the rail and the receipt are
 * built on.
 */
export default function SmoothScroll() {
  useEffect(() => {
    // Someone who asked their system to stop animating things did not ask for
    // scroll inertia either. Native scrolling is the accessible default.
    if (prefersReducedMotion()) return;

    let dispose: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const [{ default: Lenis }, { gsap }, { ScrollTrigger }] = await Promise.all([
          import("lenis"),
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        if (cancelled) return;

        gsap.registerPlugin(ScrollTrigger);

        const lenis = new Lenis({
          // Heavy and physical, per the brief: a long settle rather than a
          // snappy one. Above ~0.15 the page starts to feel disconnected from
          // the thumb on a phone.
          lerp: 0.09,
          wheelMultiplier: 1,
          touchMultiplier: 1.6,
        });

        lenis.on("scroll", ScrollTrigger.update);

        const tick = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(tick);
        // GSAP smooths its own delta by default, which fights Lenis' easing and
        // shows up as a faint stutter at the end of a flick.
        gsap.ticker.lagSmoothing(0);

        dispose = () => {
          gsap.ticker.remove(tick);
          lenis.destroy();
        };
      } catch {
        // A failed chunk must cost inertia, nothing else. Native scrolling
        // still works and every component's own fallback still runs.
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return null;
}

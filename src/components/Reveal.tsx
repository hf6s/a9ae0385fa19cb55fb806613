"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Reveals its children the first time they scroll into view.
 *
 * Once only: re-animating on every pass makes a document feel unstable when
 * someone scrolls back to re-read a number, which on this page is the point.
 *
 * VISIBLE BY DEFAULT, hidden by script. The markup carries no state class, so
 * the CSS default is opacity 1 — if the JS bundle 404s, is blocked, or the
 * browser has no IntersectionObserver, the reader still gets the whole page.
 * Hiding happens in a LAYOUT effect, which runs before paint, so there is no
 * flash of content first. Getting this backwards renders a blank invoice on
 * someone else's phone, which is exactly how it was caught: a dev server
 * dropped its chunks and the page came up empty.
 *
 * With that ordering there is no need for a reveal-everything timer, and no
 * place for one: a timer would un-hide the page for a reader who has not
 * scrolled yet, which is the opposite of what this component is for.
 */

/** useLayoutEffect warns during SSR; on the server there is nothing to hide. */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Phase = "initial" | "hidden" | "shown";

export default function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("initial");

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;

    // Already on screen at mount: leave it alone rather than hide and re-show,
    // which would animate the hero's neighbour for no reason.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) {
      setPhase("shown");
      return;
    }

    setPhase("hidden");

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // Also reveal anything the reader has already scrolled PAST. A fast
          // flick can carry a section through the viewport between two
          // observer samples, and without this that section stays invisible
          // for the rest of the visit — scrolling back up shows a blank gap.
          const scrolledPast = e.boundingClientRect.top < 0;
          if (e.isIntersecting || scrolledPast) {
            setPhase("shown");
            io.disconnect();
          }
        }
      },
      // Fires a little before the element's top edge arrives, so the motion
      // finishes about when the reader's eye gets there.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const state = phase === "hidden" ? "is-hidden" : phase === "shown" ? "is-shown" : "";
  return (
    <div
      ref={ref}
      className={`reveal-block ${state} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

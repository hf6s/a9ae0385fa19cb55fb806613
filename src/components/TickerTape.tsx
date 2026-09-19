"use client";

import { useEffect, useRef } from "react";
import { useScrollTick } from "@/components/ScrollStory";
import { tapeRate } from "@/lib/scroll-math";

/**
 * The live top 20, drifting past like a market tape — faster when the reader
 * scrolls hard, easing back when they stop.
 *
 * The drift is a CSS animation, so it costs the compositor and not the main
 * thread; scroll velocity only changes its playbackRate. Doing the movement in
 * JS would put a transform write on every scroll event for an element that is
 * purely decorative.
 *
 * Decorative is the right word, so the whole thing stands down under reduced
 * motion: the same names are already on the page in the machine's final grid.
 */
export default function TickerTape({
  items,
}: {
  items: { ticker: string; finalScore: number }[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const lastY = useRef(0);
  const lastT = useRef(0);

  useEffect(() => {
    const el = track.current;
    if (!el || items.length === 0) return;
    if (typeof el.animate !== "function") return;

    anim.current = el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }], {
      duration: 38000,
      iterations: Number.POSITIVE_INFINITY,
      easing: "linear",
    });
    lastY.current = window.scrollY;
    lastT.current = performance.now();
    return () => {
      anim.current?.cancel();
      anim.current = null;
    };
  }, [items.length]);

  useScrollTick(
    () => {
      const a = anim.current;
      if (!a) return;
      const now = performance.now();
      const dt = now - lastT.current;
      const dy = window.scrollY - lastY.current;
      lastT.current = now;
      lastY.current = window.scrollY;
      if (dt <= 0) return;
      const target = tapeRate(dy / dt);
      // Ease toward the target so stopping does not slam the tape to a halt.
      a.playbackRate += (target - a.playbackRate) * 0.25;
    },
    { decorative: true },
  );

  if (items.length === 0) return null;

  // Rendered twice so the -50% translation loops without a seam.
  const run = [...items, ...items];

  return (
    <div className="inv-tape" aria-hidden="true">
      <div className="inv-tape-track" ref={track}>
        {run.map((s, i) => (
          <span className="inv-tape-item" key={`${s.ticker}-${i}`}>
            <b>{s.ticker}</b>
            <i>{s.finalScore.toFixed(1)}</i>
          </span>
        ))}
      </div>
    </div>
  );
}

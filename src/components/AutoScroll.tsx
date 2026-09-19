"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Press once, and the page takes itself through the whole story.
 *
 * WHY THIS EXISTS. On iOS a flick carries hundreds of pixels of momentum, so
 * a scroll-driven scene either blurs past or has to be slowed to the point of
 * feeling stuck. Every trick that fought the thumb — speed limits, playing on
 * a timer — made it worse, because the reader was still the one driving.
 *
 * So the page offers to drive. It scrolls itself at a steady rate, every
 * animation follows scroll position exactly as it always did, and nothing has
 * to be faked.
 *
 * IT IS NEVER A TRAP. Any touch, wheel, key or tap on Stop hands control back
 * immediately, and it stops on its own at the bottom. It is offered once, it
 * takes one press, and if ignored it fades out of the way.
 */

/** How long the whole page should take, hands-free. */
const TOUR_SECONDS = 95;
const MIN_PX_PER_SEC = 55;
const MAX_PX_PER_SEC = 190;

export default function AutoScroll() {
  const [phase, setPhase] = useState<"hidden" | "offer" | "playing">("hidden");
  const timer = useRef(0);
  const last = useRef(0);
  const carry = useRef(0);

  // Offer it once the boot curtain is out of the way.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setPhase((p) => (p === "hidden" ? "offer" : p));
    }, 2000);
    return () => window.clearTimeout(t);
  }, []);

  // Someone already scrolling has answered the question. Stop offering.
  useEffect(() => {
    if (phase !== "offer") return;
    const start = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - start) > 600) setPhase("hidden");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing") return;

    const doc = document.documentElement;
    const span = Math.max(1, doc.scrollHeight - window.innerHeight);
    const speed = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, span / TOUR_SECONDS));

    const stop = () => setPhase("hidden");

    /**
     * Driven by an interval rather than animation frames.
     *
     * This loop scrolls the page; it does not paint. rAF is throttled or
     * paused in plenty of situations - a backgrounded tab, a power-saving
     * phone - and every one of those would leave the tour silently stuck
     * partway down with a Stop button and nothing moving. An interval keeps
     * its promise.
     */
    const step = () => {
      const now = performance.now();
      const dt = Math.min(64, now - (last.current || now));
      last.current = now;

      // Fractional pixels accumulate instead of being lost to rounding, which
      // is what keeps a slow crawl actually moving.
      carry.current += (speed * dt) / 1000;
      const px = Math.floor(carry.current);
      if (px > 0) {
        carry.current -= px;
        window.scrollBy(0, px);
      }

      const atBottom = doc.scrollTop + window.innerHeight >= doc.scrollHeight - 2;
      if (atBottom) stop();
    };

    last.current = 0;
    carry.current = 0;
    timer.current = window.setInterval(step, 16);

    // Any deliberate input hands control straight back.
    const give = () => stop();
    window.addEventListener("touchstart", give, { passive: true });
    window.addEventListener("wheel", give, { passive: true });
    window.addEventListener("keydown", give);

    return () => {
      window.clearInterval(timer.current);
      window.removeEventListener("touchstart", give);
      window.removeEventListener("wheel", give);
      window.removeEventListener("keydown", give);
    };
  }, [phase]);

  if (phase === "hidden") return null;

  if (phase === "playing") {
    return (
      <button type="button" className="inv-auto inv-auto-stop" onClick={() => setPhase("hidden")}>
        Stop
      </button>
    );
  }

  return (
    <div className="inv-auto-offer">
      <button type="button" className="inv-auto" onClick={() => setPhase("playing")}>
        <span className="inv-auto-verb">Open</span>
        <span className="inv-auto-sub">Play it hands-free</span>
      </button>
    </div>
  );
}

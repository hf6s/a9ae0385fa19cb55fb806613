"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { prefersReducedMotion } from "@/components/ScrollStory";
import { isTearGesture, shouldCommit, stubOffset, tearProgress } from "@/lib/tear";

/**
 * A paper receipt the reader tears off to pay.
 *
 * THE PAYMENT IS NEVER BEHIND THE GESTURE. The button is in the server HTML
 * and visible without script. The seal that covers it is added by JS on mount
 * and can only be added once a pointer handler exists to remove it — so a
 * failed bundle, a blocked script or a browser that hates pointer events
 * leaves the reader looking at a payment button, not at a paper flap they
 * cannot open.
 *
 * Three ways through it, because this is the last step before money moves:
 *   - drag the perforation down
 *   - tap the TEAR button
 *   - reduced motion, or a torn state remembered from earlier in the session:
 *     it never seals in the first place
 *
 * The drag only claims gestures that are clearly downward pulls. Anything
 * sideways or upward belongs to the page, or the receipt becomes a wall a
 * phone cannot scroll past.
 */

const TORN_KEY = "f20-receipt-torn";

export default function Receipt({ children }: { children: ReactNode }) {
  const seal = useRef<HTMLDivElement>(null);
  const [sealed, setSealed] = useState(false);
  const [torn, setTorn] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    try {
      if (sessionStorage.getItem(TORN_KEY) === "1") return;
    } catch {
      /* blocked storage: seal it, the tear still works */
    }
    setSealed(true);
  }, []);

  useEffect(() => {
    const el = seal.current;
    if (!el || !sealed || torn) return;

    let startY = 0;
    let startX = 0;
    let dragging = false;
    let progress = 0;

    const setVisual = (p: number, released: boolean) => {
      el.style.setProperty("--tear", String(p));
      el.style.transform = `translateY(${stubOffset(p, released)}px) rotate(${p * 1.6}deg)`;
    };

    const finish = () => {
      setTorn(true);
      try {
        sessionStorage.setItem(TORN_KEY, "1");
      } catch {
        /* nothing to do */
      }
      // A short pulse on the phones that support it. Silently ignored
      // elsewhere, which is why it is not worth feature-detecting.
      navigator.vibrate?.(18);
    };

    const onDown = (e: PointerEvent) => {
      dragging = true;
      startY = e.clientY;
      startX = e.clientX;
      el.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      const dx = e.clientX - startX;
      if (!isTearGesture(dx, dy)) {
        // Not ours. Let the page have it rather than fighting the scroll.
        dragging = false;
        setVisual(0, false);
        return;
      }
      e.preventDefault();
      progress = tearProgress(dy);
      setVisual(progress, false);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      if (shouldCommit(progress)) {
        setVisual(1, true);
        window.setTimeout(finish, 420);
      } else {
        // Springs back, so a half pull is a question rather than a mistake.
        el.style.transition = "transform 360ms var(--ease-heavy)";
        setVisual(0, false);
        window.setTimeout(() => {
          el.style.transition = "";
        }, 380);
      }
      progress = 0;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [sealed, torn]);

  const tearNow = () => {
    const el = seal.current;
    if (el) {
      el.style.transition = "transform 420ms var(--ease-heavy), opacity 420ms linear";
      el.style.transform = `translateY(${stubOffset(1, true)}px) rotate(1.6deg)`;
      el.style.opacity = "0";
    }
    navigator.vibrate?.(18);
    window.setTimeout(() => {
      setTorn(true);
      try {
        sessionStorage.setItem(TORN_KEY, "1");
      } catch {
        /* nothing to do */
      }
    }, 380);
  };

  return (
    <section className={`inv-receipt${sealed && !torn ? " is-sealed" : ""}`}>
      <div className="inv-paper">{children}</div>

      {sealed && !torn ? (
        <div className="inv-seal" ref={seal}>
          <div className="inv-perf" aria-hidden="true" />
          <div className="inv-seal-face">
            <span className="inv-seal-hint">Pull down to tear off</span>
            <button type="button" className="inv-seal-btn" onClick={tearNow}>
              Tear
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

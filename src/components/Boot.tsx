"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/components/ScrollStory";

/**
 * The boot sequence: a terminal starting up, then a curtain lift.
 *
 * SAFETY FIRST, because this is the one component on the page that can hide
 * everything behind it:
 *   - It is rendered by script only. With JS off there is no curtain at all
 *     and the invoice is simply there.
 *   - A hard timeout lifts it no matter what else happens. If a font hangs or
 *     a promise never settles, the reader waits BOOT_MAX_MS and not a
 *     millisecond longer.
 *   - Tapping anywhere lifts it immediately.
 *   - Under prefers-reduced-motion it still runs, because it is the page
 *     introducing itself rather than decoration, but it prints the log at once
 *     instead of typing it and fades instead of sliding. Skipping it entirely
 *     left a phone with that setting looking at a dead document.
 *   - Skipped when the tab is hidden at mount — nobody is watching a boot
 *     sequence they cannot see, and rAF is paused there anyway.
 *   - Once seen, it stays down for six hours. Re-reading an invoice should not
 *     cost three seconds every time.
 *
 * The counter reports real readiness — fonts resolved, page loaded, lines
 * printed — not a fabricated timer. When the physics bake lands it becomes
 * another input here, which is the point: the wait does actual work.
 */

const BOOT_MAX_MS = 1700;
const SEEN_KEY = "f20-boot-seen";
const SEEN_FOR_MS = 6 * 60 * 60 * 1000;

export interface BootLine {
  label: string;
  value: string;
}

/**
 * Character delays that are not uniform.
 *
 * A perfectly even typing rhythm is the sound of a machine pretending to be a
 * terminal. Real output stutters: a burst, a pause where something blocked, a
 * burst again. Seeded so it is the same every time rather than random noise.
 */
function delayFor(index: number): number {
  const wobble = Math.sin(index * 12.9898) * 43758.5453;
  const frac = wobble - Math.floor(wobble);
  if (frac > 0.94) return 26; // the occasional hitch
  return 3.5 + frac * 6;
}

export default function Boot({ lines }: { lines: BootLine[] }) {
  const [active, setActive] = useState(false);
  const [typed, setTyped] = useState(0);
  const [pct, setPct] = useState(0);
  const [lifting, setLifting] = useState(false);
  const [gentle, setGentle] = useState(false);
  const done = useRef(false);

  // The whole script is one flat string; `typed` is how much of it has printed.
  const script = lines.map((l) => `${l.label} ${l.value}`).join("\n");

  useEffect(() => {
    const reduced = prefersReducedMotion();
    let seenRecently = false;
    try {
      const seen = Number(localStorage.getItem(SEEN_KEY) ?? 0);
      seenRecently = Date.now() - seen < SEEN_FOR_MS;
    } catch {
      // Private mode or blocked storage: play it. A boot sequence is not worth
      // an exception.
    }
    if (seenRecently || document.hidden) return;

    setActive(true);
    if (reduced) setGentle(true);
    document.documentElement.classList.add("inv-booting");

    const started = performance.now();
    let raf = 0;
    const timers: number[] = [];

    const finish = () => {
      if (done.current) return;
      done.current = true;
      setPct(100);
      setLifting(true);
      try {
        localStorage.setItem(SEEN_KEY, String(Date.now()));
      } catch {
        /* nothing to do */
      }
      // Matches the curtain transition; the class removal re-enables scrolling.
      timers.push(
        window.setTimeout(() => {
          document.documentElement.classList.remove("inv-booting");
          setActive(false);
        }, 700),
      );
    };

    // Type the script out, character by character, at an uneven rhythm — or
    // print it whole, for a reader who asked for less movement.
    let i = 0;
    if (reduced) {
      i = script.length;
      setTyped(i);
    } else {
      const typeNext = () => {
        i += 1;
        setTyped(i);
        if (i < script.length) {
          timers.push(window.setTimeout(typeNext, delayFor(i)));
        }
      };
      timers.push(window.setTimeout(typeNext, 220));
    }

    // Real readiness, not a fake timer. Each signal is worth a share of the
    // counter, and the last share is the printing itself.
    let fontsReady = false;
    let loaded = document.readyState === "complete";
    document.fonts?.ready
      .then(() => {
        fontsReady = true;
      })
      .catch(() => {
        fontsReady = true;
      });
    const onLoad = () => {
      loaded = true;
    };
    window.addEventListener("load", onLoad);

    const tick = () => {
      const elapsed = performance.now() - started;
      const printed = script.length > 0 ? i / script.length : 1;
      const progress = (fontsReady ? 0.3 : 0) + (loaded ? 0.2 : 0) + printed * 0.5;
      setPct(Math.min(99, Math.round(progress * 100)));
      if (progress >= 0.99 && elapsed > 550) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // The guarantee: whatever stalls, the page appears.
    timers.push(window.setTimeout(finish, BOOT_MAX_MS));

    const skip = () => finish();
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);

    return () => {
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      window.removeEventListener("load", onLoad);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
      document.documentElement.classList.remove("inv-booting");
    };
  }, [script]);

  if (!active) return null;

  const printed = script.slice(0, typed).split("\n");

  return (
    <div
      className={`inv-boot${lifting ? " is-lifting" : ""}${gentle ? " is-gentle" : ""}`}
      aria-hidden="true"
    >
      <div className="inv-boot-inner">
        <pre className="inv-boot-log">
          {printed.map((line, n) => (
            <span key={n}>
              {line}
              {n === printed.length - 1 && !lifting ? <i className="inv-caret" /> : null}
              {"\n"}
            </span>
          ))}
        </pre>
        <div className="inv-boot-pct">
          <span className="inv-boot-n">{String(pct).padStart(3, "0")}</span>
          <span className="inv-boot-bar">
            <i style={{ transform: `scaleX(${pct / 100})` }} />
          </span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * Environment readout, shown only with ?diag=1 in the URL.
 *
 * The page animates on every machine I can reach and not on the one phone that
 * matters, and I cannot attach a debugger to it. So the phone reports for
 * itself: which renderer started, whether the OS asked for reduced motion,
 * whether scroll ticks are arriving at all, and how many frames have actually
 * been drawn.
 *
 * Those four numbers separate every plausible cause. Ticks at zero means the
 * scroll loop never ran. Ticks climbing with draws at zero means the loop runs
 * but no renderer started. Both climbing means it is drawing and the problem is
 * something else entirely.
 */

interface Probe {
  mode?: string;
  ticks?: number;
  draws?: number;
  progress?: number;
  glError?: string;
  /** Which branch the machine's scroll tick last took. */
  snap?: string;
}

declare global {
  interface Window {
    __f20diag?: Probe;
  }
}

export default function Diag() {
  const [on, setOn] = useState(false);
  const [snap, setSnap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("diag")) return;
    setOn(true);

    const read = () => {
      const p = window.__f20diag ?? {};
      const canvas = document.createElement("canvas");
      let gl = "no";
      try {
        if (canvas.getContext("webgl2")) gl = "webgl2";
        else if (canvas.getContext("webgl")) gl = "webgl1";
      } catch {
        gl = "threw";
      }
      setSnap({
        renderer: p.mode ?? "none",
        ticks: String(p.ticks ?? 0),
        draws: String(p.draws ?? 0),
        progress: (p.progress ?? 0).toFixed(3),
        glError: p.glError ?? "-",
        tickPath: p.snap ?? "-",
        webgl: gl,
        reducedMotion: String(
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
        ),
        rmOverride: new URLSearchParams(window.location.search).get("rm") ?? "-",
        lenis: String(document.documentElement.classList.contains("lenis")),
        dpr: String(window.devicePixelRatio),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        scrollY: String(Math.round(window.scrollY)),
        docHeight: String(document.documentElement.scrollHeight),
        ua: navigator.userAgent.slice(0, 48),
      });
    };

    read();
    const id = window.setInterval(read, 400);
    return () => window.clearInterval(id);
  }, []);

  if (!on) return null;

  return (
    <div className="inv-diag">
      {Object.entries(snap).map(([k, v]) => (
        <div key={k}>
          <b>{k}</b>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

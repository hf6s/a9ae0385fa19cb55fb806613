"use client";

import { useEffect, useState } from "react";

/** Next nightly-refresh time: 02:30 UTC, Tuesday–Saturday (after US trading days). */
function nextRun(): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 30, 0));
  while (next <= now || next.getUTCDay() === 0 || next.getUTCDay() === 1) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export default function NextScanCountdown() {
  const [text, setText] = useState("—");

  useEffect(() => {
    const tick = () => {
      const ms = nextRun().getTime() - Date.now();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setText(`${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="card">
      <div className="label">Next auto-refresh</div>
      <div className="big">{text}</div>
      <p className="name-dim">Nightly scan + AI analysis · 02:30 UTC after US trading days</p>
    </div>
  );
}

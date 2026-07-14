"use client";

import { useEffect, useRef, useState } from "react";

export interface Stat {
  label: string;
  value: number;
  sub: string;
  decimals?: number;
  suffix?: string;
}

function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [shown, setShown] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    const dur = 700;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(value * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  return (
    <>
      {shown.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </>
  );
}

export default function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <div className="stat-tiles">
      {stats.map((s) => (
        <div className="stat-tile" key={s.label}>
          <div className="stat-label">{s.label}</div>
          <div className="stat-value">
            <CountUp value={s.value} decimals={s.decimals} suffix={s.suffix} />
          </div>
          <div className="stat-sub">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

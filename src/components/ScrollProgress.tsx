"use client";

import { useEffect, useState } from "react";

export default function ScrollProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const update = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setPct(max > 0 ? (h.scrollTop / max) * 100 : 0);
    };
    document.addEventListener("scroll", update, { passive: true });
    update();
    return () => document.removeEventListener("scroll", update);
  }, []);

  return <div className="scroll-progress" style={{ width: `${pct}%` }} />;
}

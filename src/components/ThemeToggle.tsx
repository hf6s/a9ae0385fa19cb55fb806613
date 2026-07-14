"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = (document.documentElement.dataset.theme as "dark" | "light") || "dark";
    setTheme(saved);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("f20-theme", next);
    } catch {
      /* private mode */
    }
  }

  return (
    <button className="theme-toggle" onClick={toggle} title="Toggle light / dark" aria-label="Toggle theme">
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Item {
  kind: "stock" | "page";
  id: string; // href
  label: string;
  sub?: string;
  icon: string;
}

const PAGES: Item[] = [
  { kind: "page", id: "/", label: "Rankings", icon: "▤" },
  { kind: "page", id: "/lab", label: "Factor Lab", sub: "custom weights", icon: "⚗" },
  { kind: "page", id: "/universe", label: "Factor Universe", sub: "bubble map", icon: "✦" },
  { kind: "page", id: "/exits", label: "Exits", icon: "▼" },
  { kind: "page", id: "/portfolio", label: "Portfolio", icon: "◆" },
  { kind: "page", id: "/backtest", label: "Backtest", icon: "◷" },
  { kind: "page", id: "/methodology", label: "Methodology", icon: "☰" },
  { kind: "page", id: "/dashboard", label: "Dashboard", icon: "⣿" },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [stocks, setStocks] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (stocks.length > 0) return;
    try {
      const res = await fetch("/api/tickers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { ticker: string; name: string; rank: number }[];
      setStocks(
        data.map((s) => ({
          kind: "stock" as const,
          id: `/stock/${s.ticker}`,
          label: s.ticker,
          sub: s.name,
          icon: "#" + s.rank,
        })),
      );
    } catch {
      /* retry on next open */
    }
  }, [stocks.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setQuery("");
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, load]);

  const q = query.trim().toLowerCase();
  const pool = [...PAGES, ...stocks];
  const results = q
    ? pool
        .filter(
          (i) =>
            i.label.toLowerCase().includes(q) || (i.sub ?? "").toLowerCase().includes(q),
        )
        .slice(0, 9)
    : PAGES;

  function choose(item: Item) {
    setOpen(false);
    router.push(item.id);
  }

  return (
    <>
      <button className="cmdk-fab" onClick={() => setOpen(true)} aria-label="Search (Ctrl K)">
        ⌘K
      </button>
      {open && (
        <div className="cmdk-scrim" onClick={() => setOpen(false)}>
          <div className="cmdk" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              className="cmdk-input"
              placeholder="Jump to a stock or page…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (e.key === "Enter" && results[highlight]) {
                  choose(results[highlight]);
                }
              }}
            />
            <div className="cmdk-list">
              {results.length === 0 && <div className="cmdk-empty">No matches</div>}
              {results.map((item, i) => (
                <button
                  key={item.id}
                  className={`cmdk-item${i === highlight ? " active" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(item)}
                >
                  <span className="cmdk-icon">{item.icon}</span>
                  <span className="cmdk-label">{item.label}</span>
                  {item.sub && <span className="cmdk-sub">{item.sub}</span>}
                  <span className="cmdk-kind">{item.kind}</span>
                </button>
              ))}
            </div>
            <div className="cmdk-hint">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

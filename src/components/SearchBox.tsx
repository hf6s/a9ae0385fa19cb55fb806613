"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Item {
  ticker: string;
  name: string;
  rank: number;
}

export default function SearchBox() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function ensureItems() {
    if (items && items.length > 0) return;
    try {
      const res = await fetch("/api/tickers", { cache: "no-store" });
      if (res.ok) setItems(await res.json());
    } catch {
      /* retried on next focus/keystroke */
    }
  }

  useEffect(() => {
    ensureItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const matches =
    q && items
      ? items
          .filter(
            (i) => i.ticker.toLowerCase().startsWith(q) || i.name.toLowerCase().includes(q),
          )
          .slice(0, 8)
      : [];

  function go(ticker: string) {
    setQuery("");
    setOpen(false);
    router.push(`/stock/${ticker}`);
  }

  return (
    <div className="search" ref={boxRef}>
      <input
        type="text"
        placeholder="Search ticker…"
        value={query}
        onFocus={() => {
          ensureItems();
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
          ensureItems();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHighlight((h) => Math.min(h + 1, matches.length - 1));
          else if (e.key === "ArrowUp") setHighlight((h) => Math.max(h - 1, 0));
          else if (e.key === "Enter" && matches[highlight]) go(matches[highlight].ticker);
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && matches.length > 0 && (
        <div className="search-results">
          {matches.map((m, i) => (
            <button
              key={m.ticker}
              className={i === highlight ? "hit active" : "hit"}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => go(m.ticker)}
            >
              <span className="ticker">{m.ticker}</span>
              <span className="name-dim"> {m.name}</span>
              <span className="name-dim" style={{ marginLeft: "auto" }}>#{m.rank}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

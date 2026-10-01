"use client";

import Link from "next/link";
import type { Position } from "@/lib/portfolio";

/**
 * Every position's return on one axis.
 *
 * The holdings table carries the same numbers, but a column of percentages has
 * to be read one row at a time, and what matters here is the spread: a
 * portfolio where one name carries everything and nine do nothing needs a
 * different conversation from one where ten names each gained a little, and the
 * two look the same in a table.
 *
 * Bars are scaled to the largest move in either direction, so the shape is the
 * portfolio's own, not a fixed axis that squashes a quiet month into nothing.
 */

const money = (n: number) =>
  `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })}`;

export default function PnlBars({ positions }: { positions: Position[] }) {
  const priced = positions.filter((p) => p.priced && p.basis > 0);
  if (priced.length === 0) return null;

  const rows = [...priced].sort((a, b) => b.gainPct - a.gainPct);
  // A floor of 5% stops a portfolio whose biggest move is 0.3% from rendering
  // that as a full-width bar and implying something dramatic happened.
  const scale = Math.max(5, ...rows.map((r) => Math.abs(r.gainPct)));

  return (
    <div className="pnl-bars">
      {rows.map((p) => {
        const width = (Math.abs(p.gainPct) / scale) * 50;
        const up = p.gain >= 0;
        return (
          <div key={p.id} className="pnl-row">
            <Link href={`/stock/${p.ticker}`} className="pnl-ticker">
              <span className="ticker">{p.ticker}</span>
            </Link>
            <div className="pnl-track">
              <span className="pnl-axis" />
              <span
                className={`pnl-fill ${up ? "pos" : "neg"}`}
                style={up ? { width: `${width}%`, left: "50%" } : { width: `${width}%`, right: "50%" }}
              />
            </div>
            <span className={`pnl-pct ${up ? "pos" : "neg"}`}>
              {up ? "+" : "−"}
              {Math.abs(p.gainPct).toFixed(1)}%
            </span>
            <span className={`pnl-cash ${up ? "pos" : "neg"}`}>{money(p.gain)}</span>
          </div>
        );
      })}
    </div>
  );
}

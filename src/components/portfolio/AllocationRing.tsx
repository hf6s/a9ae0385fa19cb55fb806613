"use client";

import { useState } from "react";
import type { Position, SectorSlice } from "@/lib/portfolio";

/**
 * The shape of the portfolio: one arc per position, coloured by sector.
 *
 * A table of weights is already on the page, so this exists to show the two
 * things a table hides - whether one position has quietly grown into a quarter
 * of the money, and whether twelve "different" holdings are eleven technology
 * companies. Concentration is the risk an equal-weight model is supposed to
 * avoid, and it is the easiest one to stop noticing.
 *
 * Drawn with stroke-dasharray on concentric circles rather than arc paths: the
 * maths is one subtraction per slice and there is no path string to get wrong.
 */

/**
 * Sector colours.
 *
 * Fixed hues rather than the theme's four factor tokens, because the scan emits
 * around thirty sector names and they have to stay apart on both the dark and
 * the light background. Related sectors sit on neighbouring hues on purpose: a
 * portfolio that is nine kinds of financial should read as one block of blue,
 * because that is what it is.
 *
 * Two naming schemes are covered. The scan labels companies from the price
 * feed ("Insurance", "Metals & Mining"), while the backtest derives sectors
 * from SEC filing codes and produces the broader GICS names ("Financials",
 * "Materials"). Both appear in stored data, so both are listed.
 */
const SECTOR_HUE: Record<string, number> = {
  // financial
  Banking: 210,
  "Financial Services": 220,
  Insurance: 200,
  Financials: 212,
  "Real Estate": 230,
  // energy and moving things
  Energy: 22,
  Marine: 14,
  "Logistics & Transportation": 30,
  "Road & Rail": 38,
  Utilities: 8,
  // technology and media
  Technology: 250,
  Semiconductors: 262,
  Communications: 274,
  "Communication Services": 274,
  Media: 286,
  // health
  "Health Care": 312,
  Pharmaceuticals: 322,
  "Life Sciences Tools & Services": 332,
  // industrial
  "Industrial Conglomerates": 152,
  Industrials: 160,
  "Electrical Equipment": 162,
  Machinery: 168,
  "Aerospace & Defense": 176,
  "Trading Companies & Distributors": 182,
  "Professional Services": 188,
  "Commercial Services & Supplies": 194,
  Construction: 140,
  Building: 132,
  // materials
  "Metals & Mining": 46,
  Chemicals: 56,
  Packaging: 66,
  Materials: 50,
  // consumer
  Beverages: 86,
  Retail: 96,
  "Consumer products": 104,
  "Consumer Staples": 90,
  "Consumer Discretionary": 100,
  "Textiles, Apparel & Luxury Goods": 112,
  Agriculture: 76,
};

function sectorColor(sector: string, shade = 0): string {
  const hue =
    SECTOR_HUE[sector] ??
    // Anything the scan has not classified gets a stable hue from its name, so
    // the same sector is the same colour on every visit.
    [...sector].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  // Positions inside one sector step in lightness so neighbouring arcs of the
  // same colour stay separable.
  return `hsl(${hue} 62% ${Math.min(72, 52 + shade * 9)}%)`;
}

const RADIUS = 72;
const STROKE = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** A hair of empty space between arcs, in path units. */
const GAP = 2;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function AllocationRing({
  positions,
  sectors,
  total,
}: {
  positions: Position[];
  sectors: SectorSlice[];
  total: number;
}) {
  const [active, setActive] = useState<string | null>(null);

  // Ordered by sector so each sector's arcs sit together on the ring and the
  // block of colour is the sector's true size.
  const order = new Map(sectors.map((s, i) => [s.sector, i]));
  const slices = positions
    .filter((p) => p.priced && p.value > 0)
    .sort((a, b) => {
      const sa = order.get(a.sector) ?? 99;
      const sb = order.get(b.sector) ?? 99;
      return sa !== sb ? sa - sb : b.value - a.value;
    });

  if (slices.length === 0 || total <= 0) return null;

  let seen = 0;
  let lastSector = "";
  let shade = 0;
  const arcs = slices.map((p) => {
    if (p.sector !== lastSector) {
      lastSector = p.sector;
      shade = 0;
    } else {
      shade += 1;
    }
    const share = p.value / total;
    const length = share * CIRCUMFERENCE;
    const arc = {
      ticker: p.ticker,
      name: p.name,
      sector: p.sector,
      weight: share * 100,
      value: p.value,
      gainPct: p.gainPct,
      color: sectorColor(p.sector, shade),
      // A slice thinner than the gap would otherwise render as nothing at all.
      dash: `${Math.max(length - GAP, 0.6)} ${CIRCUMFERENCE - Math.max(length - GAP, 0.6)}`,
      offset: -seen,
    };
    seen += length;
    return arc;
  });

  const shown = active ? arcs.find((a) => a.ticker === active) : null;

  return (
    <div className="ring-wrap">
      <div className="ring-figure">
        <svg viewBox="0 0 200 200" role="img" aria-label="Allocation by position">
          <g transform="rotate(-90 100 100)">
            {arcs.map((a) => (
              <circle
                key={a.ticker}
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                stroke={a.color}
                strokeWidth={active === a.ticker ? STROKE + 6 : STROKE}
                strokeDasharray={a.dash}
                strokeDashoffset={a.offset}
                className="ring-arc"
                opacity={active && active !== a.ticker ? 0.32 : 1}
                onMouseEnter={() => setActive(a.ticker)}
                onMouseLeave={() => setActive(null)}
              />
            ))}
          </g>
          <text x="100" y="94" className="ring-center-value" textAnchor="middle">
            {shown ? shown.ticker : money(total)}
          </text>
          <text x="100" y="114" className="ring-center-label" textAnchor="middle">
            {shown ? `${shown.weight.toFixed(1)}% · ${money(shown.value)}` : "market value"}
          </text>
        </svg>
      </div>

      <div className="ring-legend">
        {sectors.map((s) => (
          <div key={s.sector} className="ring-sector">
            <div className="ring-sector-head">
              <span className="ring-dot" style={{ background: sectorColor(s.sector) }} />
              <strong>{s.sector}</strong>
              <span className="ring-sector-pct">{s.pct.toFixed(1)}%</span>
            </div>
            <div className="ring-sector-names">
              {arcs
                .filter((a) => a.sector === s.sector)
                .map((a) => (
                  <button
                    type="button"
                    key={a.ticker}
                    className={`ring-chip${active === a.ticker ? " is-active" : ""}`}
                    onMouseEnter={() => setActive(a.ticker)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(a.ticker)}
                    onBlur={() => setActive(null)}
                  >
                    <span className="ticker">{a.ticker}</span>
                    <span className="ring-chip-pct">{a.weight.toFixed(1)}%</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
        {sectors.length === 1 && (
          <p className="ring-warn">
            Every holding sits in one sector. The model spreads across sectors on purpose: one bad
            quarter for {sectors[0].sector} moves this whole portfolio at once.
          </p>
        )}
      </div>
    </div>
  );
}

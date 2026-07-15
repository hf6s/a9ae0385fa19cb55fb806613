"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  addMany,
  clearPortfolio,
  readPortfolio,
  removePosition,
  type Position,
} from "@/lib/portfolio";

interface TopStock {
  ticker: string;
  name: string;
  price: number;
}

export default function Portfolio({
  prices,
  top20,
}: {
  prices: Record<string, number>;
  top20: TopStock[];
}) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    setPositions(readPortfolio());
    setReady(true);
  }, []);

  // Refresh live prices for held tickers now and every 30 minutes
  const heldKey = positions.map((p) => p.ticker).sort().join(",");
  useEffect(() => {
    if (!heldKey) return;
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch(`/api/quote?tickers=${encodeURIComponent(heldKey)}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { prices: Record<string, number>; at: string };
        if (!alive) return;
        setLive((prev) => ({ ...prev, ...json.prices }));
        setUpdatedAt(json.at);
      } catch {
        /* keep last prices */
      }
    };
    pull();
    const id = setInterval(pull, 30 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [heldKey]);

  if (!ready) return <div className="analysis"><p className="name-dim">Loading portfolio…</p></div>;

  const rows = positions.map((p) => {
    const cur = live[p.ticker] ?? prices[p.ticker];
    const pnlPct = cur !== undefined ? (cur / p.entryPrice - 1) * 100 : null;
    return { ...p, cur, pnlPct };
  });

  const tracked = rows.filter((r) => r.pnlPct !== null);
  const portReturn = tracked.length
    ? tracked.reduce((a, r) => a + (r.pnlPct as number), 0) / tracked.length
    : 0;
  const winners = tracked.filter((r) => (r.pnlPct as number) > 0).length;

  function buyTop20() {
    const today = new Date().toISOString().slice(0, 10);
    setPositions(
      addMany(
        top20.map((s) => ({ ticker: s.ticker, name: s.name, entryPrice: s.price, date: today })),
      ),
    );
  }

  return (
    <div>
      <div className="pf-summary">
        <div className="stat-tile">
          <div className="stat-label">Positions</div>
          <div className="stat-value">{positions.length}</div>
          <div className="stat-sub">equal-weight, paper</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Portfolio return</div>
          <div className={`stat-value ${portReturn >= 0 ? "pos" : "neg"}`}>
            {portReturn >= 0 ? "+" : ""}
            {portReturn.toFixed(2)}%
          </div>
          <div className="stat-sub">since each entry date</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Winners</div>
          <div className="stat-value">
            {winners}/{tracked.length}
          </div>
          <div className="stat-sub">positions in the green</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <button className="btn-outline" onClick={buyTop20}>
          ＋ Buy current top 20
        </button>
        {positions.length > 0 && (
          <button
            className="btn-outline"
            onClick={() => setPositions(clearPortfolio())}
          >
            Clear all
          </button>
        )}
      </div>

      {positions.length === 0 ? (
        <div className="empty-state">
          <p>
            Your paper portfolio is empty. Click <strong>Buy current top 20</strong> above, or
            add individual stocks with the <strong>＋ Portfolio</strong> button on any stock
            page. Positions are equal-weight and stored only in your browser.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="rankings">
            <thead>
              <tr>
                <th>Company</th>
                <th style={{ textAlign: "right" }}>Entry</th>
                <th style={{ textAlign: "right" }}>Current</th>
                <th style={{ textAlign: "right" }}>Return</th>
                <th className="name-dim">Since</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker} className="row">
                  <td>
                    <Link href={`/stock/${r.ticker}`}>
                      <span className="ticker">{r.ticker}</span>{" "}
                      <span className="name-dim">{r.name}</span>
                    </Link>
                  </td>
                  <td style={{ textAlign: "right" }}>${r.entryPrice.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.cur !== undefined ? `$${r.cur.toFixed(2)}` : "—"}
                  </td>
                  <td
                    style={{ textAlign: "right" }}
                    className={r.pnlPct === null ? "name-dim" : r.pnlPct >= 0 ? "pos" : "neg"}
                  >
                    {r.pnlPct === null
                      ? "no data"
                      : `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(2)}%`}
                  </td>
                  <td className="name-dim">{r.date}</td>
                  <td>
                    <button
                      className="star"
                      title="Remove"
                      onClick={() => setPositions(removePosition(r.ticker))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="analysis-meta">
        {updatedAt ? (
          <>
            <span className="live-dot" /> Live prices · updated{" "}
            {new Date(updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} ·
            auto-refresh every 30 min.{" "}
          </>
        ) : (
          "Prices from the latest scan. "
        )}
        A holding that has dropped out of the ranked set falls back to its last scan price. Paper
        only, not a brokerage, not investment advice.
      </p>
    </div>
  );
}

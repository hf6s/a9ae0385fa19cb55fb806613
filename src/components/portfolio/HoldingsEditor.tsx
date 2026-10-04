"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { makeHolding, MAX_HOLDINGS, normaliseTicker, type Holding, type Position } from "@/lib/portfolio";

/**
 * The holdings themselves: add, correct, remove.
 *
 * Typing a portfolio in is the price of admission for everything else on this
 * page, so the form does the work it can. Picking a ticker from the ranking
 * fills in the last scan price as the cost and today as the date, which is
 * right for a position bought this morning and one edit away from right for
 * anything else.
 *
 * It accepts cost per share rather than total, because that is the number on a
 * broker confirmation, and fractional shares, because every mainstream broker
 * now sells them and a portfolio built from $250 positions is mostly fractions.
 *
 * Nothing is saved until it validates. A row with no shares or an impossible
 * date would reach the chart as a silent zero.
 */

export interface Candidate {
  ticker: string;
  name: string;
  price: number;
  rank: number;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

interface Draft {
  ticker: string;
  shares: string;
  cost: string;
  at: string;
}

const EMPTY: Draft = { ticker: "", shares: "", cost: "", at: "" };

export default function HoldingsEditor({
  holdings,
  positions,
  candidates,
  onChange,
  prefill,
}: {
  holdings: Holding[];
  positions: Position[];
  candidates: Candidate[];
  onChange: (next: Holding[]) => void;
  /** A ticker arrived at from a link, to fill the form in with. */
  prefill?: string | null;
}) {
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, at: today() });
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const sharesRef = useRef<HTMLInputElement>(null);

  const byTicker = useMemo(
    () => new Map(candidates.map((c) => [c.ticker, c])),
    [candidates],
  );

  /**
   * Fills the form in for a stock arrived at from a link.
   *
   * The price comes from the ranking, and the cursor lands on the share count,
   * because that is the one thing no page can know. The date stays today's, the
   * same as typing the ticker in by hand would give - a link is a shortcut to
   * the form, not a different way of recording a holding.
   */
  useEffect(() => {
    if (!prefill) return;
    const known = byTicker.get(prefill);
    setDraft({
      ticker: prefill,
      shares: "",
      cost: known ? known.price.toFixed(2) : "",
      at: today(),
    });
    sharesRef.current?.focus();
    sharesRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [prefill, byTicker]);

  const matches = useMemo(() => {
    const q = normaliseTicker(draft.ticker);
    if (q.length === 0) return [];
    if (byTicker.has(q)) return [];
    return candidates
      .filter((c) => c.ticker.startsWith(q) || c.name.toUpperCase().includes(q))
      .slice(0, 6);
  }, [draft.ticker, candidates, byTicker]);

  const full = holdings.length >= MAX_HOLDINGS;

  function pick(c: Candidate) {
    setDraft((d) => ({
      ...d,
      ticker: c.ticker,
      // The last scan price is the best guess available and is almost always
      // what someone buying today paid, within a day's move.
      cost: d.cost.length > 0 ? d.cost : c.price.toFixed(2),
      at: d.at.length > 0 ? d.at : today(),
    }));
    setError("");
  }

  function add() {
    const h = makeHolding({
      id: `${normaliseTicker(draft.ticker)}-${Date.now()}`,
      ticker: draft.ticker,
      shares: draft.shares,
      cost: draft.cost,
      at: draft.at,
    });
    if (!h) {
      setError("Needs a ticker, a share count above zero, a cost and a real date.");
      return;
    }
    if (full) {
      setError(`That is ${MAX_HOLDINGS} holdings, which is the limit here.`);
      return;
    }
    setError("");
    onChange([...holdings, h]);
    setDraft({ ...EMPTY, at: today() });
  }

  function startEdit(h: Holding) {
    setEditing(h.id);
    setEditDraft({
      ticker: h.ticker,
      shares: String(h.shares),
      cost: String(h.cost),
      at: h.at,
    });
    setError("");
  }

  function saveEdit(id: string) {
    const h = makeHolding({ id, ...editDraft });
    if (!h) {
      setError("That edit would not add up, so nothing was changed.");
      return;
    }
    setError("");
    onChange(holdings.map((old) => (old.id === id ? h : old)));
    setEditing(null);
  }

  function remove(id: string) {
    onChange(holdings.filter((h) => h.id !== id));
    if (editing === id) setEditing(null);
  }

  return (
    <div className="holdings">
      <div className="table-scroll">
        <table className="rankings holdings-table">
          <thead>
            <tr>
              <th>Holding</th>
              <th style={{ textAlign: "right" }}>Shares</th>
              <th style={{ textAlign: "right" }}>Cost</th>
              <th style={{ textAlign: "right" }}>Price</th>
              <th style={{ textAlign: "right" }}>Value</th>
              <th style={{ textAlign: "right" }}>Gain</th>
              <th style={{ textAlign: "right" }}>Weight</th>
              <th style={{ textAlign: "right" }}>Rank</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) =>
              editing === p.id ? (
                <tr key={p.id} className="row holdings-editing">
                  <td>
                    <span className="ticker">{p.ticker}</span>
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      step="any"
                      min="0"
                      value={editDraft.shares}
                      onChange={(e) => setEditDraft((d) => ({ ...d, shares: e.target.value }))}
                      aria-label="Shares"
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      step="any"
                      min="0"
                      value={editDraft.cost}
                      onChange={(e) => setEditDraft((d) => ({ ...d, cost: e.target.value }))}
                      aria-label="Cost per share"
                    />
                  </td>
                  <td colSpan={4}>
                    <input
                      className="cell-input"
                      type="date"
                      value={editDraft.at}
                      max={today()}
                      onChange={(e) => setEditDraft((d) => ({ ...d, at: e.target.value }))}
                      aria-label="Date bought"
                    />
                  </td>
                  <td colSpan={2} style={{ textAlign: "right" }}>
                    <button type="button" className="btn btn-sm" onClick={() => saveEdit(p.id)}>
                      Save
                    </button>{" "}
                    <button
                      type="button"
                      className="btn-outline btn-sm"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="row">
                  <td>
                    {p.known ? (
                      <Link href={`/stock/${p.ticker}`}>
                        <span className="ticker">{p.ticker}</span>{" "}
                        <span className="name-dim">{p.name}</span>
                      </Link>
                    ) : (
                      <>
                        <span className="ticker">{p.ticker}</span>{" "}
                        <span className="name-dim">not in the universe</span>
                      </>
                    )}
                    <span className="holdings-date">{p.at}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {p.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  </td>
                  <td style={{ textAlign: "right" }}>{money(p.cost)}</td>
                  <td style={{ textAlign: "right" }}>
                    {p.priced ? money(p.price) : <span className="name-dim">no price</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>{p.priced ? money(p.value) : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    {p.priced && p.basis > 0 ? (
                      <span className={p.gain >= 0 ? "pos" : "neg"}>
                        {p.gain >= 0 ? "+" : "−"}
                        {Math.abs(p.gainPct).toFixed(1)}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {p.priced ? `${p.weight.toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {p.rank === null ? (
                      <span className="name-dim">—</span>
                    ) : (
                      <span className={p.inTop20 ? "rank-in" : "rank-out"}>#{p.rank}</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="row-btn"
                      onClick={() => startEdit(p)}
                      aria-label={`Edit ${p.ticker}`}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="row-btn row-btn-x"
                      onClick={() => remove(p.id)}
                      aria-label={`Remove ${p.ticker}`}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <div className="add-holding">
        <div className="add-field add-ticker">
          <label className="control-label" htmlFor="add-ticker">
            Ticker
          </label>
          <input
            id="add-ticker"
            className="alloc-input"
            value={draft.ticker}
            onChange={(e) => setDraft((d) => ({ ...d, ticker: e.target.value }))}
            placeholder="AAPL"
            autoComplete="off"
            spellCheck={false}
          />
          {matches.length > 0 && (
            <ul className="add-suggest">
              {matches.map((c) => (
                <li key={c.ticker}>
                  <button type="button" onClick={() => pick(c)}>
                    <span className="ticker">{c.ticker}</span>
                    <span className="name-dim">{c.name}</span>
                    <span className="add-suggest-price">{money(c.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="add-field">
          <label className="control-label" htmlFor="add-shares">
            Shares
          </label>
          <input
            id="add-shares"
            ref={sharesRef}
            className="alloc-input"
            type="number"
            step="any"
            min="0"
            value={draft.shares}
            onChange={(e) => setDraft((d) => ({ ...d, shares: e.target.value }))}
            placeholder="1.25"
          />
        </div>

        <div className="add-field">
          <label className="control-label" htmlFor="add-cost">
            Cost per share
          </label>
          <input
            id="add-cost"
            className="alloc-input"
            type="number"
            step="any"
            min="0"
            value={draft.cost}
            onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
            placeholder="190.25"
          />
        </div>

        <div className="add-field">
          <label className="control-label" htmlFor="add-date">
            Bought
          </label>
          <input
            id="add-date"
            className="alloc-input"
            type="date"
            max={today()}
            value={draft.at}
            onChange={(e) => setDraft((d) => ({ ...d, at: e.target.value }))}
          />
        </div>

        <button type="button" className="btn add-btn" onClick={add} disabled={full}>
          Add holding
        </button>
      </div>

      {error && <p className="suggest-error">{error}</p>}
      {full && (
        <p className="alloc-note">
          {MAX_HOLDINGS} holdings is the ceiling. It exists so a bad import cannot ask the price
          feed for a thousand symbols at once.
        </p>
      )}
    </div>
  );
}

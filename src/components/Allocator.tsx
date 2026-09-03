"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildPlan,
  MAX_POSITIONS,
  MIN_POSITION,
  type Candidate,
} from "@/lib/allocation";

const PRESETS = [500, 1000, 2500, 5000, 10000];
const STORAGE_KEY = "f20-account-size";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function Allocator({ candidates }: { candidates: Candidate[] }) {
  const [account, setAccount] = useState<number>(() => {
    if (typeof window === "undefined") return 1000;
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved > 0 ? saved : 1000;
  });

  const plan = useMemo(() => buildPlan(account, candidates), [account, candidates]);

  function update(value: number) {
    setAccount(value);
    if (value > 0) localStorage.setItem(STORAGE_KEY, String(value));
  }

  return (
    <div>
      <div className="alloc-input-row">
        <label className="control-label" htmlFor="account-size">
          Account size
        </label>
        <div className="alloc-field">
          <span className="alloc-currency">$</span>
          <input
            id="account-size"
            type="number"
            min={0}
            step={100}
            value={account || ""}
            onChange={(e) => update(Number(e.target.value))}
            className="alloc-input"
            placeholder="1000"
          />
        </div>
        <div className="seg">
          {PRESETS.map((p) => (
            <button
              key={p}
              className={p === account ? "active" : ""}
              onClick={() => update(p)}
            >
              ${p >= 1000 ? `${p / 1000}k` : p}
            </button>
          ))}
        </div>
      </div>

      {!plan ? (
        <div className="empty-state">
          <p>Enter an account size above to see how the equal-weight split works out.</p>
        </div>
      ) : (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <div className="stat-label">Positions</div>
              <div className="stat-value">{plan.positions}</div>
              <div className="stat-sub">
                of {MAX_POSITIONS} model slots
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Per position</div>
              <div className="stat-value">{money(plan.perPosition)}</div>
              <div className="stat-sub">{plan.weightPct.toFixed(1)}% each</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Invested</div>
              <div className="stat-value">{money(plan.invested)}</div>
              <div className="stat-sub">the whole account</div>
            </div>
          </div>

          <div className="alloc-notes">
            {plan.concentrated && (
              <p className="alloc-note">
                {plan.positions} positions instead of {MAX_POSITIONS}. Each holding carries{" "}
                {plan.weightPct.toFixed(1)}% of the account, so a single stock moves your result
                more than at full diversification.
              </p>
            )}
            {plan.thin && (
              <p className="alloc-note warn">
                Positions under {money(100)}. Commission and spread take a large share of a
                position this size.
              </p>
            )}
          </div>

          <div className="table-scroll">
            <table className="rankings">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Company</th>
                  <th style={{ textAlign: "right" }}>Price</th>
                  <th style={{ textAlign: "right" }}>Weight</th>
                  <th style={{ textAlign: "right" }}>Buy</th>
                  <th style={{ textAlign: "right" }}>Shares</th>
                  <th style={{ textAlign: "right" }}>Whole shares</th>
                </tr>
              </thead>
              <tbody key={plan.positions}>
                {plan.rows.map((r, i) => (
                  <tr
                    key={r.ticker}
                    className="row row-in"
                    style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}
                  >
                    <td className="rank-cell">{i + 1}</td>
                    <td>
                      <Link href={`/stock/${r.ticker}`}>
                        <span className="ticker">{r.ticker}</span>{" "}
                        <span className="name-dim">{r.name}</span>
                      </Link>
                    </td>
                    <td style={{ textAlign: "right" }}>${r.price.toFixed(2)}</td>
                    <td style={{ textAlign: "right" }}>{r.weightPct.toFixed(1)}%</td>
                    <td style={{ textAlign: "right" }}>{money(r.dollars)}</td>
                    <td style={{ textAlign: "right" }}>{r.shares.toFixed(4)}</td>
                    <td className="name-dim" style={{ textAlign: "right" }}>
                      {r.wholeShares}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="disclaimer">
        Equal weighting follows the model spec. Position count scales with account size so each
        holding clears about {money(MIN_POSITION)}, down to a floor of 5 positions. Share counts
        assume you buy at the last scan price, which moves before you trade. This is arithmetic on
        the current ranking, not investment advice.
      </p>
    </div>
  );
}

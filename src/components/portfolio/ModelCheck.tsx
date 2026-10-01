"use client";

import Link from "next/link";
import { driftRows, type Position } from "@/lib/portfolio";
import type { Exit } from "@/lib/exits";

/**
 * What the model says about the holdings, specifically.
 *
 * The exits page already lists every sell signal in the ranking, and that is
 * the problem: most of those names are nothing to do with this portfolio, and a
 * list that is mostly irrelevant gets skimmed. These are the flags on shares
 * actually owned, which is a much shorter list and the only one that calls for
 * a decision.
 *
 * It also names the top-20 stocks the portfolio does not hold. Following a
 * ranking and quietly owning twelve of its twenty names is a different strategy
 * from the one the backtest measured, and the gap should be visible rather than
 * discovered later.
 */

const money = (n: number) =>
  `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })}`;

export default function ModelCheck({
  positions,
  exits,
  top20,
}: {
  positions: Position[];
  exits: Exit[];
  top20: { ticker: string; name: string; rank: number }[];
}) {
  const owned = new Set(positions.map((p) => p.ticker));
  const flagged = exits.filter((e) => owned.has(e.ticker));
  const high = flagged.filter((e) => e.severity === "high");
  const notOwned = top20.filter((s) => !owned.has(s.ticker));
  const offModel = positions.filter((p) => !p.inTop20);
  const drift = driftRows(positions).filter((d) => Math.abs(d.drift) >= 2);

  return (
    <div className="model-check">
      <section className={`check-card${high.length > 0 ? " is-high" : flagged.length > 0 ? " is-warn" : ""}`}>
        <div className="check-head">
          <strong>Sell rules on your holdings</strong>
          <span className="check-count">{flagged.length}</span>
        </div>
        {flagged.length === 0 ? (
          <p className="check-none">
            Nothing you own has broken a rule in the latest scan.{" "}
            <Link href="/exits">See all exit signals</Link>
          </p>
        ) : (
          <>
            <ul className="check-list">
              {flagged.map((e) => (
                <li key={`${e.ticker}-${e.rule}`} className={`sev-${e.severity}`}>
                  <Link href={`/stock/${e.ticker}`} className="ticker">
                    {e.ticker}
                  </Link>
                  <span className="check-rule">{e.rule}</span>
                  <span className="check-detail">{e.detail}</span>
                </li>
              ))}
            </ul>
            <p className="check-foot">
              <Link href="/exits">Why each rule fired</Link>
            </p>
          </>
        )}
      </section>

      <section className="check-card">
        <div className="check-head">
          <strong>Gaps against the model</strong>
          <span className="check-count">{notOwned.length}</span>
        </div>
        {notOwned.length === 0 ? (
          <p className="check-none">You hold every name in the current top 20.</p>
        ) : (
          <>
            <p className="check-none">
              Ranked in the top 20 and not held. The backtest held all twenty, so the more of these
              there are, the less the published result describes this portfolio.
            </p>
            <div className="check-chips">
              {notOwned.slice(0, 12).map((s) => (
                <Link key={s.ticker} href={`/stock/${s.ticker}`} className="check-chip">
                  <span className="check-chip-rank">#{s.rank}</span>
                  <span className="ticker">{s.ticker}</span>
                </Link>
              ))}
              {notOwned.length > 12 && (
                <Link href="/" className="check-chip check-chip-more">
                  +{notOwned.length - 12} more
                </Link>
              )}
            </div>
          </>
        )}
        {offModel.length > 0 && (
          <p className="check-foot">
            {offModel.length} holding{offModel.length === 1 ? "" : "s"} outside the top 20:{" "}
            {offModel.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link href={`/stock/${p.ticker}`} className="ticker">
                  {p.ticker}
                </Link>
                {p.known ? ` (#${p.rank})` : " (not ranked)"}
              </span>
            ))}
          </p>
        )}
      </section>

      <section className="check-card">
        <div className="check-head">
          <strong>Weight drift</strong>
          <span className="check-count">{drift.length}</span>
        </div>
        {drift.length === 0 ? (
          <p className="check-none">
            Every position is within two points of equal weight. Nothing to rebalance.
          </p>
        ) : (
          <>
            <p className="check-none">
              Winners grow into a larger share of the account on their own. These are more than two
              points off equal weight, with the trade that would even them up.
            </p>
            <ul className="drift-list">
              {drift.map((d) => (
                <li key={d.ticker}>
                  <span className="ticker">{d.ticker}</span>
                  <span className="drift-bar">
                    <span
                      className={`drift-fill ${d.drift >= 0 ? "over" : "under"}`}
                      style={{
                        width: `${Math.min(50, (Math.abs(d.drift) / Math.max(d.target, 1)) * 50)}%`,
                      }}
                    />
                  </span>
                  <span className={d.drift >= 0 ? "pos" : "neg"}>
                    {d.drift >= 0 ? "+" : "−"}
                    {Math.abs(d.drift).toFixed(1)} pts
                  </span>
                  <span className="drift-adjust">
                    {d.adjust >= 0 ? "buy " : "sell "}
                    {money(Math.abs(d.adjust))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="check-foot">
              Rebalancing costs spread and, outside a tax-sheltered account, tax. The model
              rebalances quarterly for that reason, not whenever a number drifts.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

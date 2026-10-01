"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  annualised,
  buildPositions,
  daysBetween,
  encodeHoldings,
  equityCurve,
  makeHolding,
  maxDrawdown,
  returnIndex,
  sectorMix,
  summarise,
  unchartable,
  type Bar,
  type Holding,
  type TickerMeta,
} from "@/lib/portfolio";
import type { Exit } from "@/lib/exits";
import HoldingsEditor, { type Candidate } from "./portfolio/HoldingsEditor";
import ValueChart from "./portfolio/ValueChart";
import AllocationRing from "./portfolio/AllocationRing";
import PnlBars from "./portfolio/PnlBars";
import ModelCheck from "./portfolio/ModelCheck";
import { clearHash, holdingsFromHash, loadHoldings, LINK_PARAM, saveHoldings } from "./portfolio/storage";

/**
 * The portfolio page: holdings in, every view of them out.
 *
 * WHAT IT IS FOR. The rest of the site is about what to buy. This is the only
 * page that can answer whether buying it worked, and it has to answer honestly
 * in both directions - a tracker that cannot show you losing to the index is
 * not a tracker, it is marketing.
 *
 * STALENESS IS STATED, NOT HIDDEN. Prices come from the last scan's history
 * files, and a scan runs every couple of days. So the page says which day it is
 * valuing the holdings as of. A tracker that implies live prices while quoting
 * Friday's close is how someone comes to sell on a number that was never real.
 *
 * Holdings live in this browser. The backup link is how they leave it.
 */

interface PricePayload {
  series: Record<string, Bar[]>;
  bench: Bar[];
  missing: string[];
  source: string;
}

const money = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits });

const signedMoney = (n: number) => `${n < 0 ? "−" : "+"}${money(Math.abs(n), 0)}`;

export default function Portfolio({
  meta,
  scanPrices,
  candidates,
  exits,
  top20,
  generatedAt,
  scanPriceAsOf,
}: {
  meta: Record<string, TickerMeta>;
  scanPrices: Record<string, number>;
  candidates: Candidate[];
  exits: Exit[];
  top20: { ticker: string; name: string; rank: number }[];
  generatedAt: string;
  /** The close the scan's prices come from, a day before it ran. */
  scanPriceAsOf: string;
}) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<PricePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [offered, setOffered] = useState<Holding[] | null>(null);
  const [copied, setCopied] = useState(false);

  // Storage and the URL fragment are both read once, on mount, because neither
  // exists during the server render.
  useEffect(() => {
    const saved = loadHoldings();
    const fromLink = holdingsFromHash();
    if (fromLink && saved.length === 0) {
      // Nothing to lose: a backup link opened in a fresh browser is exactly the
      // case this feature exists for, so it just works.
      setHoldings(fromLink);
      saveHoldings(fromLink);
      clearHash();
    } else if (fromLink && encodeHoldings(fromLink) !== encodeHoldings(saved)) {
      // Never silently replace a portfolio. Ask.
      setHoldings(saved);
      setOffered(fromLink);
    } else {
      setHoldings(saved);
      if (fromLink) clearHash();
    }
    setReady(true);
  }, []);

  const update = useCallback((next: Holding[]) => {
    setHoldings(next);
    saveHoldings(next);
  }, []);

  const tickers = useMemo(
    () => [...new Set(holdings.map((h) => h.ticker))].sort().join(","),
    [holdings],
  );

  useEffect(() => {
    if (!ready || tickers.length === 0) {
      setData(null);
      return;
    }
    let live = true;
    setLoading(true);
    fetch(`/api/portfolio/prices?t=${encodeURIComponent(tickers)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: PricePayload | null) => {
        if (live && json) setData(json);
      })
      .catch(() => {
        // The scan's own prices still value the positions; only the chart is
        // lost, and the page says so rather than showing an empty frame.
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tickers, ready]);

  /** Latest close per ticker, with the scan's price as the fallback. */
  const prices = useMemo(() => {
    const out: Record<string, number> = { ...scanPrices };
    for (const [ticker, bars] of Object.entries(data?.series ?? {})) {
      const last = bars[bars.length - 1];
      if (last && last.c > 0) out[ticker] = last.c;
    }
    return out;
  }, [data, scanPrices]);

  const positions = useMemo(() => buildPositions(holdings, prices, meta), [holdings, prices, meta]);
  const summary = useMemo(() => summarise(positions), [positions]);
  const sectors = useMemo(() => sectorMix(positions), [positions]);

  const curve = useMemo(
    () =>
      data ? equityCurve({ holdings, series: data.series, bench: data.bench }) : [],
    [holdings, data],
  );
  const index = useMemo(() => returnIndex(curve), [curve]);
  const hasBench = (data?.bench.length ?? 0) > 0;

  /**
   * The span of dates the holdings are priced at.
   *
   * These rarely agree. A scan runs the morning after the close it works from,
   * so the scan's own timestamp is already a day later than its prices; and a
   * holding outside the ranked universe is fetched live, so it can be a
   * fortnight fresher than everything the scan covers. Claiming the newest of
   * those for the whole portfolio would misdate most of it, so both ends are
   * kept and the page prints a range when they differ.
   */
  const priceDates = useMemo(() => {
    let newest = "";
    let oldest = "";
    for (const bars of Object.values(data?.series ?? {})) {
      const t = bars[bars.length - 1]?.t ?? "";
      if (t === "") continue;
      if (t > newest) newest = t;
      if (oldest === "" || t < oldest) oldest = t;
    }
    return { newest, oldest };
  }, [data]);
  const priceAsOf = priceDates.newest;

  const earliestBuy = useMemo(
    () => holdings.reduce((min, h) => (min === "" || h.at < min ? h.at : min), ""),
    [holdings],
  );

  /**
   * How stale the scan is, in days.
   *
   * Read from the browser's clock rather than the server's, because the page is
   * cached and a server-rendered "N days ago" would be wrong by however long it
   * sat in the cache.
   */
  const scanAge = useMemo(
    () => daysBetween(generatedAt.slice(0, 10), new Date().toISOString().slice(0, 10)),
    [generatedAt],
  );

  /** Holdings in the totals but absent from the chart, because nothing covers them. */
  const offChart = useMemo(
    () => (data ? unchartable(holdings, data.series) : []),
    [holdings, data],
  );

  const last = curve[curve.length - 1] ?? null;
  const lastIndex = index[index.length - 1] ?? null;
  const dd = useMemo(() => maxDrawdown(index), [index]);
  const held = curve.length > 0 ? daysBetween(curve[0].t, curve[curve.length - 1].t) : 0;
  const cagr = lastIndex ? annualised(lastIndex.strat - 1, held) : null;
  const benchCagr = lastIndex ? annualised(lastIndex.bench - 1, held) : null;

  /** The day the holdings are valued as of. */
  const asOf = priceAsOf || scanPriceAsOf;

  const backupLink = useMemo(() => {
    if (typeof window === "undefined" || holdings.length === 0) return "";
    return `${window.location.origin}/portfolio#${LINK_PARAM}=${encodeHoldings(holdings)}`;
  }, [holdings]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(backupLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard permission refused: the input below holds the same text and
      // can be selected by hand.
    }
  }

  function loadTop20() {
    const next = top20
      .map((s) =>
        makeHolding({
          id: `${s.ticker}-${Date.now()}-${s.rank}`,
          ticker: s.ticker,
          // One model slot each, at the scan price and dated the close that
          // price came from. Stamping it today, or even with the scan's own
          // timestamp, would date the position past the newest price available
          // for it - and then the chart has nothing to draw.
          shares: scanPrices[s.ticker] > 0 ? Number((1000 / scanPrices[s.ticker]).toFixed(4)) : 1,
          cost: scanPrices[s.ticker] ?? 0,
          at: scanPriceAsOf,
        }),
      )
      .filter((h): h is Holding => h !== null);
    update(next);
  }

  if (!ready) {
    return <div className="empty-state"><p>Reading your holdings…</p></div>;
  }

  return (
    <div className="portfolio">
      {offered && (
        <aside className="exit-alert is-warn">
          <div className="exit-alert-head">
            <strong>
              This link carries {offered.length} holding{offered.length === 1 ? "" : "s"}
            </strong>
          </div>
          <p className="check-none">
            You already have {holdings.length} saved in this browser. Loading the link replaces them.
          </p>
          <div className="exit-alert-foot">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                update(offered);
                setOffered(null);
                clearHash();
              }}
            >
              Load the link
            </button>
            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={() => {
                setOffered(null);
                clearHash();
              }}
            >
              Keep what I have
            </button>
          </div>
        </aside>
      )}

      {holdings.length === 0 ? (
        <div className="empty-state portfolio-empty">
          <h2>Nothing in here yet</h2>
          <p>
            Add what you bought — ticker, how many shares, what you paid per share, and the date.
            This page then values it against the last scan and against what the same money would
            have done in the S&amp;P 500.
          </p>
          {top20.length > 0 && (
            <p>
              <button type="button" className="btn-outline" onClick={loadTop20}>
                Start from the model&apos;s top 20
              </button>
            </p>
          )}
          <p className="disclaimer" style={{ marginTop: 4 }}>
            That button fills in all twenty at $1,000 each, priced and dated at the last close in
            the data ({scanPriceAsOf}). It is a starting point to edit, not a record of anything
            you own.
          </p>
        </div>
      ) : (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <div className="stat-label">Market value</div>
              <div className="stat-value">{money(summary.value, 0)}</div>
              <div className="stat-sub">
                {summary.positions} position{summary.positions === 1 ? "" : "s"} · {money(summary.basis, 0)} paid in
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Total gain</div>
              <div className={`stat-value ${summary.gain >= 0 ? "pos" : "neg"}`}>
                {signedMoney(summary.gain)}
              </div>
              {/*
                No annualised rate here. The honest annual figure is
                time-weighted, which does not equal this percentage divided by
                the years, and printing the two side by side invites arithmetic
                that will not reconcile. The time-weighted pair sits under the
                chart, where there is room to say what it means.
              */}
              <div className="stat-sub">
                {summary.gain >= 0 ? "+" : "−"}
                {Math.abs(summary.gainPct).toFixed(1)}% on the money you put in
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Against the index</div>
              {hasBench && last ? (
                <>
                  <div className={`stat-value ${last.value >= last.bench ? "pos" : "neg"}`}>
                    {signedMoney(last.value - last.bench)}
                  </div>
                  {/*
                    Both sides of the comparison, in dollars, because the
                    benchmark covers only the positions the chart could cover.
                    Quoting the index's figure beside the market-value tile's
                    larger basis read as the index having lost money.
                  */}
                  {/*
                    Dated, because this compares on the last day every holding
                    had a real price, which can be behind the market value in
                    the tile beside it. Without the date the two look like they
                    disagree.
                  */}
                  <div className="stat-sub">
                    {money(last.value, 0)} vs {money(last.bench, 0)} in the S&amp;P 500, at{" "}
                    {last.t}
                    {offChart.length > 0 ? ` · excludes ${offChart.join(", ")}` : ""}
                  </div>
                </>
              ) : (
                <>
                  <div className="stat-value">—</div>
                  <div className="stat-sub">no index data in this session</div>
                </>
              )}
            </div>
            <div className="stat-tile">
              <div className="stat-label">Deepest dip</div>
              <div className={`stat-value ${dd.pct > 0 ? "neg" : ""}`}>
                {dd.pct > 0 ? `−${dd.pct.toFixed(1)}%` : "—"}
              </div>
              <div className="stat-sub">
                {dd.at
                  ? `peak to trough, low on ${dd.at}`
                  : held > 0
                    ? "never below its own peak"
                    : "not enough history yet"}
              </div>
            </div>
          </div>

          <p className="meta-line portfolio-asof">
            {priceDates.oldest && priceDates.newest !== priceDates.oldest ? (
              <>
                Valued at each holding&apos;s last close, {priceDates.oldest} to{" "}
                {priceDates.newest} — the scanned names are the older date, anything fetched live is
                the newer one
              </>
            ) : (
              <>Valued at the close on {asOf}</>
            )}
            {loading ? " · fetching prices…" : ""}
            {data?.missing.length ? (
              <>
                {" "}
                · no price found for {data.missing.join(", ")}, so{" "}
                {data.missing.length === 1 ? "it is" : "they are"} left out of the totals
              </>
            ) : null}
          </p>

          {/*
            A scan runs every couple of days, so a gap this wide means scanning
            has stopped rather than that the market is quiet. Every number on
            this page is only as current as that date, and someone deciding
            whether to sell deserves to know the prices are a fortnight old
            before they act on them.
          */}
          {scanAge > 4 && (
            <p className="stale-warn">
              The last completed scan was {scanAge} days ago, on {generatedAt.slice(0, 10)}. Scans
              run every two days, so something has stopped — these prices and every rank below are
              that old.
            </p>
          )}

          <section className="pf-section">
            <h2>Your money against the index</h2>
            <ValueChart
              curve={curve}
              hasBench={hasBench}
              priceAsOf={priceAsOf}
              earliestBuy={earliestBuy}
              loading={loading}
            />
            {curve.length >= 2 && lastIndex && (
              <p className="check-foot">
                Time-weighted over {held} days, the holdings returned{" "}
                <span className={lastIndex.strat >= 1 ? "pos" : "neg"}>
                  {lastIndex.strat >= 1 ? "+" : "−"}
                  {Math.abs((lastIndex.strat - 1) * 100).toFixed(1)}%
                </span>
                {cagr !== null ? ` (${cagr.toFixed(1)}% a year)` : ""}
                {hasBench ? (
                  <>
                    {" "}
                    against the index&apos;s{" "}
                    <span className={lastIndex.bench >= 1 ? "pos" : "neg"}>
                      {lastIndex.bench >= 1 ? "+" : "−"}
                      {Math.abs((lastIndex.bench - 1) * 100).toFixed(1)}%
                    </span>
                    {benchCagr !== null ? ` (${benchCagr.toFixed(1)}% a year)` : ""}
                  </>
                ) : null}
                . That differs from the{" "}
                {summary.gain >= 0 ? "+" : "−"}
                {Math.abs(summary.gainPct).toFixed(1)}% above because it measures the holdings, not
                the timing: money paid in later earns for less of the period, which lowers the cash
                result without the stocks having done anything differently. It is the figure to
                compare against the backtest.
              </p>
            )}
            {offChart.length > 0 && curve.length >= 2 && (
              <p className="check-foot">
                {offChart.join(", ")} {offChart.length === 1 ? "is" : "are"} counted in the totals
                above but not on this chart: there is no price history covering{" "}
                {offChart.length === 1 ? "it" : "them"} since the buy date.
              </p>
            )}
            {curve.length >= 2 && last && priceAsOf && last.t < priceAsOf && (
              <p className="check-foot">
                The line ends on {last.t}, the last day every holding had a real price. The totals
                above run to {priceAsOf}, using each holding&apos;s own latest close — so the end of
                the line is slightly behind the market value. Carrying the chart further would mean
                holding the stale names flat while the rest moved, which would show a difference
                that did not happen.
              </p>
            )}
          </section>

          <section className="pf-section">
            <h2>Holdings</h2>
            <HoldingsEditor
              holdings={holdings}
              positions={positions}
              candidates={candidates}
              onChange={update}
            />
          </section>

          <div className="pf-grid">
            <section className="pf-section">
              <h2>Where the money sits</h2>
              <AllocationRing positions={positions} sectors={sectors} total={summary.value} />
            </section>

            <section className="pf-section">
              <h2>Position by position</h2>
              <PnlBars positions={positions} />
              {summary.best && summary.worst && (
                <p className="check-foot">
                  Best is <span className="ticker">{summary.best.ticker}</span> at{" "}
                  <span className="pos">+{summary.best.gainPct.toFixed(1)}%</span>, worst is{" "}
                  <span className="ticker">{summary.worst.ticker}</span> at{" "}
                  <span className={summary.worst.gainPct >= 0 ? "pos" : "neg"}>
                    {summary.worst.gainPct >= 0 ? "+" : "−"}
                    {Math.abs(summary.worst.gainPct).toFixed(1)}%
                  </span>
                  .
                </p>
              )}
            </section>
          </div>

          <section className="pf-section">
            <h2>What the model says about these</h2>
            <ModelCheck positions={positions} exits={exits} top20={top20} />
          </section>

          <section className="pf-section">
            <h2>Keep a copy</h2>
            <p className="check-none">
              These holdings are saved in this browser only. This link carries them — send it to
              yourself and opening it anywhere restores the portfolio. It is a plain list of
              tickers, share counts and dates, and everything after the <code>#</code> stays in
              your browser: that part of a URL is never sent to a server.
            </p>
            <div className="backup-row">
              <input className="alloc-input backup-input" readOnly value={backupLink} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn" onClick={copyLink}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </section>

          <p className="disclaimer">
            Prices come from the last scan, dated {asOf}, not a live feed — they will differ from
            your broker. The chart adds dividends back into both lines, so it is a total-return
            comparison; the gain column on each holding is price only, which is what a broker shows.
            The index comparison buys the S&amp;P 500 with each position&apos;s own cost on its own
            buy date, so a position bought last week is compared against one week of the index.
            None of this is advice, and none of it accounts for tax or commission.
          </p>
        </>
      )}
    </div>
  );
}

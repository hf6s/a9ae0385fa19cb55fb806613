import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { getRankings } from "@/lib/data";
import { FREE_TIER_GAPS } from "@/lib/scoring";

export const metadata = { title: "How it works — Factor20" };
export const dynamic = "force-dynamic";

/**
 * Live numbers, never hardcoded prose.
 *
 * Every performance sentence on this page is built from the result files. A
 * hardcoded "beats the market by X" goes stale the moment a scan or backtest
 * re-runs, and a stale performance claim is the kind that misleads a reader
 * into a decision. If the file is missing the sentence is omitted rather than
 * guessed at.
 */
interface Verdict {
  cagr: number;
  benchCagr: number;
  years: number;
  maxDrawdown: number;
  benchMaxDrawdown: number;
  sharpe: number;
  quartersTotal: number;
  quartersBeatingIndex: number;
  avgTurnoverPct: number;
  costDragAnnualPct: number;
  rebalanceDays: number;
  topN: number;
  avgInvestablePerRebalance: number;
}

function backtestStats(): Verdict | null {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "data", "backtest.json"),
      "utf8",
    );
    return (JSON.parse(raw) as { stats: Verdict }).stats;
  } catch {
    return null;
  }
}

function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export default function Methodology() {
  const stats = backtestStats();
  const rankings = getRankings();
  const excess = stats ? stats.cagr - stats.benchCagr : null;
  /**
   * Static gaps come from the engine; the scan file may add its own on top.
   *
   * Matched on the rule name before the dash, not the whole string: the scan
   * file is a snapshot, so once the engine's wording is corrected an exact
   * comparison stops matching and the superseded sentence reappears alongside
   * the fixed one. That already happened once, on this list, about a filter
   * that had been implemented for weeks.
   */
  const ruleName = (g: string) => g.split("—")[0].trim().toLowerCase();
  const known = new Set(FREE_TIER_GAPS.map(ruleName));
  const scanOnly = (rankings?.skippedFilters ?? []).filter(
    (g) => !known.has(ruleName(g)),
  );
  const gaps = [...FREE_TIER_GAPS, ...scanOnly];

  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>How Factor20 works</h1>
      <p className="meta-line">
        Every rule on this page is mechanical, disclosed, and applied
        identically to every stock. No black box, no predictions, nothing
        hand-picked.
      </p>

      {/* ---------- what it is ---------- */}
      <section>
        <h2>What this is</h2>
        <div className="analysis">
          <p>
            Factor20 is a <strong>stock screener and ranking engine</strong>.
            Every couple of days it downloads price history and SEC filings for
            around{" "}
            {rankings ? rankings.universeScanned.toLocaleString() : "900+"} US
            companies, throws out the ones that fail a fixed list of
            financial-health tests, scores everything that survives on four
            measures, and sorts the result. The top 20 are the output.
          </p>
          <p>
            The scoring model is not original. It is an implementation of
            published asset-pricing research — Fama–French on value and size,
            Novy-Marx on gross profitability, Jegadeesh &amp; Titman on
            momentum, Piotroski on financial strength, Altman on distress. The
            point of the app is applying those rules consistently and showing
            its work, not inventing a new theory.
          </p>
        </div>
      </section>

      {/* ---------- what it does not do ---------- */}
      <section>
        <h2>What it does not do</h2>
        <div className="analysis">
          <p>
            <strong>It does not predict prices.</strong> Nothing here forecasts
            what a stock will do. Every number is a description of what a
            company&apos;s filings and price history already say.
          </p>
          <p>
            <strong>It does not give advice.</strong> There is no
            &quot;buy&quot; button and no personalised recommendation. It ranks;
            you decide.
          </p>
          <p>
            <strong>It does not beat the market, as measured.</strong> That
            result is on the <Link href="/backtest">Backtest page</Link> and
            repeated below rather than buried.
          </p>
        </div>
      </section>

      {/* ---------- the pipeline ---------- */}
      <section>
        <h2>How a stock gets ranked</h2>
        <div className="analysis">
          <p>
            Five stages. A stock has to survive stage 1 to reach stage 2 — most
            do not.
            {rankings && (
              <>
                {" "}
                On the latest scan, {rankings.passedFilters} of{" "}
                {rankings.universeScanned} companies (
                {Math.round(
                  (rankings.passedFilters / rankings.universeScanned) * 100,
                )}
                %) made it past the filters.
              </>
            )}
          </p>
        </div>

        <div className="cards">
          <div className="card">
            <div className="label">Stage 0 — the universe</div>
            <p>US-listed common stocks on major exchanges.</p>
            <p className="name-dim">
              ETFs, ADRs, preferred shares, warrants, SPACs and OTC names are
              excluded by security type before anything else runs.
            </p>
          </div>

          <div className="card">
            <div className="label">Stage 1 — elimination filters</div>
            <p>
              <strong>Liquidity:</strong> market cap &gt; $2B · avg daily dollar
              volume &gt; $10M · price &gt; $10 · positive revenue
            </p>
            <p>
              <strong>Financial health:</strong> current ratio &gt; 1.2 ·
              interest coverage &gt; 4 · Debt/EBITDA &lt; 3 · Altman Z &gt; 2
            </p>
            <p>
              <strong>Profitability:</strong> positive net income · positive
              free cash flow · gross margin above the sector median
            </p>
            <p>
              <strong>Trend:</strong> price above the 200-day moving average ·
              50-day MA above the 200-day MA
            </p>
            <p className="name-dim">
              Fail any one and the stock is not ranked at all, however good the
              rest looks.
            </p>
          </div>

          <div className="card">
            <div className="label">Stage 2 — four factor scores</div>
            <p>
              Each survivor gets four 0–100 scores. Every underlying metric is
              converted to a percentile against the rest of the surviving
              universe first, so a raw ROIC of 18% becomes &quot;better than 84%
              of survivors&quot; before it is weighted.
            </p>
            <p>
              <strong>Quality (30%)</strong> — ROIC 25 · gross profit/assets 20
              · operating margin 15 · FCF margin 15 · ROE 15 · low debt 5 · low
              accruals 5
            </p>
            <p>
              <strong>Value (25%)</strong> — earnings yield 30 · FCF yield 30 ·
              EV/EBITDA 20 · price/book 10 · price/sales 10
            </p>
            <p>
              <strong>Momentum (25%)</strong> — 12-month return excluding the
              last month 40 · 6-month return 30 · relative strength vs the
              S&amp;P 500 20 · distance above the 200-day MA 10
            </p>
            <p>
              <strong>Growth (20%)</strong> — revenue growth 35 · EPS growth 30
              · FCF growth 20 · forward EPS growth 15
            </p>
          </div>

          <div className="card">
            <div className="label">Stage 3 — penalties</div>
            <p>Points subtracted from the weighted score:</p>
            <p>
              −20 Debt/Equity &gt; 2 · −15 heavy insider selling · −15 earnings
              surprise below −20% · −10 Piotroski F-Score &lt; 5 · −10 Altman Z
              &lt; 3
            </p>
          </div>

          <div className="card">
            <div className="label">Stages 4 &amp; 5 — score and rank</div>
            <p>
              Final = 0.30×Quality + 0.25×Value + 0.25×Momentum + 0.20×Growth −
              penalties.
            </p>
            <p className="name-dim">
              Sorted descending. The top 20 are the recommended set; everything
              else stays visible so you can see what just missed.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- holding and selling ---------- */}
      <section>
        <h2>Holding and selling</h2>
        <div className="analysis">
          <p>
            <strong>Equal weight, 20 positions, rebalanced quarterly.</strong>{" "}
            Equal weighting is what the research supports — it avoids
            concentrating the portfolio in whichever name happens to be largest.{" "}
            <Link href="/allocate">Position sizing</Link> scales the slot count
            down for small accounts, because $1,000 split 20 ways is $50 a
            position and most ranked stocks cost more than that per share.
          </p>
          <p>
            <strong>Sell rules</strong> are on the{" "}
            <Link href="/exits">Exits page</Link>, run against every scan: a
            holding is sold when it falls outside the top 50, when its score
            drops below 70, when it fails a financial-health filter, or when
            earnings turn negative.
          </p>
        </div>
      </section>

      {/* ---------- how it is tested ---------- */}
      <section>
        <h2>How it is tested — and what the test says</h2>
        <div className="analysis">
          <p>
            The same scoring code that ranks stocks today is replayed over
            history. Getting that honest is most of the engineering in this
            project:
          </p>
          <p>
            <strong>Point-in-time fundamentals.</strong> Every ranking uses only
            the SEC filings that were actually public on that date, matched by
            filing date rather than fiscal year. A company&apos;s 2015 annual
            report was not available in June 2015, so it is not used then.
          </p>
          <p>
            <strong>No survivorship bias.</strong> The universe is historical
            S&amp;P 500 membership as it stood on each date, including companies
            that were later delisted, acquired or went to zero. Testing only
            today&apos;s survivors is the single most common way a backtest
            flatters itself.
          </p>
          <p>
            <strong>Total return on both sides.</strong> The strategy and the
            benchmark both reinvest dividends, and the benchmark is SPY rather
            than the S&amp;P price index — comparing a dividend-reinvesting
            strategy to a price-only index would have manufactured roughly 180
            points of fake outperformance.
          </p>
          <p>
            <strong>Trading costs charged.</strong> 10 basis points each way on
            every position replaced, which is a fair retail estimate for liquid
            US large caps.
            {stats && (
              <>
                {" "}
                At {stats.avgTurnoverPct.toFixed(0)}% average turnover per
                rebalance that costs {stats.costDragAnnualPct.toFixed(1)}% a
                year, and it is deducted, not noted.
              </>
            )}
          </p>
          <p>
            <strong>Split into halves.</strong> Any result that only works in
            one half of the period is reported as such rather than averaged into
            a single flattering number.
          </p>
        </div>

        {stats && excess !== null && (
          <>
            <div className="stat-tiles">
              <div className="stat-tile">
                <div className="stat-label">Strategy CAGR</div>
                <div className="stat-value">{stats.cagr.toFixed(1)}%</div>
                <div className="stat-sub">
                  over {stats.years.toFixed(1)} years
                </div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">S&amp;P 500 (SPY)</div>
                <div className="stat-value">{stats.benchCagr.toFixed(1)}%</div>
                <div className="stat-sub">same period, total return</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Difference</div>
                <div className={`stat-value ${excess < 0 ? "neg" : ""}`}>
                  {pct(excess)}
                </div>
                <div className="stat-sub">per year</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Quarters ahead</div>
                <div className="stat-value">
                  {stats.quartersBeatingIndex}/{stats.quartersTotal}
                </div>
                <div className="stat-sub">
                  {Math.round(
                    (stats.quartersBeatingIndex / stats.quartersTotal) * 100,
                  )}
                  % of the time
                </div>
              </div>
            </div>

            <div className="analysis">
              <p>
                {excess < 0 ? (
                  <>
                    <strong>
                      Read that honestly: the model returned{" "}
                      {stats.cagr.toFixed(1)}% a year against the index&apos;s{" "}
                      {stats.benchCagr.toFixed(1)}%, so it lost by{" "}
                      {Math.abs(excess).toFixed(1)} points a year
                    </strong>{" "}
                    — with a deeper worst-case drawdown (
                    {stats.maxDrawdown.toFixed(1)}% vs{" "}
                    {stats.benchMaxDrawdown.toFixed(1)}%) on top. An index fund
                    beat this strategy over the tested period, after costs.
                  </>
                ) : (
                  <>
                    <strong>
                      The model returned {stats.cagr.toFixed(1)}% a year against
                      the index&apos;s {stats.benchCagr.toFixed(1)}%
                    </strong>
                    , an edge of {excess.toFixed(1)} points — but with a deeper
                    worst-case drawdown ({stats.maxDrawdown.toFixed(1)}% vs{" "}
                    {stats.benchMaxDrawdown.toFixed(1)}%). One backtest on one
                    market is not proof, and a result that does not repeat out
                    of sample is not a strategy.
                  </>
                )}
              </p>
              <p>
                Many variations have been tried — different factor weights,
                sector caps, relaxed filters, shorter holding periods, a wider
                universe. They are all recorded on the{" "}
                <Link href="/backtest">Backtest page</Link>, including the ones
                that lost, because reporting only the winning configuration is
                how a screener talks itself into a result that will not repeat.
              </p>
            </div>
          </>
        )}
      </section>

      {/* ---------- limits ---------- */}
      <section>
        <h2>What it cannot see</h2>
        <div className="analysis">
          <p>
            The data plan behind this app covers prices and SEC filings, not
            analyst estimates or dividend records. Where that leaves a hole, the
            hole is listed rather than filled with an approximation:
          </p>
          {/*
            The permanent gaps come from the scoring engine itself, so this list cannot drift
            out of date the way a copy in the page would. Anything the last scan reported on
            top of those is a condition of that run, so it is shown separately.
          */}
          {gaps.map((gap, i) => (
            <p key={i} className="name-dim">
              · {gap}
            </p>
          ))}
          <p className="name-dim">
            · Dividend-cut sell rule — needs a dividend feed, so a distress cut
            is not detected
          </p>
          <p>
            When a metric is missing for one company, that company is scored on
            the metrics it does have and the weights are renormalised — never
            filled in with a guess. When a metric is missing for everyone, the
            whole line is listed here.
          </p>
        </div>
      </section>

      {/* ---------- data ---------- */}
      <section>
        <h2>Where the data comes from</h2>
        <div className="cards">
          <div className="card">
            <div className="label">Prices</div>
            <p>
              EODHD — daily closes, split- and dividend-adjusted, including
              delisted tickers.
            </p>
            <p className="name-dim">
              Returns and moving averages use the adjusted series; valuation
              ratios use the as-traded price, since market cap is price ×
              shares.
            </p>
          </div>
          <div className="card">
            <div className="label">Fundamentals</div>
            <p>
              SEC EDGAR company filings (XBRL), read directly from the source
              documents.
            </p>
            <p className="name-dim">
              Every ratio — ROIC, Altman Z, Piotroski F, accruals — is computed
              here from raw statement lines rather than taken from a
              vendor&apos;s pre-cooked field.
            </p>
          </div>
          <div className="card">
            <div className="label">Write-ups</div>
            <p>
              Claude (Opus 5) interprets each top stock&apos;s scores and
              researches the web.
            </p>
            <p className="name-dim">
              It explains what the numbers say and flags what they might hide.
              It has no vote in the ranking — the score is computed before
              Claude sees anything.
            </p>
          </div>
          <div className="card">
            <div className="label">Refresh</div>
            <p>
              The scan runs automatically every 2 days, and on demand from the
              dashboard.
            </p>
            <p className="name-dim">
              Rankings move slowly by design — the model rebalances quarterly,
              so daily re-scanning would cost money to tell you the same thing.
            </p>
          </div>
        </div>
      </section>

      <p className="disclaimer">
        Factor20 is a screening and education tool. Nothing on this site is
        investment advice or a recommendation to buy or sell any security.
        Backtested results are hypothetical, come with the limitations described
        above, and are not a promise about the future.
      </p>
    </main>
  );
}

export const metadata = { title: "Methodology — Factor20" };

export default function Methodology() {
  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Methodology</h1>
      <p className="meta-line">
        Everything Factor20 does is mechanical and disclosed on this page. No black box, no
        predictions.
      </p>

      <section>
        <h2>Universe</h2>
        <div className="analysis">
          <p>
            All US-listed common stocks on major exchanges (no ADRs, ETFs, warrants, or OTC)
            with market cap above ~$1.5B, rebuilt monthly (~1,100+ names). Each stock must
            then pass every elimination filter below to be ranked at all.
          </p>
        </div>
      </section>

      <section>
        <h2>Stage 1 — elimination filters</h2>
        <div className="analysis">
          <p><strong>Liquidity:</strong> market cap &gt; $2B · avg daily dollar volume &gt; $10M · price &gt; $10</p>
          <p><strong>Financial health:</strong> current ratio &gt; 1.2 · interest coverage &gt; 4 · Debt/EBITDA &lt; 3 · Altman Z &gt; 2</p>
          <p><strong>Profitability:</strong> positive net income · positive free cash flow · gross margin above sector median</p>
          <p><strong>Trend:</strong> price above the 200-day moving average · 50-day MA above 200-day MA</p>
          <p className="name-dim">
            Fundamental inputs come from Finnhub and SEC EDGAR filings; Altman Z is skipped
            for banks/insurers where the formula doesn&apos;t apply.
          </p>
        </div>
      </section>

      <section>
        <h2>Stage 2 — factor scores</h2>
        <div className="analysis">
          <p>
            Every survivor gets four 0–100 scores, each a weighted blend of percentile ranks
            across the surviving universe:
          </p>
          <p><strong>Quality (30%):</strong> ROIC 25 · gross profit/assets 20 · operating margin 15 · FCF margin 15 · ROE 15 · low debt 5 · low accruals 5</p>
          <p><strong>Value (25%):</strong> earnings yield 30 · FCF yield 30 · EV/EBITDA 20 · price/book 10 · price/sales 10</p>
          <p><strong>Momentum (25%):</strong> 12-month return (excl. last month) 40 · 6-month return 30 · relative strength vs S&amp;P 500 20 · distance above 200-day MA 10</p>
          <p><strong>Growth (20%):</strong> revenue growth 35 · EPS growth 30 · FCF growth 20 · forward EPS growth 15 (unavailable on free data; weight renormalized)</p>
        </div>
      </section>

      <section>
        <h2>Stage 3 — penalties</h2>
        <div className="analysis">
          <p>
            −20 Debt/Equity &gt; 2 · −15 heavy insider selling · −15 earnings surprise below
            −20% · −10 Piotroski F-Score &lt; 5 · −10 Altman Z &lt; 3
          </p>
        </div>
      </section>

      <section>
        <h2>Final score, ranking, holding periods</h2>
        <div className="analysis">
          <p>
            Final = 0.30×Quality + 0.25×Value + 0.25×Momentum + 0.20×Growth − penalties.
            Stocks are ranked descending; the top 20 are highlighted. The holding-period
            presets re-weight the same four scores: shorter horizons emphasize momentum
            (which the literature finds strongest over 3–12 months), longer horizons
            emphasize quality and value (which converge over years).
          </p>
        </div>
      </section>

      <section>
        <h2>Data & AI</h2>
        <div className="analysis">
          <p>
            Prices: Yahoo Finance (daily). Fundamentals: Finnhub + SEC EDGAR company filings.
            Rankings refresh nightly after US trading days; the universe rebuilds monthly.
            Claude (Opus 4.8) writes an interpretation of each top stock&apos;s scores — it
            explains the numbers and flags what they might hide; it does not predict or
            recommend. The backtest page covers the momentum/trend half of the model over 10
            years with its limitations disclosed.
          </p>
        </div>
      </section>

      <p className="disclaimer">
        Factor20 is a screening and education tool. Nothing on this site is investment
        advice or a recommendation to buy or sell any security.
      </p>
    </main>
  );
}

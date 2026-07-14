import Link from "next/link";
import { notFound } from "next/navigation";
import { getAnalyses, getHistory, getRankings } from "@/lib/data";
import AddToPortfolio from "@/components/AddToPortfolio";
import AskClaude from "@/components/AskClaude";
import PriceChart from "@/components/PriceChart";
import StarButton from "@/components/StarButton";

export const dynamic = "force-dynamic";

const FACTOR_META = [
  { key: "quality", label: "Quality", weight: "30%", color: "var(--q)" },
  { key: "value", label: "Value", weight: "25%", color: "var(--v)" },
  { key: "momentum", label: "Momentum", weight: "25%", color: "var(--m)" },
  { key: "growth", label: "Growth", weight: "20%", color: "var(--g)" },
] as const;

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const rankings = getRankings();
  const stock = rankings?.stocks.find(
    (s) => s.ticker.toUpperCase() === ticker.toUpperCase(),
  );
  if (!stock || !rankings) notFound();

  const history = getHistory(stock.ticker);
  const analysis = getAnalyses()?.analyses[stock.ticker];
  const m = stock.metrics;

  // Nearest neighbors by factor-vector (Q,V,M,G) Euclidean distance
  const similar = rankings.stocks
    .filter((o) => o.ticker !== stock.ticker && o.name.toLowerCase() !== stock.name.toLowerCase())
    .map((o) => ({
      o,
      d: Math.hypot(
        o.scores.quality - stock.scores.quality,
        o.scores.value - stock.scores.value,
        o.scores.momentum - stock.scores.momentum,
        o.scores.growth - stock.scores.growth,
      ),
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4)
    .map((x) => x.o);
  const fmt = (v: number | null | undefined, suffix = "") =>
    v === null || v === undefined ? "—" : `${Math.round(v * 100) / 100}${suffix}`;

  return (
    <main>
      <Link href="/" className="back-link">
        ← Back to rankings
      </Link>
      <div className="stock-head">
        <h1>
          {stock.ticker} <span className="name-dim">{stock.name}</span>
        </h1>
        <span className="price-big">${stock.price.toFixed(2)}</span>
        {stock.recommended && <span className="badge">Top 20 · Rank #{stock.rank}</span>}
        {(() => {
          if (!stock.nextEarningsDate) return null;
          const days = Math.ceil((Date.parse(stock.nextEarningsDate) - Date.now()) / 86400000);
          if (days < 0 || days > 14) return null;
          return (
            <span className="earn-badge" title={`Earnings ${stock.nextEarningsDate}`}>
              ⚠ reports in {days}d
            </span>
          );
        })()}
        <StarButton ticker={stock.ticker} />
        <AddToPortfolio ticker={stock.ticker} name={stock.name} price={stock.price} />
      </div>
      <p className="meta-line">
        {stock.sector} · Market cap ${Math.round(stock.marketCap / 1000)}B · Final score{" "}
        <strong style={{ color: "var(--accent)" }}>{stock.finalScore.toFixed(1)}</strong>
        {stock.penalties.length > 0 && (
          <>
            {" "}
            ·{" "}
            {stock.penalties.map((p) => (
              <span key={p.reason} className="penalty">
                {p.reason} (−{p.points}){" "}
              </span>
            ))}
          </>
        )}
      </p>

      <div className="cards">
        {FACTOR_META.map((f) => {
          const score = stock.scores[f.key];
          return (
            <div className="card" key={f.key}>
              <div className="label">
                {f.label} · {f.weight}
              </div>
              <div className="big">{score.toFixed(1)}</div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${score}%`, background: f.color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {history && history.length > 0 && (
        <section>
          <h2>Price · 50/200-day trend</h2>
          <div className="chart-box">
            <PriceChart candles={history} />
          </div>
        </section>
      )}

      <section>
        <h2>AI analysis</h2>
        {analysis ? (
          <div className="analysis">
            {analysis.text.split(/\n\s*\n/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
            <p className="analysis-meta">
              Written by {analysis.model} ·{" "}
              {new Date(analysis.generatedAt).toLocaleDateString("en-US", {
                dateStyle: "medium",
              })}{" "}
              · interprets the factor model; not investment advice
            </p>
          </div>
        ) : (
          <div className="analysis">
            <p className="name-dim">
              No AI write-up yet for this stock — run <code>npm run analyze</code>.
            </p>
          </div>
        )}
      </section>

      <section>
        <h2>Ask about this stock</h2>
        <div className="analysis">
          <AskClaude ticker={stock.ticker} />
        </div>
      </section>

      <section>
        <h2>Key metrics</h2>
        <div className="cards">
          <div className="card">
            <div className="label">Valuation</div>
            <p>P/E {fmt(m.pe)} · P/B {fmt(m.pb)}</p>
            <p>P/S {fmt(m.ps)} · P/FCF {fmt(m.pfcf)}</p>
          </div>
          <div className="card">
            <div className="label">Profitability</div>
            <p>ROE {fmt(m.roe, "%")} · ROIC {fmt(m.roic, "%")}</p>
            <p>
              GM {fmt(m.grossMargin, "%")} · OM {fmt(m.operatingMargin, "%")} · NM{" "}
              {fmt(m.netMargin, "%")}
            </p>
          </div>
          <div className="card">
            <div className="label">Balance sheet</div>
            <p>Debt/Equity {fmt(m.debtToEquity)} · Debt/EBITDA {fmt(m.debtToEbitda)}</p>
            <p>Current ratio {fmt(m.currentRatio)}</p>
            <p>Altman Z {fmt(m.altmanZ)} · Piotroski F {fmt(m.piotroskiF)}/9</p>
          </div>
          <div className="card">
            <div className="label">Growth</div>
            <p>Revenue {fmt(m.revenueGrowth, "%")} yoy</p>
            <p>EPS {fmt(m.epsGrowth, "%")} yoy · FCF {fmt(m.fcfGrowth, "%")} yoy</p>
          </div>
        </div>
      </section>

      {similar.length > 0 && (
        <section>
          <h2>Similar stocks</h2>
          <p className="name-dim" style={{ marginBottom: 14 }}>
            Closest factor profiles to {stock.ticker} across Quality, Value, Momentum and Growth.
          </p>
          <div className="sim-grid">
            {similar.map((o, i) => (
              <Link
                key={o.ticker}
                href={`/stock/${o.ticker}`}
                className="sim-card reveal"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <div className="sim-head">
                  <span className="ticker">{o.ticker}</span>
                  <span className="score-strong">{o.finalScore.toFixed(1)}</span>
                </div>
                <p className="name-dim" style={{ fontSize: 12 }}>{o.name}</p>
                <div className="sim-bars">
                  {([["Q", o.scores.quality, "var(--q)"], ["V", o.scores.value, "var(--v)"], ["M", o.scores.momentum, "var(--m)"], ["G", o.scores.growth, "var(--g)"]] as const).map(
                    ([k, v, c]) => (
                      <div key={k} className="sim-bar">
                        <span className="sim-bar-k">{k}</span>
                        <div className="sim-bar-track">
                          <div className="sim-bar-fill" style={{ width: `${v}%`, background: c }} />
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="disclaimer">
        Scores are percentile ranks within the surviving universe on the latest scan. Nothing
        on this page is investment advice.
      </p>
    </main>
  );
}

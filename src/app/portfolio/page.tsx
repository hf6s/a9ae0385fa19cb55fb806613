import Portfolio from "@/components/Portfolio";
import { getPrevRankings, getPriceAsOf, getRankings } from "@/lib/data";
import { computeExits } from "@/lib/exits";
import { MODEL_POSITIONS, type TickerMeta } from "@/lib/portfolio";

/**
 * Everything the browser needs to judge a portfolio, handed over in one render.
 *
 * The ranking is a 100KB file and the client only needs four fields per stock,
 * so it is reduced here rather than shipped whole. The sell rules are evaluated
 * on the server too, from the same computeExits the exits page and the push
 * notifications use - a second implementation would eventually disagree with
 * the first, and then the site would be telling someone to sell a position it
 * elsewhere calls fine.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Portfolio · Factor20",
  description: "What you own, what it is worth, and whether it beat the index.",
};

export default function PortfolioPage() {
  const rankings = getRankings();
  const prev = getPrevRankings();

  if (!rankings || rankings.stocks.length === 0) {
    return (
      <main>
        <h1>Portfolio</h1>
        <div className="empty-state">
          <p>
            No rankings yet, so there is nothing to compare holdings against. Run{" "}
            <code>npm run scan</code> first.
          </p>
        </div>
      </main>
    );
  }

  const meta: Record<string, TickerMeta> = {};
  const scanPrices: Record<string, number> = {};
  for (const s of rankings.stocks) {
    meta[s.ticker] = { name: s.name, sector: s.sector, rank: s.rank, score: s.finalScore };
    if (s.price > 0) scanPrices[s.ticker] = s.price;
  }

  const candidates = rankings.stocks.map((s) => ({
    ticker: s.ticker,
    name: s.name,
    price: s.price,
    rank: s.rank,
  }));

  const top20 = rankings.stocks
    .slice(0, MODEL_POSITIONS)
    .map((s) => ({ ticker: s.ticker, name: s.name, rank: s.rank }));

  // The close the scan's prices come from, which is a day before the scan ran.
  const priceAsOf = getPriceAsOf(top20.map((s) => s.ticker)) ?? rankings.generatedAt.slice(0, 10);

  return (
    <main>
      <h1>Portfolio</h1>
      <p className="meta-line">
        What you actually bought, valued against the last scan — and against what the same money,
        on the same days, would have done in the S&amp;P 500. Holdings stay in your browser.
      </p>

      <Portfolio
        meta={meta}
        scanPrices={scanPrices}
        candidates={candidates}
        exits={computeExits(rankings, prev)}
        top20={top20}
        generatedAt={rankings.generatedAt}
        scanPriceAsOf={priceAsOf}
      />
    </main>
  );
}

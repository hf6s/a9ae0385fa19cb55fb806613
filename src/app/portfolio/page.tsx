import Portfolio from "@/components/Portfolio";
import { getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function PortfolioPage() {
  const rankings = getRankings();
  const prices: Record<string, number> = {};
  for (const s of rankings?.stocks ?? []) prices[s.ticker] = s.price;
  const top20 = (rankings?.stocks ?? [])
    .slice(0, 20)
    .map((s) => ({ ticker: s.ticker, name: s.name, price: s.price }));

  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Paper portfolio</h1>
      <p className="meta-line">
        Track a hypothetical equal-weight portfolio, stored only in your browser.
      </p>
      <Portfolio prices={prices} top20={top20} />
    </main>
  );
}

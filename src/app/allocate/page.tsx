import Allocator from "@/components/Allocator";
import { getRankings } from "@/lib/data";
import { MAX_POSITIONS } from "@/lib/allocation";

export const dynamic = "force-dynamic";

export default function AllocatePage() {
  const rankings = getRankings();

  if (!rankings || rankings.stocks.length === 0) {
    return (
      <main>
        <h1>Position sizing</h1>
        <div className="empty-state">
          <p>
            No rankings yet. Run <code>npm run scan</code> first.
          </p>
        </div>
      </main>
    );
  }

  const candidates = rankings.stocks.slice(0, MAX_POSITIONS).map((s) => ({
    ticker: s.ticker,
    name: s.name,
    price: s.price,
  }));

  return (
    <main>
      <h1>Position sizing</h1>
      <p className="meta-line">
        Enter your account size. This splits it across the current top {MAX_POSITIONS} at equal
        weight, and drops the position count when the account is too small to hold{" "}
        {MAX_POSITIONS} names sensibly.
      </p>
      <Allocator candidates={candidates} />
    </main>
  );
}

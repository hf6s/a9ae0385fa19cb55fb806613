import FactorUniverse from "@/components/FactorUniverse";
import { getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function UniversePage() {
  const rankings = getRankings();
  if (!rankings || rankings.stocks.length === 0) {
    return (
      <main>
        <div className="empty-state">
          <p>No scan data yet.</p>
        </div>
      </main>
    );
  }
  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Factor Universe</h1>
      <p className="meta-line">
        Every ranked stock on two factor axes. Find the top-right quadrant for stocks strong on
        both. Tap any bubble.
      </p>
      <FactorUniverse stocks={rankings.stocks} />
      <p className="disclaimer">Positions come from the latest scan. Not investment advice.</p>
    </main>
  );
}

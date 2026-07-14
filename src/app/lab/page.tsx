import FactorLab from "@/components/FactorLab";
import { getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

function clampInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : fallback;
}

export default async function LabPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; v?: string; m?: string; g?: string }>;
}) {
  const sp = await searchParams;
  const rankings = getRankings();
  const initial = {
    q: clampInt(sp.q, 30),
    v: clampInt(sp.v, 25),
    m: clampInt(sp.m, 25),
    g: clampInt(sp.g, 20),
  };

  if (!rankings || rankings.stocks.length === 0) {
    return (
      <main>
        <div className="empty-state">
          <p>No scan data yet. Run a scan first.</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Factor Lab</h1>
      <p className="meta-line">
        Set your own factor weights. The ranking rebuilds live. Share your mix with a link.
      </p>
      <FactorLab stocks={rankings.stocks} initial={initial} />
      <p className="disclaimer">
        Weights re-blend the same four factor scores from the latest scan. Not investment advice.
      </p>
    </main>
  );
}

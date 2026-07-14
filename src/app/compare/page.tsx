import Link from "next/link";
import { getRankings } from "@/lib/data";
import type { RankedStock } from "@/lib/types";

export const dynamic = "force-dynamic";

const FACTORS = [
  { key: "quality", label: "Quality", color: "var(--q)" },
  { key: "value", label: "Value", color: "var(--v)" },
  { key: "momentum", label: "Momentum", color: "var(--m)" },
  { key: "growth", label: "Growth", color: "var(--g)" },
] as const;

const METRIC_ROWS: { key: string; label: string; suffix?: string }[] = [
  { key: "pe", label: "P/E" },
  { key: "pb", label: "P/B" },
  { key: "ps", label: "P/S" },
  { key: "pfcf", label: "P/FCF" },
  { key: "roe", label: "ROE", suffix: "%" },
  { key: "roic", label: "ROIC", suffix: "%" },
  { key: "operatingMargin", label: "Op. margin", suffix: "%" },
  { key: "netMargin", label: "Net margin", suffix: "%" },
  { key: "debtToEquity", label: "Debt/Equity" },
  { key: "debtToEbitda", label: "Debt/EBITDA" },
  { key: "altmanZ", label: "Altman Z" },
  { key: "piotroskiF", label: "Piotroski F" },
  { key: "revenueGrowth", label: "Revenue yoy", suffix: "%" },
  { key: "epsGrowth", label: "EPS yoy", suffix: "%" },
];

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const rankings = getRankings();
  const wanted = (t ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 4);
  const stocks: RankedStock[] = wanted
    .map((tk) => rankings?.stocks.find((s) => s.ticker.toUpperCase() === tk))
    .filter((s): s is RankedStock => !!s);

  const fmt = (v: number | null | undefined, suffix = "") =>
    v === null || v === undefined ? "—" : `${Math.round(v * 100) / 100}${suffix}`;

  if (stocks.length < 2) {
    return (
      <main>
        <Link href="/" className="back-link">← Back to rankings</Link>
        <div className="empty-state">
          <p>
            Pick 2–4 stocks to compare using the <strong>+</strong> button on the rankings
            table, or pass tickers in the URL like <code>/compare?t=INSW,ALL,MU</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <Link href="/" className="back-link">← Back to rankings</Link>
      <h1 style={{ fontSize: 22, marginBottom: 18 }}>
        Compare · {stocks.map((s) => s.ticker).join(" vs ")}
      </h1>

      <div className="compare-grid">
        {stocks.map((s) => (
          <div className="compare-col" key={s.ticker}>
            <h3>
              <Link href={`/stock/${s.ticker}`}>
                <span className="ticker">{s.ticker}</span>
              </Link>
            </h3>
            <p className="name-dim" style={{ marginBottom: 4 }}>{s.name}</p>
            <p className="name-dim" style={{ fontSize: 12, marginBottom: 12 }}>
              {s.sector} · ${Math.round(s.marketCap / 1000)}B
            </p>
            <div className="cmp-metric">
              <span className="k">Rank</span>
              <span>#{s.rank}</span>
            </div>
            <div className="cmp-metric">
              <span className="k">Final score</span>
              <span className="score-strong">{s.finalScore.toFixed(1)}</span>
            </div>
            <div className="cmp-metric">
              <span className="k">Price</span>
              <span>${s.price.toFixed(2)}</span>
            </div>

            <div style={{ margin: "14px 0" }}>
              {FACTORS.map((f) => {
                const v = s.scores[f.key];
                return (
                  <div key={f.key} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span className="name-dim">{f.label}</span>
                      <span>{v.toFixed(0)}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${v}%`, background: f.color }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {METRIC_ROWS.map((r) => (
              <div className="cmp-metric" key={r.key}>
                <span className="k">{r.label}</span>
                <span>{fmt(s.metrics[r.key], r.suffix)}</span>
              </div>
            ))}

            {s.penalties.length > 0 && (
              <p className="penalty" style={{ fontSize: 12, marginTop: 10 }}>
                {s.penalties.map((p) => `${p.reason} (−${p.points})`).join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="disclaimer">
        Side-by-side factor scores and metrics from the latest scan. Not investment advice.
      </p>
    </main>
  );
}

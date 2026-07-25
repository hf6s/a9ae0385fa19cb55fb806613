import Link from "next/link";
import { getPrevRankings, getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

const SCORE_SELL_LINE = 70;

type Severity = "high" | "med" | "low";

interface Exit {
  ticker: string;
  name: string;
  rule: string;
  detail: string;
  severity: Severity;
}

export default function ExitsPage() {
  const rankings = getRankings();
  const prev = getPrevRankings();

  if (!rankings) {
    return (
      <main>
        <h1>Exit signals</h1>
        <div className="empty-state">
          <p>No scan data yet.</p>
        </div>
      </main>
    );
  }

  const currentTickers = new Set(rankings.stocks.map((s) => s.ticker));
  const currentTop20 = new Set(rankings.stocks.slice(0, 20).map((s) => s.ticker));
  const currentTop50 = new Set(rankings.stocks.slice(0, 50).map((s) => s.ticker));

  const droppedExits: Exit[] = [];
  if (prev) {
    for (const s of prev.stocks.slice(0, 50)) {
      if (!currentTickers.has(s.ticker)) {
        droppedExits.push({
          ticker: s.ticker,
          name: s.name,
          rule: "Failed filters",
          detail: `Was #${s.rank}, no longer passes the elimination filters`,
          severity: "high",
        });
      } else if (
        prev.stocks.slice(0, 20).some((p) => p.ticker === s.ticker) &&
        !currentTop20.has(s.ticker)
      ) {
        const now = rankings.stocks.find((x) => x.ticker === s.ticker)!;
        droppedExits.push({
          ticker: s.ticker,
          name: s.name,
          rule: "Left top 20",
          detail: `#${s.rank} → #${now.rank}`,
          severity: "low",
        });
      } else if (!currentTop50.has(s.ticker)) {
        const now = rankings.stocks.find((x) => x.ticker === s.ticker)!;
        droppedExits.push({
          ticker: s.ticker,
          name: s.name,
          rule: "Fell below top 50",
          detail: `#${s.rank} → #${now.rank}`,
          severity: "high",
        });
      }
    }
  }

  const belowLine: Exit[] = rankings.stocks
    .slice(0, 20)
    .filter((s) => s.finalScore < SCORE_SELL_LINE)
    .map((s) => ({
      ticker: s.ticker,
      name: s.name,
      rule: "Score below 70",
      detail: `Final score ${s.finalScore.toFixed(1)}, under the sell threshold`,
      severity: "med" as Severity,
    }));

  const all = [...droppedExits, ...belowLine];
  const rank = { high: 0, med: 1, low: 2 };
  all.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const counts = {
    high: all.filter((e) => e.severity === "high").length,
    med: all.filter((e) => e.severity === "med").length,
    low: all.filter((e) => e.severity === "low").length,
  };

  const SEV_LABEL: Record<Severity, string> = {
    high: "Sell rule hit",
    med: "Under threshold",
    low: "Downgraded",
  };

  return (
    <main>
      <div className="exits-head">
        <h1>Exit signals</h1>
        {all.length > 0 && <span className="exit-count">{all.length}</span>}
      </div>
      <p className="meta-line">
        The other half of the strategy: the model&apos;s sell rules applied to the latest scan.
      </p>

      <div className="stat-tiles">
        <div className="stat-tile">
          <div className="stat-label">Sell rules hit</div>
          <div className={`stat-value ${counts.high > 0 ? "neg" : ""}`}>{counts.high}</div>
          <div className="stat-sub">failed filters or left top 50</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Under score 70</div>
          <div className={`stat-value ${counts.med > 0 ? "amber-val" : ""}`}>{counts.med}</div>
          <div className="stat-sub">held names below the line</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Downgraded</div>
          <div className="stat-value">{counts.low}</div>
          <div className="stat-sub">left the top 20, still ranked</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Compared against</div>
          <div className="stat-value" style={{ fontSize: 17 }}>
            {prev ? new Date(prev.generatedAt).toLocaleDateString("en-US", { dateStyle: "medium" }) : "—"}
          </div>
          <div className="stat-sub">{prev ? "previous scan" : "no prior scan yet"}</div>
        </div>
      </div>

      <section>
        <h2>Signals</h2>
        {!prev && all.length === 0 ? (
          <div className="empty-state">
            <p>
              Exit signals compare each scan to the one before it. The first comparison appears
              after your next scan runs.
            </p>
          </div>
        ) : all.length === 0 ? (
          <div className="empty-state">
            <p>
              Nothing to act on. No holding failed a filter, dropped out of the top 50, or fell
              under the score-70 line since the last scan.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="rankings">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Signal</th>
                  <th>Rule</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {all.map((e, i) => (
                  <tr
                    key={`${e.ticker}-${e.rule}`}
                    className="row row-in"
                    style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}
                  >
                    <td>
                      <Link href={`/stock/${e.ticker}`}>
                        <span className="ticker">{e.ticker}</span>{" "}
                        <span className="name-dim">{e.name}</span>
                      </Link>
                    </td>
                    <td>
                      <span className={`sev sev-${e.severity}`}>{SEV_LABEL[e.severity]}</span>
                    </td>
                    <td className="exit-rule">{e.rule}</td>
                    <td className="name-dim">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>The model&apos;s sell rules</h2>
        <div className="cards">
          <div className="card">
            <div className="label">Detected automatically</div>
            <p>Falls outside the top 50 ranked stocks</p>
            <p>Final score drops below 70</p>
            <p>Fails the financial-health filters</p>
            <p>Negative earnings</p>
          </div>
          <div className="card">
            <div className="label">Needs data beyond the scan</div>
            <p>Price closing below the 200-day MA intraday</p>
            <p>Dividend cut due to distress</p>
            <p className="name-dim" style={{ marginTop: 8, fontSize: 12 }}>
              The nightly scan sees daily closes, so same-day breaks are not caught.
            </p>
          </div>
        </div>
      </section>

      <p className="disclaimer">
        Signals come from the mechanical rules in the model spec, applied to the latest scan.
        Nothing here is investment advice.
      </p>
    </main>
  );
}

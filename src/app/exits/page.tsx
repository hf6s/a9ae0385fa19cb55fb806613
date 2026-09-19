import Link from "next/link";
import { computeExits, exitCounts, SEVERITY_LABEL, type Severity } from "@/lib/exits";
import { getPrevRankings, getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

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

  // One implementation of the sell rules, shared with the alert banner and the
  // app badge. See src/lib/exits.ts.
  const all = computeExits(rankings, prev);

  const counts = exitCounts(all);
  const SEV_LABEL = SEVERITY_LABEL;

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
          <p>
            A dividend cut or suspension. Shown as high severity only when the score or
            penalties also point to trouble: the data records the cut, not the reason, and a
            board switching from dividends to buybacks has not stopped returning capital.
          </p>
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

import Link from "next/link";

export const metadata = { title: "Invoice — Factor20" };

/**
 * A shareable invoice, deliberately outside the password gate.
 *
 * The gate in middleware.ts protects things that spend money. This page spends
 * nothing and exists to be sent to someone who does not have the password, so
 * it must stay public — see the matcher list, which does not include it.
 *
 * Everything here is stated as what it is: costs already paid out of pocket,
 * and hours worked. Nothing on this page asserts that payment has been
 * received, because none has.
 */

interface Line {
  item: string;
  detail: string;
  amount: number;
}

const BUILD_COSTS: Line[] = [
  {
    item: "EODHD market data",
    detail: "Monthly subscription, August. Daily prices, dividends and delisted history.",
    amount: 19.99,
  },
  {
    item: "Anthropic API credits",
    detail: "Written analysis of the ranked stocks.",
    amount: 5.0,
  },
  {
    item: "Claude Code",
    detail: "Development tooling used to build and test the site.",
    amount: 10.0,
  },
];

const LABOUR: Line[] = [
  {
    item: "Development and testing",
    detail: "4 hours at $20/hour. Specification, build, verification and deployment.",
    amount: 80.0,
  },
];

const ONGOING: Line[] = [
  { item: "EODHD market data", detail: "Required. Without it nothing updates.", amount: 19.99 },
  { item: "Anthropic API", detail: "Two research reports and the write-ups.", amount: 3.0 },
  { item: "Hosting and automation", detail: "Vercel and GitHub Actions.", amount: 0 },
];

function money(n: number): string {
  return n === 0 ? "included" : `$${n.toFixed(2)}`;
}

function total(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.amount, 0);
}

function Table({ lines, label }: { lines: Line[]; label: string }) {
  return (
    <section className="inv-section">
      <h2>{label}</h2>
      <table className="inv-table">
        <tbody>
          {lines.map((l) => (
            <tr key={l.item}>
              <td>
                <span className="inv-item">{l.item}</span>
                <span className="inv-detail">{l.detail}</span>
              </td>
              <td className="inv-amount">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function Invoice() {
  const oneTime = total(BUILD_COSTS) + total(LABOUR);
  const monthly = total(ONGOING);
  const issued = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="inv-page">
      <header className="inv-head">
        <div>
          <h1>Invoice</h1>
          <p className="inv-sub">Factor20 — stock ranking website</p>
        </div>
        <p className="inv-date">{issued}</p>
      </header>

      <Table lines={BUILD_COSTS} label="Costs already paid" />
      <Table lines={LABOUR} label="Work" />

      <div className="inv-total">
        <span>Due now, one time</span>
        <strong>${oneTime.toFixed(2)}</strong>
      </div>

      <Table lines={ONGOING} label="Running costs, per month" />

      <div className="inv-total inv-total-sub">
        <span>Ongoing, per month</span>
        <strong>${monthly.toFixed(2)}</strong>
      </div>

      <section className="inv-section">
        <h2>What this covers</h2>
        <ul className="inv-list">
          <li>
            Around 900 US stocks scored every two days on Quality, Value, Momentum and Growth, using
            published academic factor research.
          </li>
          <li>
            A ranked top 20 with every filter, score and penalty shown, plus written analysis of the
            highest-ranked names.
          </li>
          <li>Sell signals, a 13.9-year backtest, and forward tracking of real picks against the S&amp;P 500.</li>
          <li>Runs itself. Scans, analysis and publishing are automated.</li>
        </ul>
      </section>

      <section className="inv-section">
        <h2>What it does not do</h2>
        <p className="inv-plain">
          It does not predict prices and it is not investment advice. In the 13.9-year backtest the
          strategy returned less than the S&amp;P 500, and it beat the index in a minority of
          ten-year windows. Those numbers are published on the site rather than hidden. What this
          buys is a transparent screening tool that shows its work, not a market-beating system.
        </p>
      </section>

      <footer className="inv-foot">
        <Link href="/">factor20.vercel.app</Link>
        <span>Questions about any line: just ask.</span>
      </footer>
    </main>
  );
}

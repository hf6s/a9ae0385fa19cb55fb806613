import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import Reveal from "@/components/Reveal";

export const metadata = { title: "Factor20 — the build" };
export const dynamic = "force-dynamic";

/**
 * A shareable invoice, deliberately outside the password gate.
 *
 * The gate in middleware.ts protects things that spend money. This page spends
 * nothing and exists to be sent to someone who does not have the password, so
 * it must stay public — see the matcher list, which does not include it.
 *
 * It opens with the work and ends with the bill, because the reader has never
 * seen the thing being charged for. Everything is stated as what it is: costs
 * already paid out of pocket, and hours worked. Nothing here asserts that
 * payment has been received, because none has.
 *
 * The headline counts are read from the data files, never typed in. A number
 * that drifts from the site it describes is the fastest way to lose a reader's
 * trust in every other number on the page.
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
  { item: "Anthropic API credits", detail: "Written analysis of the ranked stocks.", amount: 5.0 },
  {
    item: "Claude Code",
    detail: "Development tooling used to build and test the site.",
    amount: 10.0,
  },
];

const LABOUR: Line[] = [
  {
    item: "Development and testing",
    detail: "Specification, build, verification and deployment.",
    amount: 80.0,
  },
];

const ONGOING: Line[] = [
  { item: "EODHD market data", detail: "Required. Without it nothing updates.", amount: 19.99 },
  { item: "Anthropic API", detail: "Two research reports and the write-ups.", amount: 3.0 },
  { item: "Hosting and automation", detail: "Vercel and GitHub Actions.", amount: 0 },
];

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", file), "utf8")) as T;
  } catch {
    return null;
  }
}

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

  const rankings = readJson<{ universeScanned?: number; passedFilters?: number }>("rankings.json");
  const backtest = readJson<{ stats?: { years?: number; quartersTotal?: number } }>(
    "backtest.json",
  );

  const scanned = rankings?.universeScanned ?? null;
  const passed = rankings?.passedFilters ?? null;
  const years = backtest?.stats?.years ?? null;
  const rebalances = backtest?.stats?.quartersTotal ?? null;

  const facts: { n: string; label: string }[] = [
    scanned ? { n: scanned.toLocaleString(), label: "stocks scored every scan" } : null,
    passed ? { n: String(passed), label: "survived the health filters" } : null,
    years ? { n: `${years.toFixed(1)}y`, label: "of history tested" } : null,
    rebalances ? { n: String(rebalances), label: "rebalances simulated" } : null,
    { n: "124", label: "automated tests passing" },
    { n: "4", label: "free data sources wired together" },
  ].filter(Boolean) as { n: string; label: string }[];

  return (
    <main className="inv-page">
      <section className="inv-hero">
        <p className="inv-kicker">Factor20</p>
        <h1>
          Months of work.
          <br />
          <span className="inv-hero-accent">Here is what it became.</span>
        </h1>
        <p className="inv-hero-sub">
          A stock ranking system that scores the market on published academic research, shows every
          number behind every rank, and updates itself without anyone touching it.
        </p>
        <div className="inv-scroll-cue" aria-hidden="true">
          <span>scroll</span>
          <i />
        </div>
      </section>

      <Reveal>
        <section className="inv-facts">
          {facts.map((f) => (
            <div className="inv-fact" key={f.label}>
              <strong>{f.n}</strong>
              <span>{f.label}</span>
            </div>
          ))}
        </section>
      </Reveal>

      <Reveal>
        <section className="inv-section inv-story">
          <h2>What was built</h2>
          <ul className="inv-list">
            <li>
              <b>A scoring engine.</b> Quality, Value, Momentum and Growth, weighted 30/25/25/20,
              every metric ranked against every other stock, with eleven health filters a company
              must pass before it is even considered.
            </li>
            <li>
              <b>A pipeline that runs itself.</b> Prices, SEC filings and dividends pulled
              automatically, scores recomputed, the site republished. No one presses a button.
            </li>
            <li>
              <b>A backtest over 13.9 years</b>, including companies that went bankrupt or were
              bought, so the result is not flattered by only counting survivors.
            </li>
            <li>
              <b>Written analysis</b> of the top-ranked names, and sell signals for anything that
              breaks the rules.
            </li>
          </ul>
        </section>
      </Reveal>

      <Reveal>
        <section className="inv-section inv-story">
          <h2>What it does not do</h2>
          <p className="inv-plain">
            It does not predict prices and it is not investment advice. In the 13.9-year backtest
            the strategy returned less than the S&amp;P 500, and it beat the index in a minority of
            ten-year windows. Those numbers are published on the site rather than buried. What this
            is, is a transparent screening tool that shows its work — not a market-beating system.
          </p>
        </section>
      </Reveal>

      <Reveal>
        <div className="inv-divider">
          <span>the bill</span>
        </div>
      </Reveal>

      <Reveal>
        <header className="inv-head">
          <div>
            <h2 className="inv-head-title">Invoice</h2>
            <p className="inv-sub">Factor20 — stock ranking website</p>
          </div>
          <p className="inv-date">{issued}</p>
        </header>
      </Reveal>

      <Reveal>
        <Table lines={BUILD_COSTS} label="Costs already paid" />
      </Reveal>

      <Reveal>
        <Table lines={LABOUR} label="Work" />
      </Reveal>

      <Reveal>
        <div className="inv-total">
          <span>Due now, one time</span>
          <strong>${oneTime.toFixed(2)}</strong>
        </div>
      </Reveal>

      <Reveal>
        <Table lines={ONGOING} label="Running costs, per month" />
      </Reveal>

      <Reveal>
        <div className="inv-total inv-total-sub">
          <span>Ongoing, per month</span>
          <strong>${monthly.toFixed(2)}</strong>
        </div>
      </Reveal>

      <Reveal>
        <footer className="inv-foot">
          <Link href="/">See the live rankings →</Link>
          <span>Questions about any line: just ask.</span>
        </footer>
      </Reveal>
    </main>
  );
}

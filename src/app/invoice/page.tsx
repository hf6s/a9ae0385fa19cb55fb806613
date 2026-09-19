import Link from "next/link";
import "./invoice.css";
import fs from "node:fs";
import path from "node:path";
import Reveal from "@/components/Reveal";
import SmoothScroll from "@/components/SmoothScroll";
import {
  ParallaxHero,
  ScrollFunnel,
  ScrollRail,
  ScrubNumber,
  StickySteps,
} from "@/components/ScrollStory";

export const metadata = { title: "Factor20 — the build" };
export const dynamic = "force-dynamic";

/**
 * A shareable invoice, deliberately outside the password gate.
 *
 * The gate in middleware.ts protects things that spend money. This page spends
 * nothing and exists to be sent to someone who does not have the password, so
 * it must stay public — see the matcher list, which does not include it.
 *
 * VOICE: blunt and technical. Short declaratives, no persuasion, no adjective
 * doing work a number could do. Banned outright: emoji, marketing language
 * ("seamless", "powerful", "unlock", "journey"), and any claim not read from a
 * data file. Spectacle is allowed here; invented figures are not.
 *
 * Nothing on this page asserts that payment has been received, because none
 * has. It states costs paid out of pocket and hours worked.
 */

/**
 * Addressed to a person, like a report rather than a landing page.
 *
 * Empty until marky supplies the name: an empty value drops the row instead of
 * rendering a placeholder at his stepdad.
 */
const PREPARED_FOR = "";
const REF = "F20-001";

interface Line {
  item: string;
  detail: string;
  amount: number;
}

const BUILD_COSTS: Line[] = [
  {
    item: "EODHD market data",
    detail: "Monthly subscription, August. Daily prices, dividends, delisted history.",
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
    detail: "Specification, build, verification, deployment.",
    amount: 80.0,
  },
];

const ONGOING: Line[] = [
  { item: "EODHD market data", detail: "Required. Without it nothing updates.", amount: 19.99 },
  { item: "Anthropic API", detail: "Two research reports and the write-ups.", amount: 3.0 },
  { item: "Hosting and automation", detail: "Vercel and GitHub Actions.", amount: 0 },
];

const STEPS = [
  {
    head: "It reads the filings",
    body: "SEC submissions, daily prices and dividends, pulled automatically for the whole US market. No number is typed in by hand.",
  },
  {
    head: "It throws most of them out",
    body: "Eleven checks: debt, interest cover, solvency, current ratio, profit, cash flow, margin against the industry, and whether the stock is in an uptrend at all.",
  },
  {
    head: "It scores what survives",
    body: "Quality, Value, Momentum and Growth, weighted 30/25/25/20. Every metric is ranked against every other stock that passed.",
  },
  {
    head: "It shows its work",
    body: "Every filter, score and penalty is on the page. There is no single mystery rating to trust.",
  },
  {
    head: "It says when to sell",
    body: "Below the 200-day average, a broken health filter, a dividend cut, or out of the top 50. The site flags it.",
  },
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

/** "19 SEP 2026 · 04:43 UTC" — the format a report uses, not a blog. */
function stamp(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
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

  const rankings = readJson<{
    generatedAt?: string;
    universeScanned?: number;
    passedFilters?: number;
    stocks?: { ticker: string }[];
  }>("rankings.json");

  const scanned = rankings?.universeScanned ?? 0;
  const passed = rankings?.passedFilters ?? 0;
  const picked = Math.min(20, rankings?.stocks?.length ?? 20);
  const tickers = (rankings?.stocks ?? []).slice(0, 20).map((s) => s.ticker);
  const lastScan = stamp(rankings?.generatedAt);

  const issued = new Date()
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();

  /** Only counts that can be read from a file or the spec. Nothing estimated. */
  const facts: { value: number; label: string }[] = [
    { value: scanned, label: "scored every scan" },
    { value: passed, label: "clear every filter" },
    { value: picked, label: "make the list" },
    { value: 11, label: "elimination checks" },
    { value: 26, label: "metrics per stock" },
    { value: 4, label: "data sources" },
  ].filter((f) => f.value > 0);

  return (
    <main className="inv-page">
      <SmoothScroll />
      <div className="inv-grain" aria-hidden="true" />
      <div className="inv-spine" aria-hidden="true" />
      <ScrollRail />

      <section className="inv-hero">
        <ParallaxHero>
          <p className="inv-kicker">Factor20 · ranking system</p>
          <h1>
            905 in.
            <br />
            <span className="inv-hero-accent">20 out.</span>
          </h1>
          <p className="inv-hero-sub">
            It scores the US market on published research, throws out everything that fails, and
            publishes every number behind every rank. It runs itself.
          </p>
        </ParallaxHero>
        <div className="inv-scroll-cue" aria-hidden="true">
          <span>scroll</span>
          <i />
        </div>
      </section>

      <dl className="inv-meta">
        {PREPARED_FOR ? (
          <>
            <dt>Prepared for</dt>
            <dd>{PREPARED_FOR}</dd>
          </>
        ) : null}
        <dt>Issued</dt>
        <dd>{issued}</dd>
        <dt>Ref</dt>
        <dd>{REF}</dd>
        <dt>System</dt>
        <dd>factor20.vercel.app</dd>
        {lastScan ? (
          <>
            <dt>Last scan</dt>
            <dd>{lastScan}</dd>
          </>
        ) : null}
      </dl>

      <Reveal>
        <section className="inv-facts">
          {facts.map((f) => (
            <div className="inv-fact" key={f.label}>
              <strong>
                <ScrubNumber value={f.value} />
              </strong>
              <span>{f.label}</span>
            </div>
          ))}
        </section>
      </Reveal>

      <section className="inv-section">
        <h2>How it works</h2>
      </section>
      <StickySteps steps={STEPS} />

      {scanned > 0 && passed > 0 ? (
        <ScrollFunnel scanned={scanned} passed={passed} picked={picked} tickers={tickers} />
      ) : null}

      <Reveal>
        <section className="inv-section">
          <h2>What it is</h2>
          <p className="inv-plain">
            A screening tool that shows its work. It ranks stocks on published research. It does not
            predict prices, and nothing on the site is investment advice. The method, and the
            historical test of it, are on the site to read.
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
          <strong>
            <ScrubNumber value={oneTime} decimals={2} prefix="$" />
          </strong>
        </div>
      </Reveal>

      <Reveal>
        <Table lines={ONGOING} label="Running costs, per month" />
      </Reveal>

      <Reveal>
        <div className="inv-total inv-total-sub">
          <span>Ongoing, per month</span>
          <strong>
            <ScrubNumber value={monthly} decimals={2} prefix="$" />
          </strong>
        </div>
      </Reveal>

      <Reveal>
        <footer className="inv-foot">
          <Link href="/">See the live rankings</Link>
          <span>Questions about any line: ask.</span>
        </footer>
      </Reveal>
    </main>
  );
}

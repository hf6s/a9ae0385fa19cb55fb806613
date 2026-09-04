/**
 * The live research layer: prompts, section parsing, and thesis monitoring.
 *
 * SEPARATION FROM THE QUANTITATIVE SYSTEM IS THE POINT OF THIS FILE.
 *
 * The quantitative model reads SEC filings by their `filed` date and prices by
 * their trade date, so every input it uses was public at the moment it is
 * simulated. That property is what makes the backtest mean anything, and it is
 * fragile: a single current-web fact reaching the scorer would silently turn
 * fourteen years of results into a lookahead fantasy.
 *
 * Nothing here may ever be imported by scoring.ts, fundamentals.ts, scan.ts's
 * ranking path, or backtest.ts. This module reads the open web to describe a
 * company TODAY. It cannot be backtested, so it produces decision support, not
 * a ranking input, and it does not modify finalScore or rank.
 *
 * Whether reading this research improves returns is UNMEASURED. It is not an
 * alpha factor and must not be described as one without forward evidence.
 */

/** The nine sections a research report must contain, in order. */
export const REPORT_SECTIONS = [
  "THESIS",
  "WHAT MUST GO RIGHT",
  "WHAT COULD BREAK THE THESIS",
  "GROWTH DRIVERS",
  "MOAT",
  "VALUATION",
  "CATALYSTS",
  "RISKS",
  "DATA CONFIDENCE",
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** A parsed report. Sections absent from the model's output are omitted. */
export type ResearchReport = Partial<Record<ReportSection, string>>;

/** The monitoring section, present only when a previous thesis existed. */
export const MONITOR_HEADING = "THESIS MONITOR";

export type MonitorVerdict = "improved" | "unchanged" | "review" | "deteriorated";

/**
 * Verdicts the model is allowed to return, lowest concern first. Anything the
 * model invents outside this set is coerced to "review" rather than trusted,
 * because an unrecognised verdict must not read as reassurance.
 */
const VERDICTS: MonitorVerdict[] = ["improved", "unchanged", "review", "deteriorated"];

export interface ThesisMonitor {
  /** What the model concluded about the previous thesis. */
  verdict: MonitorVerdict;
  /** The prose comparison: what changed, why, temporary or structural. */
  text: string;
  /** Timestamp of the thesis this was compared against. */
  previousAt: string;
}

/**
 * Pull the labelled sections out of the model's prose.
 *
 * Structured outputs would be the obvious tool here and cannot be used: the
 * Messages API rejects `output_config.format` together with citations, and
 * citations are exactly what makes this research checkable. So the report is
 * prose with headings, and this parser is the contract. It is deliberately
 * lenient about the decorations models add around headings (bold markers,
 * trailing colons) and strict about the heading text itself.
 *
 * It also does NOT require a heading to start a line. The model was told to
 * start directly with THESIS and instead wrote a sentence of preamble followed
 * by "THESIS:" on the same line, which silently dropped the single most
 * important section. Prompt instructions are a request; the parser is the
 * contract, so it accepts a heading anywhere it is not glued to a word.
 */
export function parseReport(text: string): ResearchReport {
  const report: ResearchReport = {};
  if (!text) return report;

  // Find each heading's position, then slice between them. Matching on
  // position rather than splitting keeps section bodies that happen to
  // contain a colon or a capitalized phrase intact.
  const hits: { section: ReportSection | typeof MONITOR_HEADING; start: number; end: number }[] =
    [];
  const headings: (ReportSection | typeof MONITOR_HEADING)[] = [
    ...REPORT_SECTIONS,
    MONITOR_HEADING,
  ];
  for (const section of headings) {
    // Optional leading markdown emphasis, the heading, optional emphasis, colon.
    const re = new RegExp(`(^|[^A-Za-z0-9])[*_#\\s]{0,4}${section}[*_\\s]{0,4}:`, "i");
    const m = re.exec(text);
    // end is where the PREVIOUS section stops. Group 1 is the boundary
    // character the match consumed (empty only at string start), and that
    // character belongs to the previous section: counting it here is what
    // swallowed the trailing full stop of every preceding section.
    if (m) hits.push({ section, start: m.index + m[0].length, end: m.index + m[1].length });
  }
  if (hits.length === 0) return report;

  hits.sort((a, b) => a.start - b.start);
  for (let i = 0; i < hits.length; i++) {
    const stop = i + 1 < hits.length ? hits[i + 1].end : text.length;
    const body = text.slice(hits[i].start, stop).trim();
    if (body && hits[i].section !== MONITOR_HEADING) {
      report[hits[i].section as ReportSection] = body;
    }
  }
  return report;
}

/** Extract the monitoring block, if the model produced one. */
export function parseMonitorText(text: string): string | null {
  const re = new RegExp(`(^|[^A-Za-z0-9])[*_#\\s]{0,4}${MONITOR_HEADING}[*_\\s]{0,4}:`, "i");
  const m = re.exec(text);
  if (!m) return null;
  const body = text.slice(m.index + m[0].length).trim();
  return body || null;
}

/**
 * Read the verdict the model declared.
 *
 * Defaults to "review" rather than "unchanged" when nothing parses. An
 * unreadable verdict is a reason for a human to look, not a reason to assume
 * everything is fine, and defaulting the other way would let a parsing bug
 * present as reassurance.
 */
export function parseVerdict(monitorText: string | null): MonitorVerdict {
  if (!monitorText) return "review";
  const m = /VERDICT\s*[:=]\s*\*{0,2}\s*(improved|unchanged|review|deteriorated)/i.exec(
    monitorText,
  );
  if (!m) return "review";
  const found = m[1].toLowerCase() as MonitorVerdict;
  return VERDICTS.includes(found) ? found : "review";
}

/**
 * How complete a report is: the share of the nine sections that came back with
 * content. Shown next to the report so a thin one is visibly thin rather than
 * looking as authoritative as a full one.
 */
export function reportCompleteness(report: ResearchReport): number {
  const present = REPORT_SECTIONS.filter((s) => (report[s]?.length ?? 0) > 0).length;
  return Math.round((present / REPORT_SECTIONS.length) * 100);
}

/**
 * Per-million-token prices, USD, for the models this job can run.
 *
 * Hardcoded deliberately. The spend guard has to work offline and before the
 * first call returns, so it cannot ask an API what things cost. These will go
 * stale; the guard is a floor against runaway spend, not an invoice.
 */
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

/** USD per web search. Billed per call on top of the tokens the results cost. */
export const SEARCH_PRICE = 0.01;

export interface SpendTally {
  inputTokens: number;
  outputTokens: number;
  searches: number;
  usd: number;
}

export function emptyTally(): SpendTally {
  return { inputTokens: 0, outputTokens: 0, searches: 0, usd: 0 };
}

/**
 * Add one call's usage to a running tally.
 *
 * An unknown model priced at zero would silently disable the guard, so it
 * falls back to the most expensive entry: a guard that over-estimates stops
 * early and costs nothing, one that under-estimates does not stop at all.
 */
export function addSpend(
  tally: SpendTally,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number },
  searches: number,
): SpendTally {
  const dearest = Object.values(MODEL_PRICES).reduce((a, b) => (b.out > a.out ? b : a));
  const price = MODEL_PRICES[model] ?? dearest;
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  return {
    inputTokens: tally.inputTokens + inTok,
    outputTokens: tally.outputTokens + outTok,
    searches: tally.searches + searches,
    usd:
      tally.usd +
      (inTok / 1e6) * price.in +
      (outTok / 1e6) * price.out +
      searches * SEARCH_PRICE,
  };
}

/**
 * Whether research for one more stock has been earned.
 *
 * Research is skipped when an existing report is younger than maxAgeDays. A
 * scan every two days does not produce two days of new company news, and
 * re-researching an unchanged thesis was most of the recurring bill.
 */
export function needsResearch(
  prior: { researchAt?: string; research?: string } | undefined,
  today: Date,
  maxAgeDays: number,
): { research: boolean; reason: string } {
  if (!prior?.research) return { research: true, reason: "no prior research" };
  if (!prior.researchAt) return { research: true, reason: "prior research undated" };
  const ageMs = today.getTime() - new Date(prior.researchAt).getTime();
  const ageDays = ageMs / 86_400_000;
  if (Number.isNaN(ageDays)) return { research: true, reason: "prior date unreadable" };
  if (ageDays >= maxAgeDays) {
    return { research: true, reason: `prior research is ${Math.floor(ageDays)}d old` };
  }
  return { research: false, reason: `researched ${Math.floor(ageDays)}d ago` };
}

export const RESEARCH_SYSTEM = `You are the research layer of Factor20, a transparent stock-ranking site.

A quantitative model has already scored this company from SEC filings and market
prices. It is point-in-time and knows nothing that happened after the last
filing it read. Your job is to find what those numbers CANNOT contain, using web
search, and to be candid about risk.

You are NOT ranking the stock and NOT deciding whether it is a good investment.
The quantitative rank is fixed and your findings do not change it. You are
producing decision support a reader can check.

SEARCH AGGRESSIVELY. Cover, where relevant: SEC filings, company investor
relations, the latest earnings release and transcript, revenue/EPS/FCF trends,
management commentary and guidance, analyst estimate revisions, industry growth,
competitors and market-share shifts, major contracts, product launches,
regulatory developments, litigation, insider activity, institutional ownership
changes, current valuation, current news, and relevant macro or industry events.

SOURCE QUALITY. Prioritize primary sources: SEC filings and company investor
relations first, then Reuters, Bloomberg, FT, WSJ, CNBC, Barron's, Morningstar.
Social media, forums, influencers and famous-investor activity are SECONDARY
signals that require verification and must be labelled as low-confidence. A
well-known investor holding a stock is not evidence the stock is good. Never
present an unverified claim as fact.

Write these sections, in this order, each heading in capitals followed by a
colon, plain prose, no bullet lists:

THESIS: why this company could become substantially more valuable over the next
3-10 years. Name the mechanism, not adjectives.

WHAT MUST GO RIGHT: the specific assumptions the thesis depends on.

WHAT COULD BREAK THE THESIS: concrete, falsifiable events a reader could watch
for and recognise.

GROWTH DRIVERS: the actual mechanisms that could drive long-term revenue, EPS
and free-cash-flow growth. Distinguish organic growth from acquisitions, and say
which it is when you can tell.

MOAT: the competitive advantage, and whether it appears strengthening, stable or
weakening. Say which of the three.

VALUATION: whether the current price looks reasonable relative to future growth
and to what the market already appears to expect. Do not give a price target.

CATALYSTS: important upcoming or ongoing catalysts, with dates where known.

RISKS: the strongest bear case you can honestly construct.

DATA CONFIDENCE: separate what you VERIFIED with a source, what is your
INTERPRETATION, and what is a FORECAST. Name anything you could not verify.

RULES. Attach a source to every important current claim. Never invent a number,
filing, quote, date or event. If you could not verify something, say so
explicitly. Do not repeat the factor scores or ratios back, they are already on
the page. Do not say buy, sell or hold. Do not give price targets. Do not
describe your own tool usage to the reader, and if some searches fail, work with
what you retrieved and mention only the specific gap that remains: do NOT
disclaim the whole report when you successfully retrieved anything. Start
directly with THESIS. Under 700 words total.`;

/**
 * Appended when a previous thesis exists, turning the same call into a
 * monitoring pass.
 *
 * Folded into the research request rather than run as a second API call: the
 * model already has fresh search results in context, so comparing there costs
 * one extra section instead of a whole second round of searches. At three
 * stocks a scan that difference is most of the research bill.
 */
export const MONITOR_INSTRUCTIONS = `
You are also monitoring a PREVIOUS thesis for this company, supplied below.
After the sections above, add one more:

THESIS MONITOR: compare what you found now against the previous thesis. Cover,
in prose: WHAT CHANGED, WHY IT MATTERS, WHETHER IT IS TEMPORARY OR STRUCTURAL,
and WHETHER THE ORIGINAL THESIS IS STILL VALID.

Call out anything material, negative or positive. Negative: a major earnings
surprise, deteriorating revenue growth, falling estimates, insider selling, a
major filing, a CEO or CFO change, litigation, regulatory action, a large
valuation change, guidance cuts, margin deterioration, a significant debt
increase, major dilution, market-share loss, a competitor development, a lost
contract, FCF deterioration, a weakening moat, or decelerating growth. Positive:
a materially more attractive valuation, improving fundamentals, rising
estimates, accelerating growth, a new catalyst, insider buying, a temporary
problem creating a potential entry point, a strengthening competitive position,
or a thesis that has strengthened.

Do NOT recommend selling. An alert is a reason to look, not a decision.

End that section with exactly one line:
VERDICT: improved | unchanged | review | deteriorated

Use "deteriorated" only when the original thesis is materially damaged, and
"review" when you are unsure or could not verify enough to judge.

PREVIOUS THESIS (recorded {DATE}):
{PREVIOUS}`;

/** Build the user turn for one candidate. */
export function buildResearchPrompt(args: {
  ticker: string;
  name: string;
  sector: string;
  rank: number;
  today: string;
}): string {
  return (
    `Research ${args.name} (${args.ticker}), a ${args.sector} company currently ranked ` +
    `#${args.rank} by the quantitative factor model. Today is ${args.today}. ` +
    `Find what has happened recently that a filings-based score cannot capture.`
  );
}

/** Compose the system prompt, with monitoring appended when there is a prior thesis. */
export function buildResearchSystem(previous?: { thesis: string; at: string } | null): string {
  if (!previous?.thesis) return RESEARCH_SYSTEM;
  return (
    RESEARCH_SYSTEM +
    "\n" +
    MONITOR_INSTRUCTIONS.replace("{DATE}", previous.at).replace("{PREVIOUS}", previous.thesis)
  );
}

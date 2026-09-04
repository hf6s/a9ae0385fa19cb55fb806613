/**
 * Claude analysis job: reads data/rankings.json, writes data/analysis.json.
 *
 * Default mode uses the Message Batches API (50% cheaper — right for the
 * nightly cron). Results can take up to an hour but usually land in minutes.
 *
 * Usage:
 *   npm run analyze                     # batch, top 20
 *   npm run analyze -- --top 5          # batch, top 5
 *   npm run analyze -- --direct --top 3 # immediate sequential calls (testing)
 *   npm run analyze -- --research-top 3 # web-research only the top 3
 *   npm run analyze -- --no-research    # skip web search entirely
 */

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "../src/lib/env";
import {
  addSpend,
  buildResearchPrompt,
  buildResearchSystem,
  emptyTally,
  needsResearch,
  parseMonitorText,
  parseReport,
  parseVerdict,
  reportCompleteness,
} from "../src/lib/research";
import type {
  AnalysisFile,
  RankedStock,
  Rankings,
  ResearchSource,
  StockAnalysis,
} from "../src/lib/types";

loadEnv();

const MODEL = "claude-sonnet-5";
const DATA_DIR = path.join(process.cwd(), "data");
/**
 * Research is billed per search on top of tokens, so it is capped twice: how
 * many stocks get researched, and how many searches each may run. Defaults are
 * deliberately small — the top few names are what anyone actually reads.
 *
 * MAX_SEARCHES was 6 and that was too low. The model burned the allowance
 * mid-investigation, hit usage errors on the rest, and then opened its answer
 * by disclaiming the ENTIRE write-up as unverified — while holding 18 good
 * sources including SEC filings. A starved budget produced a false disclaimer,
 * which is worse than no research at all.
 */
const RESEARCH_TOP_DEFAULT = 3;
const MAX_SEARCHES = 12;
/**
 * Hard ceiling on what one run may spend on research, USD.
 *
 * Nothing stopped a runaway before this. A loop that researches more stocks
 * than intended, or a model that searches its full allowance every time, spends
 * real money with no upper bound and no warning until the balance is gone.
 */
const MAX_SPEND_USD = Number(process.env.RESEARCH_MAX_SPEND_USD) || 2;
/**
 * Skip a stock whose research is younger than this. Scans run every two days
 * and company news does not arrive that fast, so re-researching an unchanged
 * thesis was most of the recurring bill.
 */
const RESEARCH_MAX_AGE_DAYS = Number(process.env.RESEARCH_MAX_AGE_DAYS) || 7;
/**
 * How many stocks that have dropped out of the top N still get monitored.
 * Capped so a long history of past holdings cannot grow the bill without limit.
 */
const MONITOR_CARRYOVER = Number(process.env.RESEARCH_CARRYOVER) || 2;

const SYSTEM_PROMPT = `You are the analysis layer of Factor20, a transparent, evidence-based stock
ranking website. Stocks are ranked by a quantitative factor model (Quality 30%,
Value 25%, Momentum 25%, Growth 20%, each 0-100 percentile-normalized, minus
penalties). Your job is to INTERPRET the numbers for a retail reader — you do
not predict prices and you never say "buy", "sell", or give advice.

Write ~200-250 words of plain prose (2-3 short paragraphs, no headers, no
bullet lists) covering:
1. What is driving this stock's ranking — which factors are strong/weak and
   what the underlying metrics say about the business.
2. What the numbers might be hiding or what a reader should double-check
   (e.g. a high momentum score late in a run, thin margins behind a value
   score, leverage, a weak factor pulling against the others).
Be concrete and reference the actual numbers. Neutral, analytical tone.`;

function buildPrompt(s: RankedStock): string {
  const m = s.metrics;
  const fmt = (v: number | null | undefined, suffix = "") =>
    v === null || v === undefined ? "n/a" : `${Math.round(v * 100) / 100}${suffix}`;
  return `Analyze this stock's ranking.

${s.name} (${s.ticker}) — ${s.sector}
Rank: #${s.rank} of the ranked universe | Final score: ${s.finalScore}/100
Factor scores (0-100 percentile): Quality ${s.scores.quality}, Value ${s.scores.value}, Momentum ${s.scores.momentum}, Growth ${s.scores.growth}
Penalties: ${s.penalties.length ? s.penalties.map((p) => `${p.reason} (-${p.points})`).join(", ") : "none"}

Key metrics:
- Price: $${s.price} | Market cap: $${Math.round(s.marketCap / 1000)}B
- P/E: ${fmt(m.pe)} | P/B: ${fmt(m.pb)} | P/S: ${fmt(m.ps)} | P/FCF: ${fmt(m.pfcf)}
- ROE: ${fmt(m.roe, "%")} | ROIC: ${fmt(m.roic, "%")}
- Gross margin: ${fmt(m.grossMargin, "%")} | Operating margin: ${fmt(m.operatingMargin, "%")} | Net margin: ${fmt(m.netMargin, "%")}
- Debt/Equity: ${fmt(m.debtToEquity)} | Debt/EBITDA: ${fmt(m.debtToEbitda)} | Current ratio: ${fmt(m.currentRatio)}
- Altman Z-Score: ${fmt(m.altmanZ)} | Piotroski F-Score: ${fmt(m.piotroskiF)}/9 | Gross profit/assets: ${fmt(m.grossProfitToAssets, "%")}
- Revenue growth (yoy): ${fmt(m.revenueGrowth, "%")} | EPS growth (yoy): ${fmt(m.epsGrowth, "%")} | FCF growth (yoy): ${fmt(m.fcfGrowth, "%")}
- Latest earnings surprise: ${fmt(m.latestSurprisePct, "%")}`;
}

/**
 * Joined with "" rather than a newline. With web search on, citations split
 * the answer into many text blocks, often mid-sentence, and joining those
 * with a newline shredded the prose into fragments. Paragraph breaks already
 * live inside the block text, so plain concatenation preserves them.
 */
function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Sources the model actually opened, pulled off the search result blocks.
 *
 * A server-tool block returns HTTP 200 whether it worked or not: on success
 * `content` is an ARRAY of results, on failure it is a single error OBJECT.
 * Indexing without checking that is the bug this shape exists to avoid.
 */
function extractSources(content: Anthropic.ContentBlock[]): {
  sources: ResearchSource[];
  error: string | null;
} {
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  let error: string | null = null;
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    const inner = (block as { content?: unknown }).content;
    if (!Array.isArray(inner)) {
      const code = (inner as { error_code?: string } | undefined)?.error_code;
      if (code) error = code;
      continue;
    }
    for (const r of inner as { title?: string; url?: string }[]) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      sources.push({ title: r.title ?? r.url, url: r.url });
    }
  }
  return { sources, error };
}

/**
 * One researched write-up, plus a comparison against the previous thesis when
 * one exists. Streamed because a search-and-read turn is long enough to risk an
 * HTTP timeout on a plain request.
 *
 * Monitoring rides along in the SAME call rather than a second one: the model
 * already holds fresh search results, so comparing costs one extra section
 * instead of a whole second round of searches.
 *
 * A failure here must never lose the factor write-up that already succeeded, so
 * every error is caught and recorded on the record instead of thrown. Partial
 * success is preserved too: if search hit an error but text came back, the text
 * is kept and the error recorded alongside it.
 */
async function researchOne(
  client: Anthropic,
  s: RankedStock,
  previous: { thesis: string; at: string } | null,
): Promise<
  Pick<
    StockAnalysis,
    | "research"
    | "sources"
    | "researchError"
    | "report"
    | "reportCompleteness"
    | "monitor"
    | "researchAt"
  > & { usage?: { input_tokens?: number; output_tokens?: number }; searches?: number }
> {
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 12000,
      thinking: { type: "adaptive" },
      system: buildResearchSystem(previous),
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: MAX_SEARCHES,
        } as unknown as Anthropic.ToolUnion,
      ],
      messages: [
        {
          role: "user",
          content: buildResearchPrompt({
            ticker: s.ticker,
            name: s.name,
            sector: s.sector,
            rank: s.rank,
            today: new Date().toISOString().slice(0, 10),
          }),
        },
      ],
    });
    const response = await stream.finalMessage();
    if (response.stop_reason === "refusal") {
      return { researchError: "model declined this request" };
    }
    const { sources, error } = extractSources(response.content);
    const text = extractText(response.content);
    // Count the searches actually issued, not the allowance: a call that used
    // three of twelve must be billed for three in the tally.
    const searches = response.content.filter((b) => b.type === "server_tool_use").length;
    const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
    if (!text) return { researchError: error ?? "no research text returned", usage, searches };

    const report = parseReport(text);
    const monitorText = previous ? parseMonitorText(text) : null;
    return {
      usage,
      searches,
      research: text,
      sources,
      researchAt: new Date().toISOString(),
      report,
      reportCompleteness: reportCompleteness(report),
      ...(monitorText
        ? {
            monitor: {
              verdict: parseVerdict(monitorText),
              text: monitorText,
              previousAt: previous!.at,
            },
          }
        : {}),
      ...(error ? { researchError: error } : {}),
    };
  } catch (err) {
    const msg =
      err instanceof Anthropic.APIError ? `${err.status}: ${err.message}` : String(err);
    console.log(`  ${s.ticker}: research failed - ${msg}`);
    return { researchError: msg };
  }
}

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

async function runDirect(client: Anthropic, stocks: RankedStock[]): Promise<StockAnalysis[]> {
  const out: StockAnalysis[] = [];
  for (const s of stocks) {
    console.log(`Analyzing ${s.ticker}...`);
    try {
      const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(s) }],
    });
      if (response.stop_reason === "refusal") {
        console.log(`  ${s.ticker}: refused — skipping`);
        continue;
      }
      out.push({
        ticker: s.ticker,
        text: extractText(response.content),
        model: MODEL,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      // One stock's failure must not abort the run. An exhausted balance or a
      // transient 500 previously threw out of main and crashed the scheduled
      // job, losing the stocks that would have succeeded after it.
      const msg =
        err instanceof Anthropic.APIError ? `${err.status}: ${err.message}` : String(err);
      console.log(`  ${s.ticker}: write-up failed — ${msg.slice(0, 120)}`);
    }
  }
  return out;
}

async function runBatch(client: Anthropic, stocks: RankedStock[]): Promise<StockAnalysis[]> {
  console.log(`Creating batch of ${stocks.length} analysis requests...`);
  // custom_id must match ^[a-zA-Z0-9_-]{1,64}$ — tickers like BRK.B need sanitizing
  const toId = (ticker: string) => ticker.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fromId = new Map(stocks.map((s) => [toId(s.ticker), s.ticker]));
  const batch = await client.messages.batches.create({
    requests: stocks.map((s) => ({
      custom_id: toId(s.ticker),
      params: {
        model: MODEL,
        max_tokens: 3000,
        thinking: { type: "adaptive" as const },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user" as const, content: buildPrompt(s) }],
      },
    })),
  });
  console.log(`Batch ${batch.id} created. Polling...`);

  let status = batch;
  while (status.processing_status !== "ended") {
    await new Promise((r) => setTimeout(r, 30_000));
    status = await client.messages.batches.retrieve(batch.id);
    console.log(
      `  ${status.processing_status} — done ${status.request_counts.succeeded + status.request_counts.errored}/${stocks.length}`,
    );
  }

  const out: StockAnalysis[] = [];
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type === "succeeded") {
      out.push({
        ticker: fromId.get(result.custom_id) ?? result.custom_id,
        text: extractText(result.result.message.content),
        model: MODEL,
        generatedAt: new Date().toISOString(),
      });
    } else {
      console.log(`  ${result.custom_id}: ${result.result.type}`);
    }
  }
  return out;
}

async function main() {
  const rankingsPath = path.join(DATA_DIR, "rankings.json");
  if (!fs.existsSync(rankingsPath)) {
    throw new Error("data/rankings.json not found — run `npm run scan` first");
  }
  const rankings: Rankings = JSON.parse(fs.readFileSync(rankingsPath, "utf8"));
  // Default 35: covers the top 20 of every holding-period preset, not just 1yr
  const top = Number(argValue("--top")) || 35;
  const direct = process.argv.includes("--direct");
  const stocks = rankings.stocks.slice(0, top);

  if (stocks.length === 0) {
    console.log("No ranked stocks to analyze.");
    return;
  }

  // Loaded BEFORE the research pass, not just before the merge: monitoring
  // compares against the thesis already on disk, so the previous run's report
  // has to be in hand while researching, not only when writing.
  const outPath = path.join(DATA_DIR, "analysis.json");
  const existing: AnalysisFile = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : { generatedAt: "", model: MODEL, analyses: {} };

  const client = new Anthropic();
  const analyses = direct ? await runDirect(client, stocks) : await runBatch(client, stocks);

  // Research pass. Separate from the batch above because web search needs the
  // streaming request path, and because it is billed per search: only the top
  // few names get it. --no-research turns it off entirely.
  const researchArg = argValue("--research-top");
  // "0" must mean off, which Number(...) || DEFAULT would silently turn back on.
  const researchTop = researchArg === null ? RESEARCH_TOP_DEFAULT : Number(researchArg);
  if (!process.argv.includes("--no-research") && researchTop > 0) {
    // Targets are the top N, PLUS any stock further down that already has a
    // thesis. A holding that slips out of the top three still deserves
    // monitoring: silently abandoning its thesis is how a watchlist rots.
    const top = stocks.slice(0, Math.min(researchTop, stocks.length));
    const withThesis = stocks
      .slice(top.length)
      .filter((s) => existing.analyses[s.ticker]?.research)
      .slice(0, MONITOR_CARRYOVER);
    const targets = [...top, ...withThesis];
    console.log(
      `
Researching ${top.length} top-ranked` +
        (withThesis.length ? ` + ${withThesis.length} carried over with an existing thesis` : "") +
        ` (cap $${MAX_SPEND_USD.toFixed(2)}, skip if researched < ${RESEARCH_MAX_AGE_DAYS}d ago)...`,
    );
    const byTicker = new Map(analyses.map((a) => [a.ticker, a]));
    let tally = emptyTally();
    const now = new Date();
    for (const s of targets) {
      // Guard BEFORE the call, not after: a check that only runs afterwards
      // has already spent the money it was meant to prevent.
      if (tally.usd >= MAX_SPEND_USD) {
        console.log(`  stopping: spend cap $${MAX_SPEND_USD.toFixed(2)} reached`);
        break;
      }
      const fresh = needsResearch(existing.analyses[s.ticker], now, RESEARCH_MAX_AGE_DAYS);
      if (!fresh.research) {
        console.log(`  ${s.ticker}... skipped (${fresh.reason})`);
        continue;
      }
      process.stdout.write(`  ${s.ticker}... `);
      // The thesis to compare against comes from whatever is already on disk
      // for this ticker, so monitoring works across runs without extra state.
      const prior = existing.analyses[s.ticker];
      // Fall back to parsing the raw text: records written before sections
      // existed still carry a THESIS heading, and monitoring should work on
      // them rather than silently skipping a stock's whole research history.
      const priorThesis =
        prior?.report?.THESIS ?? (prior?.research ? parseReport(prior.research).THESIS : undefined);
      const previousAt = prior?.researchAt ?? prior?.generatedAt;
      const previous =
        priorThesis && previousAt ? { thesis: priorThesis, at: previousAt.slice(0, 10) } : null;
      const { usage, searches, ...extra } = await researchOne(client, s, previous);
      if (usage) tally = addSpend(tally, MODEL, usage, searches ?? 0);
      const target = byTicker.get(s.ticker);
      if (target) {
        Object.assign(target, extra);
      } else {
        // The write-up failed but research worked: keep it rather than drop it.
        analyses.push({
          ticker: s.ticker,
          text: "",
          model: MODEL,
          generatedAt: new Date().toISOString(),
          ...extra,
        });
      }
      console.log(
        extra.research
          ? `ok, ${extra.sources?.length ?? 0} sources, ${extra.reportCompleteness}% complete` +
            (extra.monitor ? `, monitor: ${extra.monitor.verdict}` : ", first pass")
          : `skipped (${extra.researchError})`,
      );
    }
    console.log(
      `  research spend: $${tally.usd.toFixed(3)} ` +
        `(${tally.inputTokens.toLocaleString()} in, ${tally.outputTokens.toLocaleString()} out, ` +
        `${tally.searches} searches)`,
    );
  }

  // Merge field-wise, not record-wise. A run with research disabled (or one
  // where search failed) carries no research field, and assigning the whole
  // record would delete research gathered by an earlier run. Only overwrite
  // research when this run actually produced some.
  for (const a of analyses) {
    const prev = existing.analyses[a.ticker];
    existing.analyses[a.ticker] = {
      ...prev,
      ...a,
      ...(a.research
        ? {}
        : {
            research: prev?.research,
            sources: prev?.sources,
            report: prev?.report,
            reportCompleteness: prev?.reportCompleteness,
            researchAt: prev?.researchAt,
            monitor: prev?.monitor,
          }),
    };
  }
  existing.generatedAt = new Date().toISOString();
  existing.model = MODEL;
  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));

  console.log(`\nWrote ${analyses.length} analyses to data/analysis.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

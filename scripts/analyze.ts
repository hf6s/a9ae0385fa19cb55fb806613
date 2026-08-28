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
import type {
  AnalysisFile,
  RankedStock,
  Rankings,
  ResearchSource,
  StockAnalysis,
} from "../src/lib/types";

loadEnv();

const MODEL = "claude-opus-5";
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
const RESEARCH_TOP_DEFAULT = 5;
const MAX_SEARCHES = 12;

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

/**
 * The research pass: what the factor model structurally cannot see.
 *
 * The model reads filings and prices. It has no idea whether a company just
 * lost its biggest customer, is being acquired, or is a fallen growth story
 * whose cheap multiple is a trap. That is what search is for, so the prompt
 * asks for the things a score cannot contain and explicitly bans restating
 * the numbers we already have.
 *
 * This is deliberately NOT in the backtest. Searching the live web is correct
 * for describing a company today and would be pure lookahead in a historical
 * simulation, so nothing here may ever feed the ranking.
 */
const RESEARCH_SYSTEM = `You are the research layer of Factor20, a transparent stock-ranking site.
A quantitative model has already scored this company from SEC filings and
prices. Your job is to find what those numbers CANNOT contain, using web
search, and to be candid about risk.

Search for recent developments: earnings and guidance, management changes,
major contracts or customer losses, regulation and litigation, competitive
shifts, and anything that would change how a reader reads the score.

Write three short labelled sections, plain prose, no bullet lists:

THESIS: why this company could be meaningfully more valuable in 3-5 years.
Be specific about the mechanism, not "strong company".

WHAT MUST GO RIGHT: the concrete things that have to happen for that to work.

WHAT WOULD BREAK IT: the strongest bear case you can honestly construct, and
what observable event would tell a reader the thesis has failed.

Start directly with the THESIS heading. No preamble, no "I'll research this".

If some searches fail or the search allowance runs out, work with whatever you
did retrieve and mention only the specific gap that remains. Do NOT disclaim
the whole write-up as unverified when you successfully retrieved anything, and
do not describe your own tool usage to the reader.

Rules. Prefer primary and reputable sources: SEC filings, company investor
relations, Reuters, Bloomberg, FT, WSJ, CNBC, Barron's, Morningstar. Treat
social media, forums and influencers as low-confidence and label them as such
if you use them at all. Never invent a number, a filing, a quote or an event:
if you could not verify something, say you could not verify it. Do not repeat
the factor scores or ratios back, they are already on the page. Do not say
buy, sell, or hold, and give no price targets. Under 300 words total.`;

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
 * One researched write-up. Streamed because a search-and-read turn is long
 * enough to risk an HTTP timeout on a plain request.
 *
 * A failure here must never lose the factor write-up that already succeeded,
 * so every error is caught and recorded on the record instead of thrown.
 */
async function researchOne(
  client: Anthropic,
  s: RankedStock,
): Promise<Pick<StockAnalysis, "research" | "sources" | "researchError">> {
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: RESEARCH_SYSTEM,
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
          content:
            `Research ${s.name} (${s.ticker}), a ${s.sector} company currently ranked #${s.rank} ` +
            `by the factor model. Today is ${new Date().toISOString().slice(0, 10)}. ` +
            `Find what has happened recently that the filings-based score cannot capture.`,
        },
      ],
    });
    const response = await stream.finalMessage();
    if (response.stop_reason === "refusal") {
      return { researchError: "model declined this request" };
    }
    const { sources, error } = extractSources(response.content);
    const text = extractText(response.content);
    if (!text) return { researchError: error ?? "no research text returned" };
    return {
      research: text,
      sources,
      ...(error ? { researchError: error } : {}),
    };
  } catch (err) {
    const msg =
      err instanceof Anthropic.APIError ? `${err.status}: ${err.message}` : String(err);
    console.log(`  ${s.ticker}: research failed — ${msg}`);
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

  const client = new Anthropic();
  const analyses = direct ? await runDirect(client, stocks) : await runBatch(client, stocks);

  // Research pass. Separate from the batch above because web search needs the
  // streaming request path, and because it is billed per search: only the top
  // few names get it. --no-research turns it off entirely.
  const researchArg = argValue("--research-top");
  // "0" must mean off, which Number(...) || DEFAULT would silently turn back on.
  const researchTop = researchArg === null ? RESEARCH_TOP_DEFAULT : Number(researchArg);
  if (!process.argv.includes("--no-research") && researchTop > 0) {
    const targets = stocks.slice(0, Math.min(researchTop, stocks.length));
    console.log(`
Researching the top ${targets.length} with web search...`);
    const byTicker = new Map(analyses.map((a) => [a.ticker, a]));
    for (const s of targets) {
      process.stdout.write(`  ${s.ticker}... `);
      const extra = await researchOne(client, s);
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
        extra.research ? `ok, ${extra.sources?.length ?? 0} sources` : `skipped (${extra.researchError})`,
      );
    }
  }

  // Merge into any existing file so partial runs don't wipe older analyses
  const outPath = path.join(DATA_DIR, "analysis.json");
  const existing: AnalysisFile = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : { generatedAt: "", model: MODEL, analyses: {} };
  // Merge field-wise, not record-wise. A run with research disabled (or one
  // where search failed) carries no research field, and assigning the whole
  // record would delete research gathered by an earlier run. Only overwrite
  // research when this run actually produced some.
  for (const a of analyses) {
    const prev = existing.analyses[a.ticker];
    existing.analyses[a.ticker] = {
      ...prev,
      ...a,
      ...(a.research ? {} : { research: prev?.research, sources: prev?.sources }),
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

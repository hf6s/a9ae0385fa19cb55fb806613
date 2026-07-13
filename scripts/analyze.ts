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
 */

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "../src/lib/env";
import type { AnalysisFile, RankedStock, Rankings, StockAnalysis } from "../src/lib/types";

loadEnv();

const MODEL = "claude-opus-4-8";
const DATA_DIR = path.join(process.cwd(), "data");

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

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
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
  const batch = await client.messages.batches.create({
    requests: stocks.map((s) => ({
      custom_id: s.ticker,
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
        ticker: result.custom_id,
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
  const top = Number(argValue("--top")) || 20;
  const direct = process.argv.includes("--direct");
  const stocks = rankings.stocks.slice(0, top);

  if (stocks.length === 0) {
    console.log("No ranked stocks to analyze.");
    return;
  }

  const client = new Anthropic();
  const analyses = direct ? await runDirect(client, stocks) : await runBatch(client, stocks);

  // Merge into any existing file so partial runs don't wipe older analyses
  const outPath = path.join(DATA_DIR, "analysis.json");
  const existing: AnalysisFile = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : { generatedAt: "", model: MODEL, analyses: {} };
  for (const a of analyses) existing.analyses[a.ticker] = a;
  existing.generatedAt = new Date().toISOString();
  existing.model = MODEL;
  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));

  console.log(`\nWrote ${analyses.length} analyses to data/analysis.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAnalyses, getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow up to 60s for the model call

const MODEL = "claude-opus-4-8";

// Best-effort per-IP rate limit (per serverless instance; fine for beta)
const hits = new Map<string, number[]>();
const LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;

function limited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) return true;
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "AI chat isn't configured on this deployment yet." },
      { status: 503 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) {
    return NextResponse.json(
      { error: "Rate limit: 5 questions per 10 minutes. Take a breather." },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { ticker?: string; question?: string };
  const question = (body.question ?? "").trim();
  if (!body.ticker || !question || question.length > 300) {
    return NextResponse.json(
      { error: "Provide a ticker and a question under 300 characters." },
      { status: 400 },
    );
  }

  const rankings = getRankings();
  const stock = rankings?.stocks.find(
    (s) => s.ticker.toUpperCase() === body.ticker!.toUpperCase(),
  );
  if (!stock) {
    return NextResponse.json({ error: "Unknown ticker." }, { status: 404 });
  }
  const analysis = getAnalyses()?.analyses[stock.ticker];

  const context = `${stock.name} (${stock.ticker}) — ${stock.sector}
Rank #${stock.rank}, final score ${stock.finalScore}/100
Factor scores: Quality ${stock.scores.quality}, Value ${stock.scores.value}, Momentum ${stock.scores.momentum}, Growth ${stock.scores.growth}
Penalties: ${stock.penalties.map((p) => `${p.reason} (-${p.points})`).join(", ") || "none"}
Price $${stock.price}, market cap $${Math.round(stock.marketCap / 1000)}B
Metrics: ${Object.entries(stock.metrics)
    .map(([k, v]) => `${k}=${v ?? "n/a"}`)
    .join(", ")}
${analysis ? `\nExisting analysis:\n${analysis.text}` : ""}`;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      thinking: { type: "adaptive" },
      system: `You are the Q&A layer of Factor20, a transparent factor-model stock ranking
site. Answer the user's question about this specific stock using the data
provided. Be concrete, cite the numbers, stay neutral. You do not predict
prices and you never give buy/sell advice — if asked "should I buy", explain
what the model says and its limits instead. Keep answers under 150 words.
If the question is unrelated to this stock or investing, decline briefly.`,
      messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
    });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "That question can't be answered here." }, { status: 400 });
    }
    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json({ error: "AI request failed — try again shortly." }, { status: 502 });
  }
}

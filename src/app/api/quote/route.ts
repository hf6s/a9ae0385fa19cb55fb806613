import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Live-ish quotes for portfolio refresh. Finnhub /quote works from servers on
// the free tier (only candles are premium). Cap tickers to keep under limits.
export async function GET(req: Request) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "FINNHUB_API_KEY not set" }, { status: 503 });
  }
  const url = new URL(req.url);
  const tickers = (url.searchParams.get("tickers") ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);

  const out: Record<string, number> = {};
  await Promise.all(
    tickers.map(async (t) => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t)}&token=${key}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const q = (await res.json()) as { c?: number };
        if (typeof q.c === "number" && q.c > 0) out[t] = q.c;
      } catch {
        /* skip this ticker */
      }
    }),
  );

  return NextResponse.json({ prices: out, at: new Date().toISOString() });
}

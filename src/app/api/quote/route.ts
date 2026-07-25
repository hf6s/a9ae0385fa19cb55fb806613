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
  // Failures are surfaced in the response + server logs: Finnhub's free tier
  // answers from a residential IP but not from Vercel's datacenter IPs, and a
  // silent empty result made that look like a code bug for weeks.
  const failures: string[] = [];
  await Promise.all(
    tickers.map(async (t) => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t)}&token=${key}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          failures.push(`${t}:HTTP_${res.status}`);
          return;
        }
        const q = (await res.json()) as { c?: number };
        if (typeof q.c === "number" && q.c > 0) out[t] = q.c;
        else failures.push(`${t}:no_price`);
      } catch (err) {
        failures.push(`${t}:${(err as Error).name}`);
      }
    }),
  );

  if (failures.length > 0) {
    console.warn(
      `[quote] ${Object.keys(out).length}/${tickers.length} ok; failed: ${failures.slice(0, 10).join(", ")}`,
    );
  }

  return NextResponse.json({
    prices: out,
    at: new Date().toISOString(),
    ...(failures.length > 0 ? { failed: failures.length } : {}),
  });
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Live-ish quotes for the portfolio refresh.
 *
 * EODHD is primary: its delayed feed is sold for server-side use, and it
 * batches many symbols into one request. Finnhub's free tier answers 401 from
 * Vercel's IPs, so it only works as a local fallback.
 */

const BATCH = 20; // symbols per EODHD request (1 primary + rest via ?s=)

interface EodhdQuote {
  code?: string;
  close?: number | string;
}

async function eodhdQuotes(
  tickers: string[],
  key: string,
  out: Record<string, number>,
  failures: string[],
): Promise<void> {
  const symbol = (t: string) => `${t.replace(/\./g, "-")}.US`;
  const fromSymbol = (code: string) => code.replace(/\.US$/i, "").replace(/-/g, ".");

  for (let i = 0; i < tickers.length; i += BATCH) {
    const chunk = tickers.slice(i, i + BATCH);
    const [first, ...rest] = chunk;
    const url =
      `https://eodhd.com/api/real-time/${encodeURIComponent(symbol(first))}` +
      `?api_token=${key}&fmt=json` +
      (rest.length ? `&s=${rest.map(symbol).join(",")}` : "");
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        failures.push(`batch${i}:HTTP_${res.status}`);
        continue;
      }
      const json = (await res.json()) as EodhdQuote | EodhdQuote[];
      for (const q of Array.isArray(json) ? json : [json]) {
        const price = typeof q.close === "string" ? Number(q.close) : q.close;
        if (!q.code || typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
        out[fromSymbol(q.code)] = price;
      }
    } catch (err) {
      failures.push(`batch${i}:${(err as Error).name}`);
    }
  }
}

async function finnhubQuotes(
  tickers: string[],
  key: string,
  out: Record<string, number>,
  failures: string[],
): Promise<void> {
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
}

export async function GET(req: Request) {
  const eodhdKey = process.env.EODHD_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (!eodhdKey && !finnhubKey) {
    return NextResponse.json({ error: "No quote provider configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const tickers = (url.searchParams.get("tickers") ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 60);

  const out: Record<string, number> = {};
  const failures: string[] = [];
  let source = "none";

  if (eodhdKey) {
    source = "eodhd";
    await eodhdQuotes(tickers, eodhdKey, out, failures);
  }
  // Fall back only for what the primary could not price.
  const missing = tickers.filter((t) => out[t] === undefined);
  if (missing.length > 0 && finnhubKey) {
    source = source === "eodhd" ? "eodhd+finnhub" : "finnhub";
    await finnhubQuotes(missing, finnhubKey, out, failures);
  }

  if (failures.length > 0) {
    console.warn(
      `[quote] ${Object.keys(out).length}/${tickers.length} ok via ${source}; ` +
        `failed: ${failures.slice(0, 10).join(", ")}`,
    );
  }

  return NextResponse.json({
    prices: out,
    at: new Date().toISOString(),
    source,
    ...(failures.length > 0 ? { failed: failures.length } : {}),
  });
}

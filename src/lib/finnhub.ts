/**
 * Minimal Finnhub client with a token-bucket rate limiter tuned for the
 * free tier (60 calls/min — we stay at ~50/min to be safe).
 */

const BASE = "https://finnhub.io/api/v1";
const MAX_PER_MINUTE = 50;

let stamps: number[] = [];

async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now();
    stamps = stamps.filter((s) => now - s < 60_000);
    if (stamps.length < MAX_PER_MINUTE) {
      stamps.push(now);
      return;
    }
    const wait = 60_000 - (now - stamps[0]) + 50;
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function get<T>(pathAndQuery: string): Promise<T | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not set");
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const url = `${BASE}${pathAndQuery}${sep}token=${key}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    const res = await fetch(url);
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 15_000));
      continue;
    }
    if (res.status === 403) return null; // endpoint not on free tier
    if (!res.ok) {
      if (attempt === 3) return null;
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
      continue;
    }
    return (await res.json()) as T;
  }
  return null;
}

export interface Quote {
  c: number; // current price
  pc: number; // previous close
}

export interface Profile {
  name: string;
  marketCapitalization: number; // USD millions
  shareOutstanding: number; // millions
  finnhubIndustry: string;
  ticker: string;
}

export interface MetricResponse {
  metric: Record<string, number | null | undefined>;
}

export interface EarningsSurprise {
  actual: number | null;
  estimate: number | null;
  surprisePercent: number | null;
  period: string;
}

export interface InsiderTransactions {
  data: { change: number | null }[];
}

export interface SymbolInfo {
  symbol: string;
  description: string;
  type: string; // "Common Stock", "ADR", "ETP", "Warrant", ...
  mic: string; // exchange MIC code
  currency: string;
}

export const finnhub = {
  quote: (symbol: string) => get<Quote>(`/quote?symbol=${encodeURIComponent(symbol)}`),
  profile: (symbol: string) =>
    get<Profile>(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`),
  metrics: (symbol: string) =>
    get<MetricResponse>(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`),
  earnings: (symbol: string) =>
    get<EarningsSurprise[]>(`/stock/earnings?symbol=${encodeURIComponent(symbol)}`),
  /** Insider share transactions since `from` (YYYY-MM-DD). Free tier. */
  insiderTransactions: (symbol: string, from: string) =>
    get<InsiderTransactions>(
      `/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}&from=${from}`,
    ),
  /** All US-listed symbols (1 call). Free tier. */
  symbols: () => get<SymbolInfo[]>(`/stock/symbol?exchange=US`),
};

/**
 * Finnhub key names drift between TTM/Annual/Quarterly variants. Return the
 * first present, finite value among the candidate keys.
 */
export function pickMetric(
  metrics: Record<string, number | null | undefined>,
  ...keys: string[]
): number | null {
  for (const k of keys) {
    const v = metrics[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

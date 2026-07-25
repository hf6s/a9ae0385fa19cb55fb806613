/**
 * Builds a survivorship-free candidate universe for the backtest.
 *
 * Fetching 10y history for all ~50,000 US common stocks (listed + delisted)
 * would take ~17 hours. Most of those are microcaps and shells the model
 * rejects anyway. So this samples EODHD's bulk end-of-day file a few times a
 * year -- one call returns every US ticker for that date -- and keeps only
 * names that ever cleared the liquidity bar the model already uses:
 *
 *     price > $10  AND  dollar volume > $10M
 *
 * No new selection rule is introduced, so no new bias: a name qualifies on
 * what it looked like ON that past date, never on what it became.
 *
 * Writes data/universe-pit.json. Run before a wide-universe backtest.
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/lib/env";

loadEnv();

const DATA_DIR = path.join(process.cwd(), "data");
const OUT = path.join(DATA_DIR, "universe-pit.json");

const MIN_PRICE = 10;
const MIN_DOLLAR_VOLUME = 10_000_000;
/** Samples per year. Quarterly catches names that were briefly liquid. */
const SAMPLES_PER_YEAR = 4;
const YEARS = 15;

interface BulkRow {
  code?: string;
  close?: number;
  volume?: number;
}

function sampleDates(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let y = 0; y < YEARS; y++) {
    for (let q = 0; q < SAMPLES_PER_YEAR; q++) {
      const d = new Date(now);
      d.setFullYear(now.getFullYear() - y);
      d.setMonth(q * 3 + 1, 15); // mid Feb/May/Aug/Nov
      if (d < now) out.push(d.toISOString().slice(0, 10));
    }
  }
  return out.sort();
}

/**
 * Codes that are actual US-listed common stock, past or present. The bulk file
 * carries no security type, so without this the universe fills with ETFs,
 * closed-end funds, ADRs and SPAC shells the model spec excludes.
 */
async function commonStockCodes(key: string): Promise<Set<string>> {
  const EXCHANGES = new Set(["NYSE", "NASDAQ", "NYSE MKT", "NYSE ARCA", "AMEX", "BATS", "OTC"]);
  const keep = new Set<string>();
  for (const suffix of ["", "&delisted=1"]) {
    const res = await fetch(
      `https://eodhd.com/api/exchange-symbol-list/US?fmt=json&api_token=${key}${suffix}`,
    );
    if (!res.ok) continue;
    const rows = (await res.json()) as {
      Code?: string;
      Type?: string;
      Currency?: string;
      Exchange?: string;
      Isin?: string | null;
    }[];
    for (const r of rows) {
      if (!r.Code || r.Type !== "Common Stock" || r.Currency !== "USD") continue;
      if (r.Exchange && !EXCHANGES.has(r.Exchange.toUpperCase())) continue;
      // ADRs carry a non-US ISIN; the spec excludes them.
      if (r.Isin && !/^US/i.test(r.Isin)) continue;
      // Retired/duplicate listings EODHD suffixes, plus units and warrants.
      if (/_old|\-old|[.-](WS|U|R|RT|W|P[A-Z]?)$/i.test(r.Code)) continue;
      keep.add(r.Code.toUpperCase());
    }
  }
  return keep;
}

async function main() {
  const key = process.env.EODHD_API_KEY;
  if (!key) throw new Error("EODHD_API_KEY is not set");

  console.log("Loading US common-stock symbol lists (listed + delisted)...");
  const common = await commonStockCodes(key);
  console.log(`  ${common.size} codes are US common stock`);

  const dates = sampleDates();
  console.log(`Sampling ${dates.length} dates across ${YEARS} years...`);

  const qualified = new Map<string, { firstSeen: string; bestDollarVol: number }>();

  for (const date of dates) {
    const url = `https://eodhd.com/api/eod-bulk-last-day/US?date=${date}&fmt=json&api_token=${key}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`  ${date}: HTTP ${res.status}, skipped`);
        continue;
      }
      const rows = (await res.json()) as BulkRow[];
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log(`  ${date}: no data (market holiday?)`);
        continue;
      }
      let added = 0;
      for (const r of rows) {
        if (!r.code || typeof r.close !== "number" || typeof r.volume !== "number") continue;
        if (!common.has(r.code.toUpperCase())) continue; // ETFs, funds, ADRs out
        if (r.close < MIN_PRICE) continue;
        const dollarVol = r.close * r.volume;
        if (dollarVol < MIN_DOLLAR_VOLUME) continue;
        const prev = qualified.get(r.code);
        if (!prev) {
          qualified.set(r.code, { firstSeen: date, bestDollarVol: dollarVol });
          added++;
        } else if (dollarVol > prev.bestDollarVol) {
          prev.bestDollarVol = dollarVol;
        }
      }
      console.log(
        `  ${date}: ${rows.length} tickers, ${added} newly qualified (running total ${qualified.size})`,
      );
    } catch (err) {
      console.log(`  ${date}: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const tickers = [...qualified.keys()].sort();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rule: `price > $${MIN_PRICE} and dollar volume > $${MIN_DOLLAR_VOLUME / 1e6}M on at least one sampled date`,
        sampledDates: dates.length,
        years: YEARS,
        count: tickers.length,
        tickers,
      },
      null,
      2,
    ),
  );

  console.log(`\nWrote data/universe-pit.json — ${tickers.length} candidates.`);
  console.log("These include companies that have since delisted, which is the point.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

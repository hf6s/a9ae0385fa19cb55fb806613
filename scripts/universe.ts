/**
 * Universe builder — implements the spec's real universe: all US-listed
 * common stocks (major exchanges, no ADRs/ETFs/warrants/OTC) with market
 * cap above ~$1.5B (buffer under the $2B filter so borderline names are
 * re-checked by the real filter each scan).
 *
 * Writes data/universe.json, which `npm run scan` prefers over the S&P 500
 * fallback list. Re-run occasionally (monthly) — membership drifts slowly.
 *
 * NOTE: this makes one profile call per candidate symbol (~5-6k), which
 * takes ~2 hours on the Finnhub free tier. Run it overnight or in CI.
 *
 * Usage:
 *   npm run universe
 *   npm run universe -- --min-cap 1500   # cap floor in USD millions
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/lib/env";
import { finnhub } from "../src/lib/finnhub";

loadEnv();

const DATA_DIR = path.join(process.cwd(), "data");

// Major US exchange MIC codes: NYSE, Nasdaq (all tiers), NYSE American, ARCA, BATS
const ALLOWED_MICS = new Set(["XNYS", "XNGS", "XNMS", "XNCM", "XASE", "ARCX", "BATS"]);

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

async function main() {
  const minCap = Number(argValue("--min-cap")) || 1500; // USD millions

  console.log("Fetching US symbol directory...");
  const all = await finnhub.symbols();
  if (!all) throw new Error("Could not fetch symbol list from Finnhub");

  const candidates = all.filter(
    (s) =>
      s.type === "Common Stock" &&
      s.currency === "USD" &&
      ALLOWED_MICS.has(s.mic) &&
      !s.symbol.includes(" ") && // units/when-issued
      s.symbol.length <= 5,
  );
  console.log(
    `${all.length} US symbols -> ${candidates.length} common stocks on major exchanges.`,
  );
  console.log(
    `Screening by market cap (> $${(minCap / 1000).toFixed(1)}B) — ~${Math.ceil(candidates.length / 50)} min at free-tier rate limits...\n`,
  );

  const universe: { ticker: string; name: string; sector: string }[] = [];
  let done = 0;
  for (const c of candidates) {
    done++;
    const profile = await finnhub.profile(c.symbol);
    if (
      profile &&
      profile.marketCapitalization &&
      profile.marketCapitalization >= minCap
    ) {
      universe.push({
        ticker: c.symbol,
        name: profile.name || c.description,
        sector: profile.finnhubIndustry || "Unknown",
      });
    }
    if (done % 250 === 0) {
      console.log(`  ${done}/${candidates.length} screened — ${universe.length} qualify so far`);
    }
  }

  universe.sort((a, b) => a.ticker.localeCompare(b.ticker));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "universe.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), minCap, tickers: universe }, null, 2),
  );
  console.log(
    `\nWrote data/universe.json — ${universe.length} US common stocks with cap > $${(minCap / 1000).toFixed(1)}B.`,
  );
  console.log("`npm run scan` will now use this universe automatically.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

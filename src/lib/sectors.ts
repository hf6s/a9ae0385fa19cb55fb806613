/**
 * Sector for any company, living or dead, from its SEC SIC code.
 *
 * The scan gets sectors from Finnhub, but that only covers listed companies,
 * so a backtest that includes delisted names has no sector for exactly the
 * companies the survivorship fix added. SEC's submissions endpoint carries an
 * SIC code for every registrant and never drops one, so it works for SIVB and
 * FRC as readily as for AAPL.
 *
 * Cached to disk: this is one request per company and SEC rate limits hard.
 */

import fs from "node:fs";
import path from "node:path";

const UA = `Factor20/0.1 (contact: ${process.env.SEC_CONTACT ?? "factor20-bot@users.noreply.github.com"})`;
const CACHE = path.join(process.cwd(), "data", "sector-cache.json");

/** SIC major groups -> the sector names the model already uses. */
function sicToSector(sic: number): string {
  if (sic >= 100 && sic <= 999) return "Agriculture";
  if (sic >= 1000 && sic <= 1499) return "Energy"; // mining, oil & gas extraction
  if (sic >= 1500 && sic <= 1799) return "Industrials"; // construction
  if (sic >= 2000 && sic <= 2199) return "Consumer Staples"; // food, tobacco
  if (sic >= 2200 && sic <= 2399) return "Consumer Discretionary"; // textiles, apparel
  if (sic >= 2400 && sic <= 2699) return "Materials"; // lumber, paper
  if (sic >= 2800 && sic <= 2829) return "Materials"; // industrial chemicals
  if (sic >= 2830 && sic <= 2836) return "Health Care"; // pharma, biologics
  if (sic >= 2837 && sic <= 2999) return "Energy"; // petroleum refining
  if (sic >= 3000 && sic <= 3299) return "Materials";
  if (sic >= 3300 && sic <= 3499) return "Materials"; // primary/fabricated metal
  if (sic >= 3500 && sic <= 3579) return "Technology"; // computer equipment
  if (sic >= 3580 && sic <= 3599) return "Industrials";
  if (sic >= 3600 && sic <= 3629) return "Industrials"; // electrical equipment
  if (sic >= 3630 && sic <= 3669) return "Technology";
  if (sic >= 3670 && sic <= 3679) return "Technology"; // semiconductors
  if (sic >= 3680 && sic <= 3699) return "Technology";
  if (sic >= 3700 && sic <= 3799) return "Consumer Discretionary"; // autos, aerospace
  if (sic >= 3800 && sic <= 3851) return "Health Care"; // medical instruments
  if (sic >= 3852 && sic <= 3999) return "Consumer Discretionary";
  if (sic >= 4000 && sic <= 4799) return "Industrials"; // transport
  if (sic >= 4800 && sic <= 4899) return "Communication Services";
  if (sic >= 4900 && sic <= 4999) return "Utilities";
  if (sic >= 5000 && sic <= 5199) return "Industrials"; // wholesale
  if (sic >= 5200 && sic <= 5999) return "Consumer Discretionary"; // retail
  if (sic >= 6000 && sic <= 6499) return "Financials";
  if (sic >= 6500 && sic <= 6599) return "Real Estate";
  if (sic >= 6700 && sic <= 6799) return "Financials";
  if (sic >= 7000 && sic <= 7299) return "Consumer Discretionary";
  if (sic >= 7370 && sic <= 7379) return "Technology"; // software & data
  if (sic >= 7300 && sic <= 7399) return "Industrials"; // business services
  if (sic >= 7400 && sic <= 7999) return "Consumer Discretionary";
  if (sic >= 8000 && sic <= 8099) return "Health Care";
  if (sic >= 8100 && sic <= 8999) return "Industrials";
  return "Unknown";
}

type Cache = Record<string, string>;

function load(): Cache {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8")) as Cache;
  } catch {
    return {};
  }
}

export class SectorLookup {
  private cache: Cache = load();
  private dirty = false;

  /** Returns "Unknown" rather than throwing, so a miss never blocks a run. */
  async get(ticker: string, cik: string | null): Promise<string> {
    const key = ticker.toUpperCase();
    if (this.cache[key]) return this.cache[key];
    if (!cik) return "Unknown";
    try {
      const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        headers: { "User-Agent": UA },
      });
      await new Promise((r) => setTimeout(r, 120)); // SEC fair-access pacing
      if (!res.ok) return "Unknown";
      const json = (await res.json()) as { sic?: string };
      const sic = Number(json.sic);
      const sector = Number.isFinite(sic) && sic > 0 ? sicToSector(sic) : "Unknown";
      this.cache[key] = sector;
      this.dirty = true;
      return sector;
    } catch {
      return "Unknown";
    }
  }

  save(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(CACHE), { recursive: true });
      fs.writeFileSync(CACHE, JSON.stringify(this.cache));
    } catch {
      /* best effort */
    }
  }

  size(): number {
    return Object.keys(this.cache).length;
  }
}

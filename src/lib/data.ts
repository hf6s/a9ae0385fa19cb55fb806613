import fs from "node:fs";
import path from "node:path";
import type { AnalysisFile, Candle, Rankings, ScoreHistoryPoint } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

export function getRankings(): Rankings | null {
  const file = path.join(DATA_DIR, "rankings.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Rankings;
}

export function getPrevRankings(): Rankings | null {
  const file = path.join(DATA_DIR, "rankings-prev.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Rankings;
}

export function getScoreHistory(): ScoreHistoryPoint[] {
  const file = path.join(DATA_DIR, "score-history.json");
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ScoreHistoryPoint[];
  } catch {
    return [];
  }
}

export function getAnalyses(): AnalysisFile | null {
  const file = path.join(DATA_DIR, "analysis.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as AnalysisFile;
}

export function getHistory(ticker: string): Candle[] | null {
  const safe = ticker.replace(/[^A-Za-z0-9.-]/g, "");
  const file = path.join(DATA_DIR, "history", `${safe}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Candle[];
}

/**
 * The last trading day the stored price history covers.
 *
 * NOT the scan's timestamp. A scan runs the morning after the close it works
 * from, so `generatedAt` is a day later than the prices in it, and anything
 * that dates a position by the scan time lands one day past the newest price
 * it has - which is enough to leave a chart with nothing to draw.
 *
 * Every history file is written by the same scan and ends on the same day, so
 * the first one that answers is the answer. A handful of candidates are tried
 * in case the leading ticker is new and has no file yet.
 */
export function getPriceAsOf(tickers: string[]): string | null {
  for (const ticker of tickers.slice(0, 5)) {
    const candles = getHistory(ticker);
    const last = candles?.[candles.length - 1];
    if (last?.t) return last.t;
  }
  return null;
}

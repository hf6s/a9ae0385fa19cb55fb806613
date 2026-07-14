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

export interface Candle {
  t: string; // ISO date
  o: number;
  h: number;
  l: number;
  c: number; // as-traded close: correct for valuation and for charts
  /**
   * Total-return close, adjusted for splits AND dividends. Use this for
   * returns, momentum and moving averages. `c` is NOT split-adjusted on the
   * paid feed, so a 4:1 split reads as a 75% loss if you compute returns on it.
   */
  a?: number;
  /** Share volume. Needed for the liquidity filter on a wide universe. */
  v?: number;
}

export interface FactorScores {
  quality: number;
  value: number;
  momentum: number;
  growth: number;
}

export interface Penalty {
  reason: string;
  points: number;
}

export interface RankedStock {
  rank: number;
  ticker: string;
  name: string;
  sector: string;
  price: number;
  marketCap: number; // USD millions
  scores: FactorScores;
  penalties: Penalty[];
  finalScore: number;
  recommended: boolean; // top 20
  nextEarningsDate?: string | null; // ISO date of next scheduled earnings, if within ~60d
  metrics: Record<string, number | null>; // key metrics surfaced in the UI / analysis prompt
}

export interface ScoreHistoryPoint {
  date: string;
  entries: Record<string, { r: number; s: number }>; // ticker -> { rank, score }
}

export interface Rankings {
  generatedAt: string;
  universeScanned: number;
  passedFilters: number;
  skippedFilters: string[]; // filters that could not be applied due to free-tier data gaps
  stocks: RankedStock[];
}

/** A source the research pass actually consulted, for the reader to check. */
export interface ResearchSource {
  title: string;
  url: string;
}

export interface StockAnalysis {
  ticker: string;
  text: string;
  model: string;
  generatedAt: string;
  /**
   * Web-researched context: the thesis, what has to go right, and what would
   * break it. Absent on write-ups produced before research existed, and on
   * stocks below the research cutoff, so every consumer must treat it as
   * optional rather than assume it is there.
   */
  research?: string;
  /** Pages the model actually opened. Empty if search returned nothing. */
  sources?: ResearchSource[];
  /** Set when search was attempted and failed, so the UI can say so. */
  researchError?: string;
}

export interface AnalysisFile {
  generatedAt: string;
  model: string;
  analyses: Record<string, StockAnalysis>;
}

export interface ScanStatus {
  state: "idle" | "running" | "done" | "error";
  mode: "sp500" | "universe";
  phase: string; // "market data" | "edgar" | "penalties" | ...
  done: number;
  total: number;
  startedAt: string;
  phaseStartedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
}

/** One row of the rolling-window table: annualized returns over every start date. */
export interface RollingWindow {
  years: number;
  windows: number;
  stratWorst: number;
  stratMedian: number;
  stratBest: number;
  benchWorst: number;
  benchMedian: number;
  benchBest: number;
  beatPct: number;
}

export interface Candle {
  t: string; // ISO date
  o: number;
  h: number;
  l: number;
  c: number;
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
  metrics: Record<string, number | null>; // key metrics surfaced in the UI / analysis prompt
}

export interface Rankings {
  generatedAt: string;
  universeScanned: number;
  passedFilters: number;
  skippedFilters: string[]; // filters that could not be applied due to free-tier data gaps
  stocks: RankedStock[];
}

export interface StockAnalysis {
  ticker: string;
  text: string;
  model: string;
  generatedAt: string;
}

export interface AnalysisFile {
  generatedAt: string;
  model: string;
  analyses: Record<string, StockAnalysis>;
}

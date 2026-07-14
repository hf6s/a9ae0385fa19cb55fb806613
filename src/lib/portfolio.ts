// Client-side paper portfolio stored in localStorage. Equal-weight positions,
// each opened at the stock's price on the day it was added.

export interface Position {
  ticker: string;
  name: string;
  entryPrice: number;
  date: string; // ISO date added
}

const KEY = "f20-portfolio";

export function readPortfolio(): Position[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Position[];
  } catch {
    return [];
  }
}

function write(list: Position[]): Position[] {
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

export function addPosition(p: Position): Position[] {
  const list = readPortfolio();
  if (list.some((x) => x.ticker === p.ticker)) return list; // no duplicates
  return write([...list, p]);
}

export function addMany(ps: Position[]): Position[] {
  const list = readPortfolio();
  const have = new Set(list.map((x) => x.ticker));
  return write([...list, ...ps.filter((p) => !have.has(p.ticker))]);
}

export function removePosition(ticker: string): Position[] {
  return write(readPortfolio().filter((x) => x.ticker !== ticker));
}

export function clearPortfolio(): Position[] {
  return write([]);
}

export function hasPosition(ticker: string): boolean {
  return readPortfolio().some((x) => x.ticker === ticker);
}

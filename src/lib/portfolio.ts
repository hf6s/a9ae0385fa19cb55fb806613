/**
 * What the shares you actually bought are worth, and whether owning them beat
 * doing nothing clever.
 *
 * A paper portfolio lived here once and was removed, because it kept holdings
 * in browser storage and nothing else: a cleared cache or a second device and
 * the positions were gone. Storage is the page's problem, not this file's, but
 * the lesson that shaped this one is the same - the numbers have to be worth
 * the trouble of typing holdings in. So this does not stop at "your shares are
 * worth $X". It answers the only question that decides whether following the
 * model was worth it: would the same money, put into the index on the same
 * days, have done better?
 *
 * THE COMPARISON IS CASH-FLOW MATCHED. Buying three stocks across three months
 * and comparing the total against the S&P's return for the year is meaningless,
 * because two of the positions were not held for most of it. So the benchmark
 * here buys the index with each position's exact cost, on that position's exact
 * buy date. Both lines then see identical money arriving at identical times,
 * and the gap between them is the only thing left: stock selection.
 *
 * RETURNS SEPARATE FROM DEPOSITS. Paying in more money raises the portfolio's
 * value without earning a penny, so the percentage return chains daily moves
 * and removes the day's new money - a time-weighted return, the same measure a
 * broker shows. Without that, every deposit reads as a gain and the drawdown
 * figure becomes fiction.
 *
 * Pure arithmetic on prices and holdings. No I/O, no React, and no judgement
 * about what to own.
 */

/** A hard ceiling, so a corrupt import cannot ask for a thousand price lookups. */
export const MAX_HOLDINGS = 40;

/** The model's own book size, used to say how full a portfolio is. */
export const MODEL_POSITIONS = 20;

export interface Holding {
  /** Stable across edits, so React rows and the price cache agree on identity. */
  id: string;
  ticker: string;
  shares: number;
  /** Cost per share, not total: it is what a broker confirmation shows. */
  cost: number;
  /** ISO date (YYYY-MM-DD) the shares were bought. */
  at: string;
}

/** What the scan knows about a ticker. Absent for anything outside the universe. */
export interface TickerMeta {
  name: string;
  sector: string;
  rank: number;
  score: number;
}

export interface Position extends Holding {
  name: string;
  sector: string;
  /** Latest close available. 0 when no price could be found at all. */
  price: number;
  /** shares x cost: the money that went in. */
  basis: number;
  /** shares x price: the money that would come out today. */
  value: number;
  gain: number;
  gainPct: number;
  /** Share of the portfolio's current value, as a percentage. */
  weight: number;
  rank: number | null;
  score: number | null;
  inTop20: boolean;
  /** False when the scan has never seen this ticker, so the model says nothing. */
  known: boolean;
  /** False when no price was found; the position is listed but not valued. */
  priced: boolean;
}

export interface Summary {
  positions: number;
  basis: number;
  value: number;
  gain: number;
  gainPct: number;
  /** Positions the model still ranks in its top 20. */
  inTop20: number;
  /** Positions with no price, whose value is missing from the total. */
  unpriced: number;
  best: Position | null;
  worst: Position | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normaliseTicker(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

/**
 * Validates one holding, returning null rather than a half-built object.
 *
 * Zero shares, a negative cost and a malformed date are all rejected here,
 * once, so neither the editor nor an imported link can get a nonsense row into
 * the maths downstream.
 */
export function makeHolding(input: {
  id?: string;
  ticker: string;
  shares: number | string;
  cost: number | string;
  at: string;
}): Holding | null {
  const ticker = normaliseTicker(String(input.ticker ?? ""));
  const shares = Number(input.shares);
  const cost = Number(input.cost);
  const at = String(input.at ?? "").slice(0, 10);

  if (ticker.length === 0 || ticker.length > 12) return null;
  if (!Number.isFinite(shares) || shares <= 0) return null;
  if (!Number.isFinite(cost) || cost < 0) return null;
  if (!ISO_DATE.test(at)) return null;
  // A date that does not exist (2026-02-31) silently parses as another day.
  if (new Date(`${at}T00:00:00Z`).toISOString().slice(0, 10) !== at) return null;

  return {
    id: input.id && String(input.id).length > 0 ? String(input.id) : `${ticker}-${at}-${shares}`,
    ticker,
    shares,
    cost,
    at,
  };
}

export function buildPositions(
  holdings: Holding[],
  prices: Record<string, number>,
  meta: Record<string, TickerMeta>,
): Position[] {
  const rows: Position[] = holdings.map((h) => {
    const m = meta[h.ticker];
    const price = Number(prices[h.ticker]);
    const priced = Number.isFinite(price) && price > 0;
    const basis = h.shares * h.cost;
    const value = priced ? h.shares * price : 0;
    return {
      ...h,
      name: m?.name ?? h.ticker,
      sector: m?.sector ?? "Unclassified",
      price: priced ? price : 0,
      basis,
      value,
      gain: priced ? value - basis : 0,
      // A position that cost nothing - a gift, a spin-off - has no percentage
      // return to speak of, and reporting Infinity would poison every total.
      gainPct: priced && basis > 0 ? (value / basis - 1) * 100 : 0,
      weight: 0,
      rank: m ? m.rank : null,
      score: m ? m.score : null,
      inTop20: m ? m.rank <= MODEL_POSITIONS : false,
      known: Boolean(m),
      priced,
    };
  });

  const total = rows.reduce((a, r) => a + r.value, 0);
  if (total > 0) for (const r of rows) r.weight = (r.value / total) * 100;
  return rows;
}

export function summarise(positions: Position[]): Summary {
  const basis = positions.reduce((a, p) => a + p.basis, 0);
  const value = positions.reduce((a, p) => a + p.value, 0);
  const comparable = positions.filter((p) => p.priced && p.basis > 0);
  const sorted = [...comparable].sort((a, b) => b.gainPct - a.gainPct);

  // The percentage has to be measured against the cost of the positions that
  // were actually valued. Dividing by the full basis while an unpriced holding
  // contributes no value would report a loss the portfolio has not taken.
  const pricedBasis = comparable.reduce((a, p) => a + p.basis, 0);
  const pricedValue = comparable.reduce((a, p) => a + p.value, 0);

  return {
    positions: positions.length,
    basis,
    value,
    gain: value - basis,
    gainPct: pricedBasis > 0 ? (pricedValue / pricedBasis - 1) * 100 : 0,
    inTop20: positions.filter((p) => p.inTop20).length,
    unpriced: positions.filter((p) => !p.priced).length,
    best: sorted[0] ?? null,
    worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
  };
}

export interface SectorSlice {
  sector: string;
  value: number;
  pct: number;
  tickers: string[];
}

/** Value grouped by sector, largest first. */
export function sectorMix(positions: Position[]): SectorSlice[] {
  const by = new Map<string, SectorSlice>();
  for (const p of positions) {
    if (!p.priced) continue;
    const row = by.get(p.sector) ?? { sector: p.sector, value: 0, pct: 0, tickers: [] };
    row.value += p.value;
    row.tickers.push(p.ticker);
    by.set(p.sector, row);
  }
  const total = [...by.values()].reduce((a, s) => a + s.value, 0);
  const out = [...by.values()].sort((a, b) => b.value - a.value);
  if (total > 0) for (const s of out) s.pct = (s.value / total) * 100;
  return out;
}

export interface DriftRow {
  ticker: string;
  weight: number;
  target: number;
  /** Percentage points away from the target weight. */
  drift: number;
  /** Dollars to sell (negative) or buy (positive) to return to target. */
  adjust: number;
}

/**
 * How far each position has drifted from equal weight.
 *
 * The target is an equal share among the positions actually held, not the
 * model's 5%: someone holding eight names is equal-weight at 12.5% each, and
 * telling them all eight are underweight because the full book is twenty would
 * be arithmetic in service of nothing.
 */
export function driftRows(positions: Position[]): DriftRow[] {
  const priced = positions.filter((p) => p.priced);
  if (priced.length === 0) return [];
  const total = priced.reduce((a, p) => a + p.value, 0);
  const target = 100 / priced.length;
  return priced
    .map((p) => ({
      ticker: p.ticker,
      weight: p.weight,
      target,
      drift: p.weight - target,
      adjust: (target / 100) * total - p.value,
    }))
    .sort((a, b) => b.drift - a.drift);
}

export interface Bar {
  t: string;
  c: number;
}

export interface CurvePoint {
  t: string;
  /** What the holdings were worth that day. */
  value: number;
  /** What had been paid in by that day. */
  basis: number;
  /** The same payments, into the S&P 500 on the same days. */
  bench: number;
}

/**
 * A forward-only cursor over one ascending price series.
 *
 * The naive version rescans a series for every date on the axis, which is
 * quadratic and, across twenty holdings and two years of trading days, slow
 * enough to feel. Prices and the axis both ascend, so one pointer per holding
 * answers every lookup in constant time.
 */
class Cursor {
  private i = -1;
  constructor(private readonly bars: Bar[]) {}
  /** Last close on or before `date`; null before the series begins. */
  at(date: string): number | null {
    while (this.i + 1 < this.bars.length && this.bars[this.i + 1].t <= date) this.i++;
    return this.i < 0 ? null : this.bars[this.i].c;
  }
  get first(): string | null {
    return this.bars.length > 0 ? this.bars[0].t : null;
  }
}

/** First close on or after `date` - what a buy that day would have paid. */
function closeOnOrAfter(bars: Bar[], date: string): number | null {
  for (const b of bars) if (b.t >= date) return b.c;
  return null;
}

export interface CurveInput {
  holdings: Holding[];
  /** Ticker -> ascending daily closes. */
  series: Record<string, Bar[]>;
  /** S&P 500 closes. Without them the bench line is omitted, not invented. */
  bench: Bar[];
}

/**
 * Daily portfolio value, money paid in, and the index-matched alternative.
 *
 * A holding joins the curve on its buy date, or on the first day there is a
 * price for it if that is later. History is two years deep, and a position
 * bought before it starts cannot be drawn from further back than the data
 * goes; both lines then start together, so neither gets credit for a period
 * the other could not be measured over.
 */
export function equityCurve({ holdings, series, bench }: CurveInput): CurvePoint[] {
  // Same rule the page's notice uses, so what is drawn and what is said about
  // it can never drift apart.
  const parts = splitByChartability(holdings, series)
    .charted.map((h) => {
      const bars = series[h.ticker];
      if (!bars || bars.length === 0) return null;
      const cursor = new Cursor(bars);
      const firstBar = cursor.first;
      if (!firstBar) return null;
      return {
        h,
        cursor,
        from: h.at > firstBar ? h.at : firstBar,
        basis: h.shares * h.cost,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (parts.length === 0) return [];

  const start = parts.reduce((min, p) => (p.from < min ? p.from : min), parts[0].from);

  // The comparison stops on the last day EVERY holding still has a real price.
  //
  // Feeds here do not end together. The benchmark is fetched live, a holding
  // outside the ranked universe is fetched live, and anything the scan covers is
  // priced from the last scan - which can be a fortnight behind. Running the
  // axis past the earliest of those ends freezes some positions at their last
  // known close while the index and the live names keep moving, and the chart
  // then shows a divergence that is entirely an artefact of the data. Taking the
  // earliest end can cut the chart short, which is visible and explainable; the
  // alternative invents a result, which is neither.
  const lastHoldingBar = parts.reduce((min, p) => {
    const bars = series[p.h.ticker];
    const t = bars[bars.length - 1].t;
    return min === "" || t < min ? t : min;
  }, "");

  // The axis is the market's trading days. The benchmark is the cleanest source
  // of those; failing that, the longest holding series stands in.
  const axisSource =
    bench.length > 0
      ? bench
      : [...parts.map((p) => series[p.h.ticker])].sort((a, b) => b.length - a.length)[0];
  const axis = axisSource.filter((b) => b.t >= start && b.t <= lastHoldingBar).map((b) => b.t);
  if (axis.length === 0) return [];

  // Index units each holding's cost would have bought, on that holding's own
  // start date, at that day's close.
  const benchCursor = new Cursor(bench);
  const units = new Map<string, number>();
  for (const p of parts) {
    const entry = bench.length > 0 ? closeOnOrAfter(bench, p.from) : null;
    units.set(p.h.id, entry && entry > 0 ? p.basis / entry : 0);
  }

  const out: CurvePoint[] = [];
  for (const t of axis) {
    let value = 0;
    let basis = 0;
    let unitsHeld = 0;
    for (const p of parts) {
      if (p.from > t) continue;
      const price = p.cursor.at(t);
      // A gap in one holding's feed must not drag the whole line down, so the
      // position keeps its last known price rather than counting as zero.
      if (price !== null) value += p.h.shares * price;
      basis += p.basis;
      unitsHeld += units.get(p.h.id) ?? 0;
    }
    const benchClose = benchCursor.at(t);
    out.push({
      t,
      value,
      basis,
      bench: benchClose !== null ? unitsHeld * benchClose : 0,
    });
  }
  return out;
}

/**
 * Holdings the chart cannot cover, by ticker.
 *
 * A position bought since the last scan has no price history after the day it
 * was bought, so there is nothing to plot: it counts in the totals, where its
 * value is real, and it is absent from the curve. That difference has to be
 * stated rather than left for someone to notice that the end of the line does
 * not match the number above it.
 */
export function unchartable(holdings: Holding[], series: Record<string, Bar[]>): string[] {
  return splitByChartability(holdings, series).skipped;
}

/**
 * How far behind the rest a holding's prices may fall and still be charted.
 *
 * Feeds do not all end on the same day, and a day or two of lag is ordinary.
 * Weeks is not: it means that series stopped being maintained.
 */
export const CHART_LAG_DAYS = 5;

export interface Chartability {
  charted: Holding[];
  /** Tickers left off the chart, each for one of the reasons below. */
  skipped: string[];
}

/**
 * Decides which holdings the chart can honestly include.
 *
 * Three reasons to leave one out, and the third is the one that took real data
 * to find. The chart can only run as far as its least current holding, or it
 * would hold that position flat while the others moved. With a single stale
 * series in the set - an orphaned download from a universe the scan no longer
 * covers - that rule silently cut six weeks off the chart for every other
 * holding. So a series that has fallen weeks behind the rest is dropped and
 * named, rather than being allowed to drag the whole picture back with it.
 *
 * One implementation, used by both the curve and the notice beside it. Two
 * would eventually disagree, and then the page would omit a holding from the
 * chart while claiming it was on it.
 */
export function splitByChartability(
  holdings: Holding[],
  series: Record<string, Bar[]>,
): Chartability {
  const skipped: string[] = [];
  const skip = (ticker: string) => {
    if (!skipped.includes(ticker)) skipped.push(ticker);
  };

  // Pass one: a series has to exist and reach past the buy date.
  const covered = holdings.filter((h) => {
    const bars = series[h.ticker];
    if (!bars || bars.length === 0 || bars[bars.length - 1].t < h.at) {
      skip(h.ticker);
      return false;
    }
    return true;
  });

  if (covered.length === 0) return { charted: [], skipped };

  const endOf = (h: Holding) => {
    const bars = series[h.ticker];
    return bars[bars.length - 1].t;
  };
  const newest = covered.reduce((max, h) => {
    const t = endOf(h);
    return t > max ? t : max;
  }, "");

  // Pass two: and it has to be roughly as current as the others.
  const charted = covered.filter((h) => {
    if (daysBetween(endOf(h), newest) > CHART_LAG_DAYS) {
      skip(h.ticker);
      return false;
    }
    return true;
  });

  return { charted, skipped };
}

export interface ReturnPoint {
  t: string;
  /** Time-weighted index, 1 at the start. */
  strat: number;
  bench: number;
}

/**
 * Percentage return with deposits removed, for both lines.
 *
 * Each day's return is measured against the value already invested plus the
 * money that arrived that day, then chained. A deposit therefore moves the
 * value but not the return, which is the entire point: otherwise paying in
 * $1,000 reads as a gain and the drawdown number means nothing.
 */
export function returnIndex(curve: CurvePoint[]): ReturnPoint[] {
  if (curve.length === 0) return [];
  const out: ReturnPoint[] = [{ t: curve[0].t, strat: 1, bench: 1 }];
  let strat = 1;
  let bench = 1;
  for (let i = 1; i < curve.length; i++) {
    const flow = curve[i].basis - curve[i - 1].basis;
    const sBase = curve[i - 1].value + flow;
    const bBase = curve[i - 1].bench + flow;
    // A zero numerator means the data is missing, not that the money vanished:
    // with no benchmark series at all every bench value is 0, and multiplying
    // through would collapse the line to nothing and then report a 100%
    // drawdown. Carry the index forward instead and let the page say it has no
    // benchmark.
    if (sBase > 0 && curve[i].value > 0) strat *= curve[i].value / sBase;
    if (bBase > 0 && curve[i].bench > 0) bench *= curve[i].bench / bBase;
    out.push({ t: curve[i].t, strat, bench });
  }
  return out;
}

export interface Drawdown {
  /** Depth as a positive percentage. 0 when the line never fell. */
  pct: number;
  /** The date of the low. Empty when there was no fall. */
  at: string;
}

/** Deepest peak-to-trough fall of a return index. */
export function maxDrawdown(index: ReturnPoint[], pick: "strat" | "bench" = "strat"): Drawdown {
  let peak = -Infinity;
  let worst = 0;
  let at = "";
  for (const p of index) {
    const v = p[pick];
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (v / peak - 1) * 100;
      if (dd < worst) {
        worst = dd;
        at = p.t;
      }
    }
  }
  return { pct: Math.abs(worst), at };
}

/** Calendar days between two ISO dates. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Annualised rate from a total return over a span, or null.
 *
 * Null under three months. Scaling a two-week gain to a yearly rate produces
 * numbers like 900% a year, which is not a forecast, it is noise with a percent
 * sign on it.
 */
export function annualised(totalReturn: number, days: number): number | null {
  if (days < 90 || totalReturn <= -1) return null;
  return (Math.pow(1 + totalReturn, 365 / days) - 1) * 100;
}

/**
 * Holdings as a short, readable string for a backup link.
 *
 * Plain text rather than base64, so it survives being pasted into a message and
 * so the owner can read their own backup and see that it is only tickers, share
 * counts and dates. It is carried in a URL fragment, which browsers never send
 * to a server.
 */
export function encodeHoldings(holdings: Holding[]): string {
  return holdings
    .slice(0, MAX_HOLDINGS)
    .map((h) => `${h.ticker}:${h.shares}:${h.cost}:${h.at}`)
    .join("|");
}

/**
 * Reads a backup link, or returns null.
 *
 * One bad field rejects the whole string. A link truncated by a chat app would
 * otherwise restore a believable fraction of someone's portfolio over the real
 * thing, and they would have no way to tell which positions went missing.
 */
export function decodeHoldings(encoded: string): Holding[] | null {
  const trimmed = String(encoded ?? "").trim();
  if (trimmed.length === 0) return null;
  const rows = trimmed.split("|");
  if (rows.length > MAX_HOLDINGS) return null;

  const out: Holding[] = [];
  for (const row of rows) {
    const bits = row.split(":");
    if (bits.length !== 4) return null;
    const h = makeHolding({ ticker: bits[0], shares: bits[1], cost: bits[2], at: bits[3] });
    if (!h) return null;
    out.push(h);
  }
  return out;
}

/** A live price, as the page receives it. */
export interface LiveQuote {
  ticker: string;
  price: number;
  prevClose: number | null;
  /** ISO time the feed says this price printed. */
  at: string;
}

/**
 * Whether a print time is recent enough to call the price current.
 *
 * Outside market hours the newest real price is the last close, which is
 * correct and is not live. Twenty minutes covers a delayed feed during the
 * session without ever describing a Friday close on a Sunday as current, which
 * is the whole reason the page reports the feed's print time instead of the
 * time it asked.
 *
 * Lives here rather than beside the fetching code so the browser can call it
 * without importing the server's feed client.
 */
export function isFresh(at: string, now = Date.now()): boolean {
  const t = Date.parse(at);
  if (!Number.isFinite(t) || t <= 0) return false;
  const age = now - t;
  return age >= 0 && age < 20 * 60 * 1000;
}

/**
 * Position sizing for a given account size.
 *
 * The model prescribes 20 equal-weight positions at 5% each. That breaks down
 * on small accounts: $1,000 split 20 ways is $50 a position, and most ranked
 * names trade above $50, so you end up unable to buy a single share without
 * fractional support, while spread and any per-trade fee eat a real share of
 * each position.
 *
 * So position COUNT scales with the account and weights stay equal:
 *   positions = clamp(account / MIN_POSITION, MIN_POSITIONS, MAX_POSITIONS)
 *
 * Everything here is mechanical arithmetic on the existing ranking. No new
 * judgement about which stocks to hold, and no advice about whether to.
 */

export const MIN_POSITION = 250; // target dollars per position
export const MIN_POSITIONS = 5;
export const MAX_POSITIONS = 20;
/** Below this, a position is too small for whole shares of most ranked names. */
export const THIN_POSITION = 100;

export interface Candidate {
  ticker: string;
  name: string;
  price: number;
}

export interface Allocation extends Candidate {
  weightPct: number;
  dollars: number;
  wholeShares: number;
  cost: number;
  /** One share costs more than the position budget. */
  needsFractional: boolean;
}

export interface AllocationPlan {
  positions: number;
  perPosition: number;
  weightPct: number;
  rows: Allocation[];
  investedWhole: number;
  cashLeftWhole: number;
  fractionalCount: number;
  /** Positions are small enough that fees and spread matter. */
  thin: boolean;
  /** Fewer than the model's 20 slots, so single names move the result more. */
  concentrated: boolean;
}

export function positionCount(account: number, available: number): number {
  if (!Number.isFinite(account) || account <= 0 || available <= 0) return 0;
  const byBudget = Math.floor(account / MIN_POSITION);
  // The MIN_POSITIONS floor lifts small accounts up to 5 slots, but it must
  // never claim more slots than there are ranked stocks, or the weights would
  // sum to less than 100%.
  return Math.min(MAX_POSITIONS, Math.max(MIN_POSITIONS, byBudget), available);
}

export function buildPlan(account: number, candidates: Candidate[]): AllocationPlan | null {
  const positions = positionCount(account, candidates.length);
  if (positions === 0) return null;

  const perPosition = account / positions;
  const weightPct = 100 / positions;

  const rows: Allocation[] = candidates.slice(0, positions).map((c) => {
    const wholeShares = c.price > 0 ? Math.floor(perPosition / c.price) : 0;
    return {
      ...c,
      weightPct,
      dollars: perPosition,
      wholeShares,
      cost: wholeShares * c.price,
      needsFractional: wholeShares === 0,
    };
  });

  const investedWhole = rows.reduce((a, r) => a + r.cost, 0);

  return {
    positions,
    perPosition,
    weightPct,
    rows,
    investedWhole,
    cashLeftWhole: account - investedWhole,
    fractionalCount: rows.filter((r) => r.needsFractional).length,
    thin: perPosition < THIN_POSITION,
    concentrated: positions < MAX_POSITIONS,
  };
}

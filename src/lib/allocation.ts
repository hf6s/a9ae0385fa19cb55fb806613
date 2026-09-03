/**
 * Position sizing for a given account size.
 *
 * The model prescribes 20 equal-weight positions at 5% each. Position COUNT
 * scales with the account and the weights stay equal:
 *   positions = clamp(account / MIN_POSITION, MIN_POSITIONS, MAX_POSITIONS)
 *
 * Share indivisibility used to be the reason for that floor, and it is not any
 * more: every mainstream broker sells fractional shares, so a $50 position is
 * perfectly buyable. What survives is the cost argument — the bid/ask spread is
 * a percentage of whatever you trade, so it takes the same bite out of a tiny
 * position as a large one while the position is too small to be worth the
 * attention. Sizing is therefore quoted in exact dollars, which is what you
 * actually type into a broker.
 *
 * Everything here is mechanical arithmetic on the existing ranking. No new
 * judgement about which stocks to hold, and no advice about whether to.
 */

export const MIN_POSITION = 250; // target dollars per position
export const MIN_POSITIONS = 5;
export const MAX_POSITIONS = 20;
/** Below this, spread and fees take a meaningful bite out of each position. */
export const THIN_POSITION = 100;

export interface Candidate {
  ticker: string;
  name: string;
  price: number;
}

export interface Allocation extends Candidate {
  weightPct: number;
  dollars: number;
  /** Fractional shares to buy — the number you enter at the broker. */
  shares: number;
  /** The round-lot equivalent, for anyone who would rather not hold fractions. */
  wholeShares: number;
}

export interface AllocationPlan {
  positions: number;
  perPosition: number;
  weightPct: number;
  rows: Allocation[];
  /** The whole account goes in: fractional shares leave no forced cash residue. */
  invested: number;
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

  const rows: Allocation[] = candidates.slice(0, positions).map((c) => ({
    ...c,
    weightPct,
    dollars: perPosition,
    // Four decimals is what the brokers that support fractional trading accept.
    shares: c.price > 0 ? Math.round((perPosition / c.price) * 10000) / 10000 : 0,
    wholeShares: c.price > 0 ? Math.floor(perPosition / c.price) : 0,
  }));

  return {
    positions,
    perPosition,
    weightPct,
    rows,
    invested: rows.reduce((a, r) => a + r.dollars, 0),
    thin: perPosition < THIN_POSITION,
    concentrated: positions < MAX_POSITIONS,
  };
}

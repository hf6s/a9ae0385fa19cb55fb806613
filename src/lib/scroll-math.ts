/**
 * The arithmetic behind the invoice page's scroll animation.
 *
 * Split out from the components for one reason: it can be tested. The browser
 * side of this (listeners, rAF, refs) needs a real scrolling viewport to
 * exercise, but the part that decides WHAT NUMBER TO SHOW is pure, and on
 * this page a wrong number is the amount being charged. So that part lives
 * here, under test, rather than in a component nobody can assert against.
 */

/**
 * Clamp to 0..1, mapping -0 and NaN to a plain 0.
 *
 * Negative zero survives arithmetic and formats as "-0", so a counter can
 * render "-0" or "-$0.00" at the very start of its travel. Testing for
 * `n > 0` rather than `n < 0` disposes of both that and NaN in one check.
 */
export const clamp01 = (n: number): number => (!(n > 0) ? 0 : n > 1 ? 1 : n);

/**
 * How far through its reveal an element is, from 0 to 1.
 *
 * Counting starts as the element enters the bottom of the viewport and
 * completes while it is still comfortably on screen, rather than after it has
 * scrolled away — a number that finishes counting off-screen was never seen
 * counting at all.
 *
 * `atPageBottom` is not a nicety. At the end of the document there is no
 * scroll left, so anything still mid-count freezes short, and the invoice
 * total lives exactly there. It resolved to $108.75 on a page that owes
 * $114.99 before this existed.
 */
export function scrubProgress(opts: {
  top: number;
  viewportHeight: number;
  atPageBottom?: boolean;
  /** Fraction of the viewport the element travels through while counting. */
  span?: number;
}): number {
  const { top, viewportHeight, atPageBottom = false, span = 0.45 } = opts;
  if (atPageBottom) return 1;
  if (viewportHeight <= 0) return 1;
  return clamp01((viewportHeight - top) / (viewportHeight * span));
}

/**
 * Progress through a tall pinned section, from its top edge to the point
 * where its last screenful has been scrolled past.
 */
export function pinnedProgress(opts: {
  top: number;
  height: number;
  viewportHeight: number;
  atPageBottom?: boolean;
}): number {
  const { top, height, viewportHeight, atPageBottom = false } = opts;
  if (atPageBottom) return 1;
  const travel = height - viewportHeight;
  if (travel <= 0) return clamp01((viewportHeight - top) / Math.max(1, viewportHeight));
  return clamp01(-top / travel);
}

/** Which of `count` equal steps a pinned section is showing. */
export function stepIndex(progress: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(clamp01(progress) * count)));
}

export interface CurvePoint {
  t: string;
  strat: number;
  bench: number;
}

/**
 * Even sample of a long curve, always keeping the final point.
 *
 * Dropping the last point would end the line on a value the backtest never
 * reported, which is the one number on the chart a reader might repeat.
 */
export function sampleCurve(raw: CurvePoint[], target: number): CurvePoint[] {
  if (raw.length <= target + 20) return raw;
  const step = raw.length / target;
  const out: CurvePoint[] = [];
  for (let i = 0; i < target; i++) out.push(raw[Math.floor(i * step)]);
  const last = raw[raw.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export interface CurveGeometry {
  strat: string;
  bench: string;
  area: string;
  xs: number[];
  ysS: number[];
  ysB: number[];
}

/**
 * SVG geometry for the equity curve.
 *
 * Both series share one scale. Drawing them on separate scales would let the
 * losing line sit above the winning one, which on this page would be a lie
 * told by arithmetic rather than by words.
 */
export function curveGeometry(
  points: CurvePoint[],
  width: number,
  height: number,
  pad: number,
): CurveGeometry {
  const values = points.flatMap((p) => [p.strat, p.bench]);
  const max = Math.max(...values);
  const min = Math.min(...values, 1);
  const span = max - min || 1;
  const n = Math.max(1, points.length - 1);
  const x = (i: number) => (i / n) * width;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const line = (key: "strat" | "bench") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const strat = line("strat");
  return {
    strat,
    bench: line("bench"),
    area: `${strat} L${width},${height} L0,${height} Z`,
    xs: points.map((_, i) => x(i)),
    ysS: points.map((p) => y(p.strat)),
    ysB: points.map((p) => y(p.bench)),
  };
}

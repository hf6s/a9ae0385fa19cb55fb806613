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

/**
 * Layout for the funnel: a dot per stock scanned, in a grid that fills the
 * given box.
 *
 * Deterministic, so the same scan always draws the same picture and a reader
 * scrolling back sees what they saw before.
 */
export function dotGrid(count: number, width: number, height: number, cols: number) {
  const rows = Math.ceil(count / cols);
  const cw = width / cols;
  const ch = height / Math.max(1, rows);
  const r = Math.max(1.1, Math.min(cw, ch) * 0.3);
  return {
    rows,
    r,
    points: Array.from({ length: count }, (_, i) => ({
      x: (i % cols) * cw + cw / 2,
      y: Math.floor(i / cols) * ch + ch / 2,
    })),
  };
}

/**
 * Which stocks are still lit at a given point in the funnel.
 *
 * Three stages share the scroll: everything scanned, everything that cleared
 * the filters, then the final list. The counts are the scan's real numbers,
 * so the picture cannot drift from what the site says it did.
 */
export function funnelStage(
  progress: number,
  counts: { scanned: number; passed: number; picked: number },
): { stage: 0 | 1 | 2; count: number; label: string; allOpacity: number; passOpacity: number; pickOpacity: number } {
  const p = clamp01(progress);
  if (p < 0.34) {
    return {
      stage: 0,
      count: counts.scanned,
      label: "scanned",
      allOpacity: 1,
      passOpacity: 0,
      pickOpacity: 0,
    };
  }
  if (p < 0.7) {
    return {
      stage: 1,
      count: counts.passed,
      label: "pass every filter",
      allOpacity: 0.14,
      passOpacity: 1,
      pickOpacity: 0,
    };
  }
  return {
    stage: 2,
    count: counts.picked,
    label: "make the list",
    allOpacity: 0.08,
    passOpacity: 0.22,
    pickOpacity: 1,
  };
}

/**
 * How much faster the ticker tape runs for a given scroll speed.
 *
 * Clamped hard at both ends. A trackpad fling or a momentum scroll on a phone
 * produces velocities an order of magnitude beyond anything a finger does, and
 * an unclamped multiplier turns the tape into a strobe.
 */
export function tapeRate(velocityPxPerMs: number): number {
  const v = Math.abs(velocityPxPerMs);
  if (!Number.isFinite(v)) return 1;
  return Math.min(6, 1 + v * 1.6);
}

/**
 * Move `current` toward `target` by at most `maxStep`.
 *
 * The speed limit behind the machine's scrub. iOS momentum covers a whole
 * pinned section in one flick, so the rendered progress chases the scrolled
 * progress at a capped rate rather than jumping to it — the page still moves
 * as fast as the thumb asks, the picture just refuses to skip.
 *
 * Never overshoots: arriving exactly is what stops the scene oscillating
 * around its own target forever.
 */
export function approach(current: number, target: number, maxStep: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return target;
  const step = Math.abs(maxStep);
  if (!Number.isFinite(step) || step <= 0) return current;
  const gap = target - current;
  if (Math.abs(gap) <= step) return target;
  return current + Math.sign(gap) * step;
}

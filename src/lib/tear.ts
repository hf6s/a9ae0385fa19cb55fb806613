/**
 * Dragging a paper receipt until the perforation gives way.
 *
 * Pure, because the failure modes here are not cosmetic. Too eager and the
 * page tears while someone is trying to scroll past it; too stubborn and the
 * payment button stays hidden behind a gesture nobody can complete. Both are
 * bugs in the one interaction the page is built around, so the arithmetic is
 * separated from the pointer handling and tested.
 */

export const TEAR_TRAVEL = 110;
/** Past this the tear completes on release; below it the paper springs back. */
export const TEAR_COMMIT = 0.55;
/** Under this a drag is a twitch, not an intent. */
export const TEAR_DEADZONE = 6;

/**
 * How far through the tear a drag of `dy` pixels is, from 0 to 1.
 *
 * Resistance rises as the perforation stretches: the first millimetres move
 * easily, the last need a real pull. That is what paper does, and it is what
 * stops an accidental brush from opening it.
 */
export function tearProgress(dy: number): number {
  if (dy <= TEAR_DEADZONE) return 0;
  const linear = Math.min(1, (dy - TEAR_DEADZONE) / TEAR_TRAVEL);
  // easeOutQuad on the way in, so the paper feels loose then stiff.
  return 1 - (1 - linear) ** 2;
}

/** Whether releasing at this progress should finish the tear. */
export function shouldCommit(progress: number): boolean {
  return progress >= TEAR_COMMIT;
}

/**
 * Whether a gesture belongs to the paper or to the page.
 *
 * A drag that is mostly sideways, or barely moved, is the reader scrolling or
 * fidgeting — the paper must not claim it, or the page becomes impossible to
 * scroll past on a phone.
 */
export function isTearGesture(dx: number, dy: number): boolean {
  if (dy <= TEAR_DEADZONE) return false;
  return Math.abs(dy) > Math.abs(dx) * 1.2;
}

/**
 * Vertical offset of the torn-away stub, in pixels.
 *
 * Accelerates once released so the stub falls with weight instead of sliding.
 */
export function stubOffset(progress: number, released: boolean): number {
  if (!released) return progress * 26;
  return 26 + progress * 120;
}

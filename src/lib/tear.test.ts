/**
 * The tear is the one interaction the page is built around, and both of its
 * failure modes are serious: tearing while someone tries to scroll past, or
 * refusing to tear and leaving the payment button behind a gesture that cannot
 * be completed. These pin both ends.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTearGesture,
  shouldCommit,
  stubOffset,
  TEAR_COMMIT,
  TEAR_DEADZONE,
  TEAR_TRAVEL,
  tearProgress,
} from "./tear";

describe("tearProgress", () => {
  it("ignores a twitch", () => {
    // A thumb resting on the paper moves a few pixels. That is not a tear.
    assert.equal(tearProgress(0), 0);
    assert.equal(tearProgress(3), 0);
    assert.equal(tearProgress(TEAR_DEADZONE), 0);
  });

  it("completes within a comfortable thumb drag", () => {
    // Beyond about 120px the gesture stops being one motion on a phone.
    assert.equal(tearProgress(TEAR_DEADZONE + TEAR_TRAVEL), 1);
    assert.ok(TEAR_TRAVEL <= 130, "travel longer than a thumb stroke");
  });

  it("never exceeds 1", () => {
    assert.equal(tearProgress(5000), 1);
  });

  it("rises monotonically", () => {
    let prev = -1;
    for (let dy = 0; dy < 200; dy += 4) {
      const p = tearProgress(dy);
      assert.ok(p >= prev, `progress went backwards at ${dy}`);
      prev = p;
    }
  });

  it("gives way early and stiffens late", () => {
    // Paper, not a slider: the first stretch should cover more ground than the
    // last, or the gesture feels like dragging a scrollbar.
    const first = tearProgress(TEAR_DEADZONE + TEAR_TRAVEL * 0.25);
    const last = 1 - tearProgress(TEAR_DEADZONE + TEAR_TRAVEL * 0.75);
    assert.ok(first > last, `no resistance curve: ${first} vs ${last}`);
  });

  it("handles a negative drag", () => {
    assert.equal(tearProgress(-40), 0);
  });
});

describe("shouldCommit", () => {
  it("springs back from a half-hearted pull", () => {
    assert.equal(shouldCommit(0), false);
    assert.equal(shouldCommit(TEAR_COMMIT - 0.01), false);
  });

  it("finishes once past the threshold", () => {
    assert.equal(shouldCommit(TEAR_COMMIT), true);
    assert.equal(shouldCommit(1), true);
  });

  it("commits well before the end of travel", () => {
    // Requiring the full stroke means a reader who pulls most of the way sees
    // the paper snap shut, which reads as the page refusing them.
    assert.ok(TEAR_COMMIT < 0.7, `commit threshold too strict: ${TEAR_COMMIT}`);
  });
});

describe("isTearGesture", () => {
  it("claims a downward pull", () => {
    assert.equal(isTearGesture(2, 40), true);
  });

  it("leaves a sideways swipe alone", () => {
    assert.equal(isTearGesture(60, 20), false);
  });

  it("leaves a diagonal closer to horizontal alone", () => {
    assert.equal(isTearGesture(40, 30), false);
  });

  it("ignores anything inside the deadzone", () => {
    assert.equal(isTearGesture(0, TEAR_DEADZONE), false);
  });

  it("does not claim an upward drag", () => {
    // Scrolling back up over the receipt must never tear it.
    assert.equal(isTearGesture(0, -80), false);
  });
});

describe("stubOffset", () => {
  it("barely moves while being pulled", () => {
    assert.ok(stubOffset(0.5, false) < 20);
  });

  it("falls away once released", () => {
    assert.ok(stubOffset(1, true) > stubOffset(1, false) * 3);
  });

  it("is continuous at the moment of release", () => {
    // A jump at release reads as a glitch rather than paper giving way.
    assert.equal(stubOffset(1, false), stubOffset(0, true));
  });
});

/**
 * The invoice page animates the amount being charged, so these are not
 * cosmetic assertions: each one pins a case where the page would otherwise
 * display a number that is simply wrong.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clamp01,
  dotGrid,
  funnelStage,
  pinnedProgress,
  scrubProgress,
  stepIndex,
  tapeRate,
} from "./scroll-math";

const VH = 800;

describe("scrubProgress", () => {
  it("shows nothing before the element reaches the viewport", () => {
    assert.equal(scrubProgress({ top: VH + 50, viewportHeight: VH }), 0);
  });

  it("completes while the element is still on screen, not after it leaves", () => {
    // Finishing off-screen means the reader never sees the count finish, and
    // worse, sees a wrong value the whole time it is visible.
    const p = scrubProgress({ top: VH * 0.5, viewportHeight: VH });
    assert.equal(p, 1, `expected a fully visible element to be done, got ${p}`);
  });

  it("rises monotonically as the element climbs the viewport", () => {
    let prev = -1;
    for (let top = VH; top >= 0; top -= 40) {
      const p = scrubProgress({ top, viewportHeight: VH });
      assert.ok(p >= prev, `progress went backwards at top=${top}`);
      prev = p;
    }
  });

  it("resolves at the end of the document", () => {
    // The regression: at the page bottom there is no scroll left to finish
    // with, and the invoice total froze at $108.75 of $114.99.
    const stuck = scrubProgress({ top: VH * 0.62, viewportHeight: VH, span: 0.45 });
    const fixed = scrubProgress({ top: VH * 0.62, viewportHeight: VH, atPageBottom: true });
    assert.ok(stuck < 1, "precondition: this position would not finish on its own");
    assert.equal(fixed, 1);
  });

  it("never exceeds 1, so a total cannot overshoot what is owed", () => {
    assert.equal(scrubProgress({ top: -5000, viewportHeight: VH }), 1);
  });

  it("does not divide by a zero viewport", () => {
    assert.equal(scrubProgress({ top: 0, viewportHeight: 0 }), 1);
  });
});

describe("pinnedProgress", () => {
  it("is 0 at the top of the section and 1 once its travel is used up", () => {
    assert.equal(pinnedProgress({ top: 0, height: 2400, viewportHeight: VH }), 0);
    assert.equal(pinnedProgress({ top: -1600, height: 2400, viewportHeight: VH }), 1);
  });

  it("is linear in between", () => {
    assert.equal(pinnedProgress({ top: -800, height: 2400, viewportHeight: VH }), 0.5);
  });

  it("still resolves when the section is shorter than the viewport", () => {
    // Short viewport-height sections have no travel; without a fallback the
    // curve would never draw at all on a tall desktop window.
    const p = pinnedProgress({ top: 0, height: 400, viewportHeight: VH });
    assert.ok(p > 0 && p <= 1, `expected progress, got ${p}`);
  });

  it("resolves at the end of the document", () => {
    assert.equal(pinnedProgress({ top: -10, height: 2400, viewportHeight: VH, atPageBottom: true }), 1);
  });
});

describe("stepIndex", () => {
  it("gives every step an equal share and never runs off the end", () => {
    assert.equal(stepIndex(0, 5), 0);
    assert.equal(stepIndex(0.19, 5), 0);
    assert.equal(stepIndex(0.21, 5), 1);
    assert.equal(stepIndex(1, 5), 4);
    assert.equal(stepIndex(1.5, 5), 4);
    assert.equal(stepIndex(-1, 5), 0);
  });
});

describe("clamp01", () => {
  it("bounds both ends", () => {
    assert.equal(clamp01(-3), 0);
    assert.equal(clamp01(0.4), 0.4);
    assert.equal(clamp01(9), 1);
  });
});

describe("dotGrid", () => {
  it("draws one dot per stock scanned", () => {
    assert.equal(dotGrid(905, 1000, 560, 38).points.length, 905);
  });

  it("keeps every dot inside the box", () => {
    const g = dotGrid(905, 1000, 560, 38);
    for (const p of g.points) {
      assert.ok(p.x >= 0 && p.x <= 1000, `dot escaped horizontally at ${p.x}`);
      assert.ok(p.y >= 0 && p.y <= 560, `dot escaped vertically at ${p.y}`);
    }
  });

  it("is deterministic, so scrolling back shows the same picture", () => {
    assert.deepEqual(dotGrid(905, 1000, 560, 38).points, dotGrid(905, 1000, 560, 38).points);
  });

  it("keeps dots visible rather than sub-pixel on a crowded grid", () => {
    assert.ok(dotGrid(5000, 1000, 560, 38).r >= 1.1);
  });

  it("survives an empty scan", () => {
    const g = dotGrid(0, 1000, 560, 38);
    assert.equal(g.points.length, 0);
    assert.ok(Number.isFinite(g.r));
  });
});

describe("funnelStage", () => {
  const counts = { scanned: 905, passed: 136, picked: 20 };

  it("counts down through the real scan numbers", () => {
    assert.equal(funnelStage(0, counts).count, 905);
    assert.equal(funnelStage(0.5, counts).count, 136);
    assert.equal(funnelStage(1, counts).count, 20);
  });

  it("only ever dims the earlier layers, never hides the final one", () => {
    // The last stage is the point of the whole section; if its opacity could
    // reach 0 the reader would scroll through to an empty box.
    for (const p of [0, 0.2, 0.34, 0.5, 0.7, 0.9, 1]) {
      const st = funnelStage(p, counts);
      assert.ok(st.allOpacity >= 0 && st.allOpacity <= 1);
      if (st.stage === 2) assert.equal(st.pickOpacity, 1);
    }
  });

  it("clamps out-of-range progress instead of inventing a fourth stage", () => {
    assert.equal(funnelStage(-2, counts).stage, 0);
    assert.equal(funnelStage(99, counts).stage, 2);
  });

  it("labels each stage with what the number means", () => {
    assert.match(funnelStage(0, counts).label, /scanned/);
    assert.match(funnelStage(0.5, counts).label, /filter/);
    assert.match(funnelStage(1, counts).label, /list/);
  });
});

describe("tapeRate", () => {
  it("idles at 1 when nothing is scrolling", () => {
    assert.equal(tapeRate(0), 1);
  });

  it("speeds up with scroll", () => {
    assert.ok(tapeRate(1) > tapeRate(0.2));
  });

  it("treats scrolling up the same as down", () => {
    assert.equal(tapeRate(-2), tapeRate(2));
  });

  it("clamps a fling instead of strobing", () => {
    // Momentum scrolling reaches velocities a finger never does.
    assert.equal(tapeRate(9999), 6);
  });

  it("survives a non-finite velocity", () => {
    // Two scroll events in the same millisecond divide by zero.
    assert.equal(tapeRate(Number.POSITIVE_INFINITY), 1);
    assert.equal(tapeRate(Number.NaN), 1);
  });
});

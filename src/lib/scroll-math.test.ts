/**
 * The invoice page animates the amount being charged, so these are not
 * cosmetic assertions: each one pins a case where the page would otherwise
 * display a number that is simply wrong.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clamp01,
  curveGeometry,
  pinnedProgress,
  sampleCurve,
  scrubProgress,
  stepIndex,
  type CurvePoint,
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

describe("sampleCurve", () => {
  const raw: CurvePoint[] = Array.from({ length: 3497 }, (_, i) => ({
    t: `2012-09-${i}`,
    strat: 1 + i / 1000,
    bench: 1 + i / 900,
  }));

  it("keeps the true final value", () => {
    // The end of the line is the one number a reader might quote.
    const s = sampleCurve(raw, 200);
    assert.deepEqual(s[s.length - 1], raw[raw.length - 1]);
  });

  it("starts where the real curve starts", () => {
    assert.deepEqual(sampleCurve(raw, 200)[0], raw[0]);
  });

  it("cuts the payload to roughly the requested size", () => {
    const s = sampleCurve(raw, 200);
    assert.ok(s.length <= 201, `expected ~200 points, got ${s.length}`);
  });

  it("leaves a short curve alone", () => {
    const short = raw.slice(0, 50);
    assert.equal(sampleCurve(short, 200), short);
  });

  it("preserves order", () => {
    const s = sampleCurve(raw, 200);
    for (let i = 1; i < s.length; i++) assert.ok(s[i].strat > s[i - 1].strat);
  });
});

describe("curveGeometry", () => {
  const points: CurvePoint[] = [
    { t: "2012-09-28", strat: 1, bench: 1 },
    { t: "2019-01-01", strat: 3, bench: 4 },
    { t: "2026-08-27", strat: 6.3287, bench: 6.7923 },
  ];
  const g = curveGeometry(points, 1000, 420, 10);

  it("spans the full width", () => {
    assert.equal(g.xs[0], 0);
    assert.equal(g.xs[g.xs.length - 1], 1000);
  });

  it("puts the two series on ONE scale", () => {
    // Separate scales would let the losing line sit above the winning one:
    // a lie told with arithmetic instead of words. The benchmark ends higher,
    // so on screen it must sit higher, which is a SMALLER y.
    const lastS = g.ysS[g.ysS.length - 1];
    const lastB = g.ysB[g.ysB.length - 1];
    assert.ok(lastB < lastS, `benchmark ends higher in value, so must plot above: ${lastB} vs ${lastS}`);
  });

  it("keeps every point inside the box", () => {
    for (const y of [...g.ysS, ...g.ysB]) {
      assert.ok(y >= 10 && y <= 410, `point escaped the chart at y=${y}`);
    }
  });

  it("grows downward-in-screen-space as value falls", () => {
    assert.ok(g.ysS[0] > g.ysS[2], "a rising series must climb the screen");
  });

  it("closes the area path so the fill cannot bleed", () => {
    assert.ok(g.area.startsWith("M"), "area must start with a move");
    assert.ok(g.area.endsWith("Z"), "area must be closed");
  });

  it("survives a flat curve without dividing by zero", () => {
    const flat = curveGeometry(
      [
        { t: "a", strat: 1, bench: 1 },
        { t: "b", strat: 1, bench: 1 },
      ],
      1000,
      420,
      10,
    );
    for (const y of [...flat.ysS, ...flat.ysB]) assert.ok(Number.isFinite(y), "flat curve produced NaN");
  });

  it("survives a single point", () => {
    const one = curveGeometry([{ t: "a", strat: 1, bench: 1 }], 1000, 420, 10);
    assert.ok(Number.isFinite(one.xs[0]));
  });
});

describe("clamp01", () => {
  it("bounds both ends", () => {
    assert.equal(clamp01(-3), 0);
    assert.equal(clamp01(0.4), 0.4);
    assert.equal(clamp01(9), 1);
  });
});

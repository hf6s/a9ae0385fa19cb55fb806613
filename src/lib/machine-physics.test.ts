/**
 * The machine simulation.
 *
 * These are not decorative assertions. The scene is scrubbed by scroll, and a
 * simulation that is not perfectly reproducible shows the reader a different
 * pile every time they scroll back — which reads as the page being broken.
 * Determinism, conservation and bounds are the contract.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignRoles,
  bakeBytes,
  DEFAULT_CONFIG,
  measurePileTop,
  mulberry32,
  readFrame,
  ROLE_SURVIVOR,
  simulate,
  type MachineConfig,
} from "./machine-physics";

/** The live scan's real shape, shrunk so the suite stays fast. */
const cfg = (over: Partial<MachineConfig> = {}): MachineConfig => ({
  ...DEFAULT_CONFIG,
  count: 300,
  passed: 45,
  ...over,
});

describe("mulberry32", () => {
  it("is deterministic for a seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i++) assert.equal(a(), b());
  });

  it("differs between seeds", () => {
    assert.notEqual(mulberry32(1)(), mulberry32(2)());
  });

  it("stays inside [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
  });
});

describe("assignRoles", () => {
  it("gives exactly the real number of survivors", () => {
    // The count of survivors is a figure printed on screen. If this drifts,
    // the picture contradicts the number next to it.
    const roles = assignRoles(905, 136);
    const survivors = [...roles].filter((r) => r === ROLE_SURVIVOR).length;
    assert.equal(survivors, 136);
  });

  it("spreads survivors through the field rather than clustering them", () => {
    const roles = assignRoles(905, 136);
    const first = [...roles].slice(0, 200).filter((r) => r === ROLE_SURVIVOR).length;
    const last = [...roles].slice(-200).filter((r) => r === ROLE_SURVIVOR).length;
    assert.ok(first > 10 && last > 10, `clustered: ${first} early vs ${last} late`);
  });

  it("assigns every reject to one of the three gates", () => {
    const roles = assignRoles(400, 40);
    for (const r of roles) assert.ok(r >= 0 && r <= 3, `bad role ${r}`);
    for (let gate = 0; gate < 3; gate++) {
      assert.ok([...roles].some((r) => r === gate), `gate ${gate} rejects nothing`);
    }
  });

  it("handles nobody passing", () => {
    const roles = assignRoles(50, 0);
    assert.equal([...roles].filter((r) => r === ROLE_SURVIVOR).length, 0);
  });

  it("handles everybody passing without overflowing", () => {
    const roles = assignRoles(50, 999);
    assert.equal([...roles].filter((r) => r === ROLE_SURVIVOR).length, 50);
  });
});

describe("simulate", () => {
  it("produces byte-identical output for the same seed", () => {
    // The property the whole scrub design rests on.
    const a = simulate(cfg());
    const b = simulate(cfg());
    assert.deepEqual(Buffer.from(a.data.buffer), Buffer.from(b.data.buffer));
  });

  it("produces a different scene for a different seed", () => {
    const a = simulate(cfg());
    const b = simulate(cfg({ seed: 99 }));
    assert.notDeepEqual(Buffer.from(a.data.buffer), Buffer.from(b.data.buffer));
  });

  it("never loses a particle", () => {
    const bake = simulate(cfg());
    assert.equal(bake.data.length, bake.frames * bake.count * 3);
    assert.equal(bake.roles.length, bake.count);
  });

  it("emits no NaN or Infinity anywhere", () => {
    // One NaN position poisons a GPU buffer and blanks the whole canvas.
    const bake = simulate(cfg());
    for (let i = 0; i < bake.data.length; i++) {
      assert.ok(Number.isFinite(bake.data[i]), `non-finite at ${i}: ${bake.data[i]}`);
    }
  });

  it("keeps every particle inside the world box", () => {
    const bake = simulate(cfg());
    for (let f = 0; f < bake.frames; f++) {
      for (let i = 0; i < bake.count; i++) {
        const o = (f * bake.count + i) * 3;
        const x = bake.data[o];
        const y = bake.data[o + 1];
        assert.ok(x >= 0 && x <= bake.width, `x escaped: ${x}`);
        assert.ok(y <= bake.height, `y fell through the floor: ${y}`);
      }
    }
  });

  it("keeps alpha in range", () => {
    const bake = simulate(cfg());
    for (let f = 0; f < bake.frames; f++) {
      for (let i = 0; i < bake.count; i++) {
        const a = bake.data[(f * bake.count + i) * 3 + 2];
        assert.ok(a >= 0 && a <= 1, `alpha out of range: ${a}`);
      }
    }
  });

  it("ends with survivors above the pile, not in it", () => {
    // The point of the whole sequence: what survived is visibly separate from
    // what was thrown away.
    const bake = simulate(cfg());
    const last = (bake.frames - 1) * bake.count * 3;
    let survivorY = 0;
    let survivors = 0;
    let rejectY = 0;
    let rejects = 0;
    for (let i = 0; i < bake.count; i++) {
      const y = bake.data[last + i * 3 + 1];
      if (bake.roles[i] === ROLE_SURVIVOR) {
        survivorY += y;
        survivors++;
      } else {
        rejectY += y;
        rejects++;
      }
    }
    const meanSurvivor = survivorY / survivors;
    const meanReject = rejectY / rejects;
    assert.ok(
      meanSurvivor < meanReject - 100,
      `survivors should sit well above the pile: ${meanSurvivor} vs ${meanReject}`,
    );
  });

  it("keeps EVERY survivor above the highest piece of debris", () => {
    // The mean-based check above passed while the tallest debris still poked
    // above the survivor band: an estimate of pile height was wrong by a
    // factor of three. Survivors sitting level with the scrap is the one thing
    // this whole sequence exists to avoid, so it is asserted against the
    // summit, not the average.
    const bake = simulate(cfg());
    const last = (bake.frames - 1) * bake.count * 3;
    let lowestSurvivor = -Infinity;
    let highestDebris = Infinity;
    for (let i = 0; i < bake.count; i++) {
      const y = bake.data[last + i * 3 + 1];
      if (bake.roles[i] === ROLE_SURVIVOR) lowestSurvivor = Math.max(lowestSurvivor, y);
      else highestDebris = Math.min(highestDebris, y);
    }
    assert.ok(
      lowestSurvivor < highestDebris,
      `debris reaches ${highestDebris}, survivors sink to ${lowestSurvivor}`,
    );
  });

  it("measures the pile summit rather than guessing it", () => {
    const config = cfg();
    const top = measurePileTop(config);
    const bake = simulate(config);
    const last = (bake.frames - 1) * bake.count * 3;
    let highestDebris = Infinity;
    for (let i = 0; i < bake.count; i++) {
      if (bake.roles[i] !== ROLE_SURVIVOR) {
        highestDebris = Math.min(highestDebris, bake.data[last + i * 3 + 1]);
      }
    }
    // The pre-pass must agree with the real run within a particle's radius,
    // or the holding band is placed against a fiction.
    assert.ok(
      Math.abs(top - highestDebris) < 6,
      `pre-pass says ${top}, real run settled at ${highestDebris}`,
    );
  });

  it("settles the rejects into an uneven pile", () => {
    // A pile of identical steps is a staircase. The unevenness is the
    // hand-tuned detail that stops it reading as generated.
    const bake = simulate(cfg());
    const last = (bake.frames - 1) * bake.count * 3;
    const heights: number[] = [];
    for (let i = 0; i < bake.count; i++) {
      if (bake.roles[i] !== ROLE_SURVIVOR) heights.push(bake.data[last + i * 3 + 1]);
    }
    const mean = heights.reduce((s, v) => s + v, 0) / heights.length;
    const variance = heights.reduce((s, v) => s + (v - mean) ** 2, 0) / heights.length;
    assert.ok(variance > 50, `pile is suspiciously flat, variance ${variance}`);
  });

  it("starts with the field empty and fills it", () => {
    const bake = simulate(cfg());
    const alphaAt = (f: number) => {
      let sum = 0;
      for (let i = 0; i < bake.count; i++) sum += bake.data[(f * bake.count + i) * 3 + 2];
      return sum;
    };
    assert.ok(alphaAt(0) < alphaAt(bake.frames - 1), "field never fills");
  });

  it("survives a zero-particle scan without throwing", () => {
    const bake = simulate(cfg({ count: 0, passed: 0 }));
    assert.equal(bake.data.length, 0);
  });

  it("survives more survivors than particles", () => {
    const bake = simulate(cfg({ count: 20, passed: 999 }));
    assert.equal([...bake.roles].filter((r) => r === ROLE_SURVIVOR).length, 20);
  });

  it("bakes the real scan inside a boot sequence", () => {
    // It runs behind the 2.6s curtain, so it has a budget. Generous here
    // because CI machines are slower than phones are fast.
    const started = Date.now();
    simulate({ ...DEFAULT_CONFIG, count: 905, passed: 136 });
    const ms = Date.now() - started;
    assert.ok(ms < 2000, `bake took ${ms}ms, too slow to hide behind the boot`);
  });
});

describe("readFrame", () => {
  const bake = simulate(cfg());
  const out = new Float32Array(bake.count * 3);

  it("returns the first frame at t=0", () => {
    readFrame(bake, 0, out);
    for (let k = 0; k < out.length; k++) assert.equal(out[k], bake.data[k]);
  });

  it("returns the last frame at t=1", () => {
    readFrame(bake, 1, out);
    const base = (bake.frames - 1) * bake.count * 3;
    for (let k = 0; k < out.length; k++) assert.equal(out[k], bake.data[base + k]);
  });

  it("clamps outside the range instead of reading past the buffer", () => {
    const low = readFrame(bake, -5, new Float32Array(out.length)).slice();
    const high = readFrame(bake, 5, new Float32Array(out.length)).slice();
    assert.deepEqual(low, readFrame(bake, 0, new Float32Array(out.length)).slice());
    assert.deepEqual(high, readFrame(bake, 1, new Float32Array(out.length)).slice());
  });

  it("gives the same answer scrolling backwards as forwards", () => {
    // Scrubbing up must retrace the path exactly, which is the entire reason
    // the physics is baked instead of run live.
    const forwards: Float32Array[] = [];
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      forwards.push(readFrame(bake, t, new Float32Array(out.length)).slice());
    }
    const backwards: Float32Array[] = [];
    for (const t of [0.8, 0.6, 0.4, 0.2]) {
      backwards.push(readFrame(bake, t, new Float32Array(out.length)).slice());
    }
    backwards.reverse();
    for (let i = 0; i < forwards.length; i++) assert.deepEqual(forwards[i], backwards[i]);
  });

  it("interpolates between keyframes rather than snapping", () => {
    const a = readFrame(bake, 0, new Float32Array(out.length)).slice();
    const b = readFrame(bake, 1 / (bake.frames - 1), new Float32Array(out.length)).slice();
    const mid = readFrame(bake, 0.5 / (bake.frames - 1), new Float32Array(out.length)).slice();
    let moved = 0;
    for (let k = 0; k < a.length; k += 3) {
      if (a[k] !== b[k]) {
        const between = (mid[k] - a[k]) / (b[k] - a[k]);
        assert.ok(between > 0.4 && between < 0.6, `not interpolated: ${between}`);
        moved++;
        if (moved > 5) break;
      }
    }
    assert.ok(moved > 0, "nothing moved between the first two frames");
  });

  it("emits no NaN when interpolating", () => {
    readFrame(bake, 0.37, out);
    for (const v of out) assert.ok(Number.isFinite(v));
  });
});

describe("bakeBytes", () => {
  it("reports the real memory cost", () => {
    // 905 particles, 240 frames: about 2.6MB held in memory, nothing shipped.
    const mb = bakeBytes(905, 240) / (1024 * 1024);
    assert.ok(mb > 2 && mb < 3.5, `unexpected bake size: ${mb}MB`);
  });
});

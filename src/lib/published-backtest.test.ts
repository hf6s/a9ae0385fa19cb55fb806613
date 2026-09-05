/**
 * The published backtest must describe the strategy the live site runs.
 *
 * WHY THIS EXISTS. data/backtest.json is read by the homepage for its
 * performance claim and by /backtest for the full results. Every experimental
 * run used to write that same file, so the published numbers silently became
 * whichever configuration ran last. A 2x leveraged run reading 20.7% a year
 * did land there, while the file's own strategy text still said "quarterly
 * rebalance", and it was one commit away from being advertised as what the app
 * does. An unreviewed 11.3% run landed there later by a route nobody could
 * reconstruct.
 *
 * Scripts now need --out for experiments, but that is a convention and
 * conventions get forgotten at 2am. This is the part that cannot be forgotten:
 * if the published file does not match the live engine, the build fails.
 *
 * If the live strategy is ever deliberately changed, change it HERE too, in
 * the same commit. That is the point: the change becomes visible in review
 * instead of arriving as a number nobody chose.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_WEIGHTS } from "./scoring";

/** What the live scan and ranking actually do. */
const LIVE_CONFIG = {
  topN: 20,
  exitRank: 20,
  maxPerSector: 0,
  rebalanceDays: 63, // quarterly
  cashWhenBear: false,
  leverage: 1,
  filters: { currentRatio: true, trend: true, exemptFinancials: false },
};

function published(): {
  generatedAt: string;
  strategy: string;
  stats: Record<string, unknown> & {
    cagr: number;
    benchCagr: number;
    weights: Record<string, number>;
    filters: Record<string, boolean>;
  };
} {
  const p = path.join(process.cwd(), "data", "backtest.json");
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

describe("the published backtest matches the live strategy", () => {
  it("was produced by an unlevered, un-timed, quarterly top-20 run", () => {
    const s = published().stats;
    for (const [key, want] of Object.entries(LIVE_CONFIG)) {
      if (key === "filters") continue;
      assert.deepEqual(
        s[key],
        want,
        `data/backtest.json reports ${key}=${JSON.stringify(s[key])} but the live app uses ` +
          `${JSON.stringify(want)}. An experimental run has overwritten the published result. ` +
          `Re-run "npm run backtest" with no flags, or pass --out for experiments.`,
      );
    }
  });

  it("used the live filter settings, not a relaxed variant", () => {
    assert.deepEqual(published().stats.filters, LIVE_CONFIG.filters);
  });

  it("used the live factor weights", () => {
    // The file stores percentages, DEFAULT_WEIGHTS holds fractions, so compare
    // on a common scale rather than shape. DEFAULT_WEIGHTS stays the source of
    // truth: retune the model and this fails until the backtest is re-run.
    const asPercent = Object.fromEntries(
      Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, Math.round(v * 100)]),
    );
    assert.deepEqual(
      published().stats.weights,
      asPercent,
      "the published backtest used different factor weights than the live model",
    );
  });

  it("does not advertise a return the strategy did not earn", () => {
    // A guard against the specific failure that nearly shipped: a leveraged
    // run's CAGR sitting under a "quarterly rebalance" description. Anything
    // far above the benchmark from this model would be extraordinary and is
    // far more likely to be a stray configuration.
    const { cagr, benchCagr } = published().stats;
    assert.ok(
      cagr < benchCagr + 5,
      `published CAGR ${cagr}% exceeds the benchmark ${benchCagr}% by more than 5 points. ` +
        `No configuration of this model has ever done that unlevered, so this is almost ` +
        `certainly a leveraged or otherwise experimental run reaching the published file.`,
    );
  });

  it("describes itself as the quarterly model, consistently with its own numbers", () => {
    const { strategy, stats } = published();
    if (/quarterly/i.test(strategy)) {
      assert.equal(
        stats.rebalanceDays,
        63,
        "the strategy text says quarterly but the stats say otherwise: the file is " +
          "internally inconsistent, which is what a partial overwrite looks like",
      );
    }
  });
});

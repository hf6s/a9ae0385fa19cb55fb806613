/**
 * Pins the difference between a portfolio that drifts and one rebalanced daily.
 *
 * The backtest averaged daily returns equally, which assumes a daily rebalance
 * back to equal weight: turnover nobody pays, and on volatile names it invents
 * return out of noise. These cases encode the correct behaviour so it cannot
 * quietly regress.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Equal-weight, rebalanced every day (the old, wrong behaviour). */
function dailyRebalanced(series: number[][]): number {
  let level = 1;
  for (let i = 1; i < series[0].length; i++) {
    let sum = 0;
    for (const s of series) sum += s[i] / s[i - 1] - 1;
    level *= 1 + sum / series.length;
  }
  return level;
}

/** Equal-weight at the start, then left to drift (buy and hold). */
function drifting(series: number[][]): number {
  let w = series.map(() => 1 / series.length);
  let level = 1;
  for (let i = 1; i < series[0].length; i++) {
    let ret = 0;
    for (let k = 0; k < series.length; k++) ret += w[k] * (series[k][i] / series[k][i - 1] - 1);
    level *= 1 + ret;
    let tot = 0;
    for (let k = 0; k < series.length; k++) {
      w[k] *= series[k][i] / series[k][i - 1];
      tot += w[k];
    }
    w = w.map((x) => x / tot);
  }
  return level;
}

describe("drift vs daily rebalancing", () => {
  it("agree when prices move together", () => {
    const a = [100, 110, 121];
    const b = [50, 55, 60.5];
    assert.ok(Math.abs(dailyRebalanced([a, b]) - drifting([a, b])) < 1e-9);
  });

  it("diverge on volatile, oscillating prices — the bias that inflated results", () => {
    // Two stocks whipsawing in opposite directions and ending where they began.
    const a = [100, 150, 100, 150, 100];
    const b = [100, 50, 100, 50, 100];
    const daily = dailyRebalanced([a, b]);
    const drift = drifting([a, b]);
    // Buy and hold ends flat, since both stocks end where they started.
    assert.ok(Math.abs(drift - 1) < 0.02, `drift should end ~flat, got ${drift}`);
    // Daily rebalancing harvests the oscillation and shows a large fake gain.
    assert.ok(daily > drift * 1.2, `daily rebalance should look inflated, got ${daily}`);
  });

  it("lets a winner grow into a larger share of the portfolio", () => {
    const winner = [100, 200, 400];
    const flat = [100, 100, 100];
    // Drifting keeps more of the winner's compounding than a daily reset does.
    assert.ok(drifting([winner, flat]) > dailyRebalanced([winner, flat]));
  });
});

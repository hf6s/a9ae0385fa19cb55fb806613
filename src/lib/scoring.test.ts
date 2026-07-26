/**
 * Tests for the scoring engine.
 *
 * This file decides every ranking on the site, and it had no tests. The split
 * bug proved why that matters: raw closes silently corrupted every momentum
 * score for weeks and only a manual spot check caught it. These cases pin the
 * behaviour that must not drift.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeFactorScores,
  computePenalties,
  edgarFilter,
  finalScore,
  sectorMedianGrossMargins,
  stage1Filter,
  type StockInput,
} from "./scoring";

/** A stock that comfortably passes everything; override to test one rule. */
function stock(overrides: Partial<StockInput> = {}): StockInput {
  const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.5); // steady uptrend
  return {
    ticker: "TEST",
    name: "Test Corp",
    sector: "Technology",
    price: 250,
    marketCap: 50_000,
    avgDollarVolume: 100_000_000,
    closes,
    spxCloses: Array.from({ length: 300 }, (_, i) => 1000 + i),
    currentRatio: 2,
    interestCoverage: 10,
    netMargin: 15,
    grossMargin: 50,
    operatingMargin: 20,
    roe: 25,
    roic: 20,
    debtToEquity: 0.5,
    pe: 20,
    pb: 3,
    ps: 5,
    pfcf: 25,
    evToEbitda: 12,
    revenueGrowth: 10,
    epsGrowth: 12,
    revenuePerShare: 40,
    latestSurprisePct: 5,
    altmanZ: 5,
    piotroskiF: 8,
    accrualRatio: 0.02,
    fcfGrowth: 8,
    grossProfitToAssets: 30,
    debtToEbitda: 1.5,
    insiderBought: 1000,
    insiderSold: 500,
    ...overrides,
  };
}

describe("stage1Filter", () => {
  it("passes a healthy, liquid, uptrending stock", () => {
    assert.equal(stage1Filter(stock()).passed, true);
  });

  it("rejects small caps, illiquid names and penny stocks", () => {
    assert.match(stage1Filter(stock({ marketCap: 1_500 })).failures.join(), /market cap/);
    assert.match(stage1Filter(stock({ avgDollarVolume: 1e6 })).failures.join(), /dollar volume/);
    assert.match(stage1Filter(stock({ price: 5 })).failures.join(), /price/);
  });

  it("rejects unprofitable companies", () => {
    assert.match(stage1Filter(stock({ netMargin: -5 })).failures.join(), /negative net income/);
  });

  it("rejects downtrends: price under the 200-day average", () => {
    const falling = Array.from({ length: 300 }, (_, i) => 300 - i * 0.5);
    assert.match(stage1Filter(stock({ closes: falling })).failures.join(), /200-day MA/);
  });

  it("applies health filters only when the data exists", () => {
    // Nulls must not fail a stock; the free tier legitimately lacks these.
    const noData = stock({ currentRatio: null, interestCoverage: null, netMargin: null });
    assert.equal(stage1Filter(noData).passed, true);
    // Present-but-bad must fail.
    assert.equal(stage1Filter(stock({ currentRatio: 0.9 })).passed, false);
  });
});

describe("edgarFilter", () => {
  it("rejects heavy debt and distress scores", () => {
    assert.equal(edgarFilter(stock({ debtToEbitda: 4 })).passed, false);
    assert.equal(edgarFilter(stock({ altmanZ: 1.5 })).passed, false);
  });

  it("passes when the values are missing", () => {
    assert.equal(edgarFilter(stock({ debtToEbitda: null, altmanZ: null })).passed, true);
  });
});

describe("computeFactorScores", () => {
  it("ranks a better stock above a worse one on every factor", () => {
    const strong = stock({ ticker: "STRONG", roic: 40, roe: 40, pe: 8, revenueGrowth: 30 });
    const weak = stock({ ticker: "WEAK", roic: 2, roe: 2, pe: 60, revenueGrowth: 1 });
    const [a, b] = computeFactorScores([strong, weak]);
    assert.ok(a.quality > b.quality, "quality should favour the stronger stock");
    assert.ok(a.value > b.value, "lower P/E should score higher on value");
    assert.ok(a.growth > b.growth, "faster growth should score higher");
  });

  it("keeps every score inside 0-100", () => {
    const universe = [stock({ roic: 99 }), stock({ roic: 1 }), stock({ roic: 50 })];
    for (const s of computeFactorScores(universe)) {
      for (const v of Object.values(s)) {
        assert.ok(v >= 0 && v <= 100, `score ${v} out of range`);
      }
    }
  });

  it("gives a neutral 50 when a factor has no usable data at all", () => {
    const blank = { pe: null, pfcf: null, evToEbitda: null, pb: null, ps: null };
    const [a] = computeFactorScores([stock(blank), stock(blank)]);
    assert.equal(a.value, 50);
  });

  it("rewards momentum: a riser outranks a faller", () => {
    const rising = stock({
      ticker: "UP",
      closes: Array.from({ length: 300 }, (_, i) => 100 + i),
    });
    const falling = stock({
      ticker: "DOWN",
      closes: Array.from({ length: 300 }, (_, i) => 400 - i),
    });
    const [up, down] = computeFactorScores([rising, falling]);
    assert.ok(up.momentum > down.momentum);
  });
});

describe("computePenalties", () => {
  it("penalises heavy leverage", () => {
    const p = computePenalties(stock({ debtToEquity: 3 }));
    assert.equal(p.find((x) => x.reason.includes("Debt/Equity"))?.points, 20);
  });

  it("penalises lopsided insider selling", () => {
    const p = computePenalties(stock({ insiderBought: 100, insiderSold: 10_000 }));
    assert.ok(p.some((x) => x.reason.includes("Insider")));
  });

  it("penalises a big earnings miss and weak Piotroski", () => {
    assert.ok(computePenalties(stock({ latestSurprisePct: -30 })).some((x) => x.points === 15));
    assert.ok(computePenalties(stock({ piotroskiF: 3 })).some((x) => x.points === 10));
  });

  it("leaves a clean stock unpenalised", () => {
    assert.deepEqual(computePenalties(stock()), []);
  });
});

describe("finalScore", () => {
  it("weights the factors 30/25/25/20", () => {
    const scores = { quality: 100, value: 0, momentum: 0, growth: 0 };
    assert.equal(finalScore(scores, []), 30);
    assert.equal(finalScore({ quality: 0, value: 100, momentum: 0, growth: 0 }, []), 25);
    assert.equal(finalScore({ quality: 0, value: 0, momentum: 100, growth: 0 }, []), 25);
    assert.equal(finalScore({ quality: 0, value: 0, momentum: 0, growth: 100 }, []), 20);
  });

  it("subtracts penalties and never goes below zero", () => {
    const perfect = { quality: 100, value: 100, momentum: 100, growth: 100 };
    assert.equal(finalScore(perfect, [{ reason: "x", points: 20 }]), 80);
    assert.equal(finalScore({ quality: 5, value: 5, momentum: 5, growth: 5 }, [
      { reason: "x", points: 99 },
    ]), 0);
  });
});

describe("sectorMedianGrossMargins", () => {
  it("computes a median per sector, not across the whole universe", () => {
    const medians = sectorMedianGrossMargins([
      stock({ sector: "Tech", grossMargin: 60 }),
      stock({ sector: "Tech", grossMargin: 80 }),
      stock({ sector: "Retail", grossMargin: 10 }),
      stock({ sector: "Retail", grossMargin: 20 }),
    ]);
    assert.equal(medians.get("Tech"), 70);
    assert.equal(medians.get("Retail"), 15);
  });

  it("ignores stocks with no margin data", () => {
    const medians = sectorMedianGrossMargins([
      stock({ sector: "Tech", grossMargin: 50 }),
      stock({ sector: "Tech", grossMargin: null }),
    ]);
    assert.equal(medians.get("Tech"), 50);
  });
});

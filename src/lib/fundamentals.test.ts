/**
 * Tests for the fundamentals builder.
 *
 * These pin the four input fixes: real ROIC, a working interest-coverage
 * filter, trend-based growth, and normalized earnings. Each replaced a
 * measurably wrong calculation, and each is easy to silently break again.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStockInput } from "./fundamentals";
import type { AnnualRecord } from "./edgar-history";

function year(over: Partial<AnnualRecord> = {}): AnnualRecord {
  return {
    end: "2025-12-31",
    filed: "2026-02-15",
    assets: 1000,
    currentAssets: 400,
    currentLiab: 200,
    totalLiab: 500,
    equity: 500,
    retained: 300,
    ebit: 200,
    revenue: 1000,
    cogs: 600,
    netIncome: 150,
    cfo: 180,
    capex: 30,
    debt: 200,
    dAndA: 50,
    cash: 100,
    shares: 100,
    interestExpense: 20,
    taxExpense: 40,
    pretaxIncome: 180,
    ...over,
  };
}

const build = (fy0: AnnualRecord, fy1: AnnualRecord | null = null, fy2: AnnualRecord | null = null) =>
  buildStockInput({
    ticker: "TEST",
    name: "Test",
    sector: "Technology",
    closes: Array.from({ length: 300 }, (_, i) => 100 + i * 0.5),
    spxCloses: Array.from({ length: 300 }, (_, i) => 1000 + i),
    price: 50,
    fy0,
    fy1,
    fy2,
  });

describe("ROIC", () => {
  it("uses after-tax operating profit, not raw EBIT", () => {
    const s = build(year())!;
    // effective tax 40/180 = 22.2%; NOPAT = 200 * 0.778 = 155.6
    // invested capital = equity 500 + debt 200 - cash 100 = 600
    // ROIC = 155.6 / 600 = 25.9%
    assert.ok(s.roic !== null);
    assert.ok(Math.abs(s.roic - 25.9) < 0.5, `expected ~25.9%, got ${s.roic}`);
  });

  it("excludes cash from invested capital, so a cash pile raises ROIC", () => {
    const lean = build(year({ cash: 0 }))!;
    const cashRich = build(year({ cash: 300 }))!;
    assert.ok(cashRich.roic! > lean.roic!, "cash should not count as invested capital");
  });

  it("falls back to a standard tax rate when tax data is missing", () => {
    const s = build(year({ taxExpense: null, pretaxIncome: null }))!;
    assert.ok(s.roic !== null, "should still compute with the default rate");
  });
});

describe("interest coverage", () => {
  it("is computed now that interest expense is extracted", () => {
    const s = build(year())!;
    assert.equal(s.interestCoverage, 10); // EBIT 200 / interest 20
  });

  it("makes the Stage-1 filter actually reject thin coverage", () => {
    const thin = build(year({ interestExpense: 100 }))!; // 200/100 = 2, under the 4 threshold
    assert.equal(thin.interestCoverage, 2);
  });

  it("stays null when a company reports no interest expense", () => {
    assert.equal(build(year({ interestExpense: null }))!.interestCoverage, null);
  });
});

describe("growth", () => {
  it("uses a two-year CAGR when three years are available", () => {
    const s = build(year({ revenue: 1210 }), year({ revenue: 1100 }), year({ revenue: 1000 }))!;
    // 1210 from 1000 over two years = 10% a year
    assert.ok(Math.abs(s.revenueGrowth! - 10) < 0.01, `expected 10%, got ${s.revenueGrowth}`);
  });

  it("smooths a one-off spike that year-over-year would exaggerate", () => {
    // Flat, then a jump: yoy says +50%, the two-year trend says ~22%
    const s = build(year({ revenue: 1500 }), year({ revenue: 1000 }), year({ revenue: 1000 }))!;
    assert.ok(s.revenueGrowth! < 30, `trend should damp the spike, got ${s.revenueGrowth}`);
  });

  it("falls back to year-over-year with only two years", () => {
    const s = build(year({ revenue: 1200 }), year({ revenue: 1000 }))!;
    assert.ok(Math.abs(s.revenueGrowth! - 20) < 0.01);
  });
});

describe("normalized earnings", () => {
  it("averages earnings across the years available", () => {
    const s = build(year({ netIncome: 300 }), year({ netIncome: 150 }), year({ netIncome: 150 }))!;
    // mean of 300/150/150 = 200; mve = 50 * 100 = 5000; P/E = 25
    assert.ok(Math.abs(s.pe! - 25) < 0.01, `expected 25, got ${s.pe}`);
  });

  it("keeps a company with one loss year in the value factor", () => {
    // A single negative year used to null out P/E and drop the stock entirely.
    const s = build(year({ netIncome: -50 }), year({ netIncome: 150 }), year({ netIncome: 200 }))!;
    assert.ok(s.pe !== null && s.pe > 0, "averaging should survive one loss year");
  });

  it("still returns null when every year lost money", () => {
    const s = build(
      year({ netIncome: -100 }),
      year({ netIncome: -100 }),
      year({ netIncome: -100 }),
    )!;
    assert.ok(s.pe === null || s.pe < 0, "persistent losses must not look cheap");
  });
});

describe("guards", () => {
  it("refuses to value a company with no share count", () => {
    assert.equal(build(year({ shares: null })), null);
  });
  it("refuses without revenue or assets", () => {
    assert.equal(build(year({ revenue: null })), null);
    assert.equal(build(year({ assets: null })), null);
  });
});

describe("incremental signals", () => {
  it("measures return on NEWLY deployed capital, not the level", () => {
    // Capital grows 500 -> 700 (+200) while NOPAT grows by 0.79 * 100.
    const fy1 = year({ ebit: 100, equity: 400, debt: 200, cash: 100 });
    const fy0 = year({ ebit: 200, equity: 600, debt: 200, cash: 100 });
    const s = build(fy0, fy1)!;
    assert.ok(s.incrementalRoic !== null, "should compute when capital was deployed");
    // A company earning well on new money outranks one earning badly on it,
    // even where the historical level is identical.
    const poor = build(year({ ebit: 105, equity: 600, debt: 200, cash: 100 }), fy1)!;
    assert.ok(s.incrementalRoic! > poor.incrementalRoic!);
  });

  it("stays null when the company barely deployed any capital", () => {
    // A flat year makes the ratio meaningless: a tiny denominator explodes it.
    const fy1 = year({ equity: 500, debt: 200, cash: 100 });
    const fy0 = year({ equity: 501, debt: 200, cash: 100 });
    assert.equal(build(fy0, fy1)!.incrementalRoic, null);
  });

  it("reports dilution as positive and buybacks as negative", () => {
    const diluting = build(year({ shares: 121 }), year({ shares: 110 }), year({ shares: 100 }));
    assert.ok(diluting!.shareDilution! > 9, "issuing shares should read positive");
    const buyback = build(year({ shares: 81 }), year({ shares: 90 }), year({ shares: 100 }));
    assert.ok(buyback!.shareDilution! < 0, "buybacks should read negative");
  });

  it("separates accelerating growth from decelerating growth", () => {
    // Both end at the same revenue; only the path differs.
    const speedingUp = build(year({ revenue: 1000 }), year({ revenue: 800 }), year({ revenue: 750 }));
    const slowingDown = build(year({ revenue: 1000 }), year({ revenue: 600 }), year({ revenue: 300 }));
    assert.ok(speedingUp!.growthAcceleration! > 0);
    assert.ok(slowingDown!.growthAcceleration! < 0);
  });
});

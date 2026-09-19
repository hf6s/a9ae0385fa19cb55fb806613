/**
 * The sell rules.
 *
 * These decide what the app tells someone to sell, so the assertions that
 * matter are the ones about NOT firing: a false sell costs real money and real
 * trust, and the dividend rule in particular has to stay silent when the feed
 * simply did not answer.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeExits, exitCounts, exitsSignature, SCORE_SELL_LINE } from "./exits";
import type { RankedStock, Rankings } from "./types";

function stock(over: Partial<RankedStock> & { ticker: string; rank: number }): RankedStock {
  return {
    name: `${over.ticker} Inc`,
    sector: "Industrials",
    price: 50,
    marketCap: 5000,
    scores: { quality: 80, value: 80, momentum: 80, growth: 80 },
    penalties: [],
    finalScore: 80,
    recommended: over.rank <= 20,
    metrics: {},
    ...over,
  } as RankedStock;
}

function scan(stocks: RankedStock[]): Rankings {
  return {
    generatedAt: "2026-09-19T10:22:51.486Z",
    universeScanned: 905,
    passedFilters: stocks.length,
    skippedFilters: [],
    stocks,
  };
}

const clean = scan([
  stock({ ticker: "AAA", rank: 1 }),
  stock({ ticker: "BBB", rank: 2 }),
  stock({ ticker: "CCC", rank: 3 }),
]);

describe("computeExits", () => {
  it("says nothing when nothing is wrong", () => {
    assert.deepEqual(computeExits(clean, clean), []);
  });

  it("returns nothing without a scan rather than throwing", () => {
    assert.deepEqual(computeExits(null, clean), []);
  });

  it("works on a first scan, with no previous to compare against", () => {
    assert.deepEqual(computeExits(clean, null), []);
  });

  it("flags a holding that no longer passes the filters", () => {
    const now = scan([stock({ ticker: "AAA", rank: 1 }), stock({ ticker: "BBB", rank: 2 })]);
    const exits = computeExits(now, clean);
    const gone = exits.find((e) => e.ticker === "CCC");
    assert.ok(gone, "a stock that vanished from the scan must be flagged");
    assert.equal(gone.severity, "high");
  });

  it("flags a score under the sell line", () => {
    const now = scan([
      stock({ ticker: "AAA", rank: 1, finalScore: SCORE_SELL_LINE - 0.1 }),
      stock({ ticker: "BBB", rank: 2 }),
      stock({ ticker: "CCC", rank: 3 }),
    ]);
    const exits = computeExits(now, clean);
    assert.ok(exits.some((e) => e.ticker === "AAA" && e.rule === "Score below 70"));
  });

  it("does not flag a score exactly on the line", () => {
    const now = scan([
      stock({ ticker: "AAA", rank: 1, finalScore: SCORE_SELL_LINE }),
      stock({ ticker: "BBB", rank: 2 }),
      stock({ ticker: "CCC", rank: 3 }),
    ]);
    assert.deepEqual(computeExits(now, clean), []);
  });

  it("flags a dividend cut", () => {
    const before = scan([stock({ ticker: "AAA", rank: 1, dividendTtm: 2.0 })]);
    const now = scan([stock({ ticker: "AAA", rank: 1, dividendTtm: 1.0 })]);
    const exits = computeExits(now, before);
    assert.ok(exits.some((e) => e.rule === "Dividend cut"));
  });

  it("NEVER flags a cut when the feed returned nothing", () => {
    // null is "we do not know", not "they stopped paying". An outage must not
    // tell someone to sell.
    const before = scan([stock({ ticker: "AAA", rank: 1, dividendTtm: 2.0 })]);
    const now = scan([stock({ ticker: "AAA", rank: 1, dividendTtm: null })]);
    assert.deepEqual(computeExits(now, before), []);
  });

  it("does not flag a company that has never paid a dividend", () => {
    const before = scan([stock({ ticker: "AAA", rank: 1, dividendTtm: 0 })]);
    const now = scan([stock({ ticker: "AAA", rank: 1, dividendTtm: 0 })]);
    assert.deepEqual(computeExits(now, before), []);
  });

  it("treats a cut alongside a weak score as the serious case", () => {
    const before = scan([stock({ ticker: "AAA", rank: 1, dividendTtm: 2.0 })]);
    const weak = scan([
      stock({ ticker: "AAA", rank: 1, dividendTtm: 1.0, finalScore: 60 }),
    ]);
    const exits = computeExits(weak, before);
    const cut = exits.find((e) => e.rule === "Dividend cut");
    assert.equal(cut?.severity, "high");
  });

  it("sorts the serious flags first", () => {
    const before = scan([
      stock({ ticker: "AAA", rank: 1 }),
      stock({ ticker: "BBB", rank: 2 }),
      stock({ ticker: "CCC", rank: 3 }),
    ]);
    const now = scan([
      stock({ ticker: "AAA", rank: 1, finalScore: 65 }),
      stock({ ticker: "BBB", rank: 2 }),
    ]);
    const exits = computeExits(now, before);
    assert.equal(exits[0].severity, "high", "a lost holding outranks a soft score");
  });
});

describe("exitCounts", () => {
  it("counts each severity", () => {
    const counts = exitCounts([
      { ticker: "A", name: "", rule: "", detail: "", severity: "high" },
      { ticker: "B", name: "", rule: "", detail: "", severity: "low" },
      { ticker: "C", name: "", rule: "", detail: "", severity: "high" },
    ]);
    assert.deepEqual(counts, { high: 2, med: 0, low: 1 });
  });
});

describe("exitsSignature", () => {
  it("is stable regardless of order", () => {
    const a = [
      { ticker: "A", name: "", rule: "Score below 70", detail: "", severity: "med" as const },
      { ticker: "B", name: "", rule: "Failed filters", detail: "", severity: "high" as const },
    ];
    assert.equal(exitsSignature(a), exitsSignature([...a].reverse()));
  });

  it("changes when a new flag appears", () => {
    const a = [{ ticker: "A", name: "", rule: "X", detail: "", severity: "low" as const }];
    const b = [...a, { ticker: "B", name: "", rule: "Y", detail: "", severity: "low" as const }];
    assert.notEqual(exitsSignature(a), exitsSignature(b));
  });

  it("ignores wording changes in the detail line", () => {
    // Detail text carries prices and dates that move every scan. If the
    // signature tracked those, the app would claim new alerts every day.
    const a = [{ ticker: "A", name: "", rule: "X", detail: "was $1", severity: "low" as const }];
    const b = [{ ticker: "A", name: "", rule: "X", detail: "was $2", severity: "low" as const }];
    assert.equal(exitsSignature(a), exitsSignature(b));
  });
});

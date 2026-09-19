/**
 * Tests for the dividend-cut sell rule's inputs.
 *
 * The distinction that matters throughout is null versus zero. Zero means the
 * company pays no dividend; null means the feed did not answer. A sell rule
 * that treats "we do not know" as "they stopped paying" would fire on every
 * outage, so these cases pin that apart.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDividend, sumTrailing } from "./dividends";

describe("sumTrailing", () => {
  const asOf = new Date("2026-09-06T00:00:00Z");

  it("sums only the last twelve months", () => {
    const rows = [
      { date: "2025-06-01", value: 1 }, // older than 12m
      { date: "2025-12-01", value: 0.5 },
      { date: "2026-03-01", value: 0.5 },
      { date: "2026-06-01", value: 0.5 },
    ];
    assert.equal(sumTrailing(rows, asOf), 1.5);
  });

  it("ignores payments dated in the future", () => {
    // Declared-but-unpaid rows appear in the feed and must not be counted as
    // received, or a coming payment would mask a cut that already happened.
    const rows = [
      { date: "2026-06-01", value: 0.5 },
      { date: "2026-12-01", value: 0.5 },
    ];
    assert.equal(sumTrailing(rows, asOf), 0.5);
  });

  it("returns 0 for a company that pays nothing", () => {
    assert.equal(sumTrailing([], asOf), 0);
  });

  it("skips malformed rows rather than throwing", () => {
    const rows = [
      { date: "2026-06-01", value: 0.5 },
      { date: "2026-07-01" },
      { value: 1 },
      { date: "2026-08-01", value: Number.NaN },
    ];
    assert.equal(sumTrailing(rows as never, asOf), 0.5);
  });
});

describe("classifyDividend", () => {
  it("calls a real reduction a cut", () => {
    assert.equal(classifyDividend(2.0, 1.0), "cut");
  });

  it("calls a stop a suspension, which is the strongest signal", () => {
    assert.equal(classifyDividend(2.0, 0), "suspended");
  });

  it("ignores wobble inside the band", () => {
    // A trailing-twelve-month sum moves when a payment lands either side of a
    // period boundary. That is a calendar artefact, not a decision.
    assert.equal(classifyDividend(2.0, 1.95), "steady");
    assert.equal(classifyDividend(2.0, 2.05), "steady");
  });

  it("treats an initiation as a raise, not a cut", () => {
    assert.equal(classifyDividend(0, 0.5), "raised");
  });

  it("reports no signal when the company never paid", () => {
    assert.equal(classifyDividend(0, 0), "none");
  });

  it("never fires on missing data", () => {
    // The failure that would matter: a feed outage reading as a suspension.
    assert.equal(classifyDividend(null, 1), "unknown");
    assert.equal(classifyDividend(2, null), "unknown");
    assert.equal(classifyDividend(undefined, undefined), "unknown");
    assert.equal(classifyDividend(2, undefined), "unknown");
  });

  it("honours a caller-supplied band", () => {
    assert.equal(classifyDividend(2.0, 1.8, 0.2), "steady");
    assert.equal(classifyDividend(2.0, 1.8, 0.05), "cut");
  });
});

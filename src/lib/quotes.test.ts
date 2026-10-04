/**
 * Cases for the live-quote parsing.
 *
 * The two that matter: a ticker with a dot in it must survive the round trip
 * through the feed's symbol namespace, and a missing price must never become
 * the previous close. The first silently unprices BRK.B; the second reports
 * yesterday's number as today's.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFresh } from "./portfolio";
import { BATCH, chunk, parseQuotes } from "./quotes";

describe("chunk", () => {
  it("splits into batches, last one short", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it("leaves a short list in one batch", () => {
    assert.deepEqual(chunk([1, 2], 20), [[1, 2]]);
  });

  it("returns nothing for nothing", () => {
    assert.deepEqual(chunk([], 20), []);
  });

  it("does not loop forever on a nonsense size", () => {
    assert.deepEqual(chunk([1, 2], 0), [[1, 2]]);
  });

  it("batches a full portfolio into one request", () => {
    assert.equal(chunk(Array.from({ length: BATCH }, (_, i) => i), BATCH).length, 1);
    assert.equal(chunk(Array.from({ length: BATCH + 1 }, (_, i) => i), BATCH).length, 2);
  });
});

describe("parseQuotes", () => {
  it("maps the feed's symbols back to the tickers that were asked for", () => {
    const out = parseQuotes(
      [
        { code: "AAPL.US", close: 333.69, previousClose: 330.32, timestamp: 1790000000 },
        { code: "BRK-B.US", close: 410, previousClose: 408, timestamp: 1790000000 },
      ],
      ["AAPL", "BRK.B"],
    );
    assert.equal(out.AAPL.price, 333.69);
    assert.ok(out["BRK.B"], "a dot in the ticker must survive the feed's own naming");
    assert.equal(out["BRK.B"].price, 410);
  });

  it("reads a single-symbol response, which is a bare object", () => {
    const out = parseQuotes({ code: "AAPL.US", close: 333.69, timestamp: 1790000000 }, ["AAPL"]);
    assert.equal(out.AAPL.price, 333.69);
  });

  it("leaves out a symbol with no price rather than using the previous close", () => {
    const out = parseQuotes(
      [{ code: "AAPL.US", close: "NA", previousClose: 330.32, timestamp: 1790000000 }],
      ["AAPL"],
    );
    assert.deepEqual(out, {}, "yesterday's close must not be served as today's price");
  });

  it("refuses zero, negative and missing prices", () => {
    for (const close of [0, -5, null, undefined]) {
      const out = parseQuotes([{ code: "AAPL.US", close, timestamp: 1 }], ["AAPL"]);
      assert.deepEqual(out, {}, String(close));
    }
  });

  it("accepts numbers that arrive as strings", () => {
    const out = parseQuotes(
      [{ code: "AAPL.US", close: "333.69", previousClose: "330.32", timestamp: "1790000000" }],
      ["AAPL"],
    );
    assert.equal(out.AAPL.price, 333.69);
    assert.equal(out.AAPL.prevClose, 330.32);
  });

  it("ignores a symbol that was never asked for", () => {
    const out = parseQuotes([{ code: "XYZ.US", close: 10, timestamp: 1 }], ["AAPL"]);
    assert.deepEqual(out, {});
  });

  it("survives junk instead of a response", () => {
    for (const junk of [null, undefined, "oops", 42]) {
      assert.deepEqual(parseQuotes(junk, ["AAPL"]), {}, String(junk));
    }
  });

  it("carries the feed's print time, not the time of the request", () => {
    const out = parseQuotes([{ code: "AAPL.US", close: 1, timestamp: 1790000000 }], ["AAPL"]);
    assert.equal(out.AAPL.at, new Date(1790000000 * 1000).toISOString());
  });

  it("keeps a missing timestamp visibly unreal rather than guessing now", () => {
    const out = parseQuotes([{ code: "AAPL.US", close: 1 }], ["AAPL"]);
    assert.equal(out.AAPL.at, new Date(0).toISOString());
    assert.equal(isFresh(out.AAPL.at), false);
  });
});

describe("isFresh", () => {
  const now = Date.parse("2026-10-04T15:00:00Z");

  it("calls a price from a minute ago current", () => {
    assert.equal(isFresh("2026-10-04T14:59:00Z", now), true);
  });

  it("does not call Friday's close current on Sunday", () => {
    assert.equal(isFresh("2026-10-02T20:00:00Z", now), false);
  });

  it("rejects the epoch and anything unparseable", () => {
    assert.equal(isFresh(new Date(0).toISOString(), now), false);
    assert.equal(isFresh("not a time", now), false);
  });

  it("rejects a time in the future, which means a clock is wrong", () => {
    assert.equal(isFresh("2026-10-04T15:05:00Z", now), false);
  });
});

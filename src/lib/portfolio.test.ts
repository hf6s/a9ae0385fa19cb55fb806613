/**
 * Cases for the holdings maths.
 *
 * Three of these exist because the obvious implementation gets them wrong in a
 * way that looks plausible on screen:
 *   - a deposit must not read as a gain,
 *   - the benchmark must buy on each position's own date, not one start date,
 *   - a holding with no price must not drag the percentage return down.
 * Each of those produces a believable, wrong number, which is the worst kind.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annualised,
  buildPositions,
  daysBetween,
  decodeHoldings,
  driftRows,
  encodeHoldings,
  equityCurve,
  makeHolding,
  MAX_HOLDINGS,
  maxDrawdown,
  normaliseTicker,
  returnIndex,
  sectorMix,
  summarise,
  unchartable,
  type Bar,
  type Holding,
  type TickerMeta,
} from "./portfolio";

const hold = (ticker: string, shares: number, cost: number, at: string): Holding => {
  const h = makeHolding({ ticker, shares, cost, at });
  assert.ok(h, `fixture should be valid: ${ticker}`);
  return h;
};

/** `days` flat bars at `price`, starting from 2026-01-01. */
function flat(price: number, days: number, from = 1): Bar[] {
  return Array.from({ length: days }, (_, i) => ({
    t: `2026-01-${String(from + i).padStart(2, "0")}`,
    c: price,
  }));
}

const meta = (over: Partial<TickerMeta> = {}): TickerMeta => ({
  name: "Example Corp",
  sector: "Technology",
  rank: 3,
  score: 80,
  ...over,
});

describe("makeHolding", () => {
  it("uppercases and strips the ticker", () => {
    assert.equal(makeHolding({ ticker: " aapl ", shares: 1, cost: 1, at: "2026-01-02" })?.ticker, "AAPL");
    assert.equal(normaliseTicker("brk.b"), "BRK.B");
  });

  it("rejects holdings that cannot be valued", () => {
    const bad = [
      { ticker: "", shares: 1, cost: 1, at: "2026-01-02" },
      { ticker: "AAPL", shares: 0, cost: 1, at: "2026-01-02" },
      { ticker: "AAPL", shares: -3, cost: 1, at: "2026-01-02" },
      { ticker: "AAPL", shares: 1, cost: -1, at: "2026-01-02" },
      { ticker: "AAPL", shares: Number.NaN, cost: 1, at: "2026-01-02" },
      { ticker: "AAPL", shares: 1, cost: 1, at: "02/01/2026" },
      { ticker: "AAPL", shares: 1, cost: 1, at: "" },
    ];
    for (const b of bad) assert.equal(makeHolding(b), null, JSON.stringify(b));
  });

  it("rejects a date that does not exist", () => {
    // Date.parse accepts this and quietly means 2 or 3 March, so a holding
    // would be priced from a day the owner never traded.
    assert.equal(makeHolding({ ticker: "AAPL", shares: 1, cost: 1, at: "2026-02-31" }), null);
  });

  it("accepts fractional shares", () => {
    assert.equal(makeHolding({ ticker: "AAPL", shares: "0.4312", cost: "190.5", at: "2026-01-02" })?.shares, 0.4312);
  });
});

describe("buildPositions", () => {
  const holdings = [hold("AAA", 10, 10, "2026-01-02"), hold("BBB", 5, 20, "2026-01-02")];

  it("values positions and weights them to 100%", () => {
    const rows = buildPositions(holdings, { AAA: 20, BBB: 20 }, {});
    assert.equal(rows[0].value, 200);
    assert.equal(rows[0].gain, 100);
    assert.equal(rows[0].gainPct, 100);
    assert.equal(Math.round(rows.reduce((a, r) => a + r.weight, 0)), 100);
  });

  it("marks an unpriced holding rather than valuing it at zero", () => {
    const rows = buildPositions(holdings, { AAA: 20 }, {});
    assert.equal(rows[1].priced, false);
    assert.equal(rows[1].value, 0);
    assert.equal(rows[1].gain, 0, "a missing price is not a 100% loss");
  });

  it("says the model knows nothing about a ticker outside the universe", () => {
    const rows = buildPositions(holdings, { AAA: 20, BBB: 20 }, { AAA: meta() });
    assert.equal(rows[0].known, true);
    assert.equal(rows[0].inTop20, true);
    assert.equal(rows[1].known, false);
    assert.equal(rows[1].rank, null);
    assert.equal(rows[1].sector, "Unclassified");
  });

  it("does not report an infinite return on a position that cost nothing", () => {
    const rows = buildPositions([hold("AAA", 10, 0, "2026-01-02")], { AAA: 20 }, {});
    assert.equal(rows[0].gainPct, 0);
    assert.ok(Number.isFinite(rows[0].gainPct));
  });

  it("ranks 20 as inside the top 20 and 21 as outside", () => {
    const rows = buildPositions(holdings, { AAA: 1, BBB: 1 }, { AAA: meta({ rank: 20 }), BBB: meta({ rank: 21 }) });
    assert.equal(rows[0].inTop20, true);
    assert.equal(rows[1].inTop20, false);
  });
});

describe("summarise", () => {
  it("adds up money in and money out", () => {
    const rows = buildPositions(
      [hold("AAA", 10, 10, "2026-01-02"), hold("BBB", 10, 10, "2026-01-02")],
      { AAA: 15, BBB: 5 },
      {},
    );
    const s = summarise(rows);
    assert.equal(s.basis, 200);
    assert.equal(s.value, 200);
    assert.equal(s.gain, 0);
    assert.equal(s.gainPct, 0);
    assert.equal(s.best?.ticker, "AAA");
    assert.equal(s.worst?.ticker, "BBB");
  });

  it("measures the percentage against priced holdings only", () => {
    // AAA doubled; BBB has no price. Dividing the +$100 by the full $200 basis
    // would report +50% when the only position that can be measured is +100%,
    // and the owner would read it as the portfolio having halved its gain.
    const rows = buildPositions(
      [hold("AAA", 10, 10, "2026-01-02"), hold("BBB", 10, 10, "2026-01-02")],
      { AAA: 20 },
      {},
    );
    const s = summarise(rows);
    assert.equal(s.gainPct, 100);
    assert.equal(s.unpriced, 1);
  });

  it("has no worst position when only one is priced", () => {
    const rows = buildPositions([hold("AAA", 1, 1, "2026-01-02")], { AAA: 2 }, {});
    const s = summarise(rows);
    assert.equal(s.best?.ticker, "AAA");
    assert.equal(s.worst, null, "one position cannot be both best and worst");
  });

  it("survives an empty portfolio", () => {
    const s = summarise([]);
    assert.equal(s.value, 0);
    assert.equal(s.gainPct, 0);
    assert.equal(s.best, null);
  });
});

describe("sectorMix", () => {
  it("groups by sector, largest first, to 100%", () => {
    const rows = buildPositions(
      [hold("AAA", 10, 1, "2026-01-02"), hold("BBB", 10, 1, "2026-01-02"), hold("CCC", 1, 1, "2026-01-02")],
      { AAA: 10, BBB: 10, CCC: 10 },
      { AAA: meta({ sector: "Technology" }), BBB: meta({ sector: "Technology" }), CCC: meta({ sector: "Energy" }) },
    );
    const mix = sectorMix(rows);
    assert.equal(mix[0].sector, "Technology");
    assert.equal(mix[0].tickers.length, 2);
    assert.equal(Math.round(mix.reduce((a, s) => a + s.pct, 0)), 100);
  });
});

describe("driftRows", () => {
  it("targets an equal share of the positions actually held", () => {
    const rows = buildPositions(
      [hold("AAA", 10, 1, "2026-01-02"), hold("BBB", 10, 1, "2026-01-02")],
      { AAA: 30, BBB: 10 },
      {},
    );
    const drift = driftRows(rows);
    assert.equal(drift.length, 2);
    assert.equal(drift[0].target, 50, "two holdings means 50% each, not the model's 5%");
    assert.equal(drift[0].ticker, "AAA");
    assert.ok(drift[0].drift > 0 && drift[1].drift < 0);
  });

  it("proposes adjustments that net to nothing", () => {
    const rows = buildPositions(
      [hold("AAA", 10, 1, "2026-01-02"), hold("BBB", 10, 1, "2026-01-02"), hold("CCC", 10, 1, "2026-01-02")],
      { AAA: 30, BBB: 10, CCC: 20 },
      {},
    );
    const net = driftRows(rows).reduce((a, r) => a + r.adjust, 0);
    assert.ok(Math.abs(net) < 1e-9, `rebalancing must not invent or destroy cash: ${net}`);
  });

  it("returns nothing when no holding has a price", () => {
    assert.deepEqual(driftRows(buildPositions([hold("AAA", 1, 1, "2026-01-02")], {}, {})), []);
  });
});

describe("equityCurve", () => {
  it("leaves a position out until the day it was bought", () => {
    const curve = equityCurve({
      holdings: [hold("AAA", 1, 100, "2026-01-01"), hold("BBB", 1, 500, "2026-01-03")],
      series: { AAA: flat(100, 5), BBB: flat(500, 5) },
      bench: flat(1000, 5),
    });
    assert.equal(curve[0].value, 100, "BBB was not owned on the 1st");
    assert.equal(curve[0].basis, 100);
    assert.equal(curve[2].value, 600, "both owned from the 3rd");
    assert.equal(curve[2].basis, 600);
  });

  it("buys the benchmark on each position's own date", () => {
    // The index doubles on day 3. A position bought that day must buy index
    // units at 200, not at the 100 the first position paid - otherwise the
    // benchmark is handed a gain it never had the chance to make.
    const bench: Bar[] = [
      { t: "2026-01-01", c: 100 },
      { t: "2026-01-02", c: 100 },
      { t: "2026-01-03", c: 200 },
    ];
    const curve = equityCurve({
      holdings: [hold("AAA", 10, 100, "2026-01-01"), hold("BBB", 10, 100, "2026-01-03")],
      series: { AAA: flat(100, 3), BBB: flat(100, 3) },
      bench,
    });
    const last = curve[curve.length - 1];
    assert.equal(last.basis, 2000);
    // AAA: 1000/100 = 10 units. BBB: 1000/200 = 5 units. 15 x 200 = 3000.
    assert.equal(last.bench, 3000);
  });

  it("starts where the price history starts for shares bought earlier", () => {
    const curve = equityCurve({
      holdings: [hold("AAA", 1, 50, "2020-06-01")],
      series: { AAA: flat(100, 3) },
      bench: flat(1000, 3),
    });
    assert.equal(curve[0].t, "2026-01-01");
    assert.equal(curve[0].basis, 50, "the money was still paid, the chart just cannot reach back");
  });

  it("holds the last price through a gap in one feed", () => {
    const gappy: Bar[] = [
      { t: "2026-01-01", c: 100 },
      // nothing on the 2nd
      { t: "2026-01-03", c: 100 },
    ];
    const curve = equityCurve({
      holdings: [hold("AAA", 1, 100, "2026-01-01")],
      series: { AAA: gappy },
      bench: flat(1000, 3),
    });
    assert.equal(curve.length, 3);
    assert.equal(curve[1].value, 100, "a missing bar is not a wipeout");
  });

  it("stops on the last day every holding has a price, not the last day any does", () => {
    // AAA is priced from the scan and stops on the 3rd; BBB was fetched live and
    // runs to the 9th. Charting to the 9th would hold AAA flat for six days
    // against a live index and show a divergence that is pure data artefact.
    const curve = equityCurve({
      holdings: [hold("AAA", 1, 100, "2026-01-01"), hold("BBB", 1, 100, "2026-01-01")],
      series: { AAA: flat(100, 3), BBB: flat(100, 9) },
      bench: flat(1000, 9),
    });
    assert.equal(curve[curve.length - 1].t, "2026-01-03");
  });

  it("stops where the holdings' prices stop, not where the index does", () => {
    // The index is fetched live and the holdings come from the last scan, so
    // this gap is the normal state of the data, not an edge case. Running on
    // would hold the portfolio flat against a moving index and show a loss over
    // days it was never measured over.
    const curve = equityCurve({
      holdings: [hold("AAA", 1, 100, "2026-01-01")],
      series: { AAA: flat(100, 3) }, // ends on the 3rd
      bench: flat(1000, 9), // runs to the 9th
    });
    assert.equal(curve[curve.length - 1].t, "2026-01-03");
  });

  it("drops holdings it has no prices for, and returns nothing if that is all of them", () => {
    assert.deepEqual(
      equityCurve({ holdings: [hold("AAA", 1, 1, "2026-01-02")], series: {}, bench: flat(1, 3) }),
      [],
    );
  });

  it("still draws the portfolio with no benchmark data", () => {
    const curve = equityCurve({
      holdings: [hold("AAA", 1, 100, "2026-01-01")],
      series: { AAA: flat(100, 3) },
      bench: [],
    });
    assert.equal(curve.length, 3);
    assert.equal(curve[0].value, 100);
    assert.equal(curve[0].bench, 0, "no data means no line, not a fabricated one");
  });
});

describe("unchartable", () => {
  it("names a holding bought after the last price we have", () => {
    const series = { AAA: flat(100, 3) }; // ends 2026-01-03
    assert.deepEqual(unchartable([hold("AAA", 1, 100, "2026-01-05")], series), ["AAA"]);
    assert.deepEqual(unchartable([hold("AAA", 1, 100, "2026-01-02")], series), []);
  });

  it("names a holding with no price series at all", () => {
    assert.deepEqual(unchartable([hold("ZZZ", 1, 1, "2026-01-02")], {}), ["ZZZ"]);
  });

  it("lists each ticker once", () => {
    const series = { AAA: flat(100, 3) };
    const twice = [hold("AAA", 1, 100, "2026-01-05"), hold("AAA", 2, 100, "2026-01-06")];
    assert.deepEqual(unchartable(twice, series), ["AAA"]);
  });
});

describe("returnIndex", () => {
  it("does not count a deposit as a gain", () => {
    // Everything flat; $1,000 of new money arrives on the 3rd. Value goes from
    // $100 to $1,100. A naive value/first-value index would print +1000%.
    const curve = equityCurve({
      holdings: [hold("AAA", 1, 100, "2026-01-01"), hold("BBB", 1, 1000, "2026-01-03")],
      series: { AAA: flat(100, 5), BBB: flat(1000, 5) },
      bench: flat(50, 5),
    });
    const index = returnIndex(curve);
    assert.equal(curve[4].value, 1100);
    for (const p of index) {
      assert.ok(Math.abs(p.strat - 1) < 1e-12, `flat prices must stay at 1, got ${p.strat}`);
      assert.ok(Math.abs(p.bench - 1) < 1e-12, `benchmark too, got ${p.bench}`);
    }
  });

  it("matches the simple return when no money is added", () => {
    const rising: Bar[] = [
      { t: "2026-01-01", c: 100 },
      { t: "2026-01-02", c: 110 },
      { t: "2026-01-03", c: 121 },
    ];
    const index = returnIndex(
      equityCurve({ holdings: [hold("AAA", 1, 100, "2026-01-01")], series: { AAA: rising }, bench: rising }),
    );
    assert.ok(Math.abs(index[2].strat - 1.21) < 1e-12);
  });

  it("carries the benchmark forward rather than zeroing it when there is no index data", () => {
    const index = returnIndex(
      equityCurve({ holdings: [hold("AAA", 1, 100, "2026-01-01")], series: { AAA: flat(100, 3) }, bench: [] }),
    );
    for (const p of index) assert.equal(p.bench, 1, "a missing benchmark must not read as a total loss");
  });
});

describe("maxDrawdown", () => {
  it("measures peak to trough, not start to trough", () => {
    const index = returnIndex([
      { t: "2026-01-01", value: 100, basis: 100, bench: 100 },
      { t: "2026-01-02", value: 200, basis: 100, bench: 100 },
      { t: "2026-01-03", value: 150, basis: 100, bench: 100 },
    ]);
    const dd = maxDrawdown(index);
    assert.ok(Math.abs(dd.pct - 25) < 1e-9, `25% off the peak of 200, got ${dd.pct}`);
    assert.equal(dd.at, "2026-01-03");
  });

  it("reports nothing for a line that only rose", () => {
    const dd = maxDrawdown([
      { t: "a", strat: 1, bench: 1 },
      { t: "b", strat: 2, bench: 2 },
    ]);
    assert.equal(dd.pct, 0);
    assert.equal(dd.at, "");
  });
});

describe("annualised", () => {
  it("refuses to annualise a short run", () => {
    assert.equal(annualised(0.1, 14), null);
    assert.equal(annualised(0.1, 89), null);
  });

  it("annualises a longer one", () => {
    const a = annualised(0.2, 365);
    assert.ok(a !== null && Math.abs(a - 20) < 1e-9);
  });

  it("does not take a root of a negative number", () => {
    assert.equal(annualised(-1, 400), null);
  });
});

describe("daysBetween", () => {
  it("counts calendar days and never goes negative", () => {
    assert.equal(daysBetween("2026-01-01", "2026-01-31"), 30);
    assert.equal(daysBetween("2026-01-31", "2026-01-01"), 0);
    assert.equal(daysBetween("nonsense", "2026-01-01"), 0);
  });
});

describe("backup links", () => {
  const holdings = [hold("AAPL", 2.5, 190.25, "2026-03-04"), hold("BRK.B", 1, 410, "2026-05-06")];

  it("round-trips", () => {
    const back = decodeHoldings(encodeHoldings(holdings));
    assert.ok(back);
    assert.equal(back.length, 2);
    assert.equal(back[0].ticker, "AAPL");
    assert.equal(back[0].shares, 2.5);
    assert.equal(back[0].cost, 190.25);
    assert.equal(back[1].ticker, "BRK.B", "a dot in the ticker must survive the separator");
    assert.equal(back[1].at, "2026-05-06");
  });

  it("stays readable", () => {
    assert.equal(encodeHoldings([holdings[0]]), "AAPL:2.5:190.25:2026-03-04");
  });

  it("rejects a truncated link outright", () => {
    // Restoring the first position and silently dropping the second is worse
    // than restoring nothing: the owner cannot tell what went missing.
    const encoded = encodeHoldings(holdings);
    assert.equal(decodeHoldings(encoded.slice(0, encoded.length - 4)), null);
  });

  it("rejects junk and emptiness", () => {
    for (const bad of ["", "   ", "hello", "AAPL:1:1", "AAPL:1:1:2026-01-02:extra", "AAPL:0:1:2026-01-02"]) {
      assert.equal(decodeHoldings(bad), null, bad);
    }
  });

  it("refuses a link longer than the holdings ceiling", () => {
    const many = Array.from({ length: MAX_HOLDINGS + 1 }, () => "AAA:1:1:2026-01-02").join("|");
    assert.equal(decodeHoldings(many), null);
  });
});

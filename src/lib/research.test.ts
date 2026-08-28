/**
 * Tests for the live research layer.
 *
 * The parser is the contract between prose the model writes and structure the
 * UI renders, and it cannot be checked by types. These cases pin the failures
 * that actually happened during development: a starved search budget producing
 * a false "nothing could be verified" disclaimer, citations shredding prose
 * into fragments, and a monitoring verdict that must never default to
 * reassurance when it cannot be read.
 */

import assert from "node:assert/strict";
import fsSync from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildResearchSystem,
  parseMonitorText,
  parseReport,
  parseVerdict,
  REPORT_SECTIONS,
  reportCompleteness,
  RESEARCH_SYSTEM,
} from "./research";

/** A full report in the shape the prompt asks for. */
function fullReport(extra = ""): string {
  return (
    REPORT_SECTIONS.map((s) => `${s}: Body text for ${s}, with detail.`).join("\n\n") + extra
  );
}

describe("parseReport", () => {
  it("splits every section out of a well-formed report", () => {
    const r = parseReport(fullReport());
    for (const s of REPORT_SECTIONS) {
      assert.ok(r[s], `missing section ${s}`);
      assert.match(r[s]!, new RegExp(`Body text for ${s}`));
    }
  });

  it("does not bleed one section's body into the next", () => {
    const r = parseReport(fullReport());
    assert.ok(!r.THESIS!.includes("WHAT MUST GO RIGHT"));
    assert.ok(!r.MOAT!.includes("VALUATION"));
  });

  it("tolerates markdown emphasis around headings", () => {
    const r = parseReport("**THESIS:** the mechanism.\n\n## MOAT: widening.");
    assert.match(r.THESIS!, /the mechanism/);
    assert.match(r.MOAT!, /widening/);
  });

  it("keeps colons and capitals inside a body", () => {
    const text = "THESIS: Two things matter: PRICING and SCALE.\n\nRISKS: One risk.";
    const r = parseReport(text);
    assert.equal(r.THESIS, "Two things matter: PRICING and SCALE.");
    assert.equal(r.RISKS, "One risk.");
  });

  it("returns an empty report rather than throwing on junk", () => {
    assert.deepEqual(parseReport(""), {});
    assert.deepEqual(parseReport("no headings at all, just prose"), {});
  });

  it("handles a partial report, which is what a failed search produces", () => {
    const r = parseReport("THESIS: only this one came back.");
    assert.ok(r.THESIS);
    assert.equal(r.RISKS, undefined);
  });

  it("excludes the monitor block from the report sections", () => {
    const r = parseReport(fullReport("\n\nTHESIS MONITOR: things changed.\nVERDICT: unchanged"));
    // THESIS MONITOR is not one of the nine, and must not be glued onto DATA CONFIDENCE.
    assert.ok(!("THESIS MONITOR" in r));
    assert.ok(!r["DATA CONFIDENCE"]!.includes("things changed"));
  });
});

describe("reportCompleteness", () => {
  it("is 100 for a full report and 0 for nothing", () => {
    assert.equal(reportCompleteness(parseReport(fullReport())), 100);
    assert.equal(reportCompleteness(parseReport("")), 0);
  });

  it("shows a thin report as thin", () => {
    const pct = reportCompleteness(parseReport("THESIS: a.\n\nRISKS: b."));
    assert.ok(pct > 0 && pct < 40, `expected a low score, got ${pct}`);
  });
});

describe("parseMonitorText", () => {
  it("finds the monitor block and leaves the report behind", () => {
    const t = parseMonitorText(fullReport("\n\nTHESIS MONITOR: guidance was cut.\nVERDICT: review"));
    assert.match(t!, /guidance was cut/);
    assert.ok(!t!.includes("Body text for THESIS,"));
  });

  it("returns null when there is no monitor block", () => {
    assert.equal(parseMonitorText(fullReport()), null);
  });
});

describe("parseVerdict", () => {
  it("reads each allowed verdict", () => {
    for (const v of ["improved", "unchanged", "review", "deteriorated"]) {
      assert.equal(parseVerdict(`something changed.\nVERDICT: ${v}`), v);
    }
  });

  it("is case-insensitive and tolerates emphasis", () => {
    assert.equal(parseVerdict("VERDICT: **Deteriorated**"), "deteriorated");
  });

  it("defaults to review, never to reassurance, when it cannot be read", () => {
    // A parsing failure must send a human to look, not imply all is well.
    assert.equal(parseVerdict(null), "review");
    assert.equal(parseVerdict("no verdict line here"), "review");
    assert.equal(parseVerdict("VERDICT: excellent"), "review");
  });
});

describe("buildResearchSystem", () => {
  it("omits monitoring entirely on a first pass", () => {
    const sys = buildResearchSystem(null);
    assert.equal(sys, RESEARCH_SYSTEM);
    assert.ok(!sys.includes("THESIS MONITOR"));
  });

  it("appends monitoring and embeds the previous thesis", () => {
    const sys = buildResearchSystem({ thesis: "Old mechanism was X.", at: "2026-01-15" });
    assert.ok(sys.includes("THESIS MONITOR"));
    assert.ok(sys.includes("Old mechanism was X."));
    assert.ok(sys.includes("2026-01-15"));
    // The base instructions must survive, not be replaced.
    assert.ok(sys.includes("SEARCH AGGRESSIVELY"));
  });

  it("never tells the model to recommend selling on an alert", () => {
    const sys = buildResearchSystem({ thesis: "x", at: "2026-01-01" });
    assert.match(sys, /Do NOT recommend selling/);
  });
});

describe("the prompt keeps research separate from the ranking", () => {
  it("tells the model it is not ranking and cannot change the score", () => {
    assert.match(RESEARCH_SYSTEM, /NOT ranking/);
    assert.match(RESEARCH_SYSTEM, /quantitative rank is fixed/i);
  });

  it("forbids the failure that shipped a false disclaimer", () => {
    // A starved search budget once produced "every attempt failed" while the
    // model held 18 good sources. The prompt has to rule that out.
    assert.match(RESEARCH_SYSTEM, /do NOT\s+disclaim the whole report/i);
  });

  it("treats famous-investor activity as a secondary signal, not proof", () => {
    assert.match(RESEARCH_SYSTEM, /SECONDARY/);
    assert.match(RESEARCH_SYSTEM, /not evidence the stock is good/i);
  });

  it("bans price targets and buy/sell language", () => {
    assert.match(RESEARCH_SYSTEM, /Do not say buy, sell or hold/i);
    assert.match(RESEARCH_SYSTEM, /Do not give price targets/i);
  });
});

describe("quantitative integrity: the wall between the two systems", () => {
  // These read the actual source. A comment saying "never import this" is a
  // wish; this is the thing that fails the build when someone does it anyway.
  const read = (p: string) => fsSync.readFileSync(path.join(process.cwd(), p), "utf8");

  it("no quantitative file imports the research layer", () => {
    const quantFiles = [
      "src/lib/scoring.ts",
      "src/lib/fundamentals.ts",
      "src/lib/edgar-history.ts",
      "scripts/backtest.ts",
      "scripts/scan.ts",
    ];
    for (const f of quantFiles) {
      const src = read(f);
      assert.ok(
        !/from\s+["'].*\/research["']/.test(src) && !/require\(["'].*research["']\)/.test(src),
        `${f} must not import the research layer: research reads the live web, and any ` +
          `current-web fact reaching the scorer turns the backtest into lookahead`,
      );
    }
  });

  it("the backtest never reaches for the web-search tool", () => {
    const bt = read("scripts/backtest.ts");
    assert.ok(!bt.includes("web_search"), "backtest must not search the web");
    assert.ok(!bt.includes("anthropic"), "backtest must not call a model at all");
  });

  it("the research layer never writes rank or finalScore", () => {
    const src = read("src/lib/research.ts");
    assert.ok(!/\brank\s*=/.test(src) && !/finalScore\s*=/.test(src));
  });

  it("the analysis job reads rankings but never reorders them", () => {
    const src = read("scripts/analyze.ts");
    // slice() to take the top N is fine; sort() would be re-ranking.
    assert.ok(!/rankings\.stocks\.sort|\.stocks\s*=\s*/.test(src));
  });
});

describe("parser robustness against how the model actually writes", () => {
  it("finds a heading that follows preamble on the SAME line", () => {
    // This is verbatim the shape that dropped THESIS in production: the model
    // was told to start with the heading and wrote a sentence first.
    const text =
      "I'll research this company across filings and earnings." +
      "THESIS: the mechanism is a mix shift.\n\nRISKS: reserves.";
    const r = parseReport(text);
    assert.ok(r.THESIS, "THESIS must parse even mid-line");
    assert.match(r.THESIS!, /mix shift/);
    assert.ok(!r.THESIS!.includes("I'll research"));
  });

  it("does not match a heading glued to a preceding word", () => {
    // "SYNTHESIS:" ends with THESIS and must not be read as the THESIS heading.
    const r = parseReport("SYNTHESIS: not a thesis heading.\n\nRISKS: real one.");
    assert.equal(r.THESIS, undefined);
    assert.ok(r.RISKS);
  });

  it("does not confuse THESIS MONITOR with THESIS", () => {
    const text = "THESIS: real thesis.\n\nTHESIS MONITOR: the comparison.\nVERDICT: unchanged";
    const r = parseReport(text);
    assert.equal(r.THESIS, "real thesis.");
    assert.match(parseMonitorText(text)!, /the comparison/);
  });

  it("still reports low completeness when sections really are missing", () => {
    const r = parseReport("I'll look into this. THESIS: only one section.");
    assert.equal(Object.keys(r).length, 1);
    assert.ok(reportCompleteness(r) < 20);
  });
});

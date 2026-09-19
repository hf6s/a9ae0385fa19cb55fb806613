/**
 * The sell rules, applied to a scan.
 *
 * Lifted out of the exits page so the alert banner, the app badge and the page
 * itself all answer from one implementation. A second copy of a sell rule is a
 * copy that will one day disagree with the first, and then the app is telling
 * someone to sell a position the site says is fine.
 */

import { classifyDividend } from "./dividends";
import type { Rankings } from "./types";

export const SCORE_SELL_LINE = 70;

export type Severity = "high" | "med" | "low";

export interface Exit {
  ticker: string;
  name: string;
  rule: string;
  detail: string;
  severity: Severity;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: "Sell rule hit",
  med: "Under threshold",
  low: "Downgraded",
};

export function computeExits(rankings: Rankings | null, prev: Rankings | null): Exit[] {
  if (!rankings) return [];

  const currentTickers = new Set(rankings.stocks.map((s) => s.ticker));
  const currentTop20 = new Set(rankings.stocks.slice(0, 20).map((s) => s.ticker));
  const currentTop50 = new Set(rankings.stocks.slice(0, 50).map((s) => s.ticker));

  const dropped: Exit[] = [];
  if (prev) {
    for (const s of prev.stocks.slice(0, 50)) {
      if (!currentTickers.has(s.ticker)) {
        dropped.push({
          ticker: s.ticker,
          name: s.name,
          rule: "Failed filters",
          detail: `Was #${s.rank}, no longer passes the elimination filters`,
          severity: "high",
        });
      } else if (
        prev.stocks.slice(0, 20).some((p) => p.ticker === s.ticker) &&
        !currentTop20.has(s.ticker)
      ) {
        const now = rankings.stocks.find((x) => x.ticker === s.ticker);
        if (now) {
          dropped.push({
            ticker: s.ticker,
            name: s.name,
            rule: "Left top 20",
            detail: `#${s.rank} → #${now.rank}`,
            severity: "low",
          });
        }
      } else if (!currentTop50.has(s.ticker)) {
        const now = rankings.stocks.find((x) => x.ticker === s.ticker);
        if (now) {
          dropped.push({
            ticker: s.ticker,
            name: s.name,
            rule: "Fell below top 50",
            detail: `#${s.rank} → #${now.rank}`,
            severity: "high",
          });
        }
      }
    }
  }

  const belowLine: Exit[] = rankings.stocks
    .slice(0, 20)
    .filter((s) => s.finalScore < SCORE_SELL_LINE)
    .map((s) => ({
      ticker: s.ticker,
      name: s.name,
      rule: "Score below 70",
      detail: `Final score ${s.finalScore.toFixed(1)}, under the sell threshold`,
      severity: "med" as Severity,
    }));

  /**
   * Dividend cuts, this scan's trailing-twelve-month figure against the last.
   *
   * The spec's rule is "cuts dividend due to distress". Only the cut is in the
   * data; intent is not, and a board moving capital return from dividends to
   * buybacks has not stopped returning capital. So severity is decided by
   * whether the company is ALSO in trouble on the numbers we do have.
   */
  const prevDiv = new Map(prev?.stocks.map((s) => [s.ticker, s.dividendTtm]) ?? []);
  const dividend: Exit[] = rankings.stocks
    .slice(0, 50)
    .map((s) => {
      const change = classifyDividend(prevDiv.get(s.ticker), s.dividendTtm);
      if (change !== "cut" && change !== "suspended") return null;
      const before = prevDiv.get(s.ticker) ?? 0;
      const distress = s.finalScore < SCORE_SELL_LINE || s.penalties.length > 0;
      return {
        ticker: s.ticker,
        name: s.name,
        rule: change === "suspended" ? "Dividend suspended" : "Dividend cut",
        detail:
          `$${before.toFixed(2)} to $${(s.dividendTtm ?? 0).toFixed(2)} per share (trailing 12m)` +
          (distress
            ? ", alongside a weak score or active penalties"
            : ", but the company still scores clean"),
        severity: (distress ? "high" : "low") as Severity,
      };
    })
    .filter((e): e is Exit => e !== null);

  const all = [...dropped, ...belowLine, ...dividend];
  const order = { high: 0, med: 1, low: 2 };
  all.sort((a, b) => order[a.severity] - order[b.severity]);
  return all;
}

/** Counts by severity, for a badge or a headline. */
export function exitCounts(exits: Exit[]): Record<Severity, number> {
  return {
    high: exits.filter((e) => e.severity === "high").length,
    med: exits.filter((e) => e.severity === "med").length,
    low: exits.filter((e) => e.severity === "low").length,
  };
}

/**
 * A stable fingerprint of a set of flags.
 *
 * Used to decide whether anything is actually NEW since the reader last
 * looked. Without it an alert fires on every open and becomes wallpaper.
 */
export function exitsSignature(exits: Exit[]): string {
  return exits
    .map((e) => `${e.ticker}:${e.rule}`)
    .sort()
    .join("|");
}

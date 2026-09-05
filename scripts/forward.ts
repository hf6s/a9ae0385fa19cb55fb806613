/**
 * Forward test: what the model's picks ACTUALLY returned after it picked them.
 *
 * WHY THIS EXISTS. Everything else measuring this strategy looks backwards.
 * The backtest replays fourteen years the model has now been fitted against
 * roughly thirty times, and the one configuration that won that sample failed
 * on data it had not seen. A backtest cannot settle the question any more.
 *
 * This can, eventually. Every scan records its ranked list with the price on
 * the day, before the outcome exists. This script reads those records and
 * computes what an equal-weight basket of the top N would have returned from
 * each past scan date to today, against SPY over exactly the same window.
 *
 * IT WILL SAY NOTHING USEFUL FOR MONTHS. A handful of scans over a few weeks
 * is noise, and the honest output at that point is "not enough history yet",
 * not a number. It is built now because the record has to start accumulating
 * before it can ever be read, and because a result nobody can fake is worth
 * more than another backtest.
 *
 * Usage:
 *   npm run forward              # top 20, every recorded scan
 *   npm run forward -- --top 5   # top 5
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/lib/env";
import { dailyHistory } from "../src/lib/prices";
import type { Candle, ScoreHistoryPoint } from "../src/lib/types";

loadEnv();

const DATA_DIR = path.join(process.cwd(), "data");
/** Below this, a window is too short for its return to mean anything. */
const MIN_DAYS = 30;

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Closing price on the last session at or before a date. */
function priceOn(candles: { t: string; a?: number; c: number }[], dateISO: string): number | null {
  let best: number | null = null;
  for (const c of candles) {
    if (c.t <= dateISO) best = c.a ?? c.c;
    else break;
  }
  return best;
}

async function main() {
  const topN = Number(argValue("--top")) || 20;
  const histPath = path.join(DATA_DIR, "score-history.json");
  if (!fs.existsSync(histPath)) throw new Error("no score-history.json — run a scan first");
  const history: ScoreHistoryPoint[] = JSON.parse(fs.readFileSync(histPath, "utf8"));

  // Snapshots older than forward tracking recorded rank without price. That is
  // recoverable rather than fatal: the RANK was fixed on the day, and the close
  // on a past date is a historical fact, not a prediction. Reconstructing it
  // introduces no lookahead, because nothing about the pick is being re-decided.
  const usable = history.filter((h) => Object.keys(h.entries).length > 0);
  const withPrice = history.filter((h) =>
    Object.values(h.entries).some((e) => typeof e.p === "number" && e.p > 0),
  ).length;
  console.log(
    `${history.length} recorded scans, ${usable.length} with rankings ` +
      `(${withPrice} recorded prices at the time; the rest reconstructed from history)`,
  );
  if (usable.length === 0) {
    console.log("No scan has recorded a ranking yet.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const bench = await dailyHistory("SPY", 1300, "5y");
  if (!bench || bench.length === 0) throw new Error("could not fetch SPY for the benchmark");
  const benchNow = priceOn(bench, today);

  // Every ticker that appears in any measurable snapshot's top N.
  const needed = new Set<string>();
  for (const snap of usable) {
    for (const t of topOf(snap, topN)) needed.add(t);
  }
  console.log(`Fetching current prices for ${needed.size} tickers...`);
  const series = new Map<string, Candle[]>();
  const list = [...needed];
  for (let i = 0; i < list.length; i += 5) {
    const chunk = list.slice(i, i + 5);
    const got = await Promise.all(chunk.map((t) => dailyHistory(t, 400, "2y").catch(() => null)));
    got.forEach((c, j) => {
      if (c && c.length) series.set(chunk[j], c);
    });
  }
  console.log(`  fetched ${series.size}/${list.length} price series`);

  console.log("");
  console.log("  picked on    days   picks  model    SPY     diff");
  console.log("  " + "-".repeat(50));

  const rows: { days: number; model: number; spx: number }[] = [];
  for (const snap of usable) {
    const days = Math.round(
      (new Date(today).getTime() - new Date(snap.date).getTime()) / 86_400_000,
    );
    const picks = topOf(snap, topN);
    // Equal weight, held from the pick date to today. No rebalancing: this is
    // "what if you bought the list that day", which is what a reader would do.
    const rets: number[] = [];
    for (const t of picks) {
      const candles = series.get(t);
      // Prefer the price the model actually saw; fall back to the close on that
      // date from history when the snapshot predates price recording.
      const then = snap.entries[t]?.p ?? (candles ? priceOn(candles, snap.date) : null);
      const nowP = candles ? priceOn(candles, today) : null;
      if (!then || !nowP) continue; // delisted or unfetchable
      rets.push(nowP / then - 1);
    }
    const benchThen = priceOn(bench, snap.date);
    if (rets.length === 0 || benchThen === null || benchNow === null) continue;
    const model = (rets.reduce((a, b) => a + b, 0) / rets.length) * 100;
    const spx = (benchNow / benchThen - 1) * 100;
    const flag = days < MIN_DAYS ? "  (too short to mean anything)" : "";
    console.log(
      `  ${snap.date}  ${String(days).padStart(5)}  ${String(rets.length).padStart(5)}  ` +
        `${(model.toFixed(1) + "%").padStart(6)}  ${(spx.toFixed(1) + "%").padStart(6)}  ` +
        `${((model - spx > 0 ? "+" : "") + (model - spx).toFixed(1)).padStart(6)}${flag}`,
    );
    if (days >= MIN_DAYS) rows.push({ days, model, spx });
  }

  console.log("");
  if (rows.length === 0) {
    console.log(
      `No window is at least ${MIN_DAYS} days old yet. Anything shorter is noise,\n` +
        "so there is no honest summary to give.",
    );
    return;
  }
  const beat = rows.filter((r) => r.model > r.spx).length;
  const avg = rows.reduce((a, r) => a + (r.model - r.spx), 0) / rows.length;
  console.log(
    `Across ${rows.length} windows of at least ${MIN_DAYS} days: ` +
      `beat SPY in ${beat} of ${rows.length}, average excess ${avg > 0 ? "+" : ""}${avg.toFixed(1)} pts.`,
  );
  console.log(
    "\nThis is a small sample of overlapping windows, not a verdict. It becomes\n" +
      "meaningful after months of scans, and it is the only measurement here that\n" +
      "a backtest cannot flatter.",
  );
}

/** The top N tickers of one snapshot, by recorded rank. */
function topOf(snap: ScoreHistoryPoint, topN: number): string[] {
  return Object.entries(snap.entries)
    .sort((a, b) => a[1].r - b[1].r)
    .slice(0, topN)
    .map(([t]) => t);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

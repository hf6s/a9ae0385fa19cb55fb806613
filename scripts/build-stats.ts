/**
 * Facts about this repository, written to data/build-stats.json.
 *
 * The invoice page states how much work went into the thing being invoiced.
 * Typed numbers would rot the moment anything changed, and a stale claim on a
 * bill is worse than no claim, so they are counted from the repository itself
 * and refreshed by running this.
 *
 *   npm run stats
 *
 * Everything here is countable. Nothing is estimated, and where a number
 * cannot be obtained the field is omitted rather than guessed — the page drops
 * any row it does not have.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface BuildStats {
  generatedAt: string;
  commits?: number;
  tests?: number;
  sourceLines?: number;
  scansPublished?: number;
  firstCommit?: string;
  days?: number;
}

function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function countTests(): number | undefined {
  const dir = path.join(process.cwd(), "src", "lib");
  try {
    let total = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      total += (src.match(/^\s*it\(/gm) ?? []).length;
    }
    return total || undefined;
  } catch {
    return undefined;
  }
}

function countSourceLines(): number | undefined {
  const roots = ["src", "scripts"];
  let total = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|css)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        total += fs.readFileSync(full, "utf8").split("\n").length;
      }
    }
  };
  try {
    for (const r of roots) walk(path.join(process.cwd(), r));
    return total || undefined;
  } catch {
    return undefined;
  }
}

const first = git("log --reverse --format=%aI -- . | head -1") ?? git("log --reverse --format=%aI");
const firstCommit = first ? first.split("\n")[0] : undefined;

const stats: BuildStats = {
  generatedAt: new Date().toISOString(),
  commits: Number(git("rev-list --count HEAD")) || undefined,
  tests: countTests(),
  sourceLines: countSourceLines(),
  // Every published scan is a commit that changed the rankings file, which is
  // a truer count of "times this actually ran" than any log.
  scansPublished: Number(git("rev-list --count HEAD -- data/rankings.json")) || undefined,
  firstCommit,
  days: firstCommit
    ? Math.max(1, Math.round((Date.now() - new Date(firstCommit).getTime()) / 86400000))
    : undefined,
};

const out = path.join(process.cwd(), "data", "build-stats.json");
fs.writeFileSync(out, `${JSON.stringify(stats, null, 2)}\n`);
console.log("wrote", out);
console.log(stats);

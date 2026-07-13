import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Trigger a backtest as a detached child process (local only). */
export async function POST() {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: "Backtests run locally or in CI — not on the deployed site." },
      { status: 501 },
    );
  }

  const cwd = process.cwd();
  const statusPath = path.join(cwd, "data", "backtest-status.json");
  if (fs.existsSync(statusPath)) {
    try {
      const current = JSON.parse(fs.readFileSync(statusPath, "utf8").replace(/^\uFEFF/, ""));
      if (current.state === "running" && Date.now() - Date.parse(current.updatedAt) < 120_000) {
        return NextResponse.json({ error: "A backtest is already running." }, { status: 409 });
      }
    } catch {
      /* allow */
    }
  }

  const out = fs.openSync(path.join(cwd, "backtest.log"), "w");
  const child = spawn("npx tsx scripts/backtest.ts", {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();

  const now = new Date().toISOString();
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(
    statusPath,
    JSON.stringify({
      state: "running",
      phase: "starting",
      done: 0,
      total: 0,
      startedAt: now,
      phaseStartedAt: now,
      updatedAt: now,
    }),
  );

  return NextResponse.json({ ok: true });
}

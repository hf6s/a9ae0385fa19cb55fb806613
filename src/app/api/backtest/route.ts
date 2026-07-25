import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkDailyQuota, dispatchWorkflow, githubConfigured } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * Starts a backtest.
 *
 * Deployed: dispatches the GitHub Actions workflow, one run per 24h. The job
 * replays ~10 years over ~700 companies and runs far longer than a serverless
 * function is allowed to.
 *
 * Local: spawns the script directly, unmetered.
 */
export async function POST() {
  if (process.env.VERCEL) {
    if (!githubConfigured()) {
      return NextResponse.json(
        { error: "Remote runs are not configured yet: GITHUB_TOKEN is missing." },
        { status: 503 },
      );
    }
    const quota = await checkDailyQuota("backtest");
    if (!quota.allowed) {
      const next = quota.nextAllowedAt ? new Date(quota.nextAllowedAt) : null;
      return NextResponse.json(
        {
          error: "Daily limit reached: one backtest per 24 hours.",
          nextAllowedAt: quota.nextAllowedAt,
          message: next
            ? `Next backtest available ${next.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`
            : undefined,
        },
        { status: 429 },
      );
    }
    const result = await dispatchWorkflow("backtest");
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true, remote: true });
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

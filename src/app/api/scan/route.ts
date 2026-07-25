import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkDailyQuota, dispatchWorkflow, githubConfigured } from "@/lib/github";
import type { ScanStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Starts a scan.
 *
 * Deployed: dispatches the GitHub Actions workflow, capped at one run per day.
 * A scan runs for ~90 minutes, far past any serverless timeout, so the site
 * kicks off CI and then reports on its progress.
 *
 * Local: spawns the script directly, unmetered.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "universe" ? "universe" : "sp500";

  if (process.env.VERCEL) {
    if (!githubConfigured()) {
      return NextResponse.json(
        { error: "Remote runs are not configured yet: GITHUB_TOKEN is missing." },
        { status: 503 },
      );
    }
    const quota = await checkDailyQuota("scan");
    if (!quota.allowed) {
      const next = quota.nextAllowedAt ? new Date(quota.nextAllowedAt) : null;
      return NextResponse.json(
        {
          error: "Daily limit reached: one scan per 24 hours.",
          nextAllowedAt: quota.nextAllowedAt,
          message: next
            ? `Next scan available ${next.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`
            : undefined,
        },
        { status: 429 },
      );
    }
    const result = await dispatchWorkflow("scan", { mode, analyze: "true" });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, mode, remote: true });
  }

  const cwd = process.cwd();
  const statusPath = path.join(cwd, "data", "scan-status.json");

  // Refuse if a scan is already running (status heartbeat within 2 minutes)
  if (fs.existsSync(statusPath)) {
    try {
      const current = JSON.parse(fs.readFileSync(statusPath, "utf8")) as ScanStatus;
      if (
        current.state === "running" &&
        Date.now() - Date.parse(current.updatedAt) < 120_000
      ) {
        return NextResponse.json({ error: "A scan is already running." }, { status: 409 });
      }
    } catch {
      /* unreadable status — allow */
    }
  }

  if (mode === "universe" && !fs.existsSync(path.join(cwd, "data", "universe.json"))) {
    return NextResponse.json(
      { error: "Universe not built yet — run `npm run universe` first." },
      { status: 400 },
    );
  }

  const args = mode === "sp500" ? " --sp500" : "";
  const out = fs.openSync(path.join(cwd, "scan.log"), "w");
  const child = spawn(`npx tsx scripts/scan.ts${args}`, {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();

  // Immediate optimistic status so the UI flips before the script's first write
  const now = new Date().toISOString();
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(
    statusPath,
    JSON.stringify({
      state: "running",
      mode,
      phase: "starting",
      done: 0,
      total: 0,
      startedAt: now,
      phaseStartedAt: now,
      updatedAt: now,
    } satisfies ScanStatus),
  );

  return NextResponse.json({ ok: true, mode });
}

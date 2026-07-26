import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkDailyQuota, githubConfigured, latestRun, runProgress } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * Scan status.
 *
 * Locally the running script writes data/scan-status.json every few tickers,
 * so that file is live. On the deployed site the work happens in GitHub
 * Actions and the committed file is a snapshot of the LAST finished run, so
 * the workflow run state is authoritative for "is something running now".
 */
/**
 * A running scan rewrites its status every ticker. If the heartbeat stops, the
 * process died (killed, crashed, machine slept) and the file lies about being
 * "running" forever. Anything older than this is treated as dead.
 */
const HEARTBEAT_TIMEOUT_MS = 3 * 60 * 1000;

function withStaleness(s: Record<string, unknown>): Record<string, unknown> {
  if (s.state !== "running") return s;
  const beat = Date.parse(String(s.updatedAt ?? ""));
  if (Number.isFinite(beat) && Date.now() - beat > HEARTBEAT_TIMEOUT_MS) {
    return {
      ...s,
      state: "error",
      stale: true,
      error: `Scan stopped responding at ${new Date(beat).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })} after ${s.done ?? 0}/${s.total ?? 0} tickers.`,
    };
  }
  return s;
}

export async function GET() {
  let local: Record<string, unknown> = { state: "idle" };
  const file = path.join(process.cwd(), "data", "scan-status.json");
  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, ""); // tolerate BOM
      local = withStaleness(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      /* keep idle */
    }
  }

  if (!process.env.VERCEL) return NextResponse.json(local);

  if (!githubConfigured()) {
    return NextResponse.json({ ...local, remote: true, configured: false });
  }

  const [run, quota] = await Promise.all([latestRun("scan"), checkDailyQuota("scan")]);
  const active = run !== null && run.status !== "completed";
  // GitHub exposes no per-step progress, so the ETA comes from how long this
  // workflow's own past runs took.
  const progress = active && run ? await runProgress("scan", run.createdAt) : null;

  return NextResponse.json({
    ...local,
    // A committed status file says "running" if CI was interrupted mid-scan;
    // GitHub decides instead, so the dashboard cannot get stuck.
    state: active ? "running" : local.state === "running" ? "done" : (local.state ?? "idle"),
    remote: true,
    configured: true,
    run: run
      ? {
          status: run.status,
          conclusion: run.conclusion,
          startedAt: run.createdAt,
          updatedAt: run.updatedAt,
          url: run.url,
        }
      : null,
    quota: { allowed: quota.allowed, nextAllowedAt: quota.nextAllowedAt ?? null },
    progress,
  });
}

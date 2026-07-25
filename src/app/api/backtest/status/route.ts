import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkDailyQuota, githubConfigured, latestRun } from "@/lib/github";

export const dynamic = "force-dynamic";

/** A dead run leaves its last heartbeat behind; treat a stale one as failed. */
const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // EDGAR phases are slow between writes

function withStaleness(s: Record<string, unknown>): Record<string, unknown> {
  if (s.state !== "running") return s;
  const beat = Date.parse(String(s.updatedAt ?? ""));
  if (Number.isFinite(beat) && Date.now() - beat > HEARTBEAT_TIMEOUT_MS) {
    return {
      ...s,
      state: "error",
      stale: true,
      error: `Backtest stopped responding at ${new Date(beat).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })} during "${s.phase ?? "unknown"}".`,
    };
  }
  return s;
}

/** Same split as the scan status: local file when local, GitHub run when deployed. */
export async function GET() {
  let local: Record<string, unknown> = { state: "idle" };
  const file = path.join(process.cwd(), "data", "backtest-status.json");
  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
      local = withStaleness(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      /* keep idle */
    }
  }

  if (!process.env.VERCEL) return NextResponse.json(local);

  if (!githubConfigured()) {
    return NextResponse.json({ ...local, remote: true, configured: false });
  }

  const [run, quota] = await Promise.all([latestRun("backtest"), checkDailyQuota("backtest")]);
  const active = run !== null && run.status !== "completed";

  return NextResponse.json({
    ...local,
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
  });
}

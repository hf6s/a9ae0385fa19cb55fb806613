import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkDailyQuota, githubConfigured, latestRun } from "@/lib/github";

export const dynamic = "force-dynamic";

/** Same split as the scan status: local file when local, GitHub run when deployed. */
export async function GET() {
  let local: Record<string, unknown> = { state: "idle" };
  const file = path.join(process.cwd(), "data", "backtest-status.json");
  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
      local = JSON.parse(raw) as Record<string, unknown>;
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

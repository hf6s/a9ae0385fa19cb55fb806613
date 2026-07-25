import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkDailyQuota, githubConfigured, latestRun } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * Scan status.
 *
 * Locally the running script writes data/scan-status.json every few tickers,
 * so that file is live. On the deployed site the work happens in GitHub
 * Actions and the committed file is a snapshot of the LAST finished run, so
 * the workflow run state is authoritative for "is something running now".
 */
export async function GET() {
  let local: Record<string, unknown> = { state: "idle" };
  const file = path.join(process.cwd(), "data", "scan-status.json");
  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, ""); // tolerate BOM
      local = JSON.parse(raw) as Record<string, unknown>;
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
  });
}

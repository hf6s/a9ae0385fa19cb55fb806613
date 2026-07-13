import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { ScanStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Trigger a scan as a detached child process. Local-only — on Vercel,
 * scans run via the nightly GitHub Action instead.
 */
export async function POST(req: Request) {
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        error:
          "On the deployed site, scans run automatically each night via GitHub Actions. Run the site locally to trigger scans manually.",
      },
      { status: 501 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "universe" ? "universe" : "sp500";

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

import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const file = path.join(process.cwd(), "data", "backtest-status.json");
  if (!fs.existsSync(file)) {
    return NextResponse.json({ state: "idle" });
  }
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ state: "idle" });
  }
}

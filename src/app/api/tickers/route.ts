import { NextResponse } from "next/server";
import { getRankings } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const rankings = getRankings();
  return NextResponse.json(
    rankings?.stocks.map((s) => ({ ticker: s.ticker, name: s.name, rank: s.rank })) ?? [],
  );
}

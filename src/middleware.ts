import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Password gate for the control surfaces.
 *
 * The rankings, backtest and stock pages stay public: they are the product.
 * What is NOT public is anything that spends money or changes data. The scan
 * and backtest endpoints trigger GitHub Actions runs that cost real API calls,
 * and until this existed anyone who found the URL could press the button.
 *
 * Basic auth rather than accounts: this is a stopgap for a single operator.
 * Real per-user accounts are still the v1 requirement.
 *
 * With DASHBOARD_PASSWORD unset (local dev) the gate is open.
 */

/** Constant-time-ish compare so the response time does not leak the password. */
function matches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return NextResponse.next();

  // Status polling is read-only and drives the public dashboard's progress
  // display; gating it would just spam a login prompt on every poll.
  if (req.nextUrl.pathname.endsWith("/status") && req.method === "GET") {
    return NextResponse.next();
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const password = decoded.slice(decoded.indexOf(":") + 1);
      if (matches(password, expected)) return NextResponse.next();
    } catch {
      /* malformed header falls through to the challenge */
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Factor20 controls", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/scan/:path*", "/api/backtest/:path*"],
};

import { NextResponse } from "next/server";
import webpush from "web-push";
import { getPrevRankings, getRankings } from "@/lib/data";
import { envValue } from "@/lib/env-value";
import { computeExits, exitsSignature } from "@/lib/exits";
import { readState, removeSub, writeState } from "@/lib/push-store";

/**
 * Sends a notification when the sell rules flag something NEW.
 *
 * Called by a scheduled job rather than by a person. Protected by a shared
 * secret: an open endpoint that pushes to every registered phone is a
 * spam button.
 *
 * NOTHING IS SENT TWICE. The alert set is fingerprinted by ticker and rule,
 * the last fingerprint sent is stored alongside the subscriptions, and an
 * unchanged fingerprint sends nothing at all. A notification that repeats
 * itself daily is one that gets switched off - and then the real one never
 * arrives.
 *
 * Dead subscriptions are pruned on the spot: a 404 or 410 from a push service
 * means that device is gone for good.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = envValue("PUSH_DISPATCH_SECRET");
  const auth = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const given = auth.replace(/^Bearer\s+/i, "") || url.searchParams.get("key") || "";

  // Vercel's own scheduler authenticates with CRON_SECRET; accept either.
  const cronSecret = envValue("CRON_SECRET");
  const allowed = (secret && given === secret) || (cronSecret && given === cronSecret);
  if (!allowed) return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const publicKey = envValue("VAPID_PUBLIC_KEY");
  const privateKey = envValue("VAPID_PRIVATE_KEY");
  const contact = envValue("SEC_CONTACT") ?? "mailto:alerts@factor20.invalid";
  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "Alerts are not configured." }, { status: 503 });
  }

  const exits = computeExits(getRankings(), getPrevRankings());
  const signature = exitsSignature(exits);
  const state = await readState();

  if (exits.length === 0) {
    // Nothing to say. Record it so the next genuine alert is recognised as new.
    if (state.lastSignature !== signature) await writeState({ ...state, lastSignature: signature });
    return NextResponse.json({ sent: 0, reason: "nothing flagged" });
  }
  if (state.lastSignature === signature) {
    return NextResponse.json({ sent: 0, reason: "already sent" });
  }
  if (state.subs.length === 0) {
    return NextResponse.json({ sent: 0, reason: "no devices" });
  }

  webpush.setVapidDetails(
    contact.startsWith("mailto:") ? contact : `mailto:${contact}`,
    publicKey,
    privateKey,
  );

  const high = exits.filter((e) => e.severity === "high");
  const payload = JSON.stringify({
    title: high.length > 0 ? "Sell rule hit" : "Positions to review",
    body:
      high.length > 0
        ? `${high.map((e) => e.ticker).slice(0, 3).join(", ")}${high.length > 3 ? "…" : ""} — ${high[0].rule}`
        : `${exits.length} flagged on the latest scan.`,
    url: "/exits",
  });

  let sent = 0;
  let dropped = 0;
  let next = state;

  for (const sub of state.subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
        { TTL: 60 * 60 * 12 },
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        next = removeSub(next, sub.endpoint);
        dropped++;
      }
    }
  }

  await writeState({ ...next, lastSignature: signature, lastSentAt: new Date().toISOString() });
  return NextResponse.json({ sent, dropped, flagged: exits.length });
}

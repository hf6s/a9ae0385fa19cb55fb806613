import { NextResponse } from "next/server";
import { envValue } from "@/lib/env-value";
import { addSub, readState, removeSub, writeState, type PushSub } from "@/lib/push-store";

/**
 * Register or drop a device for sell alerts.
 *
 * Stores nothing but what the browser hands over - an endpoint and its two
 * keys - plus the time. No name, no account, no identifier of any kind, and
 * the whole file is encrypted at rest because it lives in a public repository.
 *
 * Unsubscribing is the same endpoint with DELETE, so turning alerts off
 * actually removes the device rather than just muting it locally.
 */

function valid(sub: unknown): sub is PushSub {
  if (!sub || typeof sub !== "object") return false;
  const s = sub as PushSub;
  return (
    typeof s.endpoint === "string" &&
    s.endpoint.startsWith("https://") &&
    typeof s.keys?.p256dh === "string" &&
    typeof s.keys?.auth === "string"
  );
}

export async function POST(req: Request) {
  if (!envValue("PUSH_SECRET") || !envValue("VAPID_PRIVATE_KEY")) {
    return NextResponse.json({ error: "Alerts are not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const sub = (body as { subscription?: unknown }).subscription;
  if (!valid(sub)) {
    return NextResponse.json({ error: "Bad subscription." }, { status: 400 });
  }

  const state = await readState();
  // A browser re-issues the same endpoint for the same device, so this
  // replaces rather than appends - otherwise one phone gets two of every alert.
  const next = addSub(state, {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    at: new Date().toISOString(),
  });

  const ok = await writeState(next);
  return ok
    ? NextResponse.json({ ok: true, devices: next.subs.length })
    : NextResponse.json({ error: "Could not save." }, { status: 502 });
}

export async function DELETE(req: Request) {
  let endpoint = "";
  try {
    endpoint = ((await req.json()) as { endpoint?: string }).endpoint ?? "";
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!endpoint) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const state = await readState();
  const ok = await writeState(removeSub(state, endpoint));
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Could not save." }, { status: 502 });
}

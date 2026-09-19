"use client";

import { useEffect, useState } from "react";

/**
 * Turns real sell notifications on and off.
 *
 * These arrive with the app closed, which is the whole point — a phone in a
 * pocket is where a sell signal has to reach someone.
 *
 * WHAT IT TELLS THE TRUTH ABOUT. On iPhone this only works once the site is on
 * the home screen: Safari refuses push to ordinary tabs, and no amount of
 * asking changes that. So rather than throw a permission prompt that cannot
 * succeed, it says so and points at Add to Home Screen.
 *
 * Turning it off unsubscribes properly, so the device is removed from the
 * sender rather than left registered and silently muted.
 */

type State = "loading" | "unsupported" | "needs-install" | "off" | "on" | "blocked" | "working";

/**
 * VAPID keys travel as base64url; `subscribe` wants raw bytes.
 *
 * Typed as ArrayBuffer rather than Uint8Array because the DOM signature
 * insists on a buffer backed by an ArrayBuffer, and a plain Uint8Array may be
 * backed by a SharedArrayBuffer as far as the type system is concerned.
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export default function AlertToggle({ vapidKey }: { vapidKey: string }) {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!vapidKey) {
      setState("unsupported");
      return;
    }
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

    if (!supported) {
      // iOS below 16.4, or a browser with push disabled. On iOS the usual
      // cause is that the site is open in a tab rather than installed.
      const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
      setState(isIos ? "needs-install" : "unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, [vapidKey]);

  const enable = async () => {
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToBuffer(vapidKey),
        }));

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setState(res.ok ? "on" : "off");
    } catch {
      setState("off");
    }
  };

  const disable = async () => {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  };

  if (state === "loading") return null;

  return (
    <section className="alerts-toggle">
      <div className="alerts-copy">
        <strong>Sell alerts</strong>
        {state === "on" ? (
          <span>On. Your phone gets a notification when a holding breaks a rule.</span>
        ) : state === "blocked" ? (
          <span>
            Blocked in your browser settings. Allow notifications for this site, then come back.
          </span>
        ) : state === "needs-install" ? (
          <span>
            On iPhone these only work once the site is on your home screen. Tap Share, then Add to
            Home Screen, and open it from there.
          </span>
        ) : state === "unsupported" ? (
          <span>This browser cannot receive notifications.</span>
        ) : (
          <span>Get a notification when a holding breaks a sell rule, even with the app shut.</span>
        )}
      </div>

      {state === "on" ? (
        <button type="button" className="btn-outline" onClick={disable}>
          Turn off
        </button>
      ) : state === "off" ? (
        <button type="button" className="btn" onClick={enable}>
          Turn on
        </button>
      ) : state === "working" ? (
        <button type="button" className="btn" disabled>
          Working
        </button>
      ) : null}
    </section>
  );
}

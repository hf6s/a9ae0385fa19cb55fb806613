"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Exit } from "@/lib/exits";

/**
 * What the app says the moment it opens: anything the sell rules have flagged.
 *
 * ONLY SPEAKS WHEN SOMETHING IS NEW. The flags are fingerprinted by ticker and
 * rule, and the fingerprint of what the reader last acknowledged is kept
 * locally. Re-showing the same three names every morning turns the one part of
 * this app that matters into wallpaper, and then a real sell signal arrives and
 * gets dismissed with the rest.
 *
 * The desktop notification is deliberately modest: it fires only while the app
 * is open, only with permission, and only for genuinely new flags. Notifications
 * that arrive with the app closed need a push server, which does not exist yet -
 * so this promises nothing it cannot do.
 */

const SEEN_KEY = "f20-exits-seen";

export default function ExitAlerts({
  exits,
  signature,
}: {
  exits: Exit[];
  signature: string;
}) {
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    if (exits.length === 0) return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      /* blocked storage: treat everything as new, which errs toward telling */
    }
    if (seen === signature) return;

    setFresh(true);

    // Only with permission already granted. Asking on arrival is the fastest
    // way to be denied for good.
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const high = exits.filter((e) => e.severity === "high").length;
      try {
        new Notification("Factor20", {
          body:
            high > 0
              ? `${high} holding${high === 1 ? "" : "s"} hit a sell rule.`
              : `${exits.length} position${exits.length === 1 ? "" : "s"} flagged to review.`,
          icon: "/icon-192.png",
          tag: "f20-exits",
        });
      } catch {
        /* a refused notification must not break the page */
      }
    }
  }, [exits, signature]);

  const acknowledge = () => {
    try {
      localStorage.setItem(SEEN_KEY, signature);
    } catch {
      /* nothing to do */
    }
    setFresh(false);
  };

  const ask = async () => {
    if (typeof Notification === "undefined") return;
    try {
      await Notification.requestPermission();
    } catch {
      /* denied is a normal answer */
    }
  };

  if (exits.length === 0 || !fresh) return null;

  const high = exits.filter((e) => e.severity === "high");
  const shown = (high.length > 0 ? high : exits).slice(0, 3);

  return (
    <aside className={`exit-alert${high.length > 0 ? " is-high" : ""}`}>
      <div className="exit-alert-head">
        <strong>
          {high.length > 0
            ? `${high.length} sell rule${high.length === 1 ? "" : "s"} hit`
            : `${exits.length} flagged to review`}
        </strong>
        <button type="button" className="exit-alert-x" onClick={acknowledge} aria-label="Dismiss">
          Dismiss
        </button>
      </div>
      <ul className="exit-alert-list">
        {shown.map((e) => (
          <li key={`${e.ticker}-${e.rule}`}>
            <b>{e.ticker}</b>
            <span>{e.rule}</span>
          </li>
        ))}
      </ul>
      <div className="exit-alert-foot">
        <Link href="/exits" onClick={acknowledge}>
          See all exit signals
        </Link>
        {typeof Notification !== "undefined" && Notification.permission === "default" ? (
          <button type="button" className="exit-alert-bell" onClick={ask}>
            Notify me
          </button>
        ) : null}
      </div>
    </aside>
  );
}

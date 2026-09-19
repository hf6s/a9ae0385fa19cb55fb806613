"use client";

import { useEffect, useState } from "react";

/**
 * Offers to put the site on the home screen.
 *
 * TWO PLATFORMS, TWO REALITIES. Android fires `beforeinstallprompt` and lets a
 * page ask properly, so that is a real button. Safari has no such API and
 * never will on request, so iPhone gets the one thing that does work:
 * instructions for the Share menu. Pretending a button exists on iOS would be
 * worse than saying nothing.
 *
 * It registers the service worker too, since that is what installability on
 * Android depends on.
 *
 * Shown once, dismissible, and never again after it is dismissed or the app is
 * already installed. A banner that keeps asking is an advert.
 */

const DISMISSED = "f20-install-dismissed";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // No worker means no offline copy and no Android install banner. The
        // site works regardless, so this is not worth surfacing.
      });
    }

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED) === "1";
    } catch {
      /* blocked storage: treat as not dismissed */
    }
    if (dismissed) return;

    // Already installed: nothing to offer.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS: no event is coming, so detect the platform and explain instead.
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari) setShowIos(true);

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* nothing to do */
    }
    setPrompt(null);
    setShowIos(false);
  };

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    dismiss();
  };

  if (!prompt && !showIos) return null;

  return (
    <div className="install-card">
      <div className="install-body">
        <strong>Keep it on your home screen</strong>
        {prompt ? (
          <span>Opens full screen, and works offline on the last scan.</span>
        ) : (
          <span>
            Tap Share, then <b>Add to Home Screen</b>. It opens full screen and keeps the last scan
            offline.
          </span>
        )}
      </div>
      <div className="install-actions">
        {prompt ? (
          <button type="button" className="btn" onClick={install}>
            Install
          </button>
        ) : null}
        <button type="button" className="install-dismiss" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

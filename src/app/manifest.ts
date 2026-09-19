import type { MetadataRoute } from "next";

/**
 * Makes the site installable, so it sits on a home screen and opens without
 * browser chrome.
 *
 * `start_url` is the rankings page rather than the invoice: the invoice is a
 * one-time document, the rankings are the thing worth opening every week.
 *
 * Standalone display is what turns "a bookmark" into "an app" on both
 * platforms, and on iOS it is also the only way notifications can ever work
 * later - Safari refuses them to tabs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Factor20 — stock rankings",
    short_name: "Factor20",
    description:
      "Ranks US stocks on published factor research, and flags holdings that break their sell rules.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0f14",
    theme_color: "#0c0f14",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

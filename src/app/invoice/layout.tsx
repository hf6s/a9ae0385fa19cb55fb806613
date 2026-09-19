import { IBM_Plex_Mono } from "next/font/google";
import type { ReactNode } from "react";

/**
 * The invoice runs on its own typeface, self-hosted.
 *
 * next/font downloads IBM Plex Mono at build time and serves it from this
 * origin, so there is no request to Google at runtime and no layout shift from
 * a late-arriving font. It is scoped to this route: the rest of the site keeps
 * the system stack, and nobody loading the rankings pays for a font they never
 * see.
 *
 * Four weights, no italics. A terminal does not italicise.
 */
const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-mono",
});

export default function InvoiceLayout({ children }: { children: ReactNode }) {
  return <div className={`${plex.variable} inv-root`}>{children}</div>;
}

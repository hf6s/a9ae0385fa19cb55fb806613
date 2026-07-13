import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Factor20 — evidence-based stock rankings",
  description:
    "A transparent factor model (Quality, Value, Momentum, Growth) ranking US large caps, with AI-written analysis of the top 20.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="inner">
            <Link href="/" className="logo">
              Factor<span>20</span>
            </Link>
            <span className="badge">beta</span>
            <span className="tagline">
              Quality · Value · Momentum · Growth — ranked nightly, explained by AI
            </span>
            <nav className="nav">
              <Link href="/">Rankings</Link>
              <Link href="/backtest">Backtest</Link>
              <Link href="/dashboard">Dashboard</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}

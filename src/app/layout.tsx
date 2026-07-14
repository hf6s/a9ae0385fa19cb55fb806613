import type { Metadata } from "next";
import Link from "next/link";
import ScrollProgress from "@/components/ScrollProgress";
import SearchBox from "@/components/SearchBox";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Factor20 — evidence-based stock rankings",
  description:
    "A transparent factor model (Quality, Value, Momentum, Growth) ranking US large caps, with AI-written analysis of the top 20.",
};

// Set the saved theme before first paint to avoid a flash of the wrong palette.
const themeScript = `(function(){try{var t=localStorage.getItem('f20-theme');if(t){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ScrollProgress />
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
              <Link href="/exits">Exits</Link>
              <Link href="/portfolio">Portfolio</Link>
              <Link href="/backtest">Backtest</Link>
              <Link href="/methodology">Methodology</Link>
              <Link href="/dashboard">Dashboard</Link>
            </nav>
            <SearchBox />
            <ThemeToggle />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}

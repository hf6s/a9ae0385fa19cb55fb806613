import type { Metadata } from "next";
import Link from "next/link";
import CommandPalette from "@/components/CommandPalette";
import Logo from "@/components/Logo";
import ScrollProgress from "@/components/ScrollProgress";
import SearchBox from "@/components/SearchBox";
import Sidebar from "@/components/Sidebar";
import "./globals.css";
import "./anim.css";

export const metadata: Metadata = {
  title: "Factor20 — evidence-based stock rankings",
  description:
    "A transparent factor model (Quality, Value, Momentum, Growth) ranking US stocks, with AI-written analysis.",
};

// Set the saved theme before first paint to avoid a flash of the wrong palette.
const themeScript = `(function(){try{var t=localStorage.getItem('f20-theme');if(t){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <div className="aurora" aria-hidden>
          <span className="aurora-blob a1" />
          <span className="aurora-blob a2" />
          <span className="aurora-blob a3" />
        </div>
        <ScrollProgress />
        <div className="app-shell">
          <Sidebar />
          <div className="app-content">
            <header className="topbar">
              <Link href="/" className="topbar-logo">
                <Logo size={24} />
              </Link>
              <span className="topbar-tag">
                Quality · Value · Momentum · Growth <span className="badge">beta</span>
              </span>
              <SearchBox />
            </header>
            {children}
          </div>
        </div>
        <CommandPalette />
      </body>
    </html>
  );
}

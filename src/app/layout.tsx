import type { Metadata } from "next";
import ScrollProgress from "@/components/ScrollProgress";
import SearchBox from "@/components/SearchBox";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

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
        <ScrollProgress />
        <div className="app-shell">
          <Sidebar />
          <div className="app-content">
            <header className="topbar">
              <span className="topbar-tag">
                Quality · Value · Momentum · Growth <span className="badge">beta</span>
              </span>
              <SearchBox />
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}

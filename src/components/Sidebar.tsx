"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

// Methodology and Portfolio are still reachable by URL; they are just off the
// sidebar. Factor Lab sits last as an exploratory tool rather than a daily one.
const LINKS = [
  { href: "/", icon: "▤", label: "Rankings" },
  { href: "/universe", icon: "✦", label: "Universe" },
  { href: "/exits", icon: "▼", label: "Exits" },
  { href: "/allocate", icon: "◑", label: "Position sizing" },
  { href: "/backtest", icon: "◷", label: "Backtest" },
  { href: "/dashboard", icon: "⣿", label: "Dashboard" },
  { href: "/lab", icon: "⚗", label: "Factor Lab" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("f20-sidebar") === "1");
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("f20-sidebar", next ? "1" : "0");
      return next;
    });
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <button
        className="mobile-menu-btn"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label="Menu"
      >
        ☰
      </button>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <aside
        className={`sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}
      >
        <Link href="/" className="sidebar-logo">
          <Logo markOnly={collapsed} />
        </Link>

        <nav className="sidebar-nav">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`side-link${isActive(l.href) ? " active" : ""}`}
              title={collapsed ? l.label : undefined}
            >
              <span className="side-icon">{l.icon}</span>
              {!collapsed && <span className="side-label">{l.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <ThemeToggle />
          <button className="collapse-btn" onClick={toggleCollapse} title="Collapse sidebar">
            {collapsed ? "»" : "«"}
          </button>
        </div>
      </aside>
    </>
  );
}

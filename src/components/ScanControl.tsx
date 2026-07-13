"use client";

import { useCallback, useEffect, useState } from "react";
import type { ScanStatus } from "@/lib/types";

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

export default function ScanControl({ universeBuilt }: { universeBuilt: boolean }) {
  const [scanStatus, setScanStatus] = useState<ScanStatus | { state: "idle" } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/scan/status", { cache: "no-store" });
      setScanStatus(await res.json());
    } catch {
      /* server briefly unavailable */
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [poll]);

  async function trigger(mode: "sp500" | "universe") {
    setMessage(null);
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const json = await res.json();
    if (!res.ok) setMessage(json.error ?? "Failed to start scan");
    else {
      setMessage(null);
      poll();
    }
  }

  const running = scanStatus?.state === "running";
  const s = running ? (scanStatus as ScanStatus) : null;

  let etaText = "—";
  let pct = 0;
  if (s && s.total > 0 && s.done > 0) {
    const elapsed = (Date.now() - Date.parse(s.phaseStartedAt)) / 1000;
    const rate = s.done / Math.max(elapsed, 1);
    etaText = formatEta((s.total - s.done) / Math.max(rate, 0.001));
    pct = Math.min(100, (s.done / s.total) * 100);
  }

  return (
    <div className="card scan-card">
      <div className="label">Scanner</div>
      {running && s ? (
        <div>
          <p>
            Scanning <strong>{s.mode === "universe" ? "full universe" : "S&P 500"}</strong> —
            phase: {s.phase}
          </p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="name-dim" style={{ marginTop: 8 }}>
            {s.done}/{s.total} · ETA for this phase: <strong>{etaText}</strong>
            {s.phase === "market data" && " (the longest phase — EDGAR + penalties follow)"}
          </p>
        </div>
      ) : (
        <div>
          {scanStatus?.state === "error" && (
            <p className="penalty" style={{ marginBottom: 10 }}>
              Last scan failed: {(scanStatus as ScanStatus).error}
            </p>
          )}
          {scanStatus?.state === "done" && (
            <p className="name-dim" style={{ marginBottom: 10 }}>
              Last scan completed{" "}
              {new Date((scanStatus as ScanStatus).finishedAt ?? "").toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          )}
          <div className="dash-buttons">
            <button className="btn" onClick={() => trigger("sp500")}>
              Scan S&P 500 <span className="btn-sub">~503 tickers · ~35 min</span>
            </button>
            <button
              className="btn"
              disabled={!universeBuilt}
              title={universeBuilt ? "" : "Universe not built yet — run `npm run universe`"}
              onClick={() => trigger("universe")}
            >
              Scan full universe{" "}
              <span className="btn-sub">
                {universeBuilt ? "1,300+ tickers · ~90 min" : "still building…"}
              </span>
            </button>
          </div>
          {message && <p className="penalty" style={{ marginTop: 10 }}>{message}</p>}
        </div>
      )}
    </div>
  );
}

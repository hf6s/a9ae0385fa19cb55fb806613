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

/** Extra fields the status route adds on the deployed site. */
interface RemoteBits {
  remote?: boolean;
  configured?: boolean;
  run?: { status: string; conclusion: string | null; startedAt: string; url: string } | null;
  quota?: { allowed: boolean; nextAllowedAt: string | null };
}

export function RemoteNotice({
  remote,
  quota,
  run,
  noun,
}: RemoteBits & { noun: string }) {
  if (!remote) return null;
  const next = quota?.nextAllowedAt ? new Date(quota.nextAllowedAt) : null;
  return (
    <p className="name-dim" style={{ marginTop: 10, fontSize: 12 }}>
      Runs on GitHub Actions · one {noun} per day
      {quota && !quota.allowed && next
        ? ` · next available ${next.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
        : ""}
      {run?.url ? (
        <>
          {" · "}
          <a href={run.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
            view run log
          </a>
        </>
      ) : null}
    </p>
  );
}

export default function ScanControl({ universeBuilt }: { universeBuilt: boolean }) {
  const [scanStatus, setScanStatus] = useState<
    (ScanStatus & RemoteBits) | ({ state: "idle" } & RemoteBits) | null
  >(null);
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
    if (!res.ok) setMessage(json.message ?? json.error ?? "Failed to start scan");
    else {
      setMessage(
        json.remote
          ? "Started on GitHub Actions. Progress appears here shortly; the site updates when the run commits its data."
          : null,
      );
      poll();
    }
  }

  const running = scanStatus?.state === "running";
  const s = running ? (scanStatus as ScanStatus) : null;

  let etaText = "—";
  let overallText = "—";
  let pct = 0;
  if (s && s.total > 0 && s.done > 0) {
    const elapsed = (Date.now() - Date.parse(s.phaseStartedAt)) / 1000;
    const rate = s.done / Math.max(elapsed, 1);
    const phaseEta = (s.total - s.done) / Math.max(rate, 0.001);
    etaText = formatEta(phaseEta);
    pct = Math.min(100, (s.done / s.total) * 100);
    // Rough overall estimate: after market data, ~13% of the universe goes
    // through EDGAR (~1.5s each) and penalties (~1.2s each)
    let overall = phaseEta;
    if (s.phase === "market data") overall += s.total * 0.13 * 2.7;
    else if (s.phase === "SEC EDGAR fundamentals") overall += s.total * 1.2;
    overallText = formatEta(overall);
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
            {s.done}/{s.total} · phase ETA: <strong>{etaText}</strong> · overall ≈{" "}
            <strong>{overallText}</strong>
          </p>
          <RemoteNotice
            remote={scanStatus?.remote}
            quota={scanStatus?.quota}
            run={scanStatus?.run}
            noun="scan"
          />
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
          {scanStatus?.remote && (
            <p className="cost-warning">
              Scans run automatically every 2 days. Each manual scan adds roughly $0.30 in AI
              write-up costs, so once a week is plenty on top of the schedule.
            </p>
          )}
          <RemoteNotice
            remote={scanStatus?.remote}
            quota={scanStatus?.quota}
            run={scanStatus?.run}
            noun="scan"
          />
          {message && <p className="penalty" style={{ marginTop: 10 }}>{message}</p>}
        </div>
      )}
    </div>
  );
}

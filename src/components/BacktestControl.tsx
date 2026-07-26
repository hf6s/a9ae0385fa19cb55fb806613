"use client";

import { useCallback, useEffect, useState } from "react";
import { RemoteNotice, RemoteProgress, type RunProgress } from "./ScanControl";

interface BtStatus {
  state: "idle" | "running" | "done" | "error";
  phase?: string;
  done?: number;
  total?: number;
  phaseStartedAt?: string;
  finishedAt?: string;
  error?: string;
  remote?: boolean;
  configured?: boolean;
  run?: { status: string; conclusion: string | null; startedAt: string; url: string } | null;
  quota?: { allowed: boolean; nextAllowedAt: string | null };
  progress?: RunProgress | null;
}

export default function BacktestControl({ hasResult }: { hasResult: boolean }) {
  const [st, setSt] = useState<BtStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/backtest/status", { cache: "no-store" });
      setSt(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [poll]);

  async function trigger() {
    setMessage(null);
    const res = await fetch("/api/backtest", { method: "POST" });
    const json = await res.json();
    if (!res.ok) setMessage(json.message ?? json.error ?? "Failed to start backtest");
    else {
      setMessage(
        json.remote
          ? "Started on GitHub Actions. The results page updates once the run commits its data."
          : null,
      );
      poll();
    }
  }

  const running = st?.state === "running";
  let etaText = "—";
  let pct = 0;
  if (running && st?.total && st.done && st.phaseStartedAt) {
    const elapsed = (Date.now() - Date.parse(st.phaseStartedAt)) / 1000;
    const rate = st.done / Math.max(elapsed, 1);
    const secs = (st.total - st.done) / Math.max(rate, 0.001);
    const m = Math.floor(secs / 60);
    etaText = m > 0 ? `${m}m ${Math.round(secs % 60)}s` : `${Math.round(secs)}s`;
    pct = Math.min(100, (st.done / st.total) * 100);
  }

  return (
    <div className="card scan-card">
      <div className="label">Backtest</div>
      {running && st?.progress ? (
        <div>
          <RemoteProgress progress={st.progress} label="Backtesting" />
          <RemoteNotice remote={st?.remote} quota={st?.quota} run={st?.run} noun="backtest" />
        </div>
      ) : running ? (
        <div>
          <p>
            Running — phase: {st?.phase}
          </p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="name-dim" style={{ marginTop: 8 }}>
            {st?.done}/{st?.total} · ETA: <strong>{etaText}</strong>
          </p>
          <RemoteNotice remote={st?.remote} quota={st?.quota} run={st?.run} noun="backtest" />
        </div>
      ) : (
        <div>
          {st?.state === "error" && (
            <p className="penalty" style={{ marginBottom: 10 }}>Last backtest failed: {st.error}</p>
          )}
          {st?.state === "done" && (
            <p className="name-dim" style={{ marginBottom: 10 }}>
              Completed{" "}
              {new Date(st.finishedAt ?? "").toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              — <a href="/backtest" style={{ color: "var(--accent)" }}>view results</a>
            </p>
          )}
          <div className="dash-buttons">
            <button className="btn" onClick={trigger}>
              Run backtest{" "}
              <span className="btn-sub">full model · 10y · survivorship-corrected</span>
            </button>
            {hasResult && (
              <a href="/backtest" className="btn" style={{ textDecoration: "none" }}>
                View results <span className="btn-sub">equity curve + stats</span>
              </a>
            )}
          </div>
          <RemoteNotice remote={st?.remote} quota={st?.quota} run={st?.run} noun="backtest" />
          {message && <p className="penalty" style={{ marginTop: 10 }}>{message}</p>}
        </div>
      )}
    </div>
  );
}

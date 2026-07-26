/**
 * Triggers long jobs (scan, backtest) as GitHub Actions runs.
 *
 * Why not run them in the API route: a scan takes ~90 minutes and a backtest
 * ~30, while a serverless function is killed after seconds. GitHub Actions
 * allows hours per job, and since prices now come from EODHD (which answers
 * datacenter IPs, unlike Yahoo and Finnhub's free tier) CI is finally a place
 * these jobs can actually succeed.
 *
 * Rate limit: one run per workflow per 24h, enforced against GitHub's own run
 * history rather than local state, so it holds across serverless instances and
 * redeploys with nothing to keep in sync.
 */

const API = "https://api.github.com";
const DAY_MS = 24 * 60 * 60 * 1000;

export const WORKFLOWS = {
  scan: "scan.yml",
  backtest: "backtest.yml",
} as const;

export type WorkflowName = keyof typeof WORKFLOWS;

/**
 * Strips whitespace and a leading byte-order mark.
 *
 * Values piped into an env store routinely arrive with a BOM or trailing
 * newline. A BOM in a header value throws "Cannot convert argument to a
 * ByteString ... value of 65279", which reads like a code bug and is not.
 */
function clean(v: string | undefined): string | null {
  if (!v) return null;
  const out = v.replace(/^﻿/, "").trim();
  return out.length > 0 ? out : null;
}

function repo(): string {
  // Override with GITHUB_REPO if the repository is ever moved or renamed.
  return clean(process.env.GITHUB_REPO) ?? "hf6s/a9ae0385fa19cb55fb806613";
}

function token(): string | null {
  return clean(process.env.GITHUB_TOKEN);
}

export function githubConfigured(): boolean {
  return Boolean(token());
}

function headers(t: string): Record<string, string> {
  return {
    Authorization: `Bearer ${t}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "factor20-site",
  };
}

export interface RunInfo {
  id: number;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | null
  createdAt: string;
  updatedAt: string;
  url: string;
}

export async function listRuns(name: WorkflowName, perPage = 5): Promise<RunInfo[]> {
  const t = token();
  if (!t) return [];
  try {
    const res = await fetch(
      `${API}/repos/${repo()}/actions/workflows/${WORKFLOWS[name]}/runs?per_page=${perPage}`,
      { headers: headers(t), cache: "no-store" },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      workflow_runs?: {
        id: number;
        status: string;
        conclusion: string | null;
        created_at: string;
        updated_at: string;
        html_url: string;
      }[];
    };
    return (json.workflow_runs ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      url: r.html_url,
    }));
  } catch {
    return [];
  }
}

export async function latestRun(name: WorkflowName): Promise<RunInfo | null> {
  const runs = await listRuns(name, 1);
  return runs[0] ?? null;
}

/** Fallbacks until this repo has finished runs to learn from. */
const ASSUMED_MS: Record<WorkflowName, number> = {
  scan: 35 * 60 * 1000,
  backtest: 20 * 60 * 1000,
};

export interface Progress {
  elapsedMs: number;
  typicalMs: number;
  /** Remaining estimate, floored at zero once a run passes its usual length. */
  etaMs: number;
  percent: number;
  /** True when typicalMs came from real history rather than the fallback. */
  measured: boolean;
  samples: number;
}

/**
 * How long this workflow usually takes, from its own successful runs.
 *
 * A GitHub run reports no per-step progress, so the dashboard cannot show
 * "412 of 503 tickers" the way a local scan does. Median past duration gives
 * an honest estimate instead of a spinner with no end in sight, and it adapts
 * as the universe grows rather than hard-coding a number that goes stale.
 */
export async function runProgress(
  name: WorkflowName,
  startedAt: string,
): Promise<Progress> {
  const runs = await listRuns(name, 10);
  const durations = runs
    .filter((r) => r.status === "completed" && r.conclusion === "success")
    .map((r) => Date.parse(r.updatedAt) - Date.parse(r.createdAt))
    .filter((d) => Number.isFinite(d) && d > 30_000); // ignore instant failures

  let typicalMs = ASSUMED_MS[name];
  if (durations.length > 0) {
    durations.sort((a, b) => a - b);
    typicalMs = durations[Math.floor(durations.length / 2)];
  }

  const elapsedMs = Math.max(0, Date.now() - Date.parse(startedAt));
  return {
    elapsedMs,
    typicalMs,
    etaMs: Math.max(0, typicalMs - elapsedMs),
    percent: Math.min(99, Math.round((elapsedMs / typicalMs) * 100)),
    measured: durations.length > 0,
    samples: durations.length,
  };
}

export interface QuotaState {
  allowed: boolean;
  /** Set when a run already happened inside the window. */
  lastRunAt?: string;
  nextAllowedAt?: string;
}

/**
 * One run per 24h, judged from GitHub's run history.
 *
 * Only runs that did work count. A cancelled or failed run produced no data,
 * so charging it against the quota would lock the button for a day over a run
 * that achieved nothing.
 */
export async function checkDailyQuota(name: WorkflowName): Promise<QuotaState> {
  const runs = await listRuns(name, 10);
  const counts = (r: RunInfo) =>
    r.status !== "completed" || r.conclusion === "success" || r.conclusion === null;
  const recent = runs.find(
    (r) => Date.now() - Date.parse(r.createdAt) < DAY_MS && counts(r),
  );
  if (!recent) return { allowed: true };
  return {
    allowed: false,
    lastRunAt: recent.createdAt,
    nextAllowedAt: new Date(Date.parse(recent.createdAt) + DAY_MS).toISOString(),
  };
}

export async function dispatchWorkflow(
  name: WorkflowName,
  inputs: Record<string, string> = {},
): Promise<{ ok: boolean; error?: string }> {
  const t = token();
  if (!t) return { ok: false, error: "GITHUB_TOKEN is not set on this deployment." };
  try {
    const res = await fetch(
      `${API}/repos/${repo()}/actions/workflows/${WORKFLOWS[name]}/dispatches`,
      {
        method: "POST",
        headers: { ...headers(t), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME ?? "master", inputs }),
      },
    );
    if (res.status === 204) return { ok: true };
    const body = await res.text();
    return { ok: false, error: `GitHub returned ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

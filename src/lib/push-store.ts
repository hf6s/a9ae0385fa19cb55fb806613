/**
 * Where push subscriptions live.
 *
 * THE PROBLEM. There is no database, and a push subscription endpoint is a
 * capability: anyone holding it can send notifications to that phone. The only
 * writable store this project has is its own repository, which is public.
 * Plain subscriptions there would hand strangers the ability to push whatever
 * they liked to marky's and Jorge's lock screens.
 *
 * THE ANSWER. The file is encrypted before it is written, with AES-256-GCM and
 * a key held only in the server environment. What lands in the public repo is
 * a base64 blob that is useless without the key, and tamper-evident with it.
 * A missing or wrong key fails closed: no subscriptions, no sends.
 *
 * Everything here runs server-side only.
 */

import { open, seal } from "./crypto-box";
import { envValue } from "./env-value";

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** When it was registered, so dead ones can be reasoned about later. */
  at: string;
}

export interface PushState {
  subs: PushSub[];
  /** Fingerprint of the alert set last sent, so nothing is sent twice. */
  lastSignature?: string;
  lastSentAt?: string;
}

const FILE = "data/push-subs.enc";
const EMPTY: PushState = { subs: [] };

function token(): string | null {
  return envValue("GITHUB_TOKEN");
}

function secret(): string | null {
  return envValue("PUSH_SECRET");
}

function repo(): string {
  return envValue("GITHUB_REPO") ?? "hf6s/a9ae0385fa19cb55fb806613";
}

async function api(path: string, init?: RequestInit) {
  return fetch(`https://api.github.com/repos/${repo()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "factor20",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

/** Reads and decrypts the current state. Empty state rather than throwing. */
export async function readState(): Promise<PushState> {
  const key = secret();
  if (!key || !token()) return EMPTY;
  try {
    const res = await api(`/contents/${FILE}`);
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as { content: string };
    const sealed = Buffer.from(json.content, "base64").toString("utf8").trim();
    const state = open<PushState>(sealed, key);
    return state && Array.isArray(state.subs) ? state : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** The file's blob sha, which the contents API needs in order to replace it. */
async function currentSha(): Promise<string | undefined> {
  try {
    const res = await api(`/contents/${FILE}`);
    if (!res.ok) return undefined;
    const json = (await res.json()) as { sha?: string };
    return json.sha;
  } catch {
    return undefined;
  }
}

/** Encrypts and writes state back. Returns false rather than throwing. */
export async function writeState(state: PushState): Promise<boolean> {
  const key = secret();
  if (!key || !token()) return false;
  const sealed = seal(state, key);
  if (!sealed) return false;
  try {
    const res = await api(`/contents/${FILE}`, {
      method: "PUT",
      body: JSON.stringify({
        message: "data: push subscriptions",
        content: Buffer.from(`${sealed}
`, "utf8").toString("base64"),
        sha: await currentSha(),
        committer: { name: "factor20-bot", email: "actions@users.noreply.github.com" },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}


/**
 * Adds a subscription, replacing any existing one with the same endpoint.
 *
 * Browsers re-issue the same endpoint for the same device, so subscribing
 * twice must update rather than duplicate - otherwise one phone gets two
 * notifications for every alert.
 */
export function addSub(state: PushState, sub: PushSub): PushState {
  const subs = state.subs.filter((s) => s.endpoint !== sub.endpoint);
  subs.push(sub);
  return { ...state, subs };
}

export function removeSub(state: PushState, endpoint: string): PushState {
  return { ...state, subs: state.subs.filter((s) => s.endpoint !== endpoint) };
}

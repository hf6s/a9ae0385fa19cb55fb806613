import { NextResponse } from "next/server";
import { envValue } from "@/lib/env-value";

/**
 * Suggestions from whoever is using the site, stored with the site.
 *
 * WHERE THEY GO. There is no database and no mail server, so a suggestion is
 * committed to data/suggestions.json through the GitHub API using the token
 * the site already holds. That survives deploys, costs nothing, and the
 * dashboard reads the same file.
 *
 * The token is used server-side only and never reaches the browser. The
 * endpoint accepts nothing but text: no name, no email, no identifiers. The
 * only thing stored beside the message is the time it arrived.
 *
 * NOT PUBLIC BY ACCIDENT. The repository is public, so anything written here
 * is readable by anyone who finds it. Suggestions from one family member about
 * a stock tool are not sensitive, but the box says so plainly rather than
 * leaving someone to assume privacy that does not exist.
 */

const FILE = "data/suggestions.json";
const MAX_LEN = 1200;
const MAX_STORED = 300;

interface Suggestion {
  at: string;
  text: string;
}

function repo(): string {
  return envValue("GITHUB_REPO") ?? "hf6s/a9ae0385fa19cb55fb806613";
}

async function gh(path: string, init?: RequestInit) {
  const token = envValue("GITHUB_TOKEN");
  if (!token) throw new Error("no token");
  return fetch(`https://api.github.com/repos/${repo()}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "factor20",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function POST(req: Request) {
  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return NextResponse.json({ error: "Could not read that." }, { status: 400 });
  }

  if (text.length < 3) {
    return NextResponse.json({ error: "Say a little more." }, { status: 400 });
  }
  // Truncate rather than reject: someone who wrote an essay should not lose it
  // to a validation error.
  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN)}…`;

  try {
    const current = await gh(`contents/${FILE}`);
    let sha: string | undefined;
    let list: Suggestion[] = [];

    if (current.ok) {
      const json = (await current.json()) as { sha: string; content: string };
      sha = json.sha;
      try {
        const decoded = Buffer.from(json.content, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) list = parsed as Suggestion[];
      } catch {
        // A corrupt file must not swallow the suggestion: start a fresh list
        // rather than failing the request.
        list = [];
      }
    } else if (current.status !== 404) {
      return NextResponse.json({ error: "Could not reach storage." }, { status: 502 });
    }

    list.unshift({ at: new Date().toISOString(), text });
    list = list.slice(0, MAX_STORED);

    const put = await gh(`contents/${FILE}`, {
      method: "PUT",
      body: JSON.stringify({
        message: "data: suggestion from the site",
        content: Buffer.from(`${JSON.stringify(list, null, 2)}\n`, "utf8").toString("base64"),
        sha,
        committer: { name: "factor20-bot", email: "actions@users.noreply.github.com" },
      }),
    });

    if (!put.ok) {
      return NextResponse.json({ error: "Could not save that." }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Suggestions are not configured." }, { status: 503 });
  }
}

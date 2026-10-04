"use client";

import {
  decodeHoldings,
  makeHolding,
  MAX_HOLDINGS,
  normaliseTicker,
  type Holding,
} from "@/lib/portfolio";

/**
 * Where holdings live in the browser, and how they get out of it.
 *
 * The previous version of this feature was deleted for exactly one reason:
 * positions lived in browser storage and nowhere else, so a cleared cache or a
 * second device lost them, and nobody wants to type a portfolio in twice.
 *
 * There is still no database and no login here, and inventing one for a family
 * tool would be worse than the problem. What closes the hole instead is a
 * backup link: the holdings encode into a short string in the URL fragment, so
 * the owner can send it to themselves, open it on a phone, and get the same
 * portfolio. A fragment is never transmitted to the server, so the link is as
 * private as wherever it is kept.
 *
 * Every read is defensive. Storage can throw in a private window, and anything
 * stored can have been written by an older version of this code.
 */

const KEY = "f20-holdings";

interface Stored {
  v: 1;
  holdings: Holding[];
}

/** Reads saved holdings. An unreadable store is an empty portfolio, never a crash. */
export function loadHoldings(): Holding[] {
  if (typeof window === "undefined") return [];
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Stored | Holding[];
    const list = Array.isArray(parsed) ? parsed : parsed.holdings;
    if (!Array.isArray(list)) return [];
    // Re-validate on the way in. A row written before a validation rule existed
    // must not reach the maths just because it is already on disk.
    return list
      .map((h) => makeHolding(h as Holding))
      .filter((h): h is Holding => h !== null)
      .slice(0, MAX_HOLDINGS);
  } catch {
    return [];
  }
}

export function saveHoldings(holdings: Holding[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: Stored = { v: 1, holdings };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Full or blocked storage. The session still works; the backup link is the
    // honest answer for anyone in that state, and the page offers it.
  }
}

/** The fragment key a backup link uses: /portfolio#p=AAPL:2:190:2026-01-02 */
export const LINK_PARAM = "p";

/** Holdings carried in the current URL fragment, if it holds a valid set. */
export function holdingsFromHash(): Holding[] | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.length === 0) return null;
  const params = new URLSearchParams(hash);
  const encoded = params.get(LINK_PARAM);
  if (!encoded) return null;
  return decodeHoldings(encoded);
}

/** Clears the fragment without adding a history entry or reloading. */
export function clearHash(): void {
  if (typeof window === "undefined") return;
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    /* a blocked history API is cosmetic here */
  }
}

/**
 * Reads the ticker a link asked to add, and takes it out of the URL.
 *
 * The rankings and stock pages link here with ?add=TICKER rather than writing a
 * holding themselves, so that every holding is still created by the one
 * validated form and nothing invents a position size on someone's behalf.
 *
 * It is consumed on arrival: left in place, a reload or a shared link would
 * re-open the form for a stock the owner has already dealt with.
 */
export function consumeAddParam(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(ADD_PARAM);
  if (!raw) return null;

  const ticker = normaliseTicker(raw);
  params.delete(ADD_PARAM);
  try {
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash,
    );
  } catch {
    /* a blocked history API is cosmetic here */
  }
  return ticker.length > 0 ? ticker : null;
}

/** The query key a link uses to open the add form on a stock: /portfolio?add=AAPL */
export const ADD_PARAM = "add";

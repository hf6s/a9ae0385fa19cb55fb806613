"use client";

import Link from "next/link";

/**
 * Puts a stock into the holdings, from wherever you happen to be looking at it.
 *
 * WHY IT IS A LINK AND NOT A BUTTON THAT ADDS. Clicking it does not invent a
 * position. It opens the portfolio with the add form already filled in with the
 * ticker and its latest price, and asks for the one thing no page can know: how
 * many shares, and what was actually paid. Silently adding a holding at a
 * guessed size would put a number on the page that looks like a record of
 * something real and is not.
 *
 * It also means holdings are still created in exactly one place, by the one
 * validator. A second route into storage is a second set of rules that will
 * eventually disagree with the first.
 *
 * This exists because the `+` on the rankings table is the compare chart, caps
 * at four by design, and reads like "add to my portfolio" to anyone who has not
 * read the tooltip. Having a real one next to it is the fix; renaming the other
 * one is the other half.
 */
export default function AddToPortfolio({
  ticker,
  held = false,
  full = false,
}: {
  ticker: string;
  /** Already in the portfolio, so the control points at it rather than repeating it. */
  held?: boolean;
  /** The wider, labelled version for the stock page. */
  full?: boolean;
}) {
  const href = held ? "/portfolio" : `/portfolio?add=${encodeURIComponent(ticker)}`;

  if (full) {
    return (
      <Link href={href} className={`btn-outline add-pf-full${held ? " is-held" : ""}`}>
        {held ? "In your portfolio" : "Add to portfolio"}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`add-pf${held ? " is-held" : ""}`}
      title={held ? `${ticker} is in your portfolio` : `Add ${ticker} to your portfolio`}
      aria-label={held ? `${ticker} is in your portfolio` : `Add ${ticker} to your portfolio`}
    >
      {held ? "◎" : "＋"}
    </Link>
  );
}

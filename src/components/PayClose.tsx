/**
 * The payment close.
 *
 * The page is built backwards from this: one tap, one amount, no friction.
 *
 * The link is supplied by the site owner and is the only place money is
 * handled — this component opens it and nothing more. It never collects a card
 * number, never embeds a payment form, and never touches a credential. If the
 * URL is missing it renders the amount and terms as plain text, so there is no
 * such thing as a dead payment button on this page.
 *
 * Deliberately not behind the receipt tear: an interaction that hides the way
 * to pay is a worse bug than a boring layout.
 */

export default function PayClose({
  url,
  amount,
  monthly,
}: {
  url: string;
  amount: number;
  monthly: number;
}) {
  const figure = `$${amount.toFixed(2)}`;

  return (
    <section className="inv-pay">
      <p className="inv-pay-label">Settlement</p>
      {url ? (
        <a className="inv-pay-btn" href={url} target="_blank" rel="noopener noreferrer">
          <span className="inv-pay-verb">Pay</span>
          <span className="inv-pay-figure">{figure}</span>
          <span className="inv-pay-arrow" aria-hidden="true">
            →
          </span>
        </a>
      ) : (
        <p className="inv-pay-plain">{figure} due. Payment details to follow.</p>
      )}
      <p className="inv-pay-terms">
        One-time, covers everything already built and paid for. The monthly ${monthly.toFixed(2)}{" "}
        starts only when you say so, and it is the running cost of the data feed and the analysis —
        not a margin.
      </p>
    </section>
  );
}

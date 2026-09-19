/**
 * The record: what this thing has actually done, counted rather than claimed.
 *
 * Every figure comes from a file — the scan's own output, or data/build-stats.json
 * written by `npm run stats` from the repository itself. A row with no data is
 * dropped rather than filled with an estimate.
 *
 * It includes the outage, deliberately. Three weeks with no new rankings is
 * the kind of thing a seller leaves out, and the kind of thing a buyer finds
 * later; stating it, with dates and with what the system did about it, is
 * worth more than the gap it admits to. It is also the strongest possible
 * evidence that the numbers on this page are not decorative.
 */

export interface RecordRow {
  label: string;
  value: string;
}

export default function Record({
  rows,
  incident,
}: {
  rows: RecordRow[];
  incident?: { period: string; what: string };
}) {
  if (rows.length === 0 && !incident) return null;

  return (
    <section className="inv-section">
      <h2>The record</h2>
      <dl className="inv-record">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {incident ? (
        <div className="inv-incident">
          <span className="inv-incident-when">{incident.period}</span>
          <p>{incident.what}</p>
        </div>
      ) : null}
    </section>
  );
}

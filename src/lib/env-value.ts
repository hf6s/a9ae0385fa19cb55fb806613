/**
 * Reads an environment value safely.
 *
 * Values piped into secret stores routinely arrive with a byte-order mark or a
 * trailing newline. A BOM inside an HTTP header makes fetch throw
 * "Cannot convert argument to a ByteString ... value of 65279", which reads
 * like a code bug and is not. This has now cost three separate debugging
 * sessions: a GitHub token, a dashboard password, and an SEC contact address
 * that made every SEC request fail while looking like an outage.
 */
export function envValue(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  const cleaned = raw.replace(/^﻿/, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Small authenticated-encryption helper for data that has to be stored in a
 * public place.
 *
 * WHY IT EXISTS. Push subscription endpoints are capabilities: anyone holding
 * one can send notifications to that phone. There is no database here, and the
 * repository is public, so the only way to keep subscriptions in it is to keep
 * them unreadable. AES-256-GCM with a random nonce per write gives
 * confidentiality and tamper-detection; a wrong or missing key fails closed,
 * returning nothing rather than garbage.
 *
 * The key lives in the environment and never reaches the browser.
 */

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function key(secretHex: string): Buffer | null {
  try {
    const buf = Buffer.from(secretHex.trim(), "hex");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/** Encrypts a value to "nonce.ciphertext.tag", all base64url. */
export function seal(value: unknown, secretHex: string): string | null {
  const k = key(secretHex);
  if (!k) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, k, iv);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), body.toString("base64url"), tag.toString("base64url")].join(".");
}

/** Reverses seal(). Returns null on any tampering, truncation or wrong key. */
export function open<T>(sealed: string, secretHex: string): T | null {
  const k = key(secretHex);
  if (!k) return null;
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, body, tag] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv(ALGO, k, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(body), decipher.final()]);
    return JSON.parse(out.toString("utf8")) as T;
  } catch {
    return null;
  }
}

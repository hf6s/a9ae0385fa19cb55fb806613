/**
 * The seal protects push endpoints stored in a public repository, so the
 * assertions that matter are the ones about failing closed: a wrong key, a
 * truncated blob or a single flipped character must yield nothing rather than
 * something.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { open, seal } from "./crypto-box";

const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("seal and open", () => {
  it("round-trips a value", () => {
    const sealed = seal({ endpoint: "https://push.example/abc", n: 3 }, KEY);
    assert.ok(sealed);
    assert.deepEqual(open(sealed, KEY), { endpoint: "https://push.example/abc", n: 3 });
  });

  it("produces different ciphertext every time", () => {
    // A fixed nonce would leak that two writes carry the same content.
    assert.notEqual(seal({ a: 1 }, KEY), seal({ a: 1 }, KEY));
  });

  it("refuses the wrong key", () => {
    const sealed = seal({ a: 1 }, KEY);
    assert.equal(open(sealed as string, OTHER), null);
  });

  it("refuses a tampered blob", () => {
    const sealed = seal({ a: 1 }, KEY) as string;
    const [iv, body, tag] = sealed.split(".");
    const flipped = `${iv}.${body.slice(0, -2)}AA.${tag}`;
    assert.equal(open(flipped, KEY), null);
  });

  it("refuses a truncated blob", () => {
    const sealed = seal({ a: 1 }, KEY) as string;
    assert.equal(open(sealed.split(".").slice(0, 2).join("."), KEY), null);
  });

  it("refuses a key of the wrong length instead of padding it", () => {
    assert.equal(seal({ a: 1 }, "abc"), null);
    assert.equal(open("x.y.z", "abc"), null);
  });

  it("survives an empty secret", () => {
    assert.equal(seal({ a: 1 }, ""), null);
  });
});

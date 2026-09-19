"use client";

import { useState } from "react";

/**
 * A box for telling the person who built this what to change.
 *
 * Deliberately plain: one field, one button, no name, no email, no account.
 * Anything that asks who you are before it asks what you think collects fewer
 * suggestions and worse ones.
 *
 * It says where the text goes, because the repository is public and someone
 * typing into a box on a website is entitled to assume otherwise.
 */
export default function SuggestBox() {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const send = async () => {
    if (text.trim().length < 3 || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "That did not send.");
        setState("error");
        return;
      }
      setText("");
      setState("sent");
    } catch {
      setError("No connection.");
      setState("error");
    }
  };

  if (state === "sent") {
    return (
      <section className="suggest suggest-done">
        <strong>Sent.</strong>
        <span>It lands on the dashboard. Thanks.</span>
        <button type="button" className="btn-outline" onClick={() => setState("idle")}>
          Write another
        </button>
      </section>
    );
  }

  return (
    <section className="suggest">
      <label htmlFor="suggest-text">
        <strong>Suggest something</strong>
        <span>What is missing, wrong, or annoying? It goes straight to the dashboard.</span>
      </label>
      <textarea
        id="suggest-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="I would find it useful if..."
        rows={3}
        maxLength={1200}
      />
      <div className="suggest-foot">
        <span className="suggest-note">
          Stored in this site&apos;s public repository. No name or email is attached.
        </span>
        <button
          type="button"
          className="btn"
          onClick={send}
          disabled={state === "sending" || text.trim().length < 3}
        >
          {state === "sending" ? "Sending" : "Send"}
        </button>
      </div>
      {state === "error" ? <p className="suggest-error">{error}</p> : null}
    </section>
  );
}

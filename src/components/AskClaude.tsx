"use client";

import { useState } from "react";

interface QA {
  q: string;
  a: string;
}

export default function AskClaude({ ticker }: { ticker: string }) {
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, question: q }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Something went wrong.");
      else {
        setThread((t) => [...t, { q, a: json.answer }]);
        setQuestion("");
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      {thread.map((qa, i) => (
        <div key={i} className="ask-qa">
          <p className="ask-q">You: {qa.q}</p>
          {qa.a.split(/\n\s*\n/).map((p, j) => (
            <p key={j} className="ask-a">{p}</p>
          ))}
        </div>
      ))}
      <div className="ask-row">
        <input
          type="text"
          maxLength={300}
          placeholder={`Ask about ${ticker} — e.g. "why is the value score low?"`}
          value={question}
          disabled={busy}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button className="btn" onClick={ask} disabled={busy || !question.trim()}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>
      {error && <p className="penalty" style={{ marginTop: 8 }}>{error}</p>}
      <p className="analysis-meta">
        Answers use only this stock's model data · 5 questions / 10 min · not investment advice
      </p>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { prefersReducedMotion } from "@/components/ScrollStory";

/**
 * A terminal the reader can actually run, without a keyboard.
 *
 * Tap chips rather than a prompt: a text input on a phone summons a keyboard
 * that covers half the screen, and nobody types commands at an invoice. The
 * commands are real though — every line of output is read from the same data
 * files the site serves, so this answers questions rather than performing.
 *
 * Output types in, because that is what the rest of the page does. Under
 * reduced motion it appears whole.
 */

export interface Command {
  id: string;
  label: string;
  lines: string[];
}

export default function TerminalPanel({ commands }: { commands: Command[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const timers = useRef<number[]>([]);

  const run = (cmd: Command) => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    setActive(cmd.id);

    const text = cmd.lines.join("\n");
    if (prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    setShown(0);
    // Fast enough that nobody waits on it: the point is that it responds, not
    // that it performs.
    const step = Math.max(1, Math.round(text.length / 60));
    let i = 0;
    const tick = () => {
      i = Math.min(text.length, i + step);
      setShown(i);
      if (i < text.length) timers.current.push(window.setTimeout(tick, 16));
    };
    timers.current.push(window.setTimeout(tick, 60));
  };

  const current = commands.find((c) => c.id === active) ?? null;
  const text = current ? current.lines.join("\n") : "";

  return (
    <section className="inv-section inv-term">
      <h2>Ask it something</h2>
      <div className="inv-term-chips">
        {commands.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`inv-term-chip${active === c.id ? " is-active" : ""}`}
            onClick={() => run(c)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <pre className="inv-term-out" aria-live="polite">
        {current ? (
          <>
            <span className="inv-term-echo">{`> ${current.label.toLowerCase()}`}</span>
            {"\n"}
            {text.slice(0, shown)}
            {shown < text.length ? <i className="inv-caret" /> : null}
          </>
        ) : (
          <span className="inv-term-idle">Tap a command.</span>
        )}
      </pre>
    </section>
  );
}

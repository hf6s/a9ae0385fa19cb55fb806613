"use client";

import { useEffect, useState } from "react";
import { loadSoundPreference, play, setSoundEnabled } from "@/lib/audio";

/**
 * Speaker toggle, off by default.
 *
 * Someone opening an invoice on a bus should not have their phone make a
 * noise at them. Sound is opt-in, the choice persists, and the first tap is
 * what creates the AudioContext — which is also the only way autoplay policy
 * allows it to exist.
 */
export default function SoundToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(loadSoundPreference());
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    setSoundEnabled(next);
    // Confirms the choice with the thing being chosen.
    if (next) play("lock");
  };

  return (
    <button
      type="button"
      className={`inv-sound${on ? " is-on" : ""}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Turn sound off" : "Turn sound on"}
    >
      <span aria-hidden="true">{on ? "SOUND ON" : "SOUND OFF"}</span>
    </button>
  );
}

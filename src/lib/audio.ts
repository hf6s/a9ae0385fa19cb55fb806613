/**
 * Four sounds, synthesized. No files, nothing to load, nothing to go stale.
 *
 * MUTED UNTIL ASKED. The AudioContext is not even constructed until someone
 * taps the speaker, which is both the polite default and what autoplay policy
 * requires — a context created without a gesture starts suspended and the
 * first sound arrives late or not at all.
 *
 * Kept deliberately small: a low sine with a fast decay, at four pitches. A
 * page that chimes at a reader is worse than a silent one, so these sit under
 * the moments that already carry weight and nowhere else.
 */

export type Cue = "gate" | "lock" | "tear" | "total";

const PITCH: Record<Cue, number> = {
  gate: 180,
  lock: 320,
  tear: 140,
  total: 420,
};

const KEY = "f20-sound";

let ctx: AudioContext | null = null;
let enabled = false;

export function soundEnabled(): boolean {
  return enabled;
}

export function loadSoundPreference(): boolean {
  try {
    enabled = localStorage.getItem(KEY) === "1";
  } catch {
    enabled = false;
  }
  return enabled;
}

/** Called from a tap, which is the only place a context may be created. */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* blocked storage just means the choice does not persist */
  }
  if (on && !ctx) {
    try {
      ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      ctx = null;
      enabled = false;
    }
  }
  void ctx?.resume();
}

export function play(cue: Cue, gain = 0.06): void {
  if (!enabled || !ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(PITCH[cue], now);
    // A short exponential decay reads as a physical event; a flat tone reads
    // as a notification.
    vol.gain.setValueAtTime(gain, now);
    vol.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    osc.connect(vol).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
  } catch {
    /* an audio failure must never interrupt the page */
  }
}

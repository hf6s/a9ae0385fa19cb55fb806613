/**
 * The machine: 905 companies falling through three filter gates.
 *
 * WHY THIS IS BAKED RATHER THAN LIVE.
 *
 * The scene is scrubbed by scroll, and scroll goes backwards. Live physics
 * cannot: run it forwards and back and the pile settles differently every
 * pass, because floating-point integration is not reversible. So the whole
 * simulation runs ONCE into a flat array of keyframes, and scrubbing becomes
 * interpolation between two of them — reversible, identical on every pass, and
 * nearly free per frame.
 *
 * WHAT THE NUMBERS MEAN.
 *
 * `count` and `passed` come from the live scan file. The count of survivors is
 * therefore real. What is NOT in the data is how many companies each
 * individual filter rejects, so the split across the three gates is even and
 * arbitrary, and nothing on screen ever claims a per-gate figure. The gates
 * show that most companies fail; the counter shows the two totals that are
 * true.
 *
 * Everything here is deterministic: same config, same bytes out. That is what
 * makes it testable, and what makes scrolling back up retrace the same path.
 */

/** Deterministic PRNG. Seeded so the scene is identical on every visit. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ROLE_GATE_1 = 0;
export const ROLE_GATE_2 = 1;
export const ROLE_GATE_3 = 2;
export const ROLE_SURVIVOR = 3;

export interface MachineConfig {
  /** Companies scanned. One particle each. */
  count: number;
  /** How many clear every filter. Must be <= count. */
  passed: number;
  width: number;
  height: number;
  /** Y positions of the three gates, top to bottom. */
  gates: [number, number, number];
  /** Keyframes to bake. */
  frames: number;
  /** Integration steps per keyframe. More is smoother and slower to bake. */
  stepsPerFrame: number;
  seed: number;
}

export const DEFAULT_CONFIG: Omit<MachineConfig, "count" | "passed"> = {
  width: 1000,
  height: 1600,
  gates: [470, 760, 1050],
  frames: 240,
  stepsPerFrame: 3,
  seed: 20260919,
};

export interface Bake {
  frames: number;
  count: number;
  width: number;
  height: number;
  /** frames * count * 3, laid out as x, y, alpha. */
  data: Float32Array;
  /** One ROLE_* per particle. */
  roles: Uint8Array;
}

/**
 * Which particles survive, spread evenly through the field.
 *
 * Spread rather than clustered: survivors taken as the first N would leave the
 * grid draining from one corner, which reads as "the model likes the start of
 * the alphabet" instead of "these are scattered everywhere".
 */
export function assignRoles(count: number, passed: number): Uint8Array {
  const roles = new Uint8Array(count);
  const survivors = Math.max(0, Math.min(passed, count));
  for (let i = 0; i < count; i++) roles[i] = i % 3;
  if (survivors === 0) return roles;
  for (let k = 0; k < survivors; k++) {
    roles[Math.floor((k * count) / survivors)] = ROLE_SURVIVOR;
  }
  return roles;
}

const GRAVITY = 0.42;
const DAMPING = 0.994;
const FLOOR_MARGIN = 40;
/** Columns in the pile heightmap. Fewer columns, lumpier pile. */
const PILE_COLUMNS = 74;
const PARTICLE_R = 4.2;

/**
 * Height of the highest settled reject, in world units.
 *
 * Runs the same integration with the same seed, skipping only the survivors —
 * which never affect the pile — so the summit it reports is the one the real
 * pass will produce.
 */
export function measurePileTop(config: MachineConfig): number {
  const { count, passed, width, height, gates, frames, stepsPerFrame, seed } = config;
  const rand = mulberry32(seed);
  const roles = assignRoles(count, passed);
  const floorY = height - FLOOR_MARGIN;
  const pile = new Float32Array(PILE_COLUMNS);
  const colWidth = width / PILE_COLUMNS;

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const settled = new Uint8Array(count);
  const spawnAt = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const sx = 40 + rand() * (width - 80);
    spawnAt[i] = rand() * 0.34;
    x[i] = sx;
    y[i] = -30 - rand() * 420;
    px[i] = sx - (rand() - 0.5) * 0.6;
    py[i] = y[i] - (0.4 + rand() * 0.5);
  }

  const totalSteps = frames * stepsPerFrame;
  for (let step = 0; step < totalSteps; step++) {
    const t = step / totalSteps;
    for (let i = 0; i < count; i++) {
      const role = roles[i];
      if (role === ROLE_SURVIVOR || settled[i] || t < spawnAt[i]) continue;

      const vx = (x[i] - px[i]) * DAMPING;
      const vy = (y[i] - py[i]) * DAMPING;
      px[i] = x[i];
      py[i] = y[i];
      let nx = x[i] + vx;
      let ny = y[i] + vy + GRAVITY;

      const gateY = gates[role];
      if (y[i] <= gateY && ny > gateY) {
        const dir = nx < width / 2 ? -1 : 1;
        const kick = 2.6 + rand() * 3.4;
        px[i] = nx + dir * kick;
        py[i] = ny - (0.8 + rand() * 1.2);
        nx += dir * 0.4;
      }

      if (nx < PARTICLE_R) {
        nx = PARTICLE_R;
        px[i] = nx + Math.abs(vx) * 0.4;
      } else if (nx > width - PARTICLE_R) {
        nx = width - PARTICLE_R;
        px[i] = nx - Math.abs(vx) * 0.4;
      }

      const col = Math.max(0, Math.min(PILE_COLUMNS - 1, Math.floor(nx / colWidth)));
      const restY = floorY - pile[col] - PARTICLE_R;
      if (ny >= restY) {
        ny = restY;
        settled[i] = 1;
        pile[col] += PARTICLE_R * (1.15 + rand() * 0.5);
        const spill = PARTICLE_R * 0.35;
        if (col > 0) pile[col - 1] += spill;
        if (col < PILE_COLUMNS - 1) pile[col + 1] += spill;
      }

      x[i] = nx;
      y[i] = ny;
    }
  }

  let tallest = 0;
  for (const h of pile) if (h > tallest) tallest = h;
  return floorY - tallest;
}

/**
 * Run the simulation and return every keyframe.
 *
 * Verlet integration: position and previous position, no velocity vector. It
 * is stable under the hard positional corrections the gates and the pile
 * apply, where a velocity integrator would inject energy and make the pile
 * jitter forever.
 */
export function simulate(config: MachineConfig): Bake {
  const { count, passed, width, height, gates, frames, stepsPerFrame, seed } = config;
  const rand = mulberry32(seed);
  const roles = assignRoles(count, passed);

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const settled = new Uint8Array(count);
  const spawnAt = new Float32Array(count);
  const alpha = new Float32Array(count);

  const floorY = height - FLOOR_MARGIN;
  const pile = new Float32Array(PILE_COLUMNS);
  const colWidth = width / PILE_COLUMNS;

  /**
   * Survivors hold in a band under the last gate — above the debris.
   *
   * MEASURED, NOT ESTIMATED. A fixed offset put survivors inside the pile. An
   * arithmetic estimate of pile height was wrong by a factor of three, because
   * rejects do not spread evenly: they are thrown sideways at their gate and
   * heap up where they land. So the pile is simulated first, its true summit
   * measured, and the holding band placed above that.
   *
   * Rejects never touch survivors, so the pre-pass produces exactly the pile
   * the real pass will build. It costs one extra run of a 21ms simulation.
   */
  const pileTop = measurePileTop(config);
  const holdY = Math.max(gates[2] + 60, Math.min(gates[2] + 220, pileTop - 150));

  for (let i = 0; i < count; i++) {
    const sx = 40 + rand() * (width - 80);
    // Staggered entry across the first third of the bake, so the field pours
    // in as a stream rather than appearing as a block.
    spawnAt[i] = rand() * 0.34;
    x[i] = sx;
    y[i] = -30 - rand() * 420;
    px[i] = sx - (rand() - 0.5) * 0.6;
    py[i] = y[i] - (0.4 + rand() * 0.5);
    alpha[i] = 0;
  }

  const data = new Float32Array(frames * count * 3);
  const totalSteps = frames * stepsPerFrame;
  let step = 0;

  for (let f = 0; f < frames; f++) {
    for (let s = 0; s < stepsPerFrame; s++) {
      const t = step / totalSteps;
      step++;

      for (let i = 0; i < count; i++) {
        if (t < spawnAt[i]) continue;
        alpha[i] = Math.min(1, alpha[i] + 0.08);
        if (settled[i]) continue;

        const role = roles[i];
        const vx = (x[i] - px[i]) * DAMPING;
        const vy = (y[i] - py[i]) * DAMPING;
        px[i] = x[i];
        py[i] = y[i];
        let nx = x[i] + vx;
        let ny = y[i] + vy + GRAVITY;

        if (role === ROLE_SURVIVOR) {
          // Survivors pass every gate and ease into the holding band. They are
          // decelerated rather than stopped dead: an abrupt halt reads as a
          // bug, and this scene is meant to have mass.
          if (ny > holdY) {
            ny = holdY + (ny - holdY) * 0.18;
            px[i] = nx - vx * 0.45;
            py[i] = ny - vy * 0.1;
          }
        } else {
          const gateY = gates[role];
          // At its own gate the particle is thrown aside: the rejection is the
          // visible event, so it gets a real impulse rather than a fade.
          if (y[i] <= gateY && ny > gateY) {
            const dir = nx < width / 2 ? -1 : 1;
            const kick = 2.6 + rand() * 3.4;
            px[i] = nx + dir * kick;
            py[i] = ny - (0.8 + rand() * 1.2);
            nx += dir * 0.4;
          }
        }

        // Walls, with a little bounce so the debris does not stick to them.
        if (nx < PARTICLE_R) {
          nx = PARTICLE_R;
          px[i] = nx + Math.abs(vx) * 0.4;
        } else if (nx > width - PARTICLE_R) {
          nx = width - PARTICLE_R;
          px[i] = nx - Math.abs(vx) * 0.4;
        }

        // The pile. A heightmap per column rather than particle-to-particle
        // collision: 905 bodies colliding is a quadratic problem and this
        // needs to bake inside a boot sequence.
        if (role !== ROLE_SURVIVOR) {
          const col = Math.max(0, Math.min(PILE_COLUMNS - 1, Math.floor(nx / colWidth)));
          const restY = floorY - pile[col] - PARTICLE_R;
          if (ny >= restY) {
            ny = restY;
            settled[i] = 1;
            // Uneven growth: a pile of identical steps is a staircase, not a
            // pile. The jitter is seeded, so it is the same pile every time.
            pile[col] += PARTICLE_R * (1.15 + rand() * 0.5);
            const spill = PARTICLE_R * 0.35;
            if (col > 0) pile[col - 1] += spill;
            if (col < PILE_COLUMNS - 1) pile[col + 1] += spill;
          }
        }

        x[i] = nx;
        y[i] = ny;
      }
    }

    const base = f * count * 3;
    for (let i = 0; i < count; i++) {
      const o = base + i * 3;
      data[o] = x[i];
      data[o + 1] = y[i];
      // Settled rejects dim but stay: the pile is the evidence of the work.
      data[o + 2] = settled[i] ? alpha[i] * 0.42 : alpha[i];
    }
  }

  return { frames, count, width, height, data, roles };
}

/**
 * Read the bake at a point in [0, 1] into `out` (count * 3 floats).
 *
 * A pure function of t, which is the property the whole design rests on:
 * scrolling up hits the same t and gets the same bytes back.
 */
export function readFrame(bake: Bake, t: number, out: Float32Array): Float32Array {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const stride = bake.count * 3;
  const pos = clamped * (bake.frames - 1);
  const f0 = Math.floor(pos);
  const f1 = Math.min(bake.frames - 1, f0 + 1);
  const mix = pos - f0;
  const a = f0 * stride;
  const b = f1 * stride;
  for (let k = 0; k < stride; k++) {
    const va = bake.data[a + k];
    out[k] = va + (bake.data[b + k] - va) * mix;
  }
  return out;
}

/** Bytes a bake occupies, so a caller can size its budget honestly. */
export function bakeBytes(count: number, frames: number): number {
  return frames * count * 3 * Float32Array.BYTES_PER_ELEMENT;
}

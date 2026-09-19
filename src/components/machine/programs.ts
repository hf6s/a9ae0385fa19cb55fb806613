/**
 * Shaders for the machine.
 *
 * GLSL ES 1.0 rather than 3.0: it runs on WebGL 1, which is still what some
 * older Android browsers give you, and this scene needs nothing newer than
 * point sprites.
 *
 * The world is 1000 x 1600 (portrait, matching the simulation), fitted into
 * whatever the canvas is with a contain-style scale computed on the GPU. Doing
 * the fit here rather than in JS means a resize costs two uniforms, not a
 * rebuild of every position.
 */

export const VERTEX = /* glsl */ `
  attribute vec2 position;
  attribute float alpha;
  attribute float role;

  uniform vec2 uWorld;
  uniform vec2 uScreen;
  uniform float uDpr;
  uniform float uSize;
  uniform float uZoom;

  varying float vAlpha;
  varying float vRole;

  void main() {
    float worldAspect = uWorld.x / uWorld.y;
    float screenAspect = uScreen.x / uScreen.y;
    vec2 fit = screenAspect > worldAspect
      ? vec2(worldAspect / screenAspect, 1.0)
      : vec2(1.0, screenAspect / worldAspect);

    vec2 unit = position / uWorld;
    vec2 ndc = (unit * 2.0 - 1.0) * vec2(1.0, -1.0);
    gl_Position = vec4(ndc * fit * uZoom, 0.0, 1.0);

    // Survivors are drawn larger as well as brighter. Brightness alone is not
    // enough to find twenty dots among nine hundred on a phone.
    float survivor = step(2.5, role);
    gl_PointSize = uSize * uDpr * mix(1.0, 1.7, survivor);

    vAlpha = alpha;
    vRole = role;
  }
`;

export const FRAGMENT = /* glsl */ `
  precision mediump float;

  varying float vAlpha;
  varying float vRole;

  uniform vec3 uGreen;
  uniform vec3 uDim;

  void main() {
    // Soft radial falloff: a hard-edged square sprite reads as a pixel, a
    // falloff reads as phosphor.
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.06, d);
    if (core <= 0.001) discard;

    float survivor = step(2.5, vRole);
    vec3 col = mix(uDim, uGreen, survivor);

    // Additive blending expects premultiplied colour; without the multiply,
    // overlapping debris blows out to white where the pile is deepest.
    gl_FragColor = vec4(col * core * vAlpha, core * vAlpha);
  }
`;

/**
 * How much of the stage the world occupies.
 *
 * A pure contain-fit puts the pile hard against the bottom edge and the field
 * against the sides, which reads as cropped on a phone — you cannot see that
 * the machine has a floor. Backing off leaves air around the whole scene.
 *
 * Shared by all three consumers: the shader, the canvas-2D fallback, and the
 * gate rules. If they disagree, a rule stops pointing at the row of world it
 * is labelling.
 */
export const WORLD_ZOOM = 0.84;

/** Phosphor, matched to the page tokens in invoice.css. */
export const COLOURS = {
  green: [0.208, 0.878, 0.545] as [number, number, number], // #35e08b
  dim: [0.078, 0.361, 0.224] as [number, number, number], // #145c39
};

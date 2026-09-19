"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useScrollTick } from "@/components/ScrollStory";
import { DEFAULT_CONFIG, readFrame, simulate, type Bake } from "@/lib/machine-physics";
import { pinnedProgress } from "@/lib/scroll-math";
import { COLOURS, FRAGMENT, VERTEX, WORLD_ZOOM } from "./programs";

/**
 * The machine: the scan, rendered as falling bodies.
 *
 * THREE WAYS TO SEE IT, in order of preference:
 *   1. WebGL point sprites with a phosphor falloff — the real thing.
 *   2. Canvas 2D drawing the same bake, if WebGL is missing or blocked.
 *   3. The server-rendered fallback passed as children — a static picture that
 *      is in the HTML from the start and is only hidden once a renderer is
 *      confirmed working.
 *
 * That order matters more than it looks. This page is an invoice sent to one
 * person on one phone; if his browser refuses WebGL, he must still see what he
 * is paying for. Nothing here is allowed to render an empty box.
 *
 * The simulation is baked once on mount (35ms for 905 particles) and every
 * frame after that is an interpolation, so scrolling costs a buffer upload and
 * a draw call.
 */

/** Scroll distance the pinned scene occupies. */
/**
 * Scroll distance the pinned scene occupies.
 *
 * Tuned down from 620vh: long enough that the three gates each register, short
 * enough that nobody is trapped scrolling through it. The whole sequence is
 * about three screens of travel.
 */
const SCENE_VH = 300;

/**
 * Where the gates sit, as a fraction of the world height.
 *
 * Drawn as real rules across the stage with the filter they represent. Without
 * them the scene is dots falling for no visible reason; with them the reader
 * watches companies hit a named test and get thrown out by it.
 */
const GATE_LABELS = ["Financial health", "Profitability", "Trend"] as const;

type Mode = "fallback" | "gl" | "2d";

interface Renderer2D {
  draw: (frame: Float32Array, roles: Uint8Array) => void;
  resize: () => void;
  dispose: () => void;
}

export default function Machine({
  scanned,
  passed,
  picked,
  children,
}: {
  scanned: number;
  passed: number;
  picked: number;
  children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const gates = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const caption = useRef<HTMLSpanElement>(null);
  const bakeRef = useRef<Bake | null>(null);
  const frameRef = useRef<Float32Array | null>(null);
  const drawRef = useRef<((t: number) => void) | null>(null);
  const shownCount = useRef("");
  const [mode, setMode] = useState<Mode>("fallback");

  useEffect(() => {
    const el = canvas.current;
    if (!el || scanned <= 0) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    const bake = simulate({ ...DEFAULT_CONFIG, count: scanned, passed });
    bakeRef.current = bake;
    const frame = new Float32Array(bake.count * 3);
    frameRef.current = frame;

    // Capped rather than native: a 3x phone screen would quadruple the pixels
    // for dots that are already soft-edged, and this scene has a battery to
    // respect.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    /**
     * Measure the STAGE, never the canvas.
     *
     * ogl writes its own default size onto the canvas as an inline style
     * (300x150), and an inline style beats the stylesheet. Measuring the
     * canvas therefore measures ogl's guess and locks the scene to a small box
     * in the corner. The parent is the element with real layout.
     */
    const stageBox = () => {
      const parent = el.parentElement;
      const r = (parent ?? el).getBoundingClientRect();
      return { width: Math.max(1, r.width), height: Math.max(1, r.height) };
    };

    /**
     * Put the gate rules exactly where the shader puts that row of world.
     *
     * The scene is fitted "contain", so on a stage narrower than the world the
     * vertical does not fill and a rule pinned at a CSS percentage would float
     * away from the particles it is supposed to be stopping. This repeats the
     * shader's own fit so the line and the rejection happen on the same pixel.
     */
    const layoutGates = () => {
      const g = gates.current;
      if (!g) return;
      const { width, height } = stageBox();
      const worldAspect = DEFAULT_CONFIG.width / DEFAULT_CONFIG.height;
      const screenAspect = width / height;
      const fitY = (screenAspect > worldAspect ? 1 : screenAspect / worldAspect) * WORLD_ZOOM;
      DEFAULT_CONFIG.gates.forEach((gy, i) => {
        const unit = gy / DEFAULT_CONFIG.height;
        const ndc = (1 - 2 * unit) * fitY;
        const el = g.children[i] as HTMLElement | undefined;
        if (el) el.style.top = `${((1 - ndc) / 2) * height}px`;
      });
      g.classList.add("is-placed");
    };

    const sizeCanvas = () => {
      const r = stageBox();
      el.width = Math.max(1, Math.round(r.width * dpr));
      el.height = Math.max(1, Math.round(r.height * dpr));
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      return r;
    };

    const start2D = (): boolean => {
      const ctx = el.getContext("2d");
      if (!ctx) return false;
      const r2d: Renderer2D = {
        resize: () => sizeCanvas(),
        dispose: () => undefined,
        draw: (data, roles) => {
          const rect = stageBox();
          const fit = Math.min(rect.width / bake.width, rect.height / bake.height) * WORLD_ZOOM;
          const ox = (rect.width - bake.width * fit) / 2;
          const oy = (rect.height - bake.height * fit) / 2;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, rect.width, rect.height);
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < bake.count; i++) {
            const a = data[i * 3 + 2];
            if (a <= 0.02) continue;
            const survivor = roles[i] === 3;
            ctx.fillStyle = survivor
              ? `rgba(53, 224, 139, ${a})`
              : `rgba(38, 140, 90, ${a})`;
            ctx.beginPath();
            ctx.arc(
              ox + data[i * 3] * fit,
              oy + data[i * 3 + 1] * fit,
              (survivor ? 4.6 : 3.0) * Math.max(fit, 0.35),
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        },
      };
      sizeCanvas();
      layoutGates();
      drawRef.current = (t: number) => {
        readFrame(bake, t, frame);
        r2d.draw(frame, bake.roles);
      };
      const onResize = () => {
        r2d.resize();
        layoutGates();
      };
      window.addEventListener("resize", onResize);
      const ro2 = new ResizeObserver(onResize);
      if (el.parentElement) ro2.observe(el.parentElement);
      cleanup = () => {
        window.removeEventListener("resize", onResize);
        ro2.disconnect();
        r2d.dispose();
      };
      (window.__f20diag ??= {}).mode = "2d";
      setMode("2d");
      return true;
    };

    (async () => {
      try {
        const { Renderer, Geometry, Program, Mesh } = await import("ogl");
        if (disposed) return;

        const renderer = new Renderer({ canvas: el, dpr, alpha: true, antialias: false });
        const gl = renderer.gl;
        gl.clearColor(0, 0, 0, 0);

        const positions = new Float32Array(bake.count * 2);
        const alphas = new Float32Array(bake.count);
        const roles = new Float32Array(bake.count);
        for (let i = 0; i < bake.count; i++) roles[i] = bake.roles[i];

        const geometry = new Geometry(gl, {
          position: { size: 2, data: positions },
          alpha: { size: 1, data: alphas },
          role: { size: 1, data: roles },
        });

        const program = new Program(gl, {
          vertex: VERTEX,
          fragment: FRAGMENT,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          uniforms: {
            uWorld: { value: [bake.width, bake.height] },
            uScreen: { value: [1, 1] },
            uDpr: { value: dpr },
            uSize: { value: 4.6 },
            uZoom: { value: WORLD_ZOOM },
            uGreen: { value: COLOURS.green },
            uDim: { value: COLOURS.dim },
          },
        });

        const mesh = new Mesh(gl, { geometry, program, mode: gl.POINTS });

        const resize = () => {
          const r = stageBox();
          renderer.setSize(r.width, r.height);
          program.uniforms.uScreen.value = [r.width, r.height];
          layoutGates();
        };
        resize();
        window.addEventListener("resize", resize);
        // A phone rotating, or the address bar collapsing, changes the stage
        // without firing a window resize in every browser.
        const ro = new ResizeObserver(resize);
        if (el.parentElement) ro.observe(el.parentElement);

        drawRef.current = (t: number) => {
          readFrame(bake, t, frame);
          for (let i = 0; i < bake.count; i++) {
            positions[i * 2] = frame[i * 3];
            positions[i * 2 + 1] = frame[i * 3 + 1];
            alphas[i] = frame[i * 3 + 2];
          }
          geometry.attributes.position.needsUpdate = true;
          geometry.attributes.alpha.needsUpdate = true;
          // Additive: phosphor accumulates where the pile is deep.
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          renderer.render({ scene: mesh });
        };

        (window.__f20diag ??= {}).mode = "gl";
        cleanup = () => {
          window.removeEventListener("resize", resize);
          ro.disconnect();
          const lose = gl.getExtension("WEBGL_lose_context");
          lose?.loseContext();
        };
        setMode("gl");
      } catch (err) {
        // No WebGL, a blocked context, or a chunk that never arrived. The 2D
        // path draws the same bake; failing that, the static fallback stays.
        (window.__f20diag ??= {}).glError = String(err).slice(0, 80);
        if (!disposed) start2D();
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
      drawRef.current = null;
    };
  }, [scanned, passed]);

  useScrollTick(() => {
    const el = wrap.current;
    const draw = drawRef.current;
    if (!el || !draw) return;
    const r = el.getBoundingClientRect();
    const doc = document.documentElement;

    // Offscreen scenes do not need drawing, and a phone should not spend its
    // battery on a canvas nobody is looking at.
    if (r.bottom < -200 || r.top > window.innerHeight + 200) return;

    const p = pinnedProgress({
      top: r.top,
      height: r.height,
      viewportHeight: window.innerHeight,
      atPageBottom: doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 2,
    });
    draw(p);
    const d = (window.__f20diag ??= {});
    d.draws = (d.draws ?? 0) + 1;
    d.progress = p;

    // The counter states only figures the scan actually produced.
    const stage = p < 0.34 ? scanned : p < 0.78 ? passed : picked;
    const label = p < 0.34 ? "scanned" : p < 0.78 ? "clear every filter" : "make the list";
    const key = `${stage}:${label}`;
    if (key !== shownCount.current) {
      shownCount.current = key;
      if (counter.current) counter.current.textContent = stage.toLocaleString("en-US");
      if (caption.current) caption.current.textContent = label;
    }
  });

  return (
    <div ref={wrap} className="inv-machine-wrap" style={{ height: `${SCENE_VH}vh` }}>
      <div className="inv-machine-sticky">
        <div className="inv-machine-head">
          <span className="inv-machine-n" ref={counter}>
            {scanned.toLocaleString("en-US")}
          </span>
          <span className="inv-machine-l" ref={caption}>
            scanned
          </span>
        </div>
        <div className="inv-machine-stage" ref={stage}>
          <div className="inv-machine-gates" ref={gates} aria-hidden="true">
            {GATE_LABELS.map((label, i) => (
              <div className="inv-machine-gate" key={label} data-gate={i}>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <canvas
            ref={canvas}
            className={`inv-machine-canvas${mode === "fallback" ? "" : " is-live"}`}
            aria-hidden="true"
          />
          <div className={`inv-machine-fallback${mode === "fallback" ? "" : " is-replaced"}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * App shell: wires the solver, renderer, input and HUD into one loop.
 *
 * Tweak anything live from the browser console, e.g.
 *   fluid.solver.config.vorticity = 40
 *   fluid.renderer.config.bloomIntensity = 0.9
 */

import './style.css';
import { createGLContext, type GLContext } from './gl/context';
import { FullscreenPass } from './gl/pass';
import { FluidSolver, DEFAULT_SOLVER_CONFIG, type RGB, type Vec2 } from './sim/FluidSolver';
import { Renderer, DEFAULT_RENDER_CONFIG } from './render/Renderer';
import { PointerInput } from './input/PointerInput';
import { PALETTES, scale } from './color';
import { TextMask, type TextMode } from './text/TextMask';
import { Hud } from './ui/Hud';

/** Interaction settings (the solver and renderer have their own configs). */
const settings = {
  /** Brush radius in domain heights. */
  splatRadius: 0.05,
  /** Velocity added per unit of pointer travel, per second. */
  splatForce: 45,
  /** Dye added per frame while painting (at 60 fps). */
  dyeAmount: 0.2,
  /** Dye multiplier while hovering without pressing. */
  hoverDye: 0.25,
  /** How fast a pointer's colour drifts along the palette, per second. */
  colorDrift: 0.12,
  palette: 0,
  text: 'FLUID',
  textMode: 'off' as TextMode,
  paused: false,
};

const canvas = document.querySelector<HTMLCanvasElement>('#fluid')!;
const hud = new Hud();

let ctx: GLContext;
try {
  ctx = createGLContext(canvas);
} catch (error) {
  showFallback(error instanceof Error ? error.message : String(error));
  throw error;
}
const { gl } = ctx;

const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const solverConfig = {
  ...DEFAULT_SOLVER_CONFIG,
  ...(coarsePointer ? { simResolution: 128, dyeResolution: 512 } : {}),
};

const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
fitCanvas();

const pass = new FullscreenPass(gl);
const solver = new FluidSolver(ctx, pass, solverConfig, canvas.width, canvas.height);
const renderer = new Renderer(ctx, pass, { ...DEFAULT_RENDER_CONFIG });
renderer.resize(solver.dye.width, solver.dye.height);
const textMask = new TextMask(gl);
const input = new PointerInput(canvas);

declare global {
  interface Window {
    fluid: { solver: FluidSolver; renderer: Renderer; settings: typeof settings; burst: (n?: number) => void };
  }
}
window.fluid = { solver, renderer, settings, burst };

// --- interaction ------------------------------------------------------------

function palette() {
  return PALETTES[settings.palette];
}

/** Random splats; in 'inside' text mode they land inside the letters. */
function burst(count = 6 + Math.floor(Math.random() * 10)): void {
  for (let i = 0; i < count; i++) {
    let x = Math.random();
    let y = Math.random();
    for (let tries = 0; tries < 40 && !textMask.isFluid(x, y); tries++) {
      x = Math.random();
      y = Math.random();
    }
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 2.5;
    const color = scale(palette().color(Math.random()), 1.2 + Math.random() * 0.8);
    const at: Vec2 = [x, y];
    solver.splat(at, at, [Math.cos(angle) * speed, Math.sin(angle) * speed], color, settings.splatRadius * 1.15);
  }
}

function applyStrokes(dt: number): void {
  const frameScale = dt * 60; // dye per frame is tuned at 60 fps
  input.forEachStroke((pointer, from, to) => {
    pointer.phase += dt * settings.colorDrift;
    // Pointer travel in physical units (domain heights), so x and y match.
    const dx = (to[0] - from[0]) * solver.aspect;
    const dy = to[1] - from[1];
    const force: Vec2 = [dx * settings.splatForce, dy * settings.splatForce];
    const amount = settings.dyeAmount * frameScale * (pointer.down ? 1 : settings.hoverDye);
    const color: RGB = scale(palette().color(pointer.phase), amount);
    solver.splat(from, to, force, color, settings.splatRadius);
  });
}

let lastTap = { time: 0, x: 0, y: 0 };
input.onPress = (pointer) => {
  pointer.phase += 0.3; // each new press starts a fresh colour
  if (pointer.type !== 'touch') return;
  const now = performance.now();
  const near = Math.hypot(pointer.x - lastTap.x, pointer.y - lastTap.y) < 0.08;
  if (now - lastTap.time < 300 && near) burst();
  lastTap = { time: now, x: pointer.x, y: pointer.y };
};

const TEXT_MODES: TextMode[] = ['off', 'walls', 'inside'];
const TEXT_LABELS: Record<TextMode, string> = {
  off: 'Text off',
  walls: 'Text as walls',
  inside: 'Fluid inside text',
};

function refreshText(): void {
  const mask = textMask.update(settings.text, settings.textMode, solver.dye.width, solver.dye.height);
  solver.setObstacles(mask);
  renderer.config.solidLift = settings.textMode === 'walls' ? DEFAULT_RENDER_CONFIG.solidLift : 0;
}

let captureRequested = false;

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      burst();
      break;
    case 'KeyP':
      settings.paused = !settings.paused;
      hud.toast(settings.paused ? 'Paused' : 'Playing');
      break;
    case 'KeyT': {
      const next = TEXT_MODES[(TEXT_MODES.indexOf(settings.textMode) + 1) % TEXT_MODES.length];
      settings.textMode = next;
      refreshText();
      hud.toast(TEXT_LABELS[next]);
      break;
    }
    case 'KeyC':
      settings.palette = (settings.palette + 1) % PALETTES.length;
      hud.toast(palette().name);
      break;
    case 'KeyA':
      solver.config.advection = solver.config.advection === 'maccormack' ? 'semi-lagrangian' : 'maccormack';
      hud.toast(solver.config.advection === 'maccormack' ? 'MacCormack advection' : 'Semi-Lagrangian advection');
      break;
    case 'KeyM':
      renderer.config.tonemapper = renderer.config.tonemapper === 'agx' ? 'aces' : 'agx';
      hud.toast(renderer.config.tonemapper === 'agx' ? 'AgX tonemap' : 'ACES tonemap');
      break;
    case 'KeyR':
      solver.clear();
      hud.toast('Cleared');
      break;
    case 'KeyS':
      captureRequested = true;
      break;
    case 'KeyH':
      hud.toggle();
      break;
  }
});

// --- frame loop -------------------------------------------------------------

function fitCanvas(): boolean {
  const ratio = pixelRatio();
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

function capture(): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fluid-${Date.now()}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  hud.toast('Captured');
}

let running = true;
let last = performance.now();

function frame(now: number): void {
  if (!running) return;
  // Clamp so a background tab or a hitch can't blow up one giant step.
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  if (fitCanvas()) {
    solver.resize(canvas.width, canvas.height);
    renderer.resize(solver.dye.width, solver.dye.height);
    refreshText();
  }

  applyStrokes(dt);
  if (!settings.paused) solver.step(dt);
  renderer.render(solver, now / 1000);

  if (captureRequested) {
    captureRequested = false;
    capture(); // same task as the draw, so the drawing buffer is still valid
  }

  hud.tick(now, () => {
    const s = solver.velocity;
    const d = solver.dye;
    return `sim ${s.width}×${s.height} · dye ${d.width}×${d.height} · ${solver.config.advection} · ${renderer.config.tonemapper} · ${palette().name.toLowerCase()}`;
  });

  requestAnimationFrame(frame);
}

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  running = false;
  showFallback('The GPU context was lost. Reloading…');
});
canvas.addEventListener('webglcontextrestored', () => window.location.reload());

function showFallback(detail: string): void {
  const fallback = document.getElementById('fallback');
  const detailEl = document.getElementById('fallback-detail');
  if (detailEl) detailEl.textContent = detail;
  fallback?.removeAttribute('hidden');
  document.getElementById('hud')?.setAttribute('hidden', '');
}

burst(14);
requestAnimationFrame(frame);

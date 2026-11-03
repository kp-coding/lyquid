/**
 * GPU Navier-Stokes solver for incompressible flow, after Jos Stam,
 * "Stable Fluids" (SIGGRAPH 1999).
 *
 * Each step, in order:
 *   1. forces      vorticity confinement + buoyancy
 *   2. viscosity   implicit diffusion (skipped when viscosity = 0)
 *   3. projection  divergence -> Jacobi pressure solve -> subtract gradient
 *   4. advection   dye first (through the divergence-free field), then velocity
 *
 * The solver only produces fields (velocity, dye). It knows nothing about
 * how they get drawn; that's the Renderer's job. Obstacles come in as a
 * mask texture, so text, shapes, or anything else can become a wall.
 */

import type { GLContext } from '../gl/context';
import type { FullscreenPass } from '../gl/pass';
import { Program } from '../gl/program';
import { PingPong, RenderTarget } from '../gl/target';

import commonSrc from './shaders/common.glsl?raw';
import traceSrc from './shaders/trace.glsl?raw';
import advectSrc from './shaders/advect.glsl?raw';
import maccormackSrc from './shaders/maccormack.glsl?raw';
import divergenceSrc from './shaders/divergence.glsl?raw';
import pressureSrc from './shaders/pressure.glsl?raw';
import gradientSrc from './shaders/gradient.glsl?raw';
import curlSrc from './shaders/curl.glsl?raw';
import forcesSrc from './shaders/forces.glsl?raw';
import viscositySrc from './shaders/viscosity.glsl?raw';
import splatSrc from './shaders/splat.glsl?raw';
import copySrc from './shaders/copy.glsl?raw';

export type Vec2 = readonly [number, number];
export type RGB = readonly [number, number, number];
export type AdvectionScheme = 'maccormack' | 'semi-lagrangian';

export interface SolverConfig {
  /** Grid cells along the short side of the screen. */
  simResolution: number;
  /** Dye texels along the short side. Dye can be much finer than velocity. */
  dyeResolution: number;
  /** Scheme for the dye. MacCormack keeps filaments razor sharp. */
  advection: AdvectionScheme;
  /** Scheme for velocity itself. */
  velocityAdvection: AdvectionScheme;
  pressureIterations: number;
  /** 0..1: how much of last frame's pressure seeds this frame's solve. */
  pressureWarmStart: number;
  /** Vorticity confinement strength. */
  vorticity: number;
  /** Exponential decay rates, per second. */
  velocityDissipation: number;
  dyeDissipation: number;
  /** Kinematic viscosity in domain-heights^2 per second. 0 = inviscid (pass skipped). */
  viscosity: number;
  viscosityIterations: number;
  /** Upward acceleration per unit of dye brightness. Negative sinks. */
  buoyancy: number;
}

export const DEFAULT_SOLVER_CONFIG: SolverConfig = {
  simResolution: 160,
  dyeResolution: 1024,
  advection: 'maccormack',
  velocityAdvection: 'semi-lagrangian',
  pressureIterations: 30,
  pressureWarmStart: 0.8,
  vorticity: 18,
  velocityDissipation: 0.2,
  dyeDissipation: 0.7,
  viscosity: 0,
  viscosityIterations: 20,
  buoyancy: 0,
};

export class FluidSolver {
  /** Velocity in domain-heights per second (RG). */
  velocity!: PingPong;
  /** HDR colour carried by the flow (RGBA). */
  dye!: PingPong;
  /** Domain width / height. The domain is always 1 unit tall. */
  aspect = 1;

  private pressure!: PingPong;
  private divergence!: RenderTarget;
  private curl!: RenderTarget;
  private simScratch!: [RenderTarget, RenderTarget];
  private dyeScratch!: [RenderTarget, RenderTarget];

  private pixelWidth = 1;
  private pixelHeight = 1;
  private obstacles: WebGLTexture;
  private readonly noObstacles: WebGLTexture;

  private readonly programs: {
    advect: Program;
    maccormack: Program;
    divergence: Program;
    pressure: Program;
    gradient: Program;
    curl: Program;
    forces: Program;
    viscosity: Program;
    splat: Program;
    copy: Program;
  };

  constructor(
    private readonly ctx: GLContext,
    private readonly pass: FullscreenPass,
    readonly config: SolverConfig,
    width: number,
    height: number,
  ) {
    const { gl } = ctx;
    const grid = (name: string, src: string) => new Program(gl, name, commonSrc, src);
    const traced = (name: string, src: string) => new Program(gl, name, commonSrc, traceSrc, src);

    this.programs = {
      advect: traced('advect', advectSrc),
      maccormack: traced('maccormack', maccormackSrc),
      divergence: grid('divergence', divergenceSrc),
      pressure: grid('pressure', pressureSrc),
      gradient: grid('gradient', gradientSrc),
      curl: grid('curl', curlSrc),
      forces: grid('forces', forcesSrc),
      viscosity: grid('viscosity', viscositySrc),
      splat: grid('splat', splatSrc),
      copy: new Program(gl, 'copy', copySrc),
    };

    this.noObstacles = createEmptyMask(gl);
    this.obstacles = this.noObstacles;
    this.resize(width, height);
  }

  /** Physical size of one velocity cell. */
  get cellSize(): Vec2 {
    return [this.aspect / this.velocity.width, 1 / this.velocity.height];
  }

  get obstacleTexture(): WebGLTexture {
    return this.obstacles;
  }

  /** Any single-channel texture where 1 = solid. Pass null to clear. */
  setObstacles(mask: WebGLTexture | null): void {
    this.obstacles = mask ?? this.noObstacles;
  }

  /**
   * Fit the grids to a canvas size. Existing velocity and dye are resampled,
   * not thrown away, so resizing the window doesn't wipe the fluid.
   */
  resize(width: number, height: number): void {
    this.pixelWidth = width;
    this.pixelHeight = height;
    const aspect = width / height;
    const [sw, sh] = gridSize(this.config.simResolution, aspect);
    const [dw, dh] = gridSize(this.config.dyeResolution, aspect);
    if (this.velocity && this.velocity.width === sw && this.velocity.height === sh
      && this.dye.width === dw && this.dye.height === dh) {
      this.aspect = aspect;
      return;
    }
    this.aspect = aspect;

    const { gl, rgba16f, rg16f, r16f, r32f } = this.ctx;
    const previousVelocity = this.velocity;
    const previousDye = this.dye;

    this.velocity = new PingPong(gl, sw, sh, rg16f, gl.LINEAR);
    this.dye = new PingPong(gl, dw, dh, rgba16f, gl.LINEAR);
    if (previousVelocity) {
      this.resample(previousVelocity.read, this.velocity.read);
      this.resample(previousDye.read, this.dye.read);
      previousVelocity.dispose();
      previousDye.dispose();
      this.pressure.dispose();
      this.divergence.dispose();
      this.curl.dispose();
      this.simScratch.forEach((t) => t.dispose());
      this.dyeScratch.forEach((t) => t.dispose());
    }

    // Stencil fields are read with texelFetch only, so NEAREST is fine
    // (and required for R32F without OES_texture_float_linear).
    this.pressure = new PingPong(gl, sw, sh, r32f, gl.NEAREST);
    this.divergence = new RenderTarget(gl, sw, sh, r32f, gl.NEAREST);
    this.curl = new RenderTarget(gl, sw, sh, r16f, gl.NEAREST);
    this.simScratch = [
      new RenderTarget(gl, sw, sh, rgba16f, gl.LINEAR),
      new RenderTarget(gl, sw, sh, rgba16f, gl.LINEAR),
    ];
    this.dyeScratch = [
      new RenderTarget(gl, dw, dh, rgba16f, gl.LINEAR),
      new RenderTarget(gl, dw, dh, rgba16f, gl.LINEAR),
    ];
  }

  /** Re-apply simResolution / dyeResolution after changing them in config. */
  applyResolution(): void {
    this.resize(this.pixelWidth, this.pixelHeight);
  }

  /** Advance the simulation by `dt` seconds. */
  step(dt: number): void {
    if (dt <= 0) return;
    const { gl } = this.ctx;
    const c = this.config;
    gl.disable(gl.BLEND);

    if (c.vorticity !== 0 || c.buoyancy !== 0) this.applyForces(dt);
    if (c.viscosity > 0) this.diffuseVelocity(dt);
    this.project();

    // Dye moves through the freshly projected (divergence-free) field,
    // so colour neither piles up nor thins out where it shouldn't.
    this.advect(this.dye, this.dyeScratch, c.advection, dt, Math.exp(-c.dyeDissipation * dt));
    this.advect(this.velocity, this.simScratch, c.velocityAdvection, dt, Math.exp(-c.velocityDissipation * dt));
  }

  /**
   * Paint a stroke from `from` to `to` (uv, 0..1). `force` is added to the
   * velocity (domain-heights/s) and `color` to the dye, both with a Gaussian
   * falloff of `radius` (domain heights).
   */
  splat(from: Vec2, to: Vec2, force: Vec2, color: RGB, radius: number): void {
    this.ctx.gl.disable(this.ctx.gl.BLEND);
    if (force[0] !== 0 || force[1] !== 0) this.splatInto(this.velocity, from, to, [force[0], force[1], 0], radius);
    if (color[0] + color[1] + color[2] > 0) this.splatInto(this.dye, from, to, color, radius);
  }

  /** Erase all fluid. */
  clear(): void {
    this.velocity.clear();
    this.dye.clear();
    this.pressure.clear();
  }

  dispose(): void {
    this.velocity.dispose();
    this.dye.dispose();
    this.pressure.dispose();
    this.divergence.dispose();
    this.curl.dispose();
    this.simScratch.forEach((t) => t.dispose());
    this.dyeScratch.forEach((t) => t.dispose());
    Object.values(this.programs).forEach((p) => p.dispose());
    this.ctx.gl.deleteTexture(this.noObstacles);
  }

  // --- passes ---------------------------------------------------------------

  private applyForces(dt: number): void {
    const [hx, hy] = this.cellSize;
    const c = this.config;

    this.programs.curl.use()
      .texture('uVelocity', this.velocity.read.texture)
      .texture('uObstacle', this.obstacles)
      .vec2('uCellSize', hx, hy);
    this.pass.draw(this.curl);

    this.programs.forces.use()
      .texture('uVelocity', this.velocity.read.texture)
      .texture('uCurl', this.curl.texture)
      .texture('uDye', this.dye.read.texture)
      .texture('uObstacle', this.obstacles)
      .vec2('uCellSize', hx, hy)
      .float('uVorticity', c.vorticity)
      .float('uBuoyancy', c.buoyancy)
      .float('uDt', dt);
    this.drawInto(this.velocity);
  }

  private diffuseVelocity(dt: number): void {
    const [hx, hy] = this.cellSize;
    const alpha = (hx * hy) / (this.config.viscosity * dt);
    const initial = this.velocity.read;
    let current: RenderTarget = initial;

    for (let i = 0; i < this.config.viscosityIterations; i++) {
      const next = this.simScratch[i % 2];
      this.programs.viscosity.use()
        .texture('uCurrent', current.texture)
        .texture('uInitial', initial.texture)
        .texture('uObstacle', this.obstacles)
        .float('uAlpha', alpha);
      this.pass.draw(next);
      current = next;
    }

    this.programs.copy.use().texture('uSource', current.texture);
    this.drawInto(this.velocity);
  }

  private project(): void {
    const [hx, hy] = this.cellSize;
    const c = this.config;

    this.programs.divergence.use()
      .texture('uVelocity', this.velocity.read.texture)
      .texture('uObstacle', this.obstacles)
      .vec2('uCellSize', hx, hy);
    this.pass.draw(this.divergence);

    for (let i = 0; i < c.pressureIterations; i++) {
      this.programs.pressure.use()
        .texture('uPressure', this.pressure.read.texture)
        .texture('uDivergence', this.divergence.texture)
        .texture('uObstacle', this.obstacles)
        .vec2('uCellSize', hx, hy)
        .float('uScale', i === 0 ? c.pressureWarmStart : 1);
      this.drawInto(this.pressure);
    }

    this.programs.gradient.use()
      .texture('uPressure', this.pressure.read.texture)
      .texture('uVelocity', this.velocity.read.texture)
      .texture('uObstacle', this.obstacles)
      .vec2('uCellSize', hx, hy);
    this.drawInto(this.velocity);
  }

  private advect(field: PingPong, scratch: [RenderTarget, RenderTarget], scheme: AdvectionScheme, dt: number, decay: number): void {
    const velocity = this.velocity.read.texture;
    const trace = (program: Program, stepDt: number) =>
      program.use()
        .texture('uVelocity', velocity)
        .texture('uObstacle', this.obstacles)
        .vec2('uVelToUv', 1 / this.aspect, 1)
        .float('uDt', stepDt);

    if (scheme === 'semi-lagrangian') {
      trace(this.programs.advect, dt).texture('uSource', field.read.texture).float('uDecay', decay);
      this.drawInto(field);
      return;
    }

    const [forward, reverse] = scratch;
    trace(this.programs.advect, dt).texture('uSource', field.read.texture).float('uDecay', 1);
    this.pass.draw(forward);
    trace(this.programs.advect, -dt).texture('uSource', forward.texture).float('uDecay', 1);
    this.pass.draw(reverse);
    trace(this.programs.maccormack, dt)
      .texture('uSource', field.read.texture)
      .texture('uForward', forward.texture)
      .texture('uReverse', reverse.texture)
      .float('uDecay', decay);
    this.drawInto(field);
  }

  private splatInto(field: PingPong, from: Vec2, to: Vec2, value: RGB, radius: number): void {
    this.programs.splat.use()
      .texture('uTarget', field.read.texture)
      .texture('uObstacle', this.obstacles)
      .vec2('uFrom', from[0], from[1])
      .vec2('uTo', to[0], to[1])
      .float('uAspect', this.aspect)
      .float('uRadius', radius)
      .vec3('uValue', value[0], value[1], value[2]);
    this.drawInto(field);
  }

  private resample(source: RenderTarget, target: RenderTarget): void {
    this.programs.copy.use().texture('uSource', source.texture);
    this.pass.draw(target);
  }

  private drawInto(field: PingPong): void {
    this.pass.draw(field.write);
    field.swap();
  }
}

/** Grid dimensions with `shortSide` cells along the shorter screen axis. */
function gridSize(shortSide: number, aspect: number): [number, number] {
  const s = Math.max(8, Math.round(shortSide));
  return aspect >= 1 ? [Math.round(s * aspect), s] : [s, Math.round(s / aspect)];
}

function createEmptyMask(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Out of GPU memory.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  return texture;
}

/**
 * Turns solver fields into pixels:
 *
 *   dye -> composite (lighting, shadow, obstacles) -> HDR scene
 *       -> bloom pyramid
 *       -> final (dispersion, vignette, tonemap, grain, dither) -> screen
 *
 * Everything before the final pass stays in linear HDR (half-float), so
 * overlapping dye can glow past 1.0 and roll off smoothly instead of clipping.
 * The Renderer only reads the solver's fields; it never changes them.
 */

import type { GLContext } from '../gl/context';
import type { FullscreenPass } from '../gl/pass';
import { Program } from '../gl/program';
import { RenderTarget } from '../gl/target';
import type { FluidSolver, RGB } from '../sim/FluidSolver';

import compositeSrc from './shaders/composite.glsl?raw';
import bloomDownSrc from './shaders/bloom-down.glsl?raw';
import bloomUpSrc from './shaders/bloom-up.glsl?raw';
import finalSrc from './shaders/final.glsl?raw';

export type Tonemapper = 'agx' | 'aces';

export interface RenderConfig {
  background: RGB;
  backgroundEdge: RGB;
  shading: number;
  bump: number;
  specular: number;
  shadow: number;
  bloom: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  /** 0..1, fraction of the threshold used as a soft knee. */
  bloomKnee: number;
  bloomRadius: number;
  exposure: number;
  tonemapper: Tonemapper;
  chromaticAberration: number;
  vignette: number;
  grain: number;
  outline: number;
  solidLift: number;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  background: [0.004, 0.0045, 0.006],
  backgroundEdge: [0, 0, 0],
  shading: 0.7,
  bump: 0.015,
  specular: 0.35,
  shadow: 0.6,
  bloom: true,
  bloomIntensity: 0.5,
  bloomThreshold: 0.7,
  bloomKnee: 0.7,
  bloomRadius: 1,
  exposure: 1.15,
  tonemapper: 'agx',
  chromaticAberration: 0.004,
  vignette: 0.35,
  grain: 0.012,
  outline: 0.35,
  solidLift: 0.006,
};

const MAX_BLOOM_LEVELS = 7;

export class Renderer {
  private scene!: RenderTarget;
  private bloomLevels: RenderTarget[] = [];
  private frame = 0;
  private readonly black: WebGLTexture;
  private readonly programs: {
    composite: Program;
    prefilter: Program;
    down: Program;
    up: Program;
    final: Program;
  };

  constructor(
    private readonly ctx: GLContext,
    private readonly pass: FullscreenPass,
    readonly config: RenderConfig,
  ) {
    const { gl } = ctx;
    this.programs = {
      composite: new Program(gl, 'composite', compositeSrc),
      prefilter: new Program(gl, 'bloom-prefilter', '#define PREFILTER', bloomDownSrc),
      down: new Program(gl, 'bloom-down', bloomDownSrc),
      up: new Program(gl, 'bloom-up', bloomUpSrc),
      final: new Program(gl, 'final', finalSrc),
    };
    this.black = createBlack(gl);
  }

  /** The scene buffer matches the dye resolution; the final pass upsamples it. */
  resize(width: number, height: number): void {
    if (this.scene && this.scene.width === width && this.scene.height === height) return;
    const { gl, rgba16f } = this.ctx;
    this.scene?.dispose();
    this.bloomLevels.forEach((level) => level.dispose());

    this.scene = new RenderTarget(gl, width, height, rgba16f, gl.LINEAR);
    this.bloomLevels = [];
    let w = width >> 1;
    let h = height >> 1;
    while (this.bloomLevels.length < MAX_BLOOM_LEVELS && w >= 8 && h >= 8) {
      this.bloomLevels.push(new RenderTarget(gl, w, h, rgba16f, gl.LINEAR));
      w >>= 1;
      h >>= 1;
    }
  }

  render(solver: FluidSolver, time: number): void {
    const { gl } = this.ctx;
    gl.disable(gl.BLEND);
    this.composite(solver);
    const bloomOn = this.config.bloom && this.bloomLevels.length > 1;
    if (bloomOn) this.renderBloom();
    this.present(solver.aspect, time, bloomOn);
  }

  dispose(): void {
    this.scene.dispose();
    this.bloomLevels.forEach((level) => level.dispose());
    Object.values(this.programs).forEach((p) => p.dispose());
    this.ctx.gl.deleteTexture(this.black);
  }

  private composite(solver: FluidSolver): void {
    const c = this.config;
    const dye = solver.dye.read;
    this.programs.composite.use()
      .texture('uDye', dye.texture)
      .texture('uObstacle', solver.obstacleTexture)
      .vec2('uTexel', dye.texelX, dye.texelY)
      .float('uAspect', solver.aspect)
      .vec3('uBackground', ...c.background)
      .vec3('uBackgroundEdge', ...c.backgroundEdge)
      .float('uShading', c.shading)
      .float('uBump', c.bump)
      .float('uSpecular', c.specular)
      .float('uShadow', c.shadow)
      .float('uOutline', c.outline)
      .float('uSolidLift', c.solidLift);
    this.pass.draw(this.scene);
  }

  private renderBloom(): void {
    const { gl } = this.ctx;
    const c = this.config;
    const levels = this.bloomLevels;

    const knee = c.bloomThreshold * c.bloomKnee + 1e-4;
    this.programs.prefilter.use()
      .texture('uSource', this.scene.texture)
      .vec2('uTexel', this.scene.texelX, this.scene.texelY)
      .vec3('uCurve', c.bloomThreshold - knee, knee * 2, 0.25 / knee)
      .float('uThreshold', c.bloomThreshold);
    this.pass.draw(levels[0]);

    for (let i = 1; i < levels.length; i++) {
      const source = levels[i - 1];
      this.programs.down.use()
        .texture('uSource', source.texture)
        .vec2('uTexel', source.texelX, source.texelY);
      this.pass.draw(levels[i]);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = levels.length - 1; i > 0; i--) {
      const source = levels[i];
      this.programs.up.use()
        .texture('uSource', source.texture)
        .vec2('uTexel', source.texelX, source.texelY)
        .float('uRadius', c.bloomRadius);
      this.pass.draw(levels[i - 1]);
    }
    gl.disable(gl.BLEND);
  }

  private present(aspect: number, time: number, bloomOn: boolean): void {
    const c = this.config;
    this.programs.final.use()
      .texture('uScene', this.scene.texture)
      .texture('uBloom', bloomOn ? this.bloomLevels[0].texture : this.black)
      .float('uBloomIntensity', bloomOn ? c.bloomIntensity : 0)
      .float('uExposure', c.exposure)
      .float('uChromatic', c.chromaticAberration)
      .float('uVignette', c.vignette)
      .float('uGrain', c.grain)
      .float('uAspect', aspect)
      .float('uTime', time)
      .int('uFrame', this.frame++ % 64)
      .int('uTonemapper', c.tonemapper === 'agx' ? 0 : 1);
    this.pass.draw(null);
  }
}

function createBlack(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Out of GPU memory.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  return texture;
}

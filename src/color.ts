import type { RGB } from './sim/FluidSolver';

/** HSV to RGB, with h, s and v in 0..1. */
export function hsv(h: number, s: number, v: number): RGB {
  const channel = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [channel(5), channel(3), channel(1)];
}

const wrap01 = (t: number) => ((t % 1) + 1) % 1;
/** Triangle wave: 0 -> 1 -> 0 as t goes 0 -> 0.5 -> 1. Loops smoothly. */
const triangle = (t: number) => 1 - Math.abs(wrap01(t) * 2 - 1);

export interface Palette {
  readonly name: string;
  /** Colour at palette position `t`. Any real number; the palette loops. */
  color(t: number): RGB;
}

export const PALETTES: readonly Palette[] = [
  { name: 'Spectrum', color: (t) => hsv(wrap01(t), 0.9, 1) },
  { name: 'Ember', color: (t) => hsv(0.015 + 0.085 * triangle(t), 0.9, 1) },
  { name: 'Abyss', color: (t) => hsv(0.47 + 0.17 * triangle(t), 0.85, 1) },
  { name: 'Neon', color: (t) => hsv(0.55 + 0.37 * triangle(t), 0.85, 1) },
  {
    name: 'Chrome',
    color: (t) => {
      const v = 0.55 + 0.45 * triangle(t);
      return [0.8 * v, 0.85 * v, 0.95 * v];
    },
  },
];

export function scale(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

# Fluid Engine

A real-time GPU fluid simulation written from scratch in TypeScript and WebGL2, built from Jos Stam's *Stable Fluids* (1999). It's the foundation of an audio-reactive typography engine: the solver accepts any mask as solid walls, so text can contain the fluid or stand in its way.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (works on GitHub Pages)
```

## Controls

| Input | Action |
|---|---|
| Move the mouse | Stir the fluid |
| Drag (or touch) | Paint |
| `Space` / double-tap | Random burst |
| `T` | Text mode: off → text as walls → fluid inside text |
| `C` | Cycle palette (Spectrum, Ember, Abyss, Neon, Chrome) |
| `A` | Toggle dye advection: MacCormack ↔ semi-Lagrangian (compare the sharpness) |
| `M` | Toggle tonemapper: AgX ↔ ACES |
| `P` / `R` / `S` / `H` | Pause / clear / save PNG / hide HUD |

Every parameter can be changed live from the browser console, e.g. `fluid.solver.config.vorticity = 30` or `fluid.renderer.config.bloomIntensity = 0.9`.

## Architecture

```
src/
  gl/        WebGL2 plumbing: context + format probing, Program, RenderTarget/PingPong, full-screen pass
  sim/       FluidSolver + one shader per solver pass (knows nothing about rendering)
  render/    Renderer: composite → bloom → final (knows nothing about physics)
  text/      TextMask: draws a word into an obstacle mask
  input/     Pointer Events (mouse, touch, pen, multi-touch)
  ui/        HUD
  main.ts    wires it together
```

The solver outputs fields (velocity, dye) and accepts a mask as input. The renderer reads those fields and never changes them. Materials, text and post effects all plug in on either side without touching the physics.

## The solver

Each step:

1. **Forces.** Vorticity confinement (Fedkiw, Stam & Jensen 2001) puts back the small eddies that numerical smoothing removes. Optional buoyancy makes bright dye rise.
2. **Viscosity** (optional). Implicit Jacobi diffusion, as in Stam's paper. Stable at any setting.
3. **Projection.** Divergence → 30 Jacobi iterations of ∇²p = ∇·u (warm-started) → u ← u − ∇p. Divergence and gradient use *the same* central difference, so the projection actually removes the divergence instead of over-correcting.
4. **Advection.** Dye moves through the freshly projected, divergence-free field, then velocity advects itself.

Choices that differ from most WebGL fluid demos:

- **MacCormack advection for dye** (Selle et al. 2008). It advects forward, then backward, and cancels half of the round-trip error, with a limiter that prevents overshoot. Thin filaments stay sharp instead of blurring away. Press `A` to compare.
- **RK2 back-tracing.** Midpoint integration follows curved streamlines, so vortices don't drift outward.
- **Physical units.** The domain is 1 unit tall. Velocity is in domain-heights per second and every operator uses the real cell size, so changing the grid resolution doesn't change how the fluid moves.
- **Frame-rate independent.** Exact exponential decay (`exp(-rate·dt)`), and brush strength scales with distance travelled, so 60 Hz and 120 Hz screens behave the same.
- **Obstacles everywhere.** Screen edges and masks share one code path: no-flow walls in divergence and gradient, Neumann pressure, solids zeroed in advection.
- **Swept brush strokes.** Splats are Gaussians along the segment the pointer moved this frame, so fast strokes stay continuous.
- **fp32 pressure** where supported, and exact `texelFetch` stencils.

## The renderer

- **HDR throughout.** Half-float buffers until the very end, so overlapping dye glows past 1.0 instead of clipping.
- **Lighting.** Dye density is treated as a height field, giving diffuse light, a specular sheen on slopes, and a soft shadow cast on the backdrop. Slopes are measured per domain unit, so the look doesn't depend on resolution.
- **Bloom.** 13-tap downsample with a Karis-average prefilter and a tent-filter upsample (Jimenez, SIGGRAPH 2014).
- **AgX tonemapping** (polynomial fit by Benjamin Wrensch), with ACES as an alternative.
- **Lens finish.** Radial chromatic aberration, vignette, film grain, and interleaved-gradient-noise dithering against banding.

## References

- Jos Stam, *Stable Fluids*, SIGGRAPH 1999
- Mark Harris, *Fast Fluid Dynamics Simulation on the GPU*, GPU Gems ch. 38
- Selle, Fedkiw, Kim, Liu & Rossignac, *An Unconditionally Stable MacCormack Method*, 2008
- Fedkiw, Stam & Jensen, *Visual Simulation of Smoke*, SIGGRAPH 2001
- Jorge Jimenez, *Next Generation Post Processing in Call of Duty: Advanced Warfare*, SIGGRAPH 2014
- Benjamin Wrensch, *Minimal AgX Implementation* (iolite-engine.com)

Visual inspiration: Pavel Dobryakov's WebGL Fluid Simulation. No code from it is used.

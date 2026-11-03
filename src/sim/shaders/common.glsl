// Shared by every solver pass (prepended after the #version header).
//
// Units: the domain is 1 unit tall and `aspect` units wide. Velocities are
// stored in domain-heights per second, so changing the grid resolution
// never changes how fast the fluid moves on screen.

in vec2 vUv;
out vec4 outColor;

// Obstacle mask: 1 = solid. Any resolution, sampled with linear filtering.
uniform sampler2D uObstacle;

// Anything outside the unit square counts as a wall, so the screen edges
// and the text mask go through exactly the same code path.
bool solidAt(vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return true;
  return texture(uObstacle, uv).r > 0.5;
}

// Grid helpers for the stencil passes (divergence, pressure, gradient,
// curl). These read exact cells with texelFetch instead of filtered samples.
ivec2 cellCoord() { return ivec2(gl_FragCoord.xy); }

vec2 cellCenter(ivec2 c, ivec2 size) { return (vec2(c) + 0.5) / vec2(size); }

bool solidCell(ivec2 c, ivec2 size) { return solidAt(cellCenter(c, size)); }

ivec2 clampCell(ivec2 c, ivec2 size) { return clamp(c, ivec2(0), size - 1); }

const ivec2 LEFT = ivec2(-1, 0);
const ivec2 RIGHT = ivec2(1, 0);
const ivec2 DOWN = ivec2(0, -1);
const ivec2 UP = ivec2(0, 1);

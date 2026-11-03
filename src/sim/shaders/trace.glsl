// Back-tracing shared by both advection schemes.

uniform sampler2D uVelocity; // sim resolution, domain-heights per second
uniform vec2 uVelToUv;       // converts physical velocity to uv/s: (1/aspect, 1)
uniform float uDt;           // negative runs time backwards (MacCormack's reverse step)

// Where was the fluid that is now at `uv`, one time step ago?
// Midpoint (RK2) integration follows curved streamlines far better than the
// single Euler step in the original paper, so vortices don't spiral outward.
vec2 backtrace(vec2 uv) {
  vec2 v1 = texture(uVelocity, uv).xy;
  vec2 mid = uv - 0.5 * uDt * v1 * uVelToUv;
  vec2 v2 = texture(uVelocity, mid).xy;
  return uv - uDt * v2 * uVelToUv;
}

// One Jacobi iteration of implicit viscous diffusion (the "diffuse" step in
// Stam's paper):  (I - nu * dt * laplacian) u = u0.
// Implicit, so it stays stable for any viscosity and time step.

uniform sampler2D uCurrent; // current estimate
uniform sampler2D uInitial; // velocity before diffusion (u0)
uniform float uAlpha;       // h^2 / (nu * dt)

vec2 velocityAt(ivec2 c, ivec2 size) {
  // No-slip walls: fluid touching a wall doesn't move.
  return solidCell(c, size) ? vec2(0.0) : texelFetch(uCurrent, clampCell(c, size), 0).xy;
}

void main() {
  ivec2 size = textureSize(uCurrent, 0);
  ivec2 c = cellCoord();
  if (solidCell(c, size)) {
    outColor = vec4(0.0);
    return;
  }
  vec2 sum = velocityAt(c + LEFT, size) + velocityAt(c + RIGHT, size)
           + velocityAt(c + DOWN, size) + velocityAt(c + UP, size);
  vec2 u0 = texelFetch(uInitial, c, 0).xy;
  outColor = vec4((sum + uAlpha * u0) / (4.0 + uAlpha), 0.0, 1.0);
}

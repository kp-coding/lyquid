// One Jacobi iteration of the pressure Poisson equation:
//
//   laplacian(p) = div(u)
//
// Discretised with the 5-point stencil and solved for the centre cell:
//   p = (wx * (pL + pR) + wy * (pB + pT) - div) / (2 * (wx + wy)),  w = 1 / h^2

uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uCellSize;
uniform float uScale; // warm start: last frame's pressure x scale on the first iteration, 1 after

float pressureAt(ivec2 c, ivec2 size) {
  return texelFetch(uPressure, clampCell(c, size), 0).x * uScale;
}

void main() {
  ivec2 size = textureSize(uPressure, 0);
  ivec2 c = cellCoord();
  if (solidCell(c, size)) {
    outColor = vec4(0.0);
    return;
  }

  float center = pressureAt(c, size);
  // Neumann boundary (zero pressure gradient into walls): a wall neighbour
  // reports the centre pressure back.
  float l = solidCell(c + LEFT, size)  ? center : pressureAt(c + LEFT, size);
  float r = solidCell(c + RIGHT, size) ? center : pressureAt(c + RIGHT, size);
  float b = solidCell(c + DOWN, size)  ? center : pressureAt(c + DOWN, size);
  float t = solidCell(c + UP, size)    ? center : pressureAt(c + UP, size);

  vec2 w = 1.0 / (uCellSize * uCellSize);
  float div = texelFetch(uDivergence, c, 0).x;
  float p = (w.x * (l + r) + w.y * (b + t) - div) / (2.0 * (w.x + w.y));
  outColor = vec4(p, 0.0, 0.0, 1.0);
}

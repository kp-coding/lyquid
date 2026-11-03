// Divergence of the velocity field: how much fluid each cell gains or loses.
// An incompressible fluid has zero divergence everywhere; the projection
// step below exists to make that true.

uniform sampler2D uVelocity;
uniform vec2 uCellSize; // physical size of one cell

vec2 velocityAt(ivec2 c, ivec2 size) {
  return texelFetch(uVelocity, clampCell(c, size), 0).xy;
}

void main() {
  ivec2 size = textureSize(uVelocity, 0);
  ivec2 c = cellCoord();
  if (solidCell(c, size)) {
    outColor = vec4(0.0);
    return;
  }

  vec2 center = velocityAt(c, size);
  // A wall neighbour mirrors the centre velocity, so the average across the
  // shared face is zero: no fluid flows into a wall.
  float l = solidCell(c + LEFT, size)  ? -center.x : velocityAt(c + LEFT, size).x;
  float r = solidCell(c + RIGHT, size) ? -center.x : velocityAt(c + RIGHT, size).x;
  float b = solidCell(c + DOWN, size)  ? -center.y : velocityAt(c + DOWN, size).y;
  float t = solidCell(c + UP, size)    ? -center.y : velocityAt(c + UP, size).y;

  float div = (r - l) / (2.0 * uCellSize.x) + (t - b) / (2.0 * uCellSize.y);
  outColor = vec4(div, 0.0, 0.0, 1.0);
}

// Vorticity: w = dv/dx - du/dy, how fast each cell is spinning (+ = counter-clockwise).

uniform sampler2D uVelocity;
uniform vec2 uCellSize;

vec2 velocityAt(ivec2 c, ivec2 size) {
  return texelFetch(uVelocity, clampCell(c, size), 0).xy;
}

void main() {
  ivec2 size = textureSize(uVelocity, 0);
  ivec2 c = cellCoord();
  float w = (velocityAt(c + RIGHT, size).y - velocityAt(c + LEFT, size).y) / (2.0 * uCellSize.x)
          - (velocityAt(c + UP, size).x - velocityAt(c + DOWN, size).x) / (2.0 * uCellSize.y);
  outColor = vec4(w, 0.0, 0.0, 1.0);
}

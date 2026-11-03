// Projection: u <- u - grad(p). What remains is divergence-free.
// (Helmholtz-Hodge decomposition, the core of Stam's method.)

uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uCellSize;

float pressureAt(ivec2 c, ivec2 size) {
  return texelFetch(uPressure, clampCell(c, size), 0).x;
}

void main() {
  ivec2 size = textureSize(uVelocity, 0);
  ivec2 c = cellCoord();
  if (solidCell(c, size)) {
    outColor = vec4(0.0);
    return;
  }

  bool sl = solidCell(c + LEFT, size);
  bool sr = solidCell(c + RIGHT, size);
  bool sb = solidCell(c + DOWN, size);
  bool st = solidCell(c + UP, size);

  float center = pressureAt(c, size);
  float l = sl ? center : pressureAt(c + LEFT, size);
  float r = sr ? center : pressureAt(c + RIGHT, size);
  float b = sb ? center : pressureAt(c + DOWN, size);
  float t = st ? center : pressureAt(c + UP, size);

  // Same central difference and the same 1/(2h) as the divergence pass.
  // If the two operators disagree, the projection over- or under-corrects
  // and the field never actually becomes divergence-free.
  vec2 grad = vec2((r - l) / (2.0 * uCellSize.x), (t - b) / (2.0 * uCellSize.y));
  vec2 velocity = texelFetch(uVelocity, c, 0).xy - grad;

  // No flow through walls: cancel the normal component next to a solid.
  if (sl || sr) velocity.x = 0.0;
  if (sb || st) velocity.y = 0.0;

  outColor = vec4(velocity, 0.0, 1.0);
}

// Body forces: vorticity confinement and buoyancy.

uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform sampler2D uDye;
uniform vec2 uCellSize;
uniform float uVorticity; // confinement strength (epsilon)
uniform float uBuoyancy;  // upward acceleration per unit of dye luminance
uniform float uDt;

float curlAt(ivec2 c, ivec2 size) {
  return texelFetch(uCurl, clampCell(c, size), 0).x;
}

void main() {
  ivec2 size = textureSize(uVelocity, 0);
  ivec2 c = cellCoord();
  if (solidCell(c, size)) {
    outColor = vec4(0.0);
    return;
  }

  // Vorticity confinement (Fedkiw, Stam & Jensen, 2001). The solver's
  // numerical smoothing slowly kills small eddies; this puts the spin back.
  // N points toward stronger rotation, and the force is epsilon * h * (N x w).
  // Scaling by h keeps the effect the same at every grid resolution.
  vec2 eta = vec2(
    (abs(curlAt(c + RIGHT, size)) - abs(curlAt(c + LEFT, size))) / (2.0 * uCellSize.x),
    (abs(curlAt(c + UP, size)) - abs(curlAt(c + DOWN, size))) / (2.0 * uCellSize.y));
  vec2 n = eta / (length(eta) + 1e-5);
  float w = curlAt(c, size);
  float h = min(uCellSize.x, uCellSize.y);
  vec2 force = uVorticity * h * w * vec2(n.y, -n.x);

  // Buoyancy: bright dye rises like hot smoke (negative values make it sink).
  vec3 dye = texture(uDye, vUv).rgb;
  force.y += uBuoyancy * dot(dye, vec3(0.2126, 0.7152, 0.0722));

  vec2 velocity = texelFetch(uVelocity, c, 0).xy + force * uDt;
  outColor = vec4(velocity, 0.0, 1.0);
}

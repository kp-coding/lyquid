// Semi-Lagrangian advection (Stam 1999): carry a field along the flow by
// sampling it where the fluid came from. Unconditionally stable, but the
// bilinear lookup blurs slightly every step. See maccormack.glsl for the fix.

uniform sampler2D uSource;
uniform float uDecay; // exp(-rate * dt), exact for any frame rate

void main() {
  if (solidAt(vUv)) {
    outColor = vec4(0.0);
    return;
  }
  outColor = texture(uSource, backtrace(vUv)) * uDecay;
}

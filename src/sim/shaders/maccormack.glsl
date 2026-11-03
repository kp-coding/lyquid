// MacCormack advection (Selle, Fedkiw, Kim, Liu & Rossignac, 2008).
//
// Plain semi-Lagrangian advection loses detail every frame, because the
// bilinear lookup is a low-pass filter. MacCormack runs the step forward,
// then backward, measures how far that round trip drifted from where it
// started, and cancels half of the error. That makes it second-order accurate
// and keeps thin filaments sharp, for two extra cheap passes.
//
//   forward  = A(source)          (advect.glsl, +dt)
//   reverse  = A_reverse(forward) (advect.glsl, -dt)
//   result   = forward + (source - reverse) / 2, then clamped

uniform sampler2D uSource;
uniform sampler2D uForward;
uniform sampler2D uReverse;
uniform float uDecay;

void main() {
  if (solidAt(vUv)) {
    outColor = vec4(0.0);
    return;
  }

  vec4 corrected = texture(uForward, vUv) + 0.5 * (texture(uSource, vUv) - texture(uReverse, vUv));

  // Limiter: keep the result inside the range of the four source texels the
  // backtrace landed between. Without it the correction can overshoot,
  // which shows up as ringing and colour fringes.
  ivec2 size = textureSize(uSource, 0);
  vec2 st = backtrace(vUv) * vec2(size) - 0.5;
  ivec2 i = ivec2(floor(st));
  ivec2 hi = size - 1;
  vec4 a = texelFetch(uSource, clamp(i, ivec2(0), hi), 0);
  vec4 b = texelFetch(uSource, clamp(i + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 c = texelFetch(uSource, clamp(i + ivec2(0, 1), ivec2(0), hi), 0);
  vec4 d = texelFetch(uSource, clamp(i + ivec2(1, 1), ivec2(0), hi), 0);
  vec4 lo = min(min(a, b), min(c, d));
  vec4 up = max(max(a, b), max(c, d));

  outColor = clamp(corrected, lo, up) * uDecay;
}

// Bloom downsample: 13-tap filter (Jimenez, "Next Generation Post Processing
// in Call of Duty: Advanced Warfare", SIGGRAPH 2014). Overlapping 2x2 boxes
// give a smooth, shimmer-free blur pyramid.
// With PREFILTER defined it also applies the brightness threshold and a
// Karis average, which stops single bright pixels from flickering.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uTexel; // source texel size

#ifdef PREFILTER
uniform vec3 uCurve; // soft-knee curve: (threshold - knee, 2 * knee, 0.25 / knee)
uniform float uThreshold;

float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
#endif

vec3 tap(float x, float y) { return texture(uSource, vUv + vec2(x, y) * uTexel).rgb; }

void main() {
  vec3 a = tap(-2.0, 2.0), b = tap(0.0, 2.0), c = tap(2.0, 2.0);
  vec3 d = tap(-2.0, 0.0), e = tap(0.0, 0.0), f = tap(2.0, 0.0);
  vec3 g = tap(-2.0, -2.0), h = tap(0.0, -2.0), i = tap(2.0, -2.0);
  vec3 j = tap(-1.0, 1.0), k = tap(1.0, 1.0), l = tap(-1.0, -1.0), m = tap(1.0, -1.0);

#ifdef PREFILTER
  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25;
  vec3 g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25;
  vec3 g4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 * karis(g0);
  float w1 = 0.125 * karis(g1);
  float w2 = 0.125 * karis(g2);
  float w3 = 0.125 * karis(g3);
  float w4 = 0.125 * karis(g4);
  vec3 color = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);

  float brightness = max(color.r, max(color.g, color.b));
  float soft = clamp(brightness - uCurve.x, 0.0, uCurve.y);
  soft = uCurve.z * soft * soft;
  color *= max(soft, brightness - uThreshold) / max(brightness, 1e-4);
#else
  vec3 color = e * 0.125
             + (a + c + g + i) * 0.03125
             + (b + d + f + h) * 0.0625
             + (j + k + l + m) * 0.125;
#endif

  outColor = vec4(color, 1.0);
}

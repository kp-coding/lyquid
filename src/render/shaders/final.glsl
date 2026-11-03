// Final output: lens effects, tonemapping, film grain and dithering.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomIntensity;
uniform float uExposure;
uniform float uChromatic; // lens dispersion strength
uniform float uVignette;
uniform float uGrain;
uniform float uAspect;
uniform float uTime;
uniform int uFrame;
uniform int uTonemapper;  // 0 = AgX, 1 = ACES

// --- AgX ------------------------------------------------------------------
// Polynomial fit of Troy Sobotka's AgX by Benjamin Wrensch
// (iolite-engine.com, "Minimal AgX implementation"). AgX rolls bright,
// saturated colours toward white the way film does, instead of clipping
// them into flat neon blobs.
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4
       - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agx(vec3 color) {
  const mat3 inset = mat3(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outset = mat3(
    1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393;
  const float maxEv = 4.026069;

  color = inset * max(color, vec3(1e-10));
  color = clamp(log2(color), minEv, maxEv);
  color = (color - minEv) / (maxEv - minEv);
  color = agxContrast(color);

  // "Punchy" look: a little extra contrast and saturation.
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(max(color, vec3(0.0)), vec3(1.3));
  color = luma + 1.35 * (color - luma);

  return clamp(outset * color, 0.0, 1.0); // already display-encoded
}

// --- ACES (Narkowicz fit) ---------------------------------------------------
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 aces(vec3 x) {
  x *= 0.6;
  vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return linearToSrgb(mapped);
}

// --- noise ------------------------------------------------------------------
// Interleaved gradient noise (Jimenez 2014): cheap, well-distributed dither.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 fromCenter = vUv - 0.5;

  // Lens dispersion: red and blue focus at slightly different radii,
  // so colour splits toward the edges and the centre stays clean.
  vec3 color;
  if (uChromatic > 0.0) {
    color.r = texture(uScene, vUv + fromCenter * uChromatic).r;
    color.g = texture(uScene, vUv).g;
    color.b = texture(uScene, vUv - fromCenter * uChromatic).b;
  } else {
    color = texture(uScene, vUv).rgb;
  }

  color += texture(uBloom, vUv).rgb * uBloomIntensity;
  color *= uExposure;

  float radius = length(fromCenter * vec2(uAspect, 1.0));
  color *= mix(1.0, 1.0 - smoothstep(0.35, 1.15, radius), uVignette);

  color = uTonemapper == 0 ? agx(color) : aces(color);

  vec2 pixel = gl_FragCoord.xy;
  color += (hash(pixel + fract(uTime) * 917.0) - 0.5) * uGrain;
  // Dither to hide 8-bit banding in the dark gradients.
  color += (ign(pixel + 5.588238 * float(uFrame)) - 0.5) / 255.0;

  outColor = vec4(color, 1.0);
}

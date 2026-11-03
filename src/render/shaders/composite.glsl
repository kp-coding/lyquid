// Turns the raw dye field into a lit HDR image (linear light, values may exceed 1).

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uDye;
uniform sampler2D uObstacle;
uniform vec2 uTexel;          // dye texel size in uv
uniform float uAspect;
uniform vec3 uBackground;     // backdrop centre (linear)
uniform vec3 uBackgroundEdge; // backdrop corners
uniform float uShading;       // 0 = flat glowing dye, 1 = fully lit surface
uniform float uBump;          // how tall the dye "surface" reads
uniform float uSpecular;
uniform float uShadow;        // how much dye darkens the backdrop behind it
uniform float uOutline;       // brightness of obstacle contours
uniform float uSolidLift;     // tint for the inside of solid obstacles

// Upper-left and fairly low, so flat areas catch no glare and only real
// slopes light up.
const vec3 LIGHT = vec3(-0.5, 0.7, 0.5);

float density(vec3 c) { return max(c.r, max(c.g, c.b)); }
float densityAt(vec2 uv) { return density(texture(uDye, uv).rgb); }

void main() {
  vec3 L = normalize(LIGHT);

  // Obstacle mask with an antialiased edge at any resolution.
  float mask = texture(uObstacle, vUv).r;
  float aa = max(fwidth(mask), 1e-3);
  float solid = smoothstep(0.5 - aa, 0.5 + aa, mask);

  vec3 dye = texture(uDye, vUv).rgb * (1.0 - solid);

  // Backdrop: a soft radial gradient, shadowed where dye blocks the light.
  vec2 centered = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec3 backdrop = mix(uBackground, uBackgroundEdge, smoothstep(0.0, 0.95, length(centered)));
  vec2 towardLight = normalize(L.xy) * vec2(1.0 / uAspect, 1.0) * 0.007;
  float occlusion = 0.0;
  for (int i = 1; i <= 4; i++) occlusion += densityAt(vUv + towardLight * float(i));
  backdrop *= 1.0 - uShadow * clamp(occlusion * 0.25, 0.0, 1.0);

  // Lighting: treat dye density as a height field. Slopes are measured per
  // domain unit (not per texel), so the look holds at every dye resolution.
  float hl = densityAt(vUv - vec2(uTexel.x, 0.0));
  float hr = densityAt(vUv + vec2(uTexel.x, 0.0));
  float hb = densityAt(vUv - vec2(0.0, uTexel.y));
  float ht = densityAt(vUv + vec2(0.0, uTexel.y));
  vec2 slope = vec2((hr - hl) / (2.0 * uTexel.x * uAspect), (ht - hb) / (2.0 * uTexel.y));
  vec3 n = normalize(vec3(-slope * uBump, 1.0));

  float diffuse = clamp(dot(n, L) / L.z, 0.15, 1.8); // exactly 1 on flat dye
  vec3 halfway = normalize(L + vec3(0.0, 0.0, 1.0));
  float coverage = smoothstep(0.02, 0.3, density(dye));
  float specular = pow(max(dot(n, halfway), 0.0), 72.0) * coverage;

  vec3 color = backdrop + dye * mix(1.0, diffuse, uShading) + vec3(specular * uSpecular);

  // Obstacles: lifted interior plus a thin contour line.
  color = mix(color, backdrop + vec3(uSolidLift), solid);
  float contour = 1.0 - smoothstep(0.0, aa * 2.5, abs(mask - 0.5));
  color += vec3(uOutline * contour);

  outColor = vec4(color, 1.0);
}

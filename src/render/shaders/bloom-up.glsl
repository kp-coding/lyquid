// Bloom upsample: 3x3 tent filter, additively blended onto the next larger
// mip. Summing every level gives a glow with a tight core and a wide halo.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uTexel; // source texel size
uniform float uRadius;

vec3 tap(float x, float y) { return texture(uSource, vUv + vec2(x, y) * uTexel * uRadius).rgb; }

void main() {
  vec3 sum = tap(-1.0, 1.0) + 2.0 * tap(0.0, 1.0) + tap(1.0, 1.0)
           + 2.0 * tap(-1.0, 0.0) + 4.0 * tap(0.0, 0.0) + 2.0 * tap(1.0, 0.0)
           + tap(-1.0, -1.0) + 2.0 * tap(0.0, -1.0) + tap(1.0, -1.0);
  outColor = vec4(sum / 16.0, 1.0);
}

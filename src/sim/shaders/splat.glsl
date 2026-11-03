// Adds a soft brush stroke to a field: a Gaussian swept along the segment
// the pointer travelled this frame, so fast strokes stay continuous instead
// of breaking into a trail of separate dots.

uniform sampler2D uTarget;
uniform vec2 uFrom;    // uv
uniform vec2 uTo;      // uv
uniform float uAspect;
uniform float uRadius; // in domain heights
uniform vec3 uValue;

float distanceToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
  return length(p - (a + ab * t));
}

void main() {
  // Measure in physical units so brushes stay round on wide screens.
  vec2 k = vec2(uAspect, 1.0);
  float d = distanceToSegment(vUv * k, uFrom * k, uTo * k);
  float falloff = solidAt(vUv) ? 0.0 : exp(-(d * d) / (uRadius * uRadius));
  outColor = texture(uTarget, vUv) + vec4(uValue * falloff, 0.0);
}

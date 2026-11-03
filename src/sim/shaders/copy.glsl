// Resampling copy (used when the window resizes, so the fluid survives).
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;

void main() {
  outColor = texture(uSource, vUv);
}

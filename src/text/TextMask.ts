/**
 * Renders a word into an obstacle mask for the solver (1 = solid).
 *
 *   'walls'  the letters are solid: fluid flows around them
 *   'inside' everything except the letters is solid: fluid is trapped
 *            inside the letterforms (the foundation of lyrics mode)
 *
 * The mask is drawn with Canvas2D at dye resolution, so contours stay crisp
 * when the renderer antialiases them.
 */

export type TextMode = 'off' | 'walls' | 'inside';

const FONT_STACK = '"Arial Black", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';

export class TextMask {
  readonly texture: WebGLTexture;
  mode: TextMode = 'off';
  private readonly canvas = document.createElement('canvas');
  private readonly ctx2d: CanvasRenderingContext2D;
  private pixels: Uint8ClampedArray | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const texture = gl.createTexture();
    const ctx2d = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!texture || !ctx2d) throw new Error('Could not create the text mask.');
    this.texture = texture;
    this.ctx2d = ctx2d;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Redraws the mask. Returns the texture to give the solver, or null when off. */
  update(text: string, mode: TextMode, width: number, height: number): WebGLTexture | null {
    this.mode = mode;
    if (mode === 'off') {
      this.pixels = null;
      return null;
    }

    const { canvas, ctx2d: g } = this;
    canvas.width = width;
    canvas.height = height;

    const solid = '#fff';
    const fluid = '#000';
    g.fillStyle = mode === 'walls' ? fluid : solid;
    g.fillRect(0, 0, width, height);

    // Fit the word to 86% of the width, capped by height.
    let size = height * 0.42;
    g.font = `900 ${size}px ${FONT_STACK}`;
    const measured = g.measureText(text).width;
    size = Math.min(size, (size * width * 0.86) / Math.max(measured, 1));
    g.font = `900 ${size}px ${FONT_STACK}`;

    const metrics = g.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = mode === 'walls' ? solid : fluid;
    g.fillText(text, width / 2, height / 2 + (ascent - descent) / 2);

    this.pixels = g.getImageData(0, 0, width, height).data;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return this.texture;
  }

  /** True when the point (uv, y up) is open fluid rather than solid. */
  isFluid(u: number, v: number): boolean {
    if (!this.pixels) return true;
    const x = Math.min(this.canvas.width - 1, Math.max(0, Math.floor(u * this.canvas.width)));
    const y = Math.min(this.canvas.height - 1, Math.max(0, Math.floor((1 - v) * this.canvas.height)));
    return this.pixels[(y * this.canvas.width + x) * 4] < 128;
  }
}

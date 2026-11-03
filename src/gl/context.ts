/**
 * WebGL2 context creation and texture-format detection.
 *
 * Sampling half-float textures with linear filtering is core WebGL2, but
 * *rendering* into float textures is still an extension, so we probe which
 * formats can actually be used as render targets on this GPU.
 */

export interface TexFormat {
  readonly internalFormat: number;
  readonly format: number;
  readonly type: number;
}

export interface GLContext {
  readonly gl: WebGL2RenderingContext;
  /** RGBA half float: dye, scene, bloom, scratch. Filterable in core WebGL2. */
  readonly rgba16f: TexFormat;
  /** Two-channel half float: velocity. */
  readonly rg16f: TexFormat;
  /** One-channel half float: curl. */
  readonly r16f: TexFormat;
  /**
   * One-channel full float when the GPU allows it: pressure and divergence.
   * The Jacobi solve adds up many small numbers, so the extra precision matters.
   */
  readonly r32f: TexFormat;
}

export function createGLContext(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('This browser does not support WebGL2.');

  const fullFloat = gl.getExtension('EXT_color_buffer_float') !== null;
  if (!fullFloat) gl.getExtension('EXT_color_buffer_half_float');

  const rgba16f: TexFormat = { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
  const rg16f: TexFormat = { internalFormat: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT };
  const r16f: TexFormat = { internalFormat: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT };
  const r32f: TexFormat = { internalFormat: gl.R32F, format: gl.RED, type: gl.FLOAT };

  if (!isRenderable(gl, rgba16f)) {
    throw new Error('This GPU cannot render into half-float textures.');
  }

  // Fall back to wider formats when a narrow one isn't renderable.
  const rg = isRenderable(gl, rg16f) ? rg16f : rgba16f;
  const r = isRenderable(gl, r16f) ? r16f : rg;
  const precise = fullFloat && isRenderable(gl, r32f) ? r32f : r;

  return { gl, rgba16f, rg16f: rg, r16f: r, r32f: precise };
}

function isRenderable(gl: WebGL2RenderingContext, f: TexFormat): boolean {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, f.internalFormat, 4, 4, 0, f.format, f.type, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  gl.deleteTexture(texture);
  return ok;
}

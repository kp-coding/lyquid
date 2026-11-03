import type { TexFormat } from './context';

/** A texture you can render into: a framebuffer with one colour attachment. */
export class RenderTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly texelX: number;
  readonly texelY: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly width: number,
    readonly height: number,
    readonly format: TexFormat,
    filter: number,
  ) {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Out of GPU memory.');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format.internalFormat, width, height, 0, format.format, format.type, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    this.texture = texture;
    this.framebuffer = framebuffer;
    this.texelX = 1 / width;
    this.texelY = 1 / height;
    this.clear();
  }

  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
  }
}

/**
 * Two render targets for read-modify-write passes. A shader can't sample the
 * texture it's writing to, so we read `read`, write `write`, then swap.
 */
export class PingPong {
  read: RenderTarget;
  write: RenderTarget;

  constructor(gl: WebGL2RenderingContext, width: number, height: number, format: TexFormat, filter: number) {
    this.read = new RenderTarget(gl, width, height, format, filter);
    this.write = new RenderTarget(gl, width, height, format, filter);
  }

  get width(): number {
    return this.read.width;
  }

  get height(): number {
    return this.read.height;
  }

  swap(): void {
    const previous = this.read;
    this.read = this.write;
    this.write = previous;
  }

  clear(): void {
    this.read.clear();
    this.write.clear();
  }

  dispose(): void {
    this.read.dispose();
    this.write.dispose();
  }
}

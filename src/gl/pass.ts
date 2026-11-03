import type { RenderTarget } from './target';

/** Draws the full-screen triangle into a render target, or the canvas when `target` is null. */
export class FullscreenPass {
  private readonly vao: WebGLVertexArrayObject;

  constructor(private readonly gl: WebGL2RenderingContext) {
    // An empty VAO: the vertex shader builds positions from gl_VertexID.
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Could not create a vertex array.');
    this.vao = vao;
  }

  draw(target: RenderTarget | null): void {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/**
 * A linked WebGL2 program with cached uniform locations and a chainable API:
 *
 *   program.use().texture('uVelocity', tex).float('uDt', dt);
 *
 * Every pass in the engine is a full-screen fragment shader, so all programs
 * share one vertex shader that draws a single oversized triangle.
 */

const VERTEX_SOURCE = `#version 300 es
out vec2 vUv;
void main() {
  // Vertices 0, 1, 2 -> (0,0), (2,0), (0,2): one triangle that covers the
  // whole viewport. No vertex buffer, and no diagonal seam like a quad.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

const sharedVertexShaders = new WeakMap<WebGL2RenderingContext, WebGLShader>();

export class Program {
  readonly handle: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  private nextTextureUnit = 0;

  /**
   * @param chunks GLSL pieces joined in order after the `#version` header.
   *               Pass `#define`s first, then shared code, then the shader.
   */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly name: string,
    ...chunks: string[]
  ) {
    let vertex = sharedVertexShaders.get(gl);
    if (!vertex) {
      vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE, 'fullscreen.vert');
      sharedVertexShaders.set(gl, vertex);
    }
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_HEADER + chunks.join('\n'), name);

    const program = gl.createProgram();
    if (!program) throw new Error(`Could not create program "${name}".`);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Failed to link "${name}":\n${gl.getProgramInfoLog(program)}`);
    }
    gl.detachShader(program, fragment);
    gl.deleteShader(fragment);
    this.handle = program;
  }

  /** Binds the program and restarts texture-unit allocation for this draw. */
  use(): this {
    this.gl.useProgram(this.handle);
    this.nextTextureUnit = 0;
    return this;
  }

  float(name: string, x: number): this {
    this.gl.uniform1f(this.location(name), x);
    return this;
  }

  vec2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.location(name), x, y);
    return this;
  }

  vec3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.location(name), x, y, z);
    return this;
  }

  int(name: string, x: number): this {
    this.gl.uniform1i(this.location(name), x);
    return this;
  }

  /** Binds `texture` to the next free unit and points sampler `name` at it. */
  texture(name: string, texture: WebGLTexture): this {
    const gl = this.gl;
    const unit = this.nextTextureUnit++;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.location(name), unit);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.handle);
  }

  private location(name: string): WebGLUniformLocation | null {
    let location = this.locations.get(name);
    if (location === undefined) {
      // null when the uniform doesn't exist or was optimised out; gl.uniform* ignores null.
      location = this.gl.getUniformLocation(this.handle, name);
      this.locations.set(name, location);
    }
    return location;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string, name: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not create shader "${name}".`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const numbered = source
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(4)}  ${line}`)
      .join('\n');
    throw new Error(`Failed to compile "${name}":\n${log}\n${numbered}`);
  }
  return shader;
}

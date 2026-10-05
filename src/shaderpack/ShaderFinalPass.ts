import * as THREE from 'three';

import { ShaderPackRuntime } from './ShaderPackRuntime';

/**
 * Bridges the existing Three.js scene into the first real OptiFine/Iris-style
 * fullscreen shader pass.
 *
 * The scene is rendered by Three.js into a real RGBA texture. The imported
 * shader-pack final program then samples that texture as colortex0 and writes
 * directly to the canvas framebuffer.
 */
export class ShaderFinalPass {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly runtime: ShaderPackRuntime;
  private readonly gl: WebGL2RenderingContext;
  private readonly sceneTarget: THREE.WebGLRenderTarget;

  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private texcoordBuffer: WebGLBuffer | null = null;
  private initialized = false;

  constructor(renderer: THREE.WebGLRenderer, runtime: ShaderPackRuntime) {
    this.renderer = renderer;
    this.runtime = runtime;
    this.gl = renderer.getContext() as WebGL2RenderingContext;

    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    this.sceneTarget.texture.name = 'ShaderPackSceneColor';
    this.sceneTarget.texture.colorSpace = THREE.NoColorSpace;
  }

  public resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.sceneTarget.width === w && this.sceneTarget.height === h) return;
    this.sceneTarget.setSize(w, h);
  }

  public render(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): boolean {
    const definition = this.runtime.getDefinition('final');
    const program = this.runtime.getProgram('final');
    if (!definition || !program) return false;

    this.resize(width, height);
    this.ensureGeometry(program);

    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);

    return this.renderTexture(this.sceneTarget.texture, width, height);
  }

  /**
   * Execute the pack's final program against an already-produced colortex0.
   * This is the bridge used once the real G-buffer exists.
   */
  public renderTexture(texture: THREE.Texture, width: number, height: number): boolean {
    const definition = this.runtime.getDefinition('final');
    const program = this.runtime.getProgram('final');
    if (!definition || !program) return false;

    this.resize(width, height);
    this.ensureGeometry(program);

    const textureHandle = this.getTextureHandle(texture);
    if (!textureHandle) {
      console.warn('[ShaderPipeline] Unable to obtain WebGL texture for colortex0');
      return false;
    }

    this.drawFinal(program, textureHandle, Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    this.renderer.resetState();
    return true;
  }

  public dispose(): void {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.texcoordBuffer) gl.deleteBuffer(this.texcoordBuffer);
    this.vao = null;
    this.vertexBuffer = null;
    this.texcoordBuffer = null;
    this.initialized = false;
    this.sceneTarget.dispose();
  }

  private ensureGeometry(program: WebGLProgram): void {
    if (this.initialized) return;

    const gl = this.gl;
    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const texcoordBuffer = gl.createBuffer();
    if (!vao || !vertexBuffer || !texcoordBuffer) {
      throw new Error('[ShaderPipeline] Unable to allocate final-pass fullscreen geometry');
    }

    const positionLocation = gl.getAttribLocation(program, 'iris_Vertex');
    const uvLocation = gl.getAttribLocation(program, 'iris_MultiTexCoord0');
    if (positionLocation < 0 || uvLocation < 0) {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteBuffer(texcoordBuffer);
      throw new Error(
        '[ShaderPipeline] final pass is missing fullscreen inputs ' +
        '(position=' + positionLocation + ', uv=' + uvLocation + ')'
      );
    }

    const positions = new Float32Array([
      0, 0, 0, 1, 1, 0, 0, 1,
      0, 1, 0, 1, 1, 1, 0, 1,
    ]);
    const uvs = new Float32Array([
      0, 0, 0, 1, 1, 0, 0, 1,
      0, 1, 0, 1, 1, 1, 0, 1,
    ]);

    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);

    this.vao = vao;
    this.vertexBuffer = vertexBuffer;
    this.texcoordBuffer = texcoordBuffer;
    this.initialized = true;
  }

  private drawFinal(program: WebGLProgram, texture: WebGLTexture, width: number, height: number): void {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    const colortex0 = gl.getUniformLocation(program, 'colortex0');
    const viewSize = gl.getUniformLocation(program, 'viewSize');
    const pixelSize = gl.getUniformLocation(program, 'pixelSize');
    const aspectRatio = gl.getUniformLocation(program, 'aspectRatio');
    const hideGUI = gl.getUniformLocation(program, 'hideGUI');

    if (colortex0) gl.uniform1i(colortex0, 0);
    if (viewSize) gl.uniform2f(viewSize, width, height);
    if (pixelSize) gl.uniform2f(pixelSize, 1 / width, 1 / height);
    if (aspectRatio) gl.uniform1f(aspectRatio, width / height);
    if (hideGUI) gl.uniform1i(hideGUI, 0);

    // The default framebuffer uses BACK; COLOR_ATTACHMENT0 is only valid
    // for user-created framebuffers with attached color textures.
    gl.drawBuffers([gl.BACK]);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
  }

  private getTextureHandle(texture: THREE.Texture): WebGLTexture | null {
    const properties = (this.renderer as unknown as {
      properties: {
        get: (object: THREE.Texture) => { __webglTexture?: WebGLTexture };
      };
    }).properties;
    return properties.get(texture).__webglTexture ?? null;
  }
}

import * as THREE from 'three';

import { ShaderPackRuntime, ShaderPassDefinition } from './ShaderPackRuntime';
import { ShaderFramebufferManager } from './ShaderFramebufferManager';

export class ShaderFullscreenPass {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly runtime: ShaderPackRuntime;
  private readonly framebuffers: ShaderFramebufferManager;
  private readonly gl: WebGL2RenderingContext;

  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private texcoordBuffer: WebGLBuffer | null = null;
  private geometryProgram: WebGLProgram | null = null;
  private readonly neutralTexture: THREE.DataTexture;

  constructor(renderer: THREE.WebGLRenderer, runtime: ShaderPackRuntime, framebuffers: ShaderFramebufferManager) {
    this.renderer = renderer;
    this.runtime = runtime;
    this.framebuffers = framebuffers;
    this.gl = renderer.getContext() as WebGL2RenderingContext;

    this.neutralTexture = new THREE.DataTexture(new Uint8Array([127, 127, 127, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.neutralTexture.colorSpace = THREE.NoColorSpace;
    this.neutralTexture.minFilter = THREE.NearestFilter;
    this.neutralTexture.magFilter = THREE.NearestFilter;
    this.neutralTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.neutralTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.neutralTexture.needsUpdate = true;
  }

  public render(name: string, width: number, height: number, frameCounter: number, worldTime: number): boolean {
    const definition = this.runtime.getDefinition(name);
    const program = this.runtime.getProgram(name);
    const readTarget = this.framebuffers.readTarget;
    const writeTarget = this.framebuffers.writeTarget;
    if (!definition || !program || !readTarget || !writeTarget) return false;

    this.ensureGeometry(program);
    const outputBuffers = this.resolveOutputBuffers(definition);
    if (outputBuffers.length === 0) return false;

    // Never sample from a color attachment that is simultaneously attached
    // for drawing. Copy the complete read set into the write set first, then
    // swap only after the pass has finished.
    this.framebuffers.prepareWriteTarget();

    const previousTarget = this.renderer.getRenderTarget();
    const gl = this.gl;
    const textureHandles = readTarget.textures.map((texture) => this.getTextureHandle(texture));
    const depthTexture = this.framebuffers.depthTexture;
    const depthHandle = depthTexture ? this.getTextureHandle(depthTexture) : null;
    let textureUnit = 0;

    try {
      this.renderer.setRenderTarget(writeTarget);
      gl.viewport(0, 0, Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
      gl.useProgram(program);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.drawBuffers(outputBuffers.map((index) => gl.COLOR_ATTACHMENT0 + index));

      for (let index = 0; index < textureHandles.length; index += 1) {
        const location = gl.getUniformLocation(program, 'colortex' + index);
        if (!location) continue;
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, textureHandles[index] ?? this.getTextureHandle(this.neutralTexture));
        gl.uniform1i(location, textureUnit++);
      }

      for (let index = 0; index < 8; index += 1) {
        const location = gl.getUniformLocation(program, 'depthtex' + index);
        if (!location) continue;
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, index === 0 && depthHandle ? depthHandle : this.getTextureHandle(this.neutralTexture));
        gl.uniform1i(location, textureUnit++);
      }

      for (const sampler of ['shadowtex0', 'shadowtex1', 'shadowcolor0', 'shadowcolor1', 'noisetex', 'normals', 'specular']) {
        const location = gl.getUniformLocation(program, sampler);
        if (!location) continue;
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, this.getTextureHandle(this.neutralTexture));
        gl.uniform1i(location, textureUnit++);
      }

      this.setCommonUniforms(program, width, height, frameCounter, worldTime);

      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);

      this.framebuffers.swap();

      for (let unit = 0; unit < textureUnit; unit += 1) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      gl.useProgram(null);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.resetState();
    }

    return true;
  }

  public dispose(): void {
    this.disposeGeometry();
    this.neutralTexture.dispose();
  }

  private ensureGeometry(program: WebGLProgram): void {
    if (this.vao && this.geometryProgram === program) return;
    this.disposeGeometry();

    const gl = this.gl;
    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const texcoordBuffer = gl.createBuffer();
    if (!vao || !vertexBuffer || !texcoordBuffer) throw new Error('[ShaderPipeline] Unable to allocate fullscreen geometry');

    const positionLocation = gl.getAttribLocation(program, 'iris_Vertex');
    const uvLocation = gl.getAttribLocation(program, 'iris_MultiTexCoord0');
    if (positionLocation < 0 || uvLocation < 0) {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteBuffer(texcoordBuffer);
      throw new Error('[ShaderPipeline] Fullscreen shader is missing iris_Vertex or iris_MultiTexCoord0');
    }

    const positions = new Float32Array([0,0,0,1, 1,0,0,1, 0,1,0,1, 1,1,0,1]);
    const uvs = new Float32Array([0,0,0,1, 1,0,0,1, 0,1,0,1, 1,1,0,1]);

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
    this.geometryProgram = program;
  }

  private disposeGeometry(): void {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.texcoordBuffer) gl.deleteBuffer(this.texcoordBuffer);
    this.vao = null;
    this.vertexBuffer = null;
    this.texcoordBuffer = null;
    this.geometryProgram = null;
  }

  private resolveOutputBuffers(definition: ShaderPassDefinition): number[] {
    const count = this.framebuffers.attachmentCountValue;
    return (definition.drawBuffers?.length ? [...new Set(definition.drawBuffers)] : [0])
      .filter((index) => index >= 0 && index < count);
  }

  private setCommonUniforms(program: WebGLProgram, width: number, height: number, frameCounter: number, worldTime: number): void {
    const gl = this.gl;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    for (const [name, x, y] of [
      ['viewSize', w, h],
      ['pixelSize', 1 / w, 1 / h],
      ['eyeBrightnessSmooth', 240, 240],
      ['eyeBrightness', 240, 240],
    ] as Array<[string, number, number]>) {
      const location = gl.getUniformLocation(program, name);
      if (location) gl.uniform2f(location, x, y);
    }

    for (const [name, value] of [
      ['aspectRatio', w / h],
      ['worldTime', worldTime],
      ['rainStrength', 0],
      ['wetness', 0],
    ] as Array<[string, number]>) {
      const location = gl.getUniformLocation(program, name);
      if (location) gl.uniform1f(location, value);
    }

    const frame = gl.getUniformLocation(program, 'frameCounter');
    if (frame) gl.uniform1i(frame, frameCounter);

    const taaOffset = gl.getUniformLocation(program, 'taaOffset');
    if (taaOffset) gl.uniform2f(taaOffset, 0, 0);

    const hideGUI = gl.getUniformLocation(program, 'hideGUI');
    if (hideGUI) gl.uniform1i(hideGUI, 0);
  }

  private getTextureHandle(texture: THREE.Texture): WebGLTexture | null {
    const properties = (this.renderer as unknown as {
      properties: { get: (object: THREE.Texture) => { __webglTexture?: WebGLTexture } };
    }).properties;
    if (!properties.get(texture).__webglTexture) this.renderer.initTexture(texture);
    return properties.get(texture).__webglTexture ?? null;
  }
}

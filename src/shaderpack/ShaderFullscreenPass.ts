import * as THREE from 'three';

import { ShaderPackRuntime, ShaderPassDefinition } from './ShaderPackRuntime';
import { ShaderFramebufferManager } from './ShaderFramebufferManager';

export interface ShaderShadowResources {
  texture: THREE.Texture | null;
  modelView: THREE.Matrix4;
  modelViewInverse: THREE.Matrix4;
  projection: THREE.Matrix4;
  projectionInverse: THREE.Matrix4;
}

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

  public render(name: string, width: number, height: number, frameCounter: number, worldTime: number, shadows: ShaderShadowResources | null = null): boolean {
    const definition = this.runtime.getDefinition(name);
    const program = this.runtime.getProgram(name);
    const mainReadTarget = this.framebuffers.readTarget;
    const mainWriteTarget = this.framebuffers.writeTarget;
    if (!definition || !program || !mainReadTarget || !mainWriteTarget) {
      console.warn('[ShaderPipeline] Pass unavailable:', name, {
        definition: !!definition,
        program: !!program,
        mainReadTarget: !!mainReadTarget,
        mainWriteTarget: !!mainWriteTarget,
      });
      return false;
    }

    this.ensureGeometry(program);
    const logicalOutputs = definition.drawBuffers?.length ? [...new Set(definition.drawBuffers)] : [0];
    const highOutputs = logicalOutputs.filter((index) => this.framebuffers.logicalToExtraAttachment(index) >= 0);
    const mainOutputs = logicalOutputs.filter((index) => this.framebuffers.logicalToExtraAttachment(index) < 0);
    if (highOutputs.length > 0 && mainOutputs.length > 0) {
      console.warn('[ShaderPipeline] Mixed main/extra render targets are not supported:', name, logicalOutputs);
      return false;
    }
    const outputBuffers = highOutputs.length > 0
      ? highOutputs.map((index) => this.framebuffers.logicalToExtraAttachment(index))
      : this.resolveOutputBuffers(definition);
    if (outputBuffers.length === 0) {
      console.warn('[ShaderPipeline] Pass has no valid output buffers:', name, logicalOutputs);
      return false;
    }

    // Never sample from a color attachment that is simultaneously attached
    // for drawing. Copy the complete read set into the write set first, then
    // swap only after the pass has finished.
    const sampledLogicalAttachments = this.getSampledColorAttachments(definition.fragmentSource);
    const outputSet = new Set(outputBuffers);
    const copyPhysicalAttachments = new Set(
      sampledLogicalAttachments
        .filter((index) => this.framebuffers.logicalToExtraAttachment(index) < 0)
        .map((index) => this.framebuffers.logicalToPhysicalAttachment(index))
        .filter((index) => !outputSet.has(index))
    );
    if (highOutputs.length === 0) this.framebuffers.prepareWriteTarget(copyPhysicalAttachments);

    const previousTarget = this.renderer.getRenderTarget();
    const readTarget = highOutputs.length > 0 ? this.framebuffers.extraReadTarget : this.framebuffers.readTarget;
    const writeTarget = highOutputs.length > 0 ? this.framebuffers.extraWriteTarget : this.framebuffers.writeTarget;
    if (!readTarget || !writeTarget) {
      console.warn('[ShaderPipeline] Pass target unavailable:', name, {
        highOutputs,
        extraRead: !!this.framebuffers.extraReadTarget,
        extraWrite: !!this.framebuffers.extraWriteTarget,
      });
      return false;
    }
    const gl = this.gl;

    // Remove stale errors so diagnostics below identify this pass only.
    while (gl.getError() !== gl.NO_ERROR) {}

    const textureHandles = Array.from({ length: 16 }, (_, logicalIndex) =>
      this.getTextureHandle(this.framebuffers.getTexture(logicalIndex, highOutputs.length > 0 ? 'read' : 'read') ?? this.neutralTexture)
    );
    const depthTexture = this.framebuffers.depthTexture;
    const depthHandle = depthTexture ? this.getTextureHandle(depthTexture) : null;
    let textureUnit = 0;

    try {
      // Stage 1: Three.js binds the framebuffer and (for MRT targets) sets
      // its own drawBuffers list for every attachment of the target.
      this.renderer.setRenderTarget(writeTarget);
      const setTargetError = gl.getError();
      const diagnosticContext = () => ({
        logicalOutputs,
        outputBuffers,
        highOutputs,
        targetAttachments: writeTarget.textures.length,
        targetSize: [writeTarget.width, writeTarget.height],
        hasDepthTexture: !!writeTarget.depthTexture,
        maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
        maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),
        boundFramebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING) ? 'FBO' : 'default',
      });
      if (setTargetError !== gl.NO_ERROR) {
        console.error('[ShaderPipeline] GL error after setRenderTarget:', name, setTargetError, diagnosticContext());
        return false;
      }

      // Stage 2: framebuffer completeness, checked for every pass.
      const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (framebufferStatus !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('[ShaderPipeline] Incomplete framebuffer after setRenderTarget:', name, framebufferStatus, diagnosticContext());
        return false;
      }
      const statusError = gl.getError();
      if (statusError !== gl.NO_ERROR) {
        console.error('[ShaderPipeline] GL error after checkFramebufferStatus:', name, statusError, diagnosticContext());
        return false;
      }

      gl.viewport(0, 0, Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
      gl.useProgram(program);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      const stateError = gl.getError();
      if (stateError !== gl.NO_ERROR) {
        console.error('[ShaderPipeline] GL error after useProgram/state setup:', name, stateError, diagnosticContext());
        return false;
      }

      // Stage 3: Three.js configures the MRT draw-buffer state when it binds
      // the WebGLRenderTarget. Do not overwrite that state here: mobile WebGL2
      // drivers can reject a redundant drawBuffers() call even though the
      // framebuffer itself is complete. Fragment output locations are already
      // remapped by GlslTranslator to the physical attachment indices.

      // Nostalgia uses logical colortex0..15. This renderer currently has
      // eight physical MRT attachments; explicitly bind the unsupported higher
      // logical slots to a neutral texture instead of leaving their sampler
      // uniforms at the default texture unit (which accidentally aliases
      // colortex0 and can corrupt later passes).
      for (let index = 0; index < 16; index += 1) {
        const location = gl.getUniformLocation(program, 'colortex' + index);
        if (!location) continue;
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        const texture = index < textureHandles.length
          ? textureHandles[index]
          : this.getTextureHandle(this.neutralTexture);
        gl.bindTexture(gl.TEXTURE_2D, texture ?? this.getTextureHandle(this.neutralTexture));
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
        const texture =
          sampler === 'noisetex' ? this.runtime.getTexture('noisetex') :
          (sampler === 'shadowtex0' || sampler === 'shadowtex1' || sampler === 'shadowcolor0' || sampler === 'shadowcolor1')
            ? shadows?.texture ?? null
            : null;
        gl.bindTexture(gl.TEXTURE_2D, texture ? this.getTextureHandle(texture) : this.getTextureHandle(this.neutralTexture));
        gl.uniform1i(location, textureUnit++);
      }

      if (shadows) {
        this.setMatrixUniform(program, 'shadowModelView', shadows.modelView);
        this.setMatrixUniform(program, 'shadowModelViewInverse', shadows.modelViewInverse);
        this.setMatrixUniform(program, 'shadowProjection', shadows.projection);
        this.setMatrixUniform(program, 'shadowProjectionInverse', shadows.projectionInverse);
      }

      this.setCommonUniforms(program, width, height, frameCounter, worldTime);

      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);

      const glError = gl.getError();
      if (glError !== gl.NO_ERROR) {
        console.error('[ShaderPipeline] GL error after pass:', name, glError, {
          logicalOutputs,
          outputBuffers,
          highOutputs,
        });
        return false;
      }

      if (highOutputs.length > 0) this.framebuffers.swapExtra();
      else this.framebuffers.swap();

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

  private buildDrawBufferList(outputBuffers: number[]): number[] {
    const gl = this.gl;
    // WebGL2 drawBuffers[i] corresponds to fragment output location i.
    // The translator remaps that output location to the physical attachment,
    // so RENDERTARGETS: 4 becomes:
    // [NONE, NONE, NONE, NONE, COLOR_ATTACHMENT4].
    const highest = Math.max(...outputBuffers);
    const list: number[] = [];
    for (let slot = 0; slot <= highest; slot += 1) {
      list.push(outputBuffers.includes(slot) ? gl.COLOR_ATTACHMENT0 + slot : gl.NONE);
    }
    return list;
  }

  private resolveOutputBuffers(definition: ShaderPassDefinition): number[] {
    const count = this.framebuffers.attachmentCountValue;
    const logical = definition.drawBuffers?.length ? [...new Set(definition.drawBuffers)] : [0];
    return [...new Set(logical.map((index) => this.framebuffers.logicalToPhysicalAttachment(index)))]
      .filter((index) => index >= 0 && index < count);
  }

  private getSampledColorAttachments(fragmentSource: string): number[] {
    const indices = new Set<number>();
    const pattern = /uniform\s+sampler2D\s+colortex(\d+)\b/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(fragmentSource)) !== null) {
      indices.add(Number(match[1]));
    }
    return [...indices];
  }

  private setMatrixUniform(program: WebGLProgram, name: string, value: THREE.Matrix4): void {
    const location = this.gl.getUniformLocation(program, name);
    if (location) this.gl.uniformMatrix4fv(location, false, value.elements);
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

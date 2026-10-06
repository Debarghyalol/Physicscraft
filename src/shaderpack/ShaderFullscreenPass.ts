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
  /** Iris creates a pass-specific FBO whose attachment 0 is the first logical
   * RENDERTARGETS texture. Three.js MRT targets instead keep colortexN at
   * COLOR_ATTACHMENTN, so we need this remapping FBO for composite passes. */
  private passFramebuffer: WebGLFramebuffer | null = null;
  private readonly neutralTexture: THREE.DataTexture;
  private readonly whiteTexture: THREE.DataTexture;

  /** WebGL2 rejects the draw (INVALID_OPERATION, "Mismatch between texture
   * format and sampler type") when a depth texture with compare mode enabled is
   * read through sampler2D, or when a sampler2DShadow reads a texture without
   * compare mode. Iris/OpenGL is lenient about this; WebGL is not. Sampler
   * objects override the texture's own compare state per unit, so the same
   * Three.js shadow/depth texture can serve both sampler2D and sampler2DShadow. */
  private plainDepthSampler: WebGLSampler | null = null;
  private shadowCompareSampler: WebGLSampler | null = null;
  private neutralDepth: WebGLTexture | null = null;
  private readonly samplerTypeCache = new WeakMap<WebGLProgram, Map<string, number>>();

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

    this.whiteTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.whiteTexture.colorSpace = THREE.NoColorSpace;
    this.whiteTexture.minFilter = THREE.NearestFilter;
    this.whiteTexture.magFilter = THREE.NearestFilter;
    this.whiteTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.whiteTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.whiteTexture.needsUpdate = true;
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
    const mixedOutputs = highOutputs.length > 0 && mainOutputs.length > 0;
    // Keep the logical RENDERTARGETS indices all the way into the pass FBO.
    // configurePassFramebuffer() resolves each logical buffer to either the
    // main ping-pong target or the extra target, which also enables mixed lists.
    const outputBuffers = logicalOutputs;
    if (outputBuffers.length === 0) {
      console.warn('[ShaderPipeline] Pass has no valid output buffers:', name, logicalOutputs);
      return false;
    }

    // Never sample from a color attachment that is simultaneously attached
    // for drawing. Copy the complete read set into the write set first, then
    // swap only after the pass has finished.
    const sampledLogicalAttachments = this.getSampledColorAttachments(definition.fragmentSource);
    // Main-buffer reads must be copied to the write side before a mixed
    // pass, otherwise the pass would sample a color attachment that is also
    // attached for drawing. Extra-buffer outputs live in their own ping-pong
    // target and do not participate in this copy.
    const mainOutputPhysical = new Set(
      mainOutputs.map((index) => this.framebuffers.logicalToPhysicalAttachment(index))
    );
    const copyPhysicalAttachments = new Set(
      sampledLogicalAttachments
        .filter((index) => this.framebuffers.logicalToExtraAttachment(index) < 0)
        .map((index) => this.framebuffers.logicalToPhysicalAttachment(index))
        .filter((index) => !mainOutputPhysical.has(index))
    );
    if (mainOutputs.length > 0) this.framebuffers.prepareWriteTarget(copyPhysicalAttachments);

    const previousTarget = this.renderer.getRenderTarget();
    const readTarget = highOutputs.length > 0 && !mixedOutputs
      ? this.framebuffers.extraReadTarget
      : this.framebuffers.readTarget;
    const writeTarget = highOutputs.length > 0 && !mixedOutputs
      ? this.framebuffers.extraWriteTarget
      : this.framebuffers.writeTarget;
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
    const samplerUnits: number[] = [];

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

      // Stage 3: Iris does not use the logical RENDERTARGETS index as the
      // framebuffer attachment index. For RENDERTARGETS: 4 it attaches the
      // colortex4 texture to COLOR_ATTACHMENT0 and the normalized shader output
      // location 0 writes there. Three.js' WebGLRenderTarget instead attaches
      // colortex4 to COLOR_ATTACHMENT4, so simply calling drawBuffers() on the
      // Three.js FBO is not equivalent to Iris. Build the same pass-local FBO.
      const passFramebufferError = this.configurePassFramebuffer(outputBuffers);
      if (passFramebufferError !== gl.NO_ERROR) {
        console.error('[ShaderPipeline] GL error after pass framebuffer setup:', name, passFramebufferError, {
          ...diagnosticContext(),
          mixedOutputs,
          drawBufferList: this.buildDrawBufferList(outputBuffers),
        });
        return false;
      }
      const passFramebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (passFramebufferStatus !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('[ShaderPipeline] Incomplete Iris-compatible pass framebuffer:', name, passFramebufferStatus, {
          ...diagnosticContext(),
          mixedOutputs,
          drawBufferList: this.buildDrawBufferList(outputBuffers),
        });
        return false;
      }
      gl.drawBuffers(this.buildDrawBufferList(outputBuffers));
      const drawBuffersError = gl.getError();
      if (drawBuffersError !== gl.NO_ERROR) {
        console.error('[ShaderPipeline] GL error after drawBuffers:', name, drawBuffersError, {
          ...diagnosticContext(),
          drawBufferList: this.buildDrawBufferList(outputBuffers),
        });
        return false;
      }

      // Nostalgia uses logical colortex0..15. This renderer currently has
      // eight physical MRT attachments; explicitly bind the unsupported higher
      // logical slots to a neutral texture instead of leaving their sampler
      // uniforms at the default texture unit (which accidentally aliases
      // colortex0 and can corrupt later passes).
      const assertTextureCall = (stage: string): boolean => {
        const error = gl.getError();
        if (error === gl.NO_ERROR) return true;
        console.error('[ShaderPipeline] GL error during texture/uniform binding:', name, error, {
          stage,
          textureUnitsUsed: textureUnit,
          maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
          maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        });
        return false;
      };

      for (let index = 0; index < 16; index += 1) {
        const location = gl.getUniformLocation(program, 'colortex' + index);
        if (!location) continue;
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        if (!assertTextureCall('activeTexture colortex' + index)) return false;
        const texture = index < textureHandles.length
          ? textureHandles[index]
          : this.getTextureHandle(this.neutralTexture);
        gl.bindTexture(gl.TEXTURE_2D, texture ?? this.getTextureHandle(this.neutralTexture));
        if (!assertTextureCall('bindTexture colortex' + index)) return false;
        gl.uniform1i(location, textureUnit);
        if (!assertTextureCall('uniform1i colortex' + index)) return false;
        textureUnit++;
      }

      const samplerTypes = this.getSamplerTypes(program);
      const isShadowSampler = (uniformName: string): boolean =>
        samplerTypes.get(uniformName) === gl.SAMPLER_2D_SHADOW;

      for (let index = 0; index < 8; index += 1) {
        const uniformName = 'depthtex' + index;
        const location = gl.getUniformLocation(program, uniformName);
        if (!location) continue;
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        if (!assertTextureCall('activeTexture ' + uniformName)) return false;
        const wantsShadow = isShadowSampler(uniformName);
        if (index === 0 && depthHandle) {
          gl.bindTexture(gl.TEXTURE_2D, depthHandle);
        } else {
          // depthtex1+ are not produced by this renderer: bind a real depth
          // texture so a depth/shadow sampler never sees a color texture.
          gl.bindTexture(gl.TEXTURE_2D, this.getNeutralDepthTexture());
        }
        gl.bindSampler(textureUnit, this.getDepthSampler(wantsShadow));
        samplerUnits.push(textureUnit);
        if (!assertTextureCall('bindTexture ' + uniformName)) return false;
        gl.uniform1i(location, textureUnit);
        if (!assertTextureCall('uniform1i ' + uniformName)) return false;
        textureUnit++;
      }

      for (const sampler of ['shadowtex0', 'shadowtex1', 'shadowcolor0', 'shadowcolor1', 'noisetex', 'normals', 'specular']) {
        const location = gl.getUniformLocation(program, sampler);
        if (!location) continue;
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        if (!assertTextureCall('activeTexture ' + sampler)) return false;
        const isShadowTex = sampler === 'shadowtex0' || sampler === 'shadowtex1';
        const isShadowColor = sampler === 'shadowcolor0' || sampler === 'shadowcolor1';
        // shadowcolor0/1 are color samplers. This renderer has no shadow color
        // buffer, and the shadow map texture is a compare-mode depth texture,
        // which WebGL2 refuses to read through sampler2D/texelFetch. Bind an
        // untinted white color texture instead (no colored shadow tint).
        const texture =
          sampler === 'noisetex' ? this.runtime.getTexture('noisetex') :
          isShadowTex ? shadows?.texture ?? null :
          isShadowColor ? this.whiteTexture :
          null;
        if (isShadowTex) {
          // shadowtex0/1 are depth samplers (sampler2D or sampler2DShadow).
          gl.bindTexture(gl.TEXTURE_2D, texture ? this.getTextureHandle(texture) : this.getNeutralDepthTexture());
          gl.bindSampler(textureUnit, this.getDepthSampler(isShadowSampler(sampler)));
          samplerUnits.push(textureUnit);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, texture ? this.getTextureHandle(texture) : this.getTextureHandle(this.neutralTexture));
        }
        if (!assertTextureCall('bindTexture ' + sampler)) return false;
        gl.uniform1i(location, textureUnit);
        if (!assertTextureCall('uniform1i ' + sampler)) return false;
        textureUnit++;
      }

      if (shadows) {
        this.setMatrixUniform(program, 'shadowModelView', shadows.modelView);
        this.setMatrixUniform(program, 'shadowModelViewInverse', shadows.modelViewInverse);
        this.setMatrixUniform(program, 'shadowProjection', shadows.projection);
        this.setMatrixUniform(program, 'shadowProjectionInverse', shadows.projectionInverse);
      }

      this.setCommonUniforms(program, width, height, frameCounter, worldTime);

      const uniformError = gl.getError();
      if (uniformError !== gl.NO_ERROR) {
        console.error('[ShaderPipeline] GL error after uniform setup:', name, uniformError, {
          ...diagnosticContext(),
          textureUnitsUsed: textureUnit,
        });
        return false;
      }

      if (!this.vao) {
        console.error('[ShaderPipeline] Missing fullscreen VAO:', name);
        return false;
      }

      gl.bindVertexArray(this.vao);
      const vaoError = gl.getError();
      if (vaoError !== gl.NO_ERROR) {
        console.error('[ShaderPipeline] GL error after bindVertexArray:', name, vaoError);
        gl.bindVertexArray(null);
        return false;
      }

      // WebGL validates sampler completeness at draw time. Validate every
      // texture unit actually used by this program before drawArrays so a mobile
      // driver cannot collapse the real cause into a generic 1282.
      for (let unit = 0; unit < textureUnit; unit += 1) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        const boundTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
        if (!boundTexture) {
          console.error('[ShaderPipeline] Missing 2D texture on sampler unit:', name, {
            unit,
            textureUnitsUsed: textureUnit,
          });
          return false;
        }
        const minFilter = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
        const magFilter = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER);
        const wrapS = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S);
        const wrapT = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T);
        // WebGL2 does not expose gl.getTexLevelParameter(). Texture
        // dimensions are therefore not queryable through the WebGL API.
        // Three.js owns the texture metadata; querying this nonexistent API
        // was itself throwing "getTexLevelParameter is not a function".
        const textureError = gl.getError();
        if (textureError !== gl.NO_ERROR) {
          console.error('[ShaderPipeline] Invalid sampler texture before draw:', name, textureError, {
            unit,
            minFilter,
            magFilter,
            wrapS,
            wrapT,
          });
          return false;
        }
        if (!gl.isTexture(boundTexture)) {
          console.error('[ShaderPipeline] Invalid WebGL texture before draw:', name, {
            unit,
            minFilter,
            magFilter,
            wrapS,
            wrapT,
          });
          return false;
        }
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const drawError = gl.getError();
      gl.bindVertexArray(null);

      if (drawError !== gl.NO_ERROR) {
        console.error('[ShaderPipeline] GL error after drawArrays:', name, drawError, {
          ...diagnosticContext(),
          logicalOutputs,
          outputBuffers,
          highOutputs,
          programLinked: gl.getProgramParameter(program, gl.LINK_STATUS),
          vao: !!this.vao,
        });
        return false;
      }

      if (mixedOutputs) {
        this.framebuffers.swap();
        this.framebuffers.swapExtra();
      } else if (highOutputs.length > 0) {
        this.framebuffers.swapExtra();
      } else {
        this.framebuffers.swap();
      }

      for (let unit = 0; unit < textureUnit; unit += 1) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      gl.useProgram(null);
    } finally {
      // Sampler objects are global GL state that Three.js knows nothing about;
      // always release them so later Three.js draws use their textures' own
      // sampling parameters again.
      for (const unit of samplerUnits) gl.bindSampler(unit, null);
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.resetState();
    }

    return true;
  }

  public dispose(): void {
    const gl = this.gl;
    if (this.plainDepthSampler) {
      gl.deleteSampler(this.plainDepthSampler);
      this.plainDepthSampler = null;
    }
    if (this.shadowCompareSampler) {
      gl.deleteSampler(this.shadowCompareSampler);
      this.shadowCompareSampler = null;
    }
    if (this.neutralDepth) {
      gl.deleteTexture(this.neutralDepth);
      this.neutralDepth = null;
    }
    if (this.passFramebuffer) {
      gl.deleteFramebuffer(this.passFramebuffer);
      this.passFramebuffer = null;
    }
    this.disposeGeometry();
    this.neutralTexture.dispose();
    this.whiteTexture.dispose();
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
    // drawBuffers[i] selects the attachment for fragment output location i.
    // Iris' pass framebuffer attaches the first RENDERTARGETS texture at
    // COLOR_ATTACHMENT0, the second at COLOR_ATTACHMENT1, and so on.
    return outputBuffers.map((_, index) => gl.COLOR_ATTACHMENT0 + index);
  }

  private configurePassFramebuffer(outputBuffers: number[]): number {
    const gl = this.gl;
    if (!this.passFramebuffer) {
      this.passFramebuffer = gl.createFramebuffer();
      if (!this.passFramebuffer) return gl.OUT_OF_MEMORY;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.passFramebuffer);

    // Remove attachments left by the previous pass. Iris creates a fresh
    // framebuffer for each pass, so every enabled attachment is intentional.
    const maxAttachments = Math.min(8, Number(gl.getParameter(gl.MAX_COLOR_ATTACHMENTS)) || 8);
    for (let i = 0; i < maxAttachments; i += 1) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
    }

    for (let outputIndex = 0; outputIndex < outputBuffers.length; outputIndex += 1) {
      const logicalIndex = outputBuffers[outputIndex];
      const texture = this.framebuffers.getTexture(logicalIndex, 'write');
      if (!texture) {
        console.error('[ShaderPipeline] Missing pass output texture:', {
          logicalIndex,
          outputIndex,
        });
        return gl.INVALID_OPERATION;
      }
      const textureHandle = this.getTextureHandle(texture);
      if (!textureHandle) return gl.INVALID_OPERATION;
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0 + outputIndex,
        gl.TEXTURE_2D,
        textureHandle,
        0,
      );
    }

    // Iris composite/deferred pass FBOs are color-only. The depth texture is
    // sampled by depthtex0 but is not attached to this pass framebuffer;
    // attaching it would create a feedback loop on alternating ping-pong frames.
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);

    return gl.getError();
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

    const check = (name: string, operation: string): boolean => {
      const error = gl.getError();
      if (error === gl.NO_ERROR) return true;
      console.error('[ShaderPipeline] GL error in common uniform:', name, error, { operation });
      return false;
    };

    for (const [name, x, y] of [
      ['viewSize', w, h],
      ['pixelSize', 1 / w, 1 / h],
      ['eyeBrightnessSmooth', 240, 240],
      ['eyeBrightness', 240, 240],
    ] as Array<[string, number, number]>) {
      const location = gl.getUniformLocation(program, name);
      if (!location) continue;
      gl.uniform2f(location, x, y);
      if (!check(name, 'uniform2f')) return;
    }

    for (const [name, value] of [
      ['aspectRatio', w / h],
      ['rainStrength', 0],
      ['wetness', 0],
    ] as Array<[string, number]>) {
      const location = gl.getUniformLocation(program, name);
      if (!location) continue;
      gl.uniform1f(location, value);
      if (!check(name, 'uniform1f')) return;
    }

    // Nostalgia declares worldTime as an integer in its prepare/composite
    // programs. Using uniform1f on an integer uniform generates GL_INVALID_OPERATION
    // (1282) on WebGL2.
    const worldTimeLocation = gl.getUniformLocation(program, 'worldTime');
    if (worldTimeLocation) {
      gl.uniform1i(worldTimeLocation, Math.floor(worldTime));
      if (!check('worldTime', 'uniform1i')) return;
    }

    const frame = gl.getUniformLocation(program, 'frameCounter');
    if (frame) {
      gl.uniform1i(frame, frameCounter);
      if (!check('frameCounter', 'uniform1i')) return;
    }

    const taaOffset = gl.getUniformLocation(program, 'taaOffset');
    if (taaOffset) {
      gl.uniform2f(taaOffset, 0, 0);
      if (!check('taaOffset', 'uniform2f')) return;
    }

    const hideGUI = gl.getUniformLocation(program, 'hideGUI');
    if (hideGUI) {
      gl.uniform1i(hideGUI, 0);
      if (!check('hideGUI', 'uniform1i')) return;
    }
  }

  /** Map of active sampler uniform name -> GL type (SAMPLER_2D, SAMPLER_2D_SHADOW, ...). */
  private getSamplerTypes(program: WebGLProgram): Map<string, number> {
    const cached = this.samplerTypeCache.get(program);
    if (cached) return cached;
    const gl = this.gl;
    const types = new Map<string, number>();
    const count = Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)) || 0;
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(program, i);
      if (info) types.set(info.name.replace(/\[0\]$/, ''), info.type);
    }
    this.samplerTypeCache.set(program, types);
    return types;
  }

  /** Sampler object for depth-format textures. `compare` selects hardware
   * shadow comparison (sampler2DShadow) or plain depth reads (sampler2D). */
  private getDepthSampler(compare: boolean): WebGLSampler | null {
    const gl = this.gl;
    const existing = compare ? this.shadowCompareSampler : this.plainDepthSampler;
    if (existing) return existing;
    const sampler = gl.createSampler();
    if (!sampler) return null;
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (compare) {
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.samplerParameteri(sampler, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.samplerParameteri(sampler, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      this.shadowCompareSampler = sampler;
    } else {
      // Depth textures sampled as float must be NEAREST and compare-free.
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.samplerParameteri(sampler, gl.TEXTURE_COMPARE_MODE, gl.NONE);
      this.plainDepthSampler = sampler;
    }
    return sampler;
  }

  /** 1x1 depth texture used where the pack expects a depth/shadow sampler but
   * this renderer has nothing to provide (e.g. depthtex1, or the first frame
   * before the shadow map exists). */
  private getNeutralDepthTexture(): WebGLTexture | null {
    if (this.neutralDepth) return this.neutralDepth;
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.neutralDepth = texture;
    return texture;
  }

  private getTextureHandle(texture: THREE.Texture): WebGLTexture | null {
    const properties = (this.renderer as unknown as {
      properties: { get: (object: THREE.Texture) => { __webglTexture?: WebGLTexture } };
    }).properties;
    if (!properties.get(texture).__webglTexture) this.renderer.initTexture(texture);
    return properties.get(texture).__webglTexture ?? null;
  }
}

import * as THREE from 'three';

export interface ShaderFramebufferConfig {
  colorAttachments?: number;
  depth?: boolean;
  pingPong?: boolean;
}

/**
 * Owns the render targets used by the shader-pack pipeline.
 *
 * The first implementation intentionally keeps the storage Three.js-native:
 * later fullscreen passes can consume the textures directly without reaching
 * into WebGL private state. ping-pong targets are allocated as a pair so
 * deferred/composite passes can safely read and write different attachments.
 */
export class ShaderFramebufferManager {
  private readonly renderer: THREE.WebGLRenderer;
  private primary: THREE.WebGLRenderTarget | null = null;
  private secondary: THREE.WebGLRenderTarget | null = null;
  private attachmentCount = 0;
  private pingPongEnabled = false;
  private readIndex = 0;
  private extraPrimary: THREE.WebGLRenderTarget | null = null;
  private extraSecondary: THREE.WebGLRenderTarget | null = null;
  private extraReadIndex = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  public get target(): THREE.WebGLRenderTarget | null {
    return this.primary;
  }

  public get readTarget(): THREE.WebGLRenderTarget | null {
    return this.pingPongEnabled ? (this.readIndex === 0 ? this.primary : this.secondary) : this.primary;
  }

  public get writeTarget(): THREE.WebGLRenderTarget | null {
    return this.pingPongEnabled ? (this.readIndex === 0 ? this.secondary : this.primary) : this.primary;
  }

  public get extraReadTarget(): THREE.WebGLRenderTarget | null {
    return this.extraReadIndex === 0 ? this.extraPrimary : this.extraSecondary;
  }

  public get extraWriteTarget(): THREE.WebGLRenderTarget | null {
    return this.extraReadIndex === 0 ? this.extraSecondary : this.extraPrimary;
  }

  public get extraTexture(): THREE.Texture | null {
    return null;
  }

  public get depthTexture(): THREE.DepthTexture | null {
    // Depth is generated once by the G-buffer and remains immutable while
    // deferred/composite passes ping-pong the color attachments.
    return this.primary?.depthTexture ?? null;
  }

  public get attachmentCountValue(): number {
    return this.attachmentCount;
  }

  public prepareWriteTarget(copyIndices?: ReadonlySet<number>): void {
    if (!this.pingPongEnabled || !this.primary || !this.secondary) return;
    const read = this.readTarget;
    const write = this.writeTarget;
    if (!read || !write) return;

    this.renderer.initRenderTarget(read);
    this.renderer.initRenderTarget(write);

    if (copyIndices) {
      for (const index of copyIndices) {
        if (index >= 0 && index < this.attachmentCount) {
          this.renderer.copyTextureToTexture(read.textures[index], write.textures[index]);
        }
      }
    } else {
      for (let index = 0; index < this.attachmentCount; index += 1) {
        this.renderer.copyTextureToTexture(read.textures[index], write.textures[index]);
      }
    }
  }

  public resize(width: number, height: number, colorAttachments = 3, config: ShaderFramebufferConfig = {}): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const count = Math.max(1, Math.floor(colorAttachments));
    const pingPong = config.pingPong ?? false;
    const depth = config.depth ?? true;

    const needsRecreate =
      !this.primary ||
      this.attachmentCount !== count ||
      this.pingPongEnabled !== pingPong ||
      (!!this.primary.depthTexture !== depth);

    if (needsRecreate) {
      this.disposeTargets();

      this.primary = this.createTarget(w, h, count, depth, 'Primary');
      this.secondary = pingPong ? this.createTarget(w, h, count, depth, 'Secondary') : null;
      this.extraPrimary = pingPong ? this.createTarget(w, h, 8, false, 'ExtraPrimary') : null;
      this.extraSecondary = pingPong ? this.createTarget(w, h, 8, false, 'ExtraSecondary') : null;
      this.extraReadIndex = 0;
      this.attachmentCount = count;
      this.pingPongEnabled = pingPong;
      this.readIndex = 0;
      return;
    }

    if (this.primary.width !== w || this.primary.height !== h) {
      this.primary.setSize(w, h);
      this.secondary?.setSize(w, h);
      this.extraPrimary?.setSize(w, h);
      this.extraSecondary?.setSize(w, h);
    }
  }

  public getTexture(index: number, target: 'read' | 'write' | 'primary' = 'primary'): THREE.Texture | null {
    const extraSlot = this.logicalToExtraAttachment(index);
    if (extraSlot >= 0) {
      const selectedExtra = target === 'read' ? this.extraReadTarget : target === 'write' ? this.extraWriteTarget : this.extraPrimary;
      // Three.js' WebGLRenderTarget count is capped by the implementation's
      // MRT support. If a device exposes fewer than 8 attachments, keep the
      // logical slot unavailable rather than aliasing an unrelated texture.
      return selectedExtra?.textures[extraSlot] ?? null;
    }
    const physicalIndex = this.logicalToPhysicalAttachment(index);
    const selected =
      target === 'read' ? this.readTarget :
      target === 'write' ? this.writeTarget :
      this.primary;

    return selected?.textures[physicalIndex] ?? null;
  }

  public logicalToExtraAttachment(index: number): number {
    // WebGL exposes at most eight color attachments per draw target. Keep
    // colortex0..7 in the primary MRT and give every logical colortex8..15
    // its own slot in the secondary MRT. This is required because Nostalgia
    // uses transient buffers such as 9, 12, 13 and 14 in addition to 8/10/11/15.
    return index >= 8 && index <= 15 ? index - 8 : -1;
  }

  public swapExtra(): void {
    this.extraReadIndex = this.extraReadIndex === 0 ? 1 : 0;
  }

  public logicalToPhysicalAttachment(index: number): number {
    // Logical buffers 0..7 are stored directly in the primary MRT.
    // Logical buffers 8..15 are stored in the secondary MRT and therefore
    // never need to be represented by a primary attachment index.
    return index;
  }

  public getColorTextures(target: 'read' | 'write' | 'primary' = 'primary'): THREE.Texture[] {
    const selected =
      target === 'read' ? this.readTarget :
      target === 'write' ? this.writeTarget :
      this.primary;

    return selected?.textures ?? [];
  }

  public swap(): void {
    if (!this.pingPongEnabled) return;
    this.readIndex = this.readIndex === 0 ? 1 : 0;
  }

  public clear(renderer = this.renderer): void {
    const previousTarget = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.primary);
      renderer.clear(true, true, true);
      if (this.secondary) {
        renderer.setRenderTarget(this.secondary);
        renderer.clear(true, true, true);
      }
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
  }

  public dispose(): void {
    this.disposeTargets();
    this.attachmentCount = 0;
    this.pingPongEnabled = false;
    this.readIndex = 0;
    this.extraReadIndex = 0;
  }

  private createTarget(
    width: number,
    height: number,
    count: number,
    depth: boolean,
    label: string,
  ): THREE.WebGLRenderTarget {
    const depthTexture = depth ? new THREE.DepthTexture(width, height) : undefined;
    if (depthTexture) {
      depthTexture.name = `ShaderPackDepthtex0-${label}`;
      depthTexture.type = THREE.UnsignedIntType;
      depthTexture.format = THREE.DepthFormat;
    }

    // Three.js r186 expects the depth texture to be attached after the
    // WebGLRenderTarget has been constructed. Passing it through the
    // constructor options hits the depthTexture setter before the target
    // is fully initialized and can throw "reading 'renderTarget'".
    const target = new THREE.WebGLRenderTarget(width, height, {
      count: Math.min(count, Math.max(1, Number(this.renderer.getContext().getParameter(
        (this.renderer.getContext() as WebGL2RenderingContext).MAX_COLOR_ATTACHMENTS
      )) || 1)),
      depthBuffer: depth,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });

    if (depthTexture) {
      target.depthTexture = depthTexture;
    }

    target.texture.name = `ShaderPackColortex0-${label}`;
    for (let i = 0; i < target.textures.length; i += 1) {
      target.textures[i].name = `ShaderPackColortex${i}-${label}`;
      target.textures[i].colorSpace = THREE.NoColorSpace;
    }

    return target;
  }

  private disposeTargets(): void {
    this.primary?.dispose();
    this.secondary?.dispose();
    this.extraPrimary?.dispose();
    this.extraSecondary?.dispose();
    this.primary = null;
    this.secondary = null;
    this.extraPrimary = null;
    this.extraSecondary = null;
  }
}

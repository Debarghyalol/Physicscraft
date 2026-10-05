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

  public get depthTexture(): THREE.DepthTexture | null {
    // Depth is generated once by the G-buffer and remains immutable while
    // deferred/composite passes ping-pong the color attachments.
    return this.primary?.depthTexture ?? null;
  }

  public get attachmentCountValue(): number {
    return this.attachmentCount;
  }

  public prepareWriteTarget(preserveIndices?: ReadonlySet<number>): void {
    if (!this.pingPongEnabled || !this.primary || !this.secondary) return;
    const read = this.readTarget;
    const write = this.writeTarget;
    if (!read || !write) return;

    this.renderer.initRenderTarget(read);
    this.renderer.initRenderTarget(write);

    for (let index = 0; index < this.attachmentCount; index += 1) {
      // Attachments written by the current pass do not need to be copied: the
      // fullscreen shader reads the old value from `read`, then overwrites the
      // corresponding attachment on `write`. Only untouched attachments need
      // their previous contents preserved.
      if (preserveIndices?.has(index)) continue;
      this.renderer.copyTextureToTexture(read.textures[index], write.textures[index]);
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
      this.attachmentCount = count;
      this.pingPongEnabled = pingPong;
      this.readIndex = 0;
      return;
    }

    if (this.primary.width !== w || this.primary.height !== h) {
      this.primary.setSize(w, h);
      this.secondary?.setSize(w, h);
    }
  }

  public getTexture(index: number, target: 'read' | 'write' | 'primary' = 'primary'): THREE.Texture | null {
    const selected =
      target === 'read' ? this.readTarget :
      target === 'write' ? this.writeTarget :
      this.primary;

    return selected?.textures[index] ?? null;
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

    const target = new THREE.WebGLRenderTarget(width, height, {
      count,
      depthBuffer: depth,
      stencilBuffer: false,
      depthTexture,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });

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
    this.primary = null;
    this.secondary = null;
  }
}

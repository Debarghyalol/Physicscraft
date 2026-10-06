import * as THREE from 'three';

import { ShaderPackRuntime } from './ShaderPackRuntime';
import { ShaderFramebufferManager } from './ShaderFramebufferManager';
import { VoxelWorld } from '../rendering/VoxelWorld';

/**
 * First real Minecraft-style G-buffer stage.
 *
 * Nostalgia's gbuffers_terrain program writes:
 *   location 0 -> colortex0 (albedo)
 *   location 1 -> colortex1 (encoded normal/light data)
 *   location 2 -> colortex2 (encoded material data)
 *
 * The target also owns a depth texture so later deferred/composite passes can
 * consume depthtex0 without rebuilding the scene.
 */
export class ShaderGBufferPass {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly runtime: ShaderPackRuntime;

  private readonly framebuffers: ShaderFramebufferManager;
  private material: THREE.RawShaderMaterial | null = null;
  private materialKey = '';

  private readonly flatNormalTexture: THREE.DataTexture;
  private readonly blackTexture: THREE.DataTexture;
  private readonly noiseTexture: THREE.DataTexture;

  constructor(renderer: THREE.WebGLRenderer, runtime: ShaderPackRuntime) {
    this.renderer = renderer;
    this.runtime = runtime;
    this.framebuffers = new ShaderFramebufferManager(renderer);

    this.flatNormalTexture = this.makeTexture(new Uint8Array([128, 128, 255, 255]));
    this.blackTexture = this.makeTexture(new Uint8Array([0, 0, 0, 255]));

    // A deterministic neutral noise source. It is only a bootstrap texture;
    // real pack textures/noise are wired into the pipeline in later stages.
    this.noiseTexture = this.makeTexture(new Uint8Array([127, 127, 127, 255]));
  }

  public get framebufferManager(): ShaderFramebufferManager {
    return this.framebuffers;
  }

  public get colorTexture(): THREE.Texture | null {
    return this.framebuffers.getTexture(0, 'read');
  }

  public get depthTexture(): THREE.DepthTexture | null {
    return this.framebuffers.depthTexture;
  }

  public resize(width: number, height: number): void {
    this.framebuffers.resize(width, height, 8, { pingPong: true, depth: true });
  }

  public render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    voxelWorld: VoxelWorld,
    width: number,
    height: number,
    frameCounter: number,
    worldTime: number,
    lightDir: THREE.Vector3
  ): boolean {
    const definition = this.runtime.getDefinition('gbuffers_terrain');
    if (!definition) return false;

    this.resize(width, height);
    this.ensureMaterial(definition, voxelWorld);

    const uniforms = this.material!.uniforms;
    const projection = camera.projectionMatrix;
    const modelView = camera.matrixWorldInverse;
    const projectionInverse = projection.clone().invert();
    const modelViewInverse = camera.matrixWorld;
    const cameraRotation = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion);
    const cameraRotationInverse = cameraRotation.clone().invert();

    uniforms.iris_ModelViewProjectionMatrix.value.multiplyMatrices(projection, modelView);
    uniforms.iris_ModelViewMatrix.value.copy(modelView);
    uniforms.iris_ModelViewMatrixInverse.value.copy(modelViewInverse);
    uniforms.iris_ProjectionMatrix.value.copy(projection);
    uniforms.iris_ProjectionMatrixInverse.value.copy(projectionInverse);
    uniforms.iris_NormalMatrix.value.getNormalMatrix(modelView);

    // Minecraft's gbufferModelView is camera-relative (rotation only), while
    // cameraPosition carries the world-space origin separately.
    uniforms.gbufferModelView.value.copy(cameraRotationInverse);
    uniforms.gbufferModelViewInverse.value.copy(cameraRotation);
    uniforms.gbufferProjection.value.copy(projection);
    uniforms.gbufferProjectionInverse.value.copy(projectionInverse);

    uniforms.cameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
    uniforms.viewSize.value.set(width, height);
    uniforms.pixelSize.value.set(1 / width, 1 / height);
    uniforms.taaOffset.value.set(0, 0);
    uniforms.frameCounter.value = frameCounter;
    uniforms.worldTime.value = worldTime;
    uniforms.lightDir.value.copy(lightDir).normalize();
    uniforms.rainStrength.value = 0;
    uniforms.wetness.value = 0;
    uniforms.near.value = (camera as THREE.PerspectiveCamera).near ?? 0.1;
    uniforms.far.value = (camera as THREE.PerspectiveCamera).far ?? 400;

    // The current world renderer owns Minecraft-like baked light in aLight.
    // Nostalgia expects the lightmap UV in the second texture coordinate.
    uniforms.eyeAltitude.value = camera.position.y;

    // Three.js enables every attachment of the MRT target (all 8) as draw
    // buffers, but gbuffers_terrain only writes a few of them. WebGL2 rejects
    // such draws ("Active draw buffers with missing fragment shader outputs"),
    // so nothing would be drawn at all. Iris only enables the buffers named by
    // RENDERTARGETS; do the same by masking the rest with NONE right before each
    // chunk draw (Three.js re-applies its own list whenever the render target
    // changes, e.g. after its internal shadow pass, so a single call is not enough).
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const gTarget = this.framebuffers.target;
    const attachmentCount = this.framebuffers.attachmentCountValue;
    const writtenLocations = this.getFragmentOutputLocations(definition.fragmentSource);
    const maskedDrawBuffers = Array.from({ length: attachmentCount }, (_, index) =>
      writtenLocations.has(index) ? gl.COLOR_ATTACHMENT0 + index : gl.NONE
    );
    const allDrawBuffers = Array.from({ length: attachmentCount }, (_, index) => gl.COLOR_ATTACHMENT0 + index);

    const hidden: Array<[THREE.Object3D, boolean]> = [];
    const patchedHooks: Array<[THREE.Object3D, THREE.Object3D['onBeforeRender']]> = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const keep = object.userData?.isVoxelChunk === true;
      hidden.push([object, object.visible]);
      object.visible = keep;
      if (keep) {
        const original = object.onBeforeRender;
        patchedHooks.push([object, original]);
        object.onBeforeRender = (...args: Parameters<THREE.Object3D['onBeforeRender']>) => {
          original.apply(object, args);
          // Only the G-buffer target: leave Three.js' shadow pass untouched.
          if (this.renderer.getRenderTarget() === gTarget) gl.drawBuffers(maskedDrawBuffers);
        };
      }
    });

    const previousOverride = scene.overrideMaterial;
    const previousTarget = this.renderer.getRenderTarget();

    try {
      scene.overrideMaterial = this.material;
      this.renderer.setRenderTarget(this.framebuffers.target);
      this.renderer.clear(true, true, true);
      this.renderer.render(scene, camera);
    } finally {
      for (const [object, hook] of patchedHooks) object.onBeforeRender = hook;
      // Put the full attachment list back so Three.js' cached state stays
      // truthful and the next frame's clear() covers every attachment.
      if (gTarget && this.renderer.getRenderTarget() === gTarget) gl.drawBuffers(allDrawBuffers);
      this.renderer.setRenderTarget(previousTarget);
      scene.overrideMaterial = previousOverride;
      for (const [object, visible] of hidden) object.visible = visible;
      this.renderer.resetState();
    }

    return true;
  }

  public dispose(): void {
    this.material?.dispose();
    this.material = null;
    this.framebuffers.dispose();
    this.flatNormalTexture.dispose();
    this.blackTexture.dispose();
    this.noiseTexture.dispose();
  }

  private ensureMaterial(
    definition: NonNullable<ReturnType<ShaderPackRuntime['getDefinition']>>,
    voxelWorld: VoxelWorld
  ): void {
    const key = definition.vertexSource + '\n---\n' + definition.fragmentSource;
    if (this.material && this.materialKey === key) {
      this.material.uniforms.gcolor.value = voxelWorld.getAtlasTexture();
      return;
    }

    this.material?.dispose();

    const identity = new THREE.Matrix4();
    this.material = new THREE.RawShaderMaterial({
      vertexShader: this.stripVersion(definition.vertexSource),
      fragmentShader: this.stripVersion(definition.fragmentSource),
      glslVersion: THREE.GLSL3,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
      transparent: false,
      uniforms: {
        iris_ModelViewProjectionMatrix: { value: new THREE.Matrix4() },
        iris_ModelViewMatrix: { value: new THREE.Matrix4() },
        iris_ModelViewMatrixInverse: { value: new THREE.Matrix4() },
        iris_ProjectionMatrix: { value: new THREE.Matrix4() },
        iris_ProjectionMatrixInverse: { value: new THREE.Matrix4() },
        iris_NormalMatrix: { value: new THREE.Matrix3() },
        iris_TextureMatrix0: { value: identity.clone() },
        iris_TextureMatrix1: { value: identity.clone() },

        gbufferModelView: { value: new THREE.Matrix4() },
        gbufferModelViewInverse: { value: new THREE.Matrix4() },
        gbufferProjection: { value: new THREE.Matrix4() },
        gbufferProjectionInverse: { value: new THREE.Matrix4() },

        gcolor: { value: voxelWorld.getAtlasTexture() },
        normals: { value: this.flatNormalTexture },
        specular: { value: this.blackTexture },
        noisetex: { value: this.noiseTexture },

        cameraPosition: { value: new THREE.Vector3() },
        lightDir: { value: new THREE.Vector3(0.35, 0.8, 0.2).normalize() },
        viewSize: { value: new THREE.Vector2(1, 1) },
        pixelSize: { value: new THREE.Vector2(1, 1) },
        taaOffset: { value: new THREE.Vector2() },

        frameCounter: { value: 0 },
        worldTime: { value: 6000 },
        rainStrength: { value: 0 },
        wetness: { value: 0 },
        near: { value: 0.1 },
        far: { value: 400 },
        eyeAltitude: { value: 80 },

        // These are referenced by shared shader code under some feature
        // combinations. Keeping them explicitly bound prevents accidental
        // zero-valued matrices when a pack enables those branches.
        gbufferModelViewInverse2: { value: new THREE.Matrix4() },
      },
    });

    this.material.defaultAttributeValues = {
      mc_midTexCoord: [0.5, 0.5, 0, 1],
      mc_Entity: [0, 0, 0, 0],
      at_midBlock: [0, 0, 0],
      at_tangent: [1, 0, 0, 1],
    };

    this.materialKey = key;
  }

  /** Fragment output locations declared via `layout(location = N) out`. */
  private getFragmentOutputLocations(fragmentSource: string): Set<number> {
    const locations = new Set<number>();
    const pattern = /layout\s*\(\s*location\s*=\s*(\d+)\s*\)\s*out\b/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(fragmentSource)) !== null) locations.add(Number(match[1]));
    if (locations.size === 0) locations.add(0);
    return locations;
  }

  private stripVersion(source: string): string {
    return source.replace(/^\s*#version\s+300\s+es\s*\n?/, '');
  }

  private makeTexture(data: Uint8Array): THREE.DataTexture {
    const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }
}

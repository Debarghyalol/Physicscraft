import { UnsignedByteType } from 'three';
import { Node as TSLNode } from 'three/webgpu';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import {
  Loop,
  attribute,
  getViewPosition,
  materialColor,
  float,
  mix,
  mrt,
  floor,
  normalWorld,
  output,
  shadow,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { DirectionalLight, PerspectiveCamera, Texture } from 'three';
import { createNostalgiaSSAO, createSceneCameraNodes } from './NostalgiaSSAO';
import type { Node } from 'three/tsl';

type NostalgiaScenePass = {
  setMRT: (configuration: ReturnType<typeof mrt>) => unknown;
  getTextureNode: (name: string) => Node;
};

export interface NostalgiaGBuffer {
  color: Node;
  /** Albedo is the first packed RGBA8 attachment. */
  albedo: Node;
  /** Decoded world normal reconstructed from octahedral RG8. */
  normal: Node;
  /** Decoded voxel light: x=sky, y=block, z=1 when voxel light data exists. */
  lightmap: Node;
  depth: Node;
}

/**
 * Per-surface voxel light (the `aLight` vertex attribute written by VoxelWorld's flood-fill
 * lighting). Geometry without that attribute (player model, clouds, particles) emits
 * zeros with z = 0, so the deferred pass treats it as fully sky-lit instead of black.
 *
 * A custom node (not `attribute()` directly) so geometry lacking the attribute does not
 * log a missing-attribute warning per material.
 */
class VoxelLightmapNode extends TSLNode {
  constructor() {
    super('vec4');
  }

  setup(builder: any) {
    const geometry = builder.geometry;
    if (geometry && geometry.hasAttribute('aLight')) {
      return vec4(attribute('aLight', 'vec2'), 1.0, 1.0);
    }
    return vec4(0.0, 0.0, 0.0, 1.0);
  }
}

const voxelLightmap = () => new VoxelLightmapNode() as unknown as Node;

/**
 * Reproduce Nostalgia's gbuffers_terrain.fsh attachment layout with native
 * WebGPU MRT.
 *
 * Nostalgia's solid.fsh writes:
 *   colortex0 = sceneAlbedo
 *   colortex1 = encoded normal + lightmap/specular data
 *   colortex2 = material/parallax/emission data
 *
 * Three's PassNode lets us provide arbitrary TSL expressions as MRT outputs,
 * so these are real scene-derived attachments rather than copies of the
 * final beauty buffer.
 */
export function activateNostalgiaGBuffer(scenePass: NostalgiaScenePass): NostalgiaGBuffer {
  /*
   * Match Nostalgia's fundamental strategy: keep the geometry buffer compact and
   * decode only what deferred lighting needs.
   *
   * Physicscraft currently needs only:
   *   - albedo RGB
   *   - world normal
   *   - sky/block voxel light
   *
   * Pack those into TWO RGBA8 attachments:
   *
   *   output/albedo RGBA8:
   *     RGB = albedo
   *     A   = unused/material alpha
   *
   *   gdata RGBA8:
   *     RG = octahedral normal
   *     B  = sky light
   *     A  = block light
   *
   * This avoids the default RGBA16F MRT allocations that caused the WebGPU
   * 32-bytes-per-sample validation failure.
   */
  const n = normalWorld.normalize();
  const invL1 = float(1.0).div(n.x.abs().add(n.y.abs()).add(n.z.abs()).max(0.000001));
  const octBase = n.xy.mul(invL1);
  const folded = vec2(1.0).sub(octBase.yx.abs()).mul(
    vec2(
      n.x.greaterThanEqual(0.0).select(1.0, -1.0),
      n.y.greaterThanEqual(0.0).select(1.0, -1.0),
    ),
  );
  const oct = n.z.lessThan(0.0).select(folded, octBase).mul(0.5).add(0.5);

  const light = voxelLightmap();
  const sky = light.x;
  const block = light.y;
  const hasLight = light.z;

  scenePass.setMRT(
    mrt({
      output: materialColor,
      gdata: vec4(oct.x, oct.y, sky, block),
    }),
  );

  scenePass.getTexture('output').type = UnsignedByteType;
  scenePass.getTexture('gdata').type = UnsignedByteType;

  const packed = scenePass.getTextureNode('gdata');

  // Decode octahedral normal from the packed RG8 pair.
  const encoded = packed.xy.mul(2.0).sub(1.0);
  const z = float(1.0).sub(encoded.x.abs()).sub(encoded.y.abs());
  const t = z.negate().max(0.0);
  const decoded = vec3(
    encoded.x.add(encoded.x.greaterThanEqual(0.0).select(t.negate(), t)),
    encoded.y.add(encoded.y.greaterThanEqual(0.0).select(t.negate(), t)),
    z,
  ).normalize();

  return {
    color: scenePass.getTextureNode('output'),
    albedo: scenePass.getTextureNode('output'),
    normal: decoded,
    lightmap: vec4(sky, block, hasLight, 1.0) as unknown as Node,
    depth: scenePass.getTextureNode('depth'),
  };
}

/**
 * Translate Nostalgia's shadowFiltered() kernel into TSL and install it into
 * Three's ShadowNode filter hook. Three continues to own shadow-map rendering,
 * projection, bias and lifetime; this replaces only the filtering algorithm.
 *
 * Iris normally provides shadowtex0, shadowtex1 and shadowcolor0 separately.
 * The current WebGPU renderer has one native directional shadow depth texture,
 * so this port reproduces Nostalgia's depth/occlusion filtering path and
 * leaves transparent shadow colour for the later dedicated shadow pass.
 */
function installNostalgiaShadowFilter(sunLight: DirectionalLight): void {
  const lightShadow = sunLight.shadow as any;
  if (lightShadow.__nostalgiaFilterInstalled === true) return;

  lightShadow.filterNode = ({ depthTexture, shadowCoord, shadow }: any) => {
    const mapSize = vec2(shadow.mapSize.width, shadow.mapSize.height);
    const shadowmapPixel = vec2(1.0).div(mapSize);

    // Nostalgia: R2((i + dither) * 64.0), with the same plastic constant.
    const rho = 1.324717957244746;
    const tau = Math.PI * 2.0;
    const iterations = 12;
    // Keep the sample pattern stable per screen pixel. A time-varying dither makes the
    // 12-tap filter crawl every frame and is especially visible on voxel shadow edges.
    const screenUv = uv();
    const dither = screenUv.x.mul(127.1).add(screenUv.y.mul(311.7)).sin().mul(43758.5453).fract();

    // Nostalgia warps the shadow map (shadowmapWarp) both when rendering it and when
    // sampling it. Three renders an unwarped map here, so sampling must use the unwarped
    // coordinate too: warping only the lookup shifts/magnifies every shadow (at the
    // centre of the map it scaled coordinates by ~6.7x). Resolution is instead tuned
    // through the shadow frustum size (see EnvironmentManager).
    const shadowUv = shadowCoord.xy;

    // getShadowRegular() clamps the filter to at least two shadow pixels.
    // DirectionalLightShadow.radius is used as the runtime sigma control.
    const sigma = float(shadow.radius ?? 1.0).mul(shadowmapPixel.x);
    const minSoftSigma = shadowmapPixel.x.mul(2.0);
    const softSigma = sigma.max(minSoftSigma);

    const totalShadow = float(0.0).toVar('nostalgiaShadowTotal');

    Loop(iterations, ({ i }) => {
      const n = float(i).add(dither).mul(64.0);
      const r2 = vec2(
        float(0.5).add(n.div(rho)).fract(),
        float(0.5).add(n.div(rho * rho)).fract(),
      );
      const angle = r2.x.mul(tau);
      const diskRadius = r2.y.sqrt();
      const offset = vec2(angle.cos(), angle.sin()).mul(diskRadius).mul(softSigma);

      // GetShadowBilinear(): four depth comparisons followed by explicit
      // bilinear interpolation, mirroring Nostalgia's shadowtex sampling.
      const sampleUv = shadowUv.add(offset);
      const pixel = sampleUv.mul(mapSize).sub(0.5);
      const base = pixel.floor().add(0.5).div(mapSize);
      const frac = pixel.fract();
      const texel = vec2(1.0).div(mapSize);

      const s00 = texture(depthTexture, base).x.greaterThanEqual(shadowCoord.z).select(1.0, 0.0);
      const s10 = texture(depthTexture, base.add(vec2(1.0, 0.0).mul(texel))).x.greaterThanEqual(shadowCoord.z).select(1.0, 0.0);
      const s01 = texture(depthTexture, base.add(vec2(0.0, 1.0).mul(texel))).x.greaterThanEqual(shadowCoord.z).select(1.0, 0.0);
      const s11 = texture(depthTexture, base.add(vec2(1.0, 1.0).mul(texel))).x.greaterThanEqual(shadowCoord.z).select(1.0, 0.0);

      const row0 = s00.mul(frac.x.oneMinus()).add(s10.mul(frac.x));
      const row1 = s01.mul(frac.x.oneMinus()).add(s11.mul(frac.x));
      const bilinear = row0.mul(frac.y.oneMinus()).add(row1.mul(frac.y));
      totalShadow.addAssign(bilinear);
    });

    const filtered = totalShadow.div(iterations);

    // Nostalgia's sharpenedShadow = linStep(TotalShadow.a, borders.x, borders.y)
    // where borders are mixed from (0.5,0.6) to (0.0,1.0) using sigma/minSoftSigma.
    const sharpenLerp = sigma.div(minSoftSigma).clamp(0.0, 1.0);
    const borderLow = float(0.5).mul(sharpenLerp.oneMinus());
    const borderHigh = float(0.6).mul(sharpenLerp.oneMinus()).add(sharpenLerp);

    return filtered
      .sub(borderLow)
      .div(borderHigh.sub(borderLow).max(0.0001))
      .clamp(0.0, 1.0);
  };

  lightShadow.__nostalgiaFilterInstalled = true;
}

/**
 * Port of Nostalgia's screen-space contactShadow.glsl.
 *
 * This is deliberately separate from the shadow-map lookup: the shadow map provides
 * the broad directional shadow, while this short view-space ray closes the small
 * rasterization gap immediately around voxel casters/receivers.
 */
function createNostalgiaContactShadow(
  sceneDepth: Node,
  viewPosition: Node,
  cam: ReturnType<typeof createSceneCameraNodes>,
  lightDirWorld: Node,
): Node {
  const lightDirView = (cam.viewMatrix as any).mul(vec4(lightDirWorld.normalize(), 0.0)).xyz.normalize();
  const start = viewPosition;
  const rayLength = (viewPosition.z.abs() as any).max(0.25);
  const rayEnd = start.add(lightDirView.mul(rayLength));

  const project = (p: any) => {
    const clip = (cam.projectionMatrix as any).mul(vec4(p, 1.0));
    const invW = float(1.0).div(clip.w);
    const ndc = clip.xyz.mul(invW);
    return vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(0.5).add(0.5));
  };

  const startUv = project(start);
  const endUv = project(rayEnd);
  const rayUv = endUv.sub(startUv);
  // The pack normalizes its projected ray to screen pixels, then advances four pixels
  // per iteration. Sampling the full projected ray here gives the same short contact
  // ray without making its reach depend on the ray's screen-space length.
  const dither = uv().x.mul(127.1).add(uv().y.mul(311.7)).sin().mul(43758.5453).fract();
  const stride = 4.0;
  const steps = 16;

  const hit = float(0.0).toVar('nostalgiaContactHit');
  Loop(steps, ({ i }) => {
    const pixelStep = float(i).mul(stride).add(dither.mul(stride).add(1.0));
    const t = pixelStep.div(float(steps).mul(stride)).clamp(0.0, 1.0);
    const rayPoint = start.add(rayEnd.sub(start).mul(t));
    const sampleUv = project(rayPoint);
    const inside = sampleUv.x.greaterThanEqual(0.0)
      .and(sampleUv.x.lessThanEqual(1.0))
      .and(sampleUv.y.greaterThanEqual(0.0))
      .and(sampleUv.y.lessThanEqual(1.0));

    const sampleDepth = sceneDepth.sample(sampleUv).x;
    const sampleView = getViewPosition(sampleUv, sampleDepth, cam.projectionMatrixInverse);
    // In view space the camera looks down -Z. A depth sample with a less-negative Z
    // than the ray point is in front of the light ray and therefore occludes it.
    const depthGap = sampleView.z.sub(rayPoint.z);
    const tolerance = float(0.015).add(t.mul(0.05));
    const depthHit = depthGap.greaterThan(tolerance)
      .and(sampleDepth.lessThan(0.99999));
    hit.assign(inside.and(depthHit).select(1.0, hit));
  });

  return hit.oneMinus().clamp(0.0, 1.0) as unknown as Node;
}

let nostalgiaShadowNode: any = null;

/**
 * Render the sun's shadow map from the real world scene. Call once per frame, before
 * `renderPipeline.render()`. A no-op until the pipeline has compiled (the shadow render
 * target is created lazily) or while shadows are disabled.
 */
export function updateNostalgiaShadowMap(renderer: any, scene: any, camera: any): void {
  const node = nostalgiaShadowNode;
  if (!node || !node.shadowMap || !node.light?.castShadow || renderer.shadowMap?.enabled !== true) return;
  node.updateShadow({ renderer, scene, camera });
}

/**
 * Deferred lighting using the actual Nostalgia shadowFiltered() kernel
 * translated to TSL, with Three.js retaining the native shadow-map renderer.
 */
export function createNostalgiaDeferredLighting(
  albedo: Node,
  sceneNormal: Node,
  sceneLightmap: Node,
  sceneDepth: Node,
  lightDirectionWorld: Node,
  lightStrength: Node,
  skyDim: Node,
  sunLight: DirectionalLight,
  camera: PerspectiveCamera,
  frameCounter: Node = float(0.0),
  noiseTexture?: Texture,
): Node {
  // Decode the 0..1 G-buffer normal back into a unit world-space vector.
  const normal = sceneNormal.xyz.mul(2.0).sub(1.0).normalize();
  const lightDir = lightDirectionWorld.normalize();
  const diffuse = normal.dot(lightDir).max(0.0);

  installNostalgiaShadowFilter(sunLight);

  // shadow() normally reads the *mesh* world position of the surface being shaded. In
  // this full-screen pass that would be the screen quad's position, giving every pixel
  // the same (meaningless) shadow lookup. Reconstruct the real world position of the
  // scene pixel from the depth buffer and hand it to the ShadowNode through the build
  // context (`shadowPositionWorld`), which Three honours for deferred use.
  const cam = createSceneCameraNodes(camera);
  const viewPosition = getViewPosition(uv(), sceneDepth.x, cam.projectionMatrixInverse);
  const worldPosition = (cam.worldMatrix as any).mul(vec4(viewPosition, 1.0)).xyz;
  // Normal-offset bias (ShadowNode's own normalBias would use the screen quad's normal):
  // push the lookup along the surface normal, more at grazing angles, to avoid acne on
  // side faces and self-shadowing banding on slopes.
  // Voxel faces are exactly one block wide. Keep the normal offset tiny so the shadow
  // remains attached to the caster instead of creating a visible gap at block edges.
  const biasedPosition = worldPosition.add(normal.mul(0.003));
  // Three's ShadowNode renders its shadow map from `frame.scene` when it is updated. Inside
  // the post-processing pass that scene is the full-screen quad, so left alone it renders
  // an EMPTY shadow map every frame and nothing is ever shadowed. Take over the update:
  // stop the node's own (wrong-scene) update and render the map ourselves each frame from
  // the real world scene via updateNostalgiaShadowMap().
  const sunShadowNode = shadow(sunLight) as any;
  sunLight.shadow.autoUpdate = false;
  nostalgiaShadowNode = sunShadowNode;
  const shadowFactor = sunShadowNode
    .context({ shadowPositionWorld: biasedPosition })
    .clamp(0.0, 1.0) as Node;
  // Nostalgia's contactShadow ray closes the sub-texel/rasterization gap that a
  // conventional shadow-map PCF lookup cannot resolve around voxel silhouettes.
  const contactShadow = createNostalgiaContactShadow(
    sceneDepth,
    viewPosition,
    cam,
    lightDir,
  );

  // --- Voxel light propagation (sky + block light flood fill from VoxelWorld) ---------
  // Same model as VoxelWorld's vanilla shader: sky light is reduced by the day/night
  // cycle, both channels go through Minecraft's non-linear curve, then are converted to
  // linear energy (pow 2.2). Surfaces without voxel light data count as fully sky-lit.
  const hasLight = sceneLightmap.z;
  const rawSky = mix(float(1.0), sceneLightmap.x, hasLight);
  const rawBlock = sceneLightmap.y.mul(hasLight);
  const skyLevel = rawSky.sub(skyDim.mul(11.0 / 15.0)).max(0.0);
  const mcLight = (l: any) => l.div(l.mul(-3.0).add(4.0)); // l / (4 - 3l)
  const skyBrightness = mcLight(skyLevel).pow(2.2);
  const blockBrightness = mcLight(rawBlock).pow(2.2);
  const moonTint = (skyDim as any).smoothstep(0.05, 1.0);
  const skyColor = mix(vec3(1.0, 1.0, 1.0), vec3(0.52, 0.68, 1.0), moonTint);
  const blockColor = vec3(1.0, 0.82, 0.6);

  // Direct sun only reaches surfaces that actually see the sky. The shadow map has a
  // finite frustum, so without this gate surfaces under a roof or in a cave can still be
  // sun-lit. Sky light is 15 (=1.0) only in open air; it drops under overhangs.
  const sunExposure = (rawSky as any).smoothstep(0.7, 0.95);

  // Hemispherical face term for sky ambient (up 1.0 / sides ~0.78 / down 0.55), standing
  // in for Nostalgia's sky-gather indirect light.
  const skyExposure = normal.y.mul(0.5).add(0.5).clamp(0.0, 1.0);
  const faceShade = float(0.55).add(skyExposure.mul(0.45));

  const skyAmbient = skyColor.mul(skyBrightness).mul(faceShade).mul(0.75);
  const blockLight = blockColor.mul(blockBrightness);
  const direct = diffuse.mul(lightStrength).mul(0.8).mul(shadowFactor).mul(contactShadow).mul(sunExposure);

  // Nostalgia's indirectAO.fsh multiplies the *indirect* light (sky + block bounce) by
  // SSAO; direct sunlight is left to the shadow map.
  const ambientOcclusion = createNostalgiaSSAO(sceneDepth, normal, cam, 1.0, frameCounter, noiseTexture);
  const indirect = skyAmbient.add(blockLight).mul(ambientOcclusion);

  const lighting = vec3(direct, direct, direct).add(indirect).max(0.002).min(1.5);

  return albedo.mul(lighting);
}

/**
 * Nostalgia's final.fsh applies CAS with strength 0.5 to colortex0.
 */
export function createNostalgiaFinalOutput(
  deferredColor: Node,
  originalSceneColor: Node,
  sceneDepth: Node,
): Node {
  // WebGPURenderer defaults to a normal depth buffer. A cleared depth value
  // identifies the sky/background, whose original pass contains the actual
  // Minecraft sun, moon, stars and cloud rendering.
  const background = sceneDepth.greaterThanEqual(0.99999);
  const sceneColor = background.select(originalSceneColor, deferredColor);
  return sharpen(sceneColor, 0.5, false);
}

export function isNostalgiaFinalSource(source: string): boolean {
  return /textureCAS\s*\(/.test(source) && /uniform\s+sampler2D\s+colortex0/.test(source);
}

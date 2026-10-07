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
  normalWorld,
  output,
  shadow,
  texture,
  time,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { DirectionalLight, PerspectiveCamera } from 'three';
import { createNostalgiaSSAO, createSceneCameraNodes } from './NostalgiaSSAO';
import type { Node } from 'three/tsl';

type NostalgiaScenePass = {
  setMRT: (configuration: ReturnType<typeof mrt>) => unknown;
  getTextureNode: (name: string) => Node;
};

export interface NostalgiaGBuffer {
  color: Node;
  albedo: Node;
  normal: Node;
  /** x = sky light 0..1, y = block light 0..1, z = 1 when the surface carries voxel light data. */
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
  scenePass.setMRT(
    mrt({
      output,
      // Use the material's actual texture/color, not diffuseColor. diffuseColor
      // already contains VoxelWorld's baked face/AO vertex color, so using it as
      // deferred albedo applies the Minecraft face shading a second time and makes
      // vertical/underside faces unnaturally black before lighting even runs.
      albedo: materialColor,
      // MRT color targets are normalized 0..1. Store the world normal encoded
      // from [-1,1] to [0,1]; writing normalWorld directly clips negative X/Y/Z
      // components and destroys the side/bottom-face normals in the deferred pass.
      normal: normalWorld.mul(0.5).add(0.5),
      lightmap: voxelLightmap(),
    }),
  );

  scenePass.getTexture('albedo').type = UnsignedByteType;

  return {
    color: scenePass.getTextureNode('output'),
    albedo: scenePass.getTextureNode('albedo'),
    normal: scenePass.getTextureNode('normal'),
    lightmap: scenePass.getTextureNode('lightmap'),
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
    const dither = time.mul(60.0).fract();

    // Nostalgia warps the shadow map (shadowmapWarp) both when rendering it and when
    // sampling it. Three renders an unwarped map here, so sampling must use the unwarped
    // coordinate too: warping only the lookup shifts/magnifies every shadow (at the
    // centre of the map it scaled coordinates by ~6.7x). Resolution is instead tuned
    // through the shadow frustum size (see EnvironmentManager).
    const uv = shadowCoord.xy;

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
      const sampleUv = uv.add(offset);
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
  const biasedPosition = worldPosition.add(normal.mul(float(0.03).add(float(0.07).mul(float(1.0).sub(diffuse)))));
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
  const direct = diffuse.mul(lightStrength).mul(0.8).mul(shadowFactor).mul(sunExposure);

  // Nostalgia's indirectAO.fsh multiplies the *indirect* light (sky + block bounce) by
  // SSAO; direct sunlight is left to the shadow map.
  const ambientOcclusion = createNostalgiaSSAO(sceneDepth, normal, cam, 1.0);
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

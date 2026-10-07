import { UnsignedByteType } from 'three';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import {
  Loop,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  getViewPosition,
  materialColor,
  float,
  mrt,
  normalWorld,
  output,
  shadow,
  texture,
  time,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import type { DirectionalLight } from 'three';
import type { Node } from 'three/tsl';

type NostalgiaScenePass = {
  setMRT: (configuration: ReturnType<typeof mrt>) => unknown;
  getTextureNode: (name: string) => Node;
};

export interface NostalgiaGBuffer {
  color: Node;
  albedo: Node;
  normal: Node;
  depth: Node;
}

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
    }),
  );

  scenePass.getTexture('albedo').type = UnsignedByteType;

  return {
    color: scenePass.getTextureNode('output'),
    albedo: scenePass.getTextureNode('albedo'),
    normal: scenePass.getTextureNode('normal'),
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

    // Nostalgia's shadowmapWarp() works around the centered shadow-map domain.
    // ShadowNode has already performed the light projection and normalization.
    const centered = shadowCoord.xy.mul(2.0).sub(1.0);
    const distortion = centered.mul(1.169).length().mul(0.85).add(0.15);
    const warped = centered.div(distortion);
    const uv = warped.mul(0.5).add(0.5);

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

/**
 * Deferred lighting using the actual Nostalgia shadowFiltered() kernel
 * translated to TSL, with Three.js retaining the native shadow-map renderer.
 */
export function createNostalgiaDeferredLighting(
  albedo: Node,
  sceneNormal: Node,
  sceneDepth: Node,
  lightDirectionWorld: Node,
  lightStrength: Node,
  sunLight: DirectionalLight,
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
  const viewPosition = getViewPosition(uv(), sceneDepth.x, cameraProjectionMatrixInverse);
  const worldPosition = cameraWorldMatrix.mul(vec4(viewPosition, 1.0)).xyz;
  const shadowFactor = (shadow(sunLight) as any)
    .context({ shadowPositionWorld: worldPosition })
    .clamp(0.0, 1.0) as Node;

  // The custom deferred node bypasses Three's HemisphereLight evaluation, so supply a
  // sky-ambient term here. Nostalgia is a path-traced pack: its indirect light is a
  // sky gather weighted by lightmap sky-light, so vertical and downward faces still
  // receive a large share of sky light (they are not near-black). Approximate that with
  // a hemispherical term that falls from 1.0 (up) to ~0.78 (sides) to 0.55 (down),
  // scaled by the current sun/moon intensity so it follows the day/night cycle.
  const skyExposure = normal.y.mul(0.5).add(0.5).clamp(0.0, 1.0);
  const faceShade = float(0.55).add(skyExposure.mul(0.45));
  const skyAmbient = faceShade.mul(0.75).mul(lightStrength.max(0.18));

  const direct = diffuse.mul(lightStrength).mul(0.8).mul(shadowFactor);
  const lighting = direct.add(skyAmbient).clamp(0.0, 1.5);

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

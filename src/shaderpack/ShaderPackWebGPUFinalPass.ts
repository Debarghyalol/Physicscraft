import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { mrt, normalView, output, vec4, float, max, dot, normalize } from 'three/tsl';
import type { Node } from 'three/tsl';

type NostalgiaScenePass = {
  setMRT: (configuration: ReturnType<typeof mrt>) => unknown;
  getTextureNode: (name: string) => Node;
};

export interface NostalgiaGBuffer {
  color: Node;
  normal: Node;
  depth: Node;
}

/**
 * Configure the native WebGPU MRT used by the first Nostalgia G-buffer stage.
 *
 * Iris maps gbuffers_terrain.fsh to:
 *   colortex0 = scene albedo
 *   colortex1 = encoded normal/light data
 *   colortex2 = material data
 *
 * The current WebGPU scene already exposes its beauty output and a native
 * view-space normal attachment. The latter is used directly by the first
 * deferred lighting adapter below.
 */
export function activateNostalgiaGBuffer(scenePass: NostalgiaScenePass): NostalgiaGBuffer {
  scenePass.setMRT(
    mrt({
      output,
      normal: normalView,
    }),
  );

  return {
    color: scenePass.getTextureNode('output'),
    normal: scenePass.getTextureNode('normal'),
    depth: scenePass.getTextureNode('depth'),
  };
}

/**
 * First real deferred stage.
 *
 * This follows the central direct-lighting operation in Nostalgia's
 * deferred1.fsh: reconstruct the view-space normal, evaluate N.L against
 * lightDirView, and use that to modulate the terrain color before the later
 * composite/final processing.
 *
 * Shadow-VPS filtering, material LAB-PBR decode, SSR and temporal history are
 * intentionally left for subsequent stages because their Iris resources are
 * not represented by the current Three.js scene pass yet.
 */
export function createNostalgiaDeferredLighting(
  sceneColor: Node,
  sceneNormal: Node,
  lightDirectionView: Node,
  lightStrength: Node = float(1.0),
): Node {
  const normal = normalize(sceneNormal.xyz);
  const lightDir = normalize(lightDirectionView);
  const diffuse = max(dot(normal, lightDir), 0.0);

  // Nostalgia's deferred lighting is deliberately conservative here because
  // the scene's voxel material already contains Minecraft block/sky lighting.
  // We add the deferred directional contribution without multiplying the
  // existing baked light twice.
  const lighting = float(0.30).add(diffuse.mul(float(0.70)).mul(lightStrength));
  return vec4(sceneColor.rgb.mul(lighting), sceneColor.a);
}

/**
 * Nostalgia's final.fsh applies CAS with strength 0.5 to colortex0.
 * Three.js exposes a native WebGPU sharpening node.
 */
export function createNostalgiaFinalOutput(sceneColor: Node): Node {
  return sharpen(sceneColor, 0.5, false);
}

export function isNostalgiaFinalSource(source: string): boolean {
  return /textureCAS\s*\(/.test(source) && /uniform\s+sampler2D\s+colortex0/.test(source);
}

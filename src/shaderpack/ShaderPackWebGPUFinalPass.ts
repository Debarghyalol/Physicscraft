import { UnsignedByteType } from 'three';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import {
  attribute,
  diffuseColor,
  mrt,
  normalView,
  output,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/tsl';

type NostalgiaScenePass = {
  setMRT: (configuration: ReturnType<typeof mrt>) => unknown;
  getTextureNode: (name: string) => Node;
};

export interface NostalgiaGBuffer {
  color: Node;
  albedo: Node;
  normal: Node;
  light: Node;
  material: Node;
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
  const lightAttribute = attribute('aLight', 'vec2');

  scenePass.setMRT(
    mrt({
      // This remains available as the ordinary beauty output. Keep it FP16
      // because it is the final HDR-capable scene color.
      output,

      // These three auxiliary targets only contain normalized color/light/
      // material data, so RGBA8 is sufficient and avoids exceeding WebGPU's
      // 32-byte-per-sample color-attachment limit.
      albedo: diffuseColor,
      normal: normalView,
      light: vec4(lightAttribute.x, lightAttribute.y, 0.0, 1.0),
      material: vec4(0.0, 0.0, 0.0, 1.0),
    }),
  );

  // Three defaults MRT attachments to RGBA16F. Five FP16 attachments would
  // cost 5 * 8 = 40 bytes/sample, while WebGPU guarantees only 32 here.
  // Keep the normal FP16 for signed normal precision; the other auxiliary
  // buffers are safely reduced to RGBA8.
  scenePass.getTexture('albedo').type = UnsignedByteType;
  scenePass.getTexture('light').type = UnsignedByteType;
  scenePass.getTexture('material').type = UnsignedByteType;

  return {
    color: scenePass.getTextureNode('output'),
    albedo: scenePass.getTextureNode('albedo'),
    normal: scenePass.getTextureNode('normal'),
    light: scenePass.getTextureNode('light'),
    material: scenePass.getTextureNode('material'),
    depth: scenePass.getTextureNode('depth'),
  };
}

/**
 * First real deferred lighting stage.
 *
 * This consumes the actual Nostalgia-style albedo/normal G-buffer instead of
 * the already-lit beauty buffer. It is intentionally the WebGPU equivalent
 * of the core diffuse operation in deferred1.fsh; shadow/VPS filtering is
 * added in the following stage once the WebGPU shadow attachments are exposed.
 */
export function createNostalgiaDeferredLighting(
  albedo: Node,
  sceneNormal: Node,
  lightDirectionView: Node,
  lightStrength: Node,
): Node {
  const normal = sceneNormal.xyz.normalize();
  const lightDir = lightDirectionView.normalize();
  const diffuse = normal.dot(lightDir).max(0.0);

  // Keep a small sky contribution while allowing the actual directional
  // response to dominate. This is deliberately stronger than the previous
  // beauty-buffer multiplier so the new G-buffer path is visually obvious.
  const lighting = diffuse.mul(lightStrength).mul(0.9).add(0.10);

  return vec4(albedo.rgb.mul(lighting), albedo.a);
}

/**
 * Nostalgia's final.fsh applies CAS with strength 0.5 to colortex0.
 */
export function createNostalgiaFinalOutput(sceneColor: Node): Node {
  return sharpen(sceneColor, 0.5, false);
}

export function isNostalgiaFinalSource(source: string): boolean {
  return /textureCAS\s*\(/.test(source) && /uniform\s+sampler2D\s+colortex0/.test(source);
}

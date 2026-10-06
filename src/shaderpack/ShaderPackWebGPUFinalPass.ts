import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { mrt, normalView, output } from 'three/tsl';
import type { Node } from 'three/tsl';

/**
 * WebGPU adapter for the first real shader-pack stage.
 *
 * Nostalgia's terrain G-buffer declares:
 *   location 0 -> colortex0 (scene albedo)
 *   location 1 -> colortex1 (normal/light data)
 *   location 2 -> colortex2 (material data)
 *
 * Three.js WebGPU exposes the same concept through PassNode MRT. The scene
 * pass is therefore configured as the shader-pack G-buffer before the final
 * output chain is built.
 *
 * The actual Iris GLSL stage is still translated separately; this adapter
 * provides the native WebGPU resource layout that later translated stages
 * will consume. It deliberately does not claim arbitrary GLSL compatibility.
 */
export function activateNostalgiaGBuffer(sceneColor: Node): Node {
  const passNode = (sceneColor as Node & {
    passNode?: {
      setMRT?: (configuration: ReturnType<typeof mrt>) => unknown;
      getTextureNode?: (name: string) => Node;
    };
  }).passNode;

  if (!passNode?.setMRT || !passNode.getTextureNode) {
    throw new Error('[ShaderPipeline] scene color is not backed by a Three.js PassNode');
  }

  // Map the first three logical shader-pack buffers onto a native WebGPU MRT.
  // The first output is Three's beauty/albedo output; normalView supplies the
  // view-space normal that the deferred stage will consume.
  passNode.setMRT(
    mrt({
      output,
      normal: normalView,
    }),
  );

  return passNode.getTextureNode('output');
}

/**
 * First WebGPU final-stage adapter.
 *
 * Nostalgia's final.fsh applies CAS (CAS_Strength 0.5) to colortex0. Three.js
 * already exposes a WebGPU-native CAS/sharpen implementation, so this executes
 * the equivalent final sharpening without falling back to WebGL.
 */
export function createNostalgiaFinalOutput(sceneColor: Node): Node {
  // Configure the scene pass before building the final node graph. PassNode
  // requires MRT configuration before compilation, so doing this here keeps
  // the existing Viewport3D setup small while still activating the real
  // WebGPU G-buffer path.
  activateNostalgiaGBuffer(sceneColor);
  return sharpen(sceneColor, 0.5, false);
}

export function isNostalgiaFinalSource(source: string): boolean {
  return /textureCAS\s*\(/.test(source) && /uniform\s+sampler2D\s+colortex0/.test(source);
}

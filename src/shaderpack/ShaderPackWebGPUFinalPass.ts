import { Node, sharpen } from 'three/tsl';

/**
 * First real WebGPU shader-pack output adapter.
 *
 * Nostalgia's final.fsh applies CAS (CAS_Strength 0.5) to colortex0 and then
 * performs an 8-bit Bayer dither. Three.js already exposes a WebGPU-native
 * contrast-adaptive sharpen node, so we can execute the equivalent operation
 * inside RenderPipeline without falling back to ShaderMaterial/WebGL.
 *
 * This is intentionally a narrow adapter rather than pretending arbitrary
 * Iris GLSL can be injected into TSL. More shader-pack stages will be mapped
 * here as their resource/binding contracts are implemented.
 */
export function createNostalgiaFinalOutput(sceneColor: Node): Node {
  return sharpen(sceneColor, 0.5, false);
}

export function isNostalgiaFinalSource(source: string): boolean {
  return /CAS_Strength\\s+0\\.5/.test(source) && /uniform\\s+sampler2D\\s+colortex0/.test(source);
}

import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { mrt, normalView, output } from 'three/tsl';
import type { Node } from 'three/tsl';

type NostalgiaScenePass = {
  setMRT: (configuration: ReturnType<typeof mrt>) => unknown;
  getTextureNode: (name: string) => Node;
};

export function activateNostalgiaGBuffer(scenePass: NostalgiaScenePass): Node {
  scenePass.setMRT(
    mrt({
      output,
      normal: normalView,
    }),
  );
  return scenePass.getTextureNode('output');
}

export function createNostalgiaFinalOutput(sceneColor: Node): Node {
  return sharpen(sceneColor, 0.5, false);
}

export function isNostalgiaFinalSource(source: string): boolean {
  return /textureCAS\s*\(/.test(source) && /uniform\s+sampler2D\s+colortex0/.test(source);
}

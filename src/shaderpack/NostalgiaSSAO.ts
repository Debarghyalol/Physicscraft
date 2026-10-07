import { PerspectiveCamera } from 'three';
import {
  float,
  mix,
  perspectiveDepthToViewZ,
  reference,
  screenCoordinate,
  screenSize,
  uniform,
  uv,
  vec2,
} from 'three/tsl';
import type { Node } from 'three/tsl';

/**
 * Scene-camera nodes for full-screen passes.
 *
 * RenderPipeline draws its screen quad with a dummy orthographic camera, so TSL's
 * `cameraWorldMatrix` / `cameraProjectionMatrixInverse` / `cameraNear` ... describe THAT
 * camera inside a post-processing node, not the player's. Three's own GTAO/SSR nodes pass
 * the scene camera explicitly; do the same.
 */
export interface SceneCameraNodes {
  near: Node;
  far: Node;
  projectionMatrixInverse: Node;
  projectionMatrix: Node;
  viewMatrix: Node;
  worldMatrix: Node;
  /** projectionMatrix[1][1] = 1 / tan(fov / 2) */
  projection11: Node;
}

export function createSceneCameraNodes(camera: PerspectiveCamera): SceneCameraNodes {
  return {
    near: reference('near', 'float', camera),
    far: reference('far', 'float', camera),
    projectionMatrixInverse: uniform(camera.projectionMatrixInverse),
    projectionMatrix: uniform(camera.projectionMatrix),
    viewMatrix: uniform(camera.matrixWorldInverse),
    worldMatrix: uniform(camera.matrixWorld),
    projection11: (uniform(camera.projectionMatrix) as any).element(1).element(1),
  };
}

/** Nostalgia renders at 0.75 scale; its SSAO radius is multiplied by it (lib/internal.glsl). */
const RESOLUTION_SCALE = 0.75;
const SSAO_STEPS = 4;
const BASE_RADIUS = Math.SQRT2;
const MAX_OCCLUSION_DIST = Math.PI * 2;
const ANTI_BLEED_EXP = 0.71;

const offsetDist = (x: any) => {
  const n = x.mul(8.0).fract().mul(Math.PI);
  return vec2(n.cos(), n.sin()).mul(x);
};

/**
 * TSL port of Nostalgia's `getDSSAO()` (program/deferred/indirectAO.fsh, SSAO by Capt Tatsu
 * / BSL): four depth taps on each side of the pixel along a rotating offset, with an
 * anti-bleed term. Returns a 0..1 occlusion factor (1 = unoccluded) for indirect light.
 *
 * Nostalgia's `depthLinear()` is 2n / (f + n - d(f - n)) on GL window depth; substituting
 * GL's depth mapping reduces to 2 * dist / (dist + far), which is what is used here so it
 * works with WebGPU's [0,1] clip depth.
 */
export function createNostalgiaSSAO(
  sceneDepth: Node,
  worldNormal: Node,
  cam: SceneCameraNodes,
  intensity = 1.0,
): Node {
  const near: any = cam.near;
  const far: any = cam.far;
  const depthTex: any = sceneDepth;
  const normal: any = worldNormal;
  const coord = uv();

  const linearize = (rawDepth: any) => {
    const dist = perspectiveDepthToViewZ(rawDepth, near, far).negate();
    return dist.mul(2.0).div(dist.add(far));
  };

  const rawDepth = depthTex.x;
  const depth = linearize(rawDepth);

  // radius = sqrt2 * (0.75 + |1 - dot(n, up)| * 0.5) * ResolutionScale
  const radius = float(BASE_RADIUS * RESOLUTION_SCALE).mul(
    float(0.75).add(float(1.0).sub(normal.y).abs().mul(0.5)),
  );

  // Interleaved gradient noise stands in for the pack's blue-noise texture.
  const frag: any = screenCoordinate;
  const dither = frag.x.mul(0.06711056).add(frag.y.mul(0.00583715)).fract().mul(52.9829189).fract();

  const fovScale = (cam.projection11 as any).div(1.37);
  const distScale = far.sub(near).mul(depth).add(near).max(5.0);
  const aspect = (screenSize as any).x.div((screenSize as any).y);
  const scale = vec2(aspect.reciprocal(), 1.0).mul(radius).mul(fovScale).div(distScale);
  const mult = float(0.7).div(radius).mul(far.sub(near));

  const tap = (offset: any) => {
    const sampleUv = coord.add(offset).clamp(0.0, 1.0);
    const sampleDepth = linearize(depthTex.sample(sampleUv).x);
    const sample0 = depth.sub(sampleDepth).mul(mult);
    const antiBleed = float(1.0).sub(
      float(1.0).div(
        float(1.0).add(
          sampleDepth.sub(depth).abs().mul(far).sub(MAX_OCCLUSION_DIST).max(0.0).mul(ANTI_BLEED_EXP),
        ),
      ),
    );
    const angle = mix(float(0.5).sub(sample0).clamp(0.0, 1.0), float(0.5), antiBleed);
    const dist = mix(sample0.mul(0.25).sub(1.0).clamp(0.0, 1.0), float(0.5), antiBleed);
    return { angle, dist };
  };

  let ao: any = float(0.0);
  let currStep: any = dither.mul(0.2).add(0.2);
  for (let i = 0; i < SSAO_STEPS; i++) {
    const offset = offsetDist(currStep).mul(scale);
    const a = tap(offset);
    const b = tap(offset.negate());
    ao = ao.add(a.angle.add(b.angle).add(a.dist).add(b.dist).clamp(0.0, 1.0));
    currStep = currStep.add(0.2);
  }
  ao = ao.div(SSAO_STEPS);

  // Sky / cleared depth is not occluded. mix(1, ao, intensity) like the pack.
  const isLand = rawDepth.lessThan(0.99999);
  return isLand.select(mix(float(1.0), ao, float(intensity)), float(1.0)) as unknown as Node;
}

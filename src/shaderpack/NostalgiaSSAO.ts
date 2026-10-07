import { PerspectiveCamera } from 'three';
import {
  float,
  mix,
  perspectiveDepthToViewZ,
  reference,
  screenCoordinate,
  texture,
  screenSize,
  uniform,
  uv,
  vec2,
} from 'three/tsl';
import type { Node } from 'three/tsl';
import type { Texture } from 'three';

export interface SceneCameraNodes {
  near: Node;
  far: Node;
  projectionMatrixInverse: Node;
  projectionMatrix: Node;
  viewMatrix: Node;
  worldMatrix: Node;
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

const RESOLUTION_SCALE = 0.75;
const SSAO_STEPS = 4;
const BASE_RADIUS = Math.SQRT2;
const MAX_OCCLUSION_DIST = Math.PI * 2;
const ANTI_BLEED_EXP = 0.71;

/**
 * Nostalgia's exact ditherBluenoise() source:
 *
 *   noise = texelFetch(noisetex, ivec2(gl_FragCoord.xy) & 255, 0).a;
 *   noise = fract(noise + frameCounter / pi); // when TAA is enabled
 *
 * The texture is configured as 256x256 nearest/repeat, so normalized sampling at
 * pixel centers is equivalent to the pack's integer texelFetch for our full-resolution pass.
 */
const blueNoise = (noiseTexture: Texture, frameCounter: Node) => {
  const frag: any = screenCoordinate;
  const noiseUv = frag.add(0.5).div(256.0).fract();
  const noise = texture(noiseTexture, noiseUv).a;
  return noise.add(frameCounter.div(Math.PI)).fract();
};

const offsetDist = (x: any) => {
  const n = x.mul(8.0).fract().mul(Math.PI);
  return vec2(n.cos(), n.sin()).mul(x);
};

export function createNostalgiaSSAO(
  sceneDepth: Node,
  worldNormal: Node,
  cam: SceneCameraNodes,
  intensity = 1.0,
  frameCounter: Node = float(0.0),
  noiseTexture?: Texture,
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

  const normalUp = normal.y.clamp(-1.0, 1.0);
  const radius = float(BASE_RADIUS * RESOLUTION_SCALE).mul(
    float(0.75).add(float(1.0).sub(normalUp).abs().mul(0.5)),
  );

  if (!noiseTexture) throw new Error('Nostalgia SSAO requires noise2D.png');
  const dither = blueNoise(noiseTexture, frameCounter);

  const fovScale = (cam.projection11 as any).div(1.37);
  const distScale = far.sub(near).mul(depth).add(near).max(5.0);
  const aspect = (screenSize as any).x.div((screenSize as any).y);
  const scale = vec2(aspect.reciprocal(), 1.0).mul(radius).mul(fovScale).div(distScale);
  const mult = float(0.7).div(radius).mul(far.sub(near));

  const tap = (offset: any) => {
    const sampleUv = coord.add(offset);
    const inside = sampleUv.x.greaterThanEqual(0.0)
      .and(sampleUv.x.lessThan(1.0))
      .and(sampleUv.y.greaterThanEqual(0.0))
      .and(sampleUv.y.lessThan(1.0));

    const sampleDepthRaw = depthTex.sample(sampleUv.clamp(0.0, 1.0)).x;
    const sampleDepth = linearize(sampleDepthRaw);
    const sample0 = depth.sub(sampleDepth).mul(mult);

    const antiBleed = float(1.0).sub(
      float(1.0).div(
        float(1.0).add(
          sampleDepth.sub(depth).abs()
            .mul(far)
            .sub(MAX_OCCLUSION_DIST)
            .max(0.0)
            .mul(ANTI_BLEED_EXP),
        ),
      ),
    );

    const angle = mix(float(0.5).sub(sample0).clamp(0.0, 1.0), float(0.5), antiBleed);
    const dist = mix(sample0.mul(0.25).sub(1.0).clamp(0.0, 1.0), float(0.5), antiBleed);

    return {
      angle: inside.select(angle, 0.5),
      dist: inside.select(dist, 0.5),
    };
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

  const isLand = rawDepth.lessThan(0.99999);
  return isLand.select(mix(float(1.0), ao, float(intensity)), float(1.0)) as unknown as Node;
}

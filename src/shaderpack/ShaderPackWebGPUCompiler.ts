import { init as initNaga, translate as nagaTranslate } from 'naga-wasm';

type GlslangCompiler = {
  compileGLSL(source: string, stage: 'vertex' | 'fragment' | 'compute'): Uint32Array;
};

let glslangPromise: Promise<GlslangCompiler> | null = null;
let nagaInitialized = false;

async function getGlslang(): Promise<GlslangCompiler> {
  if (!glslangPromise) {
    glslangPromise = import('@webgpu/glslang/dist/web-devel/glslang.js').then(async (module) => {
      return (await module.default()) as GlslangCompiler;
    });
  }
  return glslangPromise;
}

async function ensureNaga(): Promise<void> {
  if (!nagaInitialized) {
    await initNaga();
    nagaInitialized = true;
  }
}

export type WebGPUShaderStage = 'vertex' | 'fragment' | 'compute';

export interface WebGPUCompiledShader {
  stage: WebGPUShaderStage;
  spirv: Uint32Array;
  wgsl: string;
}

/**
 * Browser-side shader compiler for the Minecraft/Iris GLSL pipeline.
 *
 * We deliberately use the established GLSL -> SPIR-V -> WGSL route instead
 * of attempting a regex-based GLSL -> WGSL rewrite. The latter breaks on
 * texture/sampler types, control flow, overloads and matrix semantics.
 *
 * The compiler is backend-only: resource binding/reflection is kept separate
 * so the renderer can map Iris uniforms, textures and MRT outputs onto TSL.
 */
export async function compileShaderToWGSL(
  source: string,
  stage: WebGPUShaderStage,
): Promise<WebGPUCompiledShader> {
  await ensureNaga();

  const glslang = await getGlslang();
  const spirv = glslang.compileGLSL(source, stage);

  if (!(spirv instanceof Uint32Array) || spirv.length === 0) {
    throw new Error(`GLSL compiler returned no SPIR-V for ${stage} shader`);
  }

  const wgsl = nagaTranslate({
    from: 'spv',
    to: 'wgsl',
    source: spirv,
  });

  if (typeof wgsl !== 'string' || wgsl.trim().length === 0) {
    throw new Error(`Naga returned no WGSL for ${stage} shader`);
  }

  return { stage, spirv, wgsl };
}

export async function warmupWebGPUShaderCompiler(): Promise<void> {
  await Promise.all([ensureNaga(), getGlslang()]);
}

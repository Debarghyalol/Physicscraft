import { init as initNaga, translate as nagaTranslate } from 'naga-wasm';
const glslangWasmUrl = `${import.meta.env.BASE_URL}glslang.wasm`;

type GlslangCompiler = {
  compileGLSL(source: string, stage: 'vertex' | 'fragment' | 'compute'): Uint32Array;
};

let glslangPromise: Promise<GlslangCompiler> | null = null;
let nagaInitialized = false;

async function getGlslang(): Promise<GlslangCompiler> {
  if (!glslangPromise) {
    glslangPromise = (async () => {
      // Fetch the Vite-emitted WASM asset ourselves. Emscripten documents
      // Module.wasmBinary as the direct way to supply a fetched binary,
      // completely bypassing instantiateStreaming() and its URL/MIME lookup.
      const response = await fetch(glslangWasmUrl, { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch glslang WASM (${response.status} ${response.statusText}) from ${glslangWasmUrl}`,
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (
        bytes.length < 4 ||
        bytes[0] !== 0x00 ||
        bytes[1] !== 0x61 ||
        bytes[2] !== 0x73 ||
        bytes[3] !== 0x6d
      ) {
        const preview = new TextDecoder().decode(bytes.subarray(0, 32));
        throw new Error(
          `glslang WASM asset is not valid WebAssembly at ${glslangWasmUrl}; received: ${JSON.stringify(preview)}`,
        );
      }

      const module = await import('@webgpu/glslang/dist/web-devel/glslang.js');
      return (await module.default({
        wasmBinary: bytes,
        locateFile: () => glslangWasmUrl,
      })) as GlslangCompiler;
    })();
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

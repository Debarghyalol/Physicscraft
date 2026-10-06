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

      // vite.config.ts patches this module so its default export is the raw
      // Emscripten factory (the stock one ignores every option we pass).
      // The returned Module is thenable, so never resolve a promise with it
      // directly; resolve with a plain wrapper from onRuntimeInitialized.
      const factory = (await import('@webgpu/glslang/dist/web-devel/glslang.js'))
        .default as unknown as (opts: Record<string, unknown>) => unknown;
      return await new Promise<GlslangCompiler>((resolve, reject) => {
        try {
          factory({
            wasmBinary: bytes,
            locateFile: () => glslangWasmUrl,
            onRuntimeInitialized(this: any) {
              resolve({
                compileGLSL: (src: string, stage: 'vertex' | 'fragment' | 'compute') =>
                  this.compileGLSL(src, stage),
              });
            },
            onAbort: (reason: unknown) => reject(new Error(`glslang aborted: ${String(reason)}`)),
          });
        } catch (e) {
          reject(e);
        }
      });
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

  let wgsl: string;
  try {
    wgsl = nagaTranslate({
      from: 'spirv',
      to: 'wgsl',
      source: spirv,
    });
  } catch (err: any) {
    // NagaError.message is only the first line; the useful detail is in `formatted`.
    const detail = typeof err?.formatted === 'string' ? err.formatted : String(err?.message ?? err);
    throw new Error(`naga ${err?.kind ?? 'error'} (${stage}): ${detail}`);
  }

  if (typeof wgsl !== 'string' || wgsl.trim().length === 0) {
    throw new Error(`Naga returned no WGSL for ${stage} shader`);
  }

  return { stage, spirv, wgsl };
}

export async function warmupWebGPUShaderCompiler(): Promise<void> {
  await Promise.all([ensureNaga(), getGlslang()]);
}

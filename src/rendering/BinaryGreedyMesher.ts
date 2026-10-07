export interface WasmMeshResult {
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  lights: Float32Array;
  indices: Uint32Array;
  blocks: Uint8Array;
  quadCount: number;
}

type WasmModule = {
  default: (input?: string | URL | Request | Response | BufferSource) => Promise<unknown>;
  mesh_chunk: (blocks: Uint8Array, light: Uint8Array) => {
    positions: Float32Array;
    normals: Int8Array;
    uvs: Float32Array;
    lights: Float32Array;
    indices: Uint32Array;
    blocks: Uint8Array;
    quad_count: number;
  };
  padded_size: () => number;
  version: () => string;
};

let modulePromise: Promise<WasmModule> | null = null;

/**
 * Lazy WASM loader. The normal TS mesher remains the fallback until the
 * Rust output has passed geometry/lighting parity tests.
 */
export function loadBinaryGreedyMesher(): Promise<WasmModule> {
  if (!modulePromise) {
    modulePromise = import('/wasm/voxel-mesher/voxel_mesher.js').then(async (m: any) => {
      await m.default();
      return m as WasmModule;
    });
  }
  return modulePromise;
}

export async function meshChunkWithWasm(
  blocks: Uint8Array,
  light: Uint8Array,
): Promise<WasmMeshResult> {
  const mesher = await loadBinaryGreedyMesher();

  if (blocks.length !== 18 * 18 * 18 || light.length !== 18 * 18 * 18) {
    throw new Error('Binary greedy mesher requires padded 18x18x18 buffers.');
  }

  const result = mesher.mesh_chunk(blocks, light);

  return {
    positions: result.positions,
    normals: result.normals,
    uvs: result.uvs,
    lights: result.lights,
    indices: result.indices,
    blocks: result.blocks,
    quadCount: result.quad_count,
  };
}

export async function getBinaryGreedyMesherVersion(): Promise<string> {
  const mesher = await loadBinaryGreedyMesher();
  return mesher.version();
}

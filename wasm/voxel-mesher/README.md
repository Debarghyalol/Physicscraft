# Physicscraft Binary Greedy Mesher

This is the Rust/WebAssembly meshing core for Physicscraft.

Input is intentionally compatible with the current VoxelWorld padded section buffers:

- 18 x 18 x 18 block IDs
- 18 x 18 x 18 packed sky/block light
- the playable 16 x 16 x 16 section is surrounded by a one-block neighbor border

The core creates binary 16-bit face rows and greedily merges equal block/face keys. The WASM API is chunk-granular so JavaScript does not call into Rust once per voxel or once per face.

The current source is a first integration stage. It is deliberately not made the default renderer yet. Exact AO/light merge keys, atlas-repeat UVs, and a parity test against the existing TypeScript mesher must be completed before switching the world over.

Build with wasm-pack:

wasm-pack build wasm/voxel-mesher --target web --out-dir ../../public/wasm/voxel-mesher

The generated package is a build artifact and should not be treated as source.

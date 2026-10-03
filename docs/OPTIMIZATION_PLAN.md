# Physicscraft Performance Optimization Plan

## Scope

This document is the optimization roadmap for the current Physicscraft rendering, voxel streaming, lighting, meshing, and physics pipeline.

The goal is to remove frame-time spikes while preserving gameplay behavior and visual correctness.

> This document is a plan only. Optimization changes should be implemented and benchmarked in separate, reviewable steps.

## Current Problem

Frame drops are still visible while moving through newly streamed terrain.

The current streaming code uses time deadlines, but JavaScript cannot interrupt a synchronous operation once it has started. A nominal 2 ms or 4 ms budget therefore does not prevent a single expensive operation from blocking the main thread for much longer.

The main-thread game step currently includes voxel streaming work, terrain generation, lighting work, mesh construction, and physics-related updates. These workloads can therefore compete directly with input, physics, and rendering.

## Main Bottlenecks Identified

### 1. Synchronous chunk generation

VoxelWorld.getChunk() can perform terrain population and column finalization synchronously. A newly requested column contains a large vertical volume, so generation can consume an entire frame budget by itself.

**Plan**
- Convert generation into resumable stages.
- Process a small amount of work per frame.
- Keep generation state for each in-progress column.
- Prioritize columns closest to the player.

### 2. Synchronous lighting

initChunkLight() performs large sky-light and block-light initialization/flooding operations. The current deadline is checked around the operation rather than inside the expensive loops.

**Plan**
- Make lighting initialization incremental.
- Maintain explicit lighting work queues.
- Process bounded numbers of light nodes per frame.
- Prioritize lighting needed by visible and nearby chunks.

### 3. Synchronous mesh generation

buildSection() performs padded block/light preparation, voxel traversal, face culling, ambient occlusion, smooth lighting, and mesh construction. A complete section can therefore exceed the intended frame budget.

**Plan**
- Make mesh work incremental or move it off the main thread.
- Avoid rebuilding sections that are not visible or urgently needed.
- Prioritize sections near the player and camera.
- Investigate greedy meshing after the streaming pipeline is stable.

### 4. GPU geometry and buffer allocation

Mesh creation currently creates Three.js geometry and buffer data and can generate significant temporary allocations. Repeated allocations increase garbage-collection pressure.

**Plan**
- Reuse typed-array storage where practical.
- Reduce temporary arrays during mesh construction.
- Reuse buffer capacity instead of repeatedly allocating exact-size buffers when possible.
- Profile geometry upload time separately from CPU mesh generation.

### 5. Collider creation

Section collider creation copies mesh arrays and creates Rapier trimeshes synchronously. Physics collider creation is particularly unsuitable for the same high-priority queue as visual terrain.

**Plan**
- Separate visual mesh readiness from collider readiness.
- Give collider creation a lower priority.
- Create only colliders that are needed for nearby gameplay.
- Avoid unnecessary array copies before Rapier receives the data.

### 6. Dirty-section queue overhead

The current dirty-section processing creates and sorts temporary collections each frame. When many sections become dirty simultaneously, this can create CPU and garbage-collection spikes.

**Plan**
- Replace full-map sorting with a persistent priority queue or distance buckets.
- Deduplicate section requests.
- Prioritize by player/camera distance and visibility.
- Process a bounded number of sections per frame.

### 7. Repeated streaming scans

Streaming logic repeatedly scans render-distance rings and checks many columns. With larger render distances, this becomes unnecessary per-frame work.

**Plan**
- Replace repeated broad scans with explicit queues.
- Update desired chunk state only when the player crosses chunk boundaries.
- Maintain separate queues for generation, lighting, meshing, and colliders.

### 8. Per-frame allocations

There are still some hot-path allocations in camera/raycast and voxel systems. Even small allocations become relevant at 60+ FPS because they increase garbage-collection frequency.

**Plan**
- Reuse Three.js vectors, rays, and temporary arrays.
- Avoid Array.from(), slice(), and temporary objects in hot loops where possible.
- Use queue indices instead of Array.shift() for large queues.

## Proposed Streaming Architecture

The long-term main-thread pipeline should be:

1. **Request** — Detect required chunks and assign priority based on player/camera distance.
2. **Terrain** — Generate terrain incrementally and yield before the frame budget is exceeded.
3. **Finalize** — Complete block metadata and column state.
4. **Lighting** — Run bounded sky/block-light work.
5. **Meshing** — Build required visible sections, prioritizing nearby sections.
6. **GPU Upload** — Upload completed mesh buffers on the main thread.
7. **Collider** — Create Rapier colliders at lower priority.

Each stage should be resumable so a large chunk can never monopolize a frame.

## Web Worker Phase

If incremental main-thread processing is not enough, move pure CPU workloads to a Web Worker.

Good worker candidates:
- Terrain generation
- Noise calculations
- Cave/ore/tree generation
- Lighting calculations
- Mesh construction

Keep main-thread responsibilities limited to:
- Three.js scene objects
- GPU buffer uploads
- Rapier world mutations
- Player/input/camera updates

Worker results should use transferable ArrayBuffers where possible to avoid unnecessary copies.

## Camera/Player Hot Path

The camera update path should remain allocation-free during normal gameplay.

Targets:
- Reuse direction vectors.
- Reuse ray objects where safe.
- Avoid cloning vectors for every aim/raycast request.
- Keep front/third/first-person mode transitions centralized.

## Debugging and Measurement

Before and after each optimization stage, record:
- Total frame time
- Physics time
- Terrain generation time
- Lighting time
- Mesh generation time
- GPU/geometry upload time
- Collider creation time
- Garbage-collection symptoms
- Chunks generated per second
- Sections meshed per second
- Pending jobs in each queue

The existing telemetry should be split into these categories instead of grouping unrelated work under a generic streaming number.

## Implementation Order

### Phase 1 — Camera correctness
- Fix front-view player orientation.
- Verify first-person, third-person, and front-view behavior.
- Keep this isolated from performance changes.

### Phase 2 — Instrumentation
- Add precise per-stage timing.
- Track queue sizes and completed jobs.
- Capture worst-frame spikes, not only averages.

### Phase 3 — Queue redesign
- Replace deadline-only processing with resumable queues.
- Remove repeated full scans and large temporary collections.
- Add distance/visibility priorities.

### Phase 4 — Allocation reduction
- Remove avoidable hot-path allocations.
- Reuse vectors, arrays, and mesh buffers.
- Reduce collider data copies.

### Phase 5 — Work separation
- Decouple visual meshes from collider creation.
- Give physics colliders lower priority.
- Prevent nonessential work from blocking visible terrain.

### Phase 6 — Worker offload
- Move terrain generation, lighting, and mesh preparation into a worker if main-thread spikes remain.
- Transfer completed typed-array buffers back to the renderer.

### Phase 7 — Meshing improvements
- Evaluate greedy meshing and other face-reduction techniques.
- Benchmark vertex count, draw calls, CPU time, and GPU time before adopting them.

## Success Criteria

The optimization work should be considered successful only when measurements show:
- No large frame spikes caused by entering newly generated terrain.
- Camera/input remain responsive during chunk streaming.
- Physics remains stable while terrain loads.
- Visible terrain appears progressively without freezing the game loop.
- Memory usage remains bounded during long-distance exploration.
- Any worker/queue complexity produces measurable gains rather than only theoretical improvements.

## Validation Checklist

For every optimization PR:
- Test walking into untouched terrain.
- Test sprinting through new chunks.
- Test flying rapidly across chunk boundaries.
- Test chunk loading underground.
- Test placing and breaking blocks while chunks are streaming.
- Test physics objects near newly loaded terrain.
- Test first-person, third-person, and front camera modes.
- Compare debug frame-time measurements before and after the change.

## Guiding Rule

**Do not solve frame drops by simply lowering a time budget.**

A budget only works when the work itself can yield. The core optimization target is therefore to make expensive voxel operations **incremental or asynchronous**, while keeping gameplay-critical main-thread work responsive.


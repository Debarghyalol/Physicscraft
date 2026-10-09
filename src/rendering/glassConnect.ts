/**
 * Connected-glass ("CTM") helpers for the voxel mesher. Pure data logic, no three.js, so it
 * can be unit tested on its own.
 *
 * For every visible glass face we record which of its 4 in-plane neighbours (edges) and 4
 * diagonal neighbours (corners) are also glass. The glass shader then removes the frame on
 * connected edges, and keeps just the corner pixel where two connected edges meet at a
 * diagonal that is not glass (the classic inner-corner dot).
 *
 * Bit layout of the mask (matches GlassConnectedUV.ts):
 *   bit 0 = left edge   (local u = 0)    bit 4 = top-left corner
 *   bit 1 = top edge    (local v = 0)    bit 5 = top-right corner
 *   bit 2 = right edge  (local u = 1)    bit 6 = bottom-right corner
 *   bit 3 = bottom edge (local v = 1)    bit 7 = bottom-left corner
 * "Left/top/..." simply name the mesher's face-vertex UV layout:
 *   vertex 0 = (u0,v0), 1 = (u1,v0), 2 = (u1,v1), 3 = (u0,v1).
 */

export interface GlassFaceVertex {
  oCenter: number;
  o1: number;
  o2: number;
  oC: number;
}

export interface GlassConnectTables {
  /** [face][edge L,T,R,B] -> offset into the padded block array, relative to the glass cell. */
  edge: number[][];
  /** [face][corner TL,TR,BR,BL] -> offset relative to the glass cell. */
  corner: number[][];
}

/**
 * Derive the in-plane neighbour offsets of each face from the mesher's per-vertex AO tables.
 * Vertex k's o1/o2 are the two edge neighbours touching that vertex (offset by the face
 * normal), so an edge neighbour is the one offset two adjacent vertices have in common.
 */
export function buildGlassConnectTables(faceInfo: GlassFaceVertex[][]): GlassConnectTables {
  const edge: number[][] = [];
  const corner: number[][] = [];
  for (const verts of faceInfo) {
    const sets = verts.map((v) => [v.o1 - v.oCenter, v.o2 - v.oCenter]);
    const common = (a: number, b: number): number => {
      const hit = sets[a].filter((d) => sets[b].includes(d));
      if (hit.length !== 1) throw new Error('glassConnect: face vertices do not share exactly one edge neighbour');
      return hit[0];
    };
    edge.push([common(0, 3), common(0, 1), common(1, 2), common(2, 3)]);
    corner.push(verts.map((v) => v.oC - v.oCenter));
  }
  return { edge, corner };
}

/** Connectivity mask for the glass face `face` of the glass cell at padded index `pi`. */
export function glassConnectMask(
  blocks: ArrayLike<number>,
  pi: number,
  face: number,
  tables: GlassConnectTables,
  glass: number,
): number {
  const e = tables.edge[face];
  const c = tables.corner[face];
  let mask = 0;
  for (let i = 0; i < 4; i++) {
    if (blocks[pi + e[i]] === glass) mask |= 1 << i;
    if (blocks[pi + c[i]] === glass) mask |= 1 << (4 + i);
  }
  return mask;
}

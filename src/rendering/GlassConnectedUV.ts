import { Node as TSLNode } from 'three/webgpu';
import { attribute, float, uv, vec2 } from 'three/tsl';
type Node = TSLNode;

/**
 * Per-face connected-glass mask (`aCtm`, see glassConnect.ts) plus a presence flag in y.
 * Geometry without the attribute (dynamic contraption glass) reports presence 0 so it keeps
 * its original UVs, and no missing-attribute warning is logged.
 */
class GlassCtmNode extends TSLNode {
  constructor() {
    super('vec2');
  }

  setup(builder: any) {
    const geometry = builder.geometry;
    if (geometry && geometry.hasAttribute('aCtm')) {
      return vec2(attribute('aCtm', 'float'), 1.0);
    }
    return vec2(0.0, 0.0);
  }
}

export interface GlassAtlasLayout {
  /** Number of tiles across the atlas row. */
  columns: number;
  /** Inner (gutter-free) tile bounds, as fractions of a tile cell. */
  innerMin: number;
  innerMax: number;
  innerMinV: number;
  innerMaxV: number;
}

/** Glass frame width as a fraction of the tile (1px of 16, 2px of 32, ...). */
const BORDER = 1 / 16;
/** Where a removed border strip is resampled from: the middle of the first interior texel. */
const INTERIOR = 1.5 / 16;

/**
 * Atlas UV for the glass layer with connected textures.
 *
 * The glass tile has a frame along its outline. On every edge whose neighbour is also glass
 * the frame strip is replaced by the adjacent interior texels, so the two blocks read as one
 * pane. Where two connected edges meet but the diagonal block is not glass, the original
 * corner texel is kept, which draws the small inner-corner mark.
 */
export function createConnectedGlassUV(layout: GlassAtlasLayout): Node {
  const { columns, innerMin, innerMax, innerMinV, innerMaxV } = layout;
  const mesherUV = uv();

  // Recover the tile column and the 0..1 position inside the tile from the baked atlas UV.
  const scaledU = mesherUV.x.mul(columns);
  const tileColumn = scaledU.floor();
  const localU = scaledU.sub(tileColumn).sub(innerMin).div(innerMax - innerMin);
  const localV = mesherUV.y.sub(innerMinV).div(innerMaxV - innerMinV);

  const ctm = new GlassCtmNode() as unknown as Node;
  const mask = (ctm as any).x.add(0.5).floor();
  const present = (ctm as any).y.greaterThan(0.5);
  const bit = (n: number) => mask.div(float(1 << n)).floor().mod(2.0).greaterThan(0.5);

  const left = bit(0), top = bit(1), right = bit(2), bottom = bit(3);
  const topLeft = bit(4), topRight = bit(5), bottomRight = bit(6), bottomLeft = bit(7);

  const inLeft = localU.lessThan(BORDER);
  const inRight = localU.greaterThan(1 - BORDER);
  const inTop = localV.lessThan(BORDER);
  const inBottom = localV.greaterThan(1 - BORDER);

  // Inner corners: both neighbouring edges connected but the diagonal block is not glass.
  const keepCorner = inLeft.and(inTop).and(left).and(top).and(topLeft.not())
    .or(inRight.and(inTop).and(right).and(top).and(topRight.not()))
    .or(inRight.and(inBottom).and(right).and(bottom).and(bottomRight.not()))
    .or(inLeft.and(inBottom).and(left).and(bottom).and(bottomLeft.not()));

  const connectedU = left.and(inLeft).select(
    float(INTERIOR),
    right.and(inRight).select(float(1 - INTERIOR), localU),
  );
  const connectedV = top.and(inTop).select(
    float(INTERIOR),
    bottom.and(inBottom).select(float(1 - INTERIOR), localV),
  );
  const u = keepCorner.select(localU, connectedU);
  const v = keepCorner.select(localV, connectedV);

  const atlasU = tileColumn.add(u.mul(innerMax - innerMin).add(innerMin)).div(columns);
  const atlasV = v.mul(innerMaxV - innerMinV).add(innerMinV);

  return present.select(vec2(atlasU, atlasV), mesherUV) as unknown as Node;
}

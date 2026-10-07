use wasm_bindgen::prelude::*;

const SIZE: usize = 16;
const PAD: usize = 18;
const PAD_AREA: usize = PAD * PAD;
const PAD_VOLUME: usize = PAD * PAD * PAD;

#[repr(C)]
#[derive(Clone, Copy)]
struct Quad {
    x: u8,
    y: u8,
    z: u8,
    w: u8,
    h: u8,
    face: u8,
    block: u8,
    _pad: u8,
}

struct MeshData {
    positions: Vec<f32>,
    normals: Vec<i8>,
    uvs: Vec<f32>,
    lights: Vec<f32>,
    indices: Vec<u32>,
    blocks: Vec<u8>,
}

#[wasm_bindgen]
pub struct MeshResult {
    positions: Vec<f32>,
    normals: Vec<i8>,
    uvs: Vec<f32>,
    lights: Vec<f32>,
    indices: Vec<u32>,
    blocks: Vec<u8>,
    quad_count: u32,
}

#[wasm_bindgen]
impl MeshResult {
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f32> { self.positions.clone() }

    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> Vec<i8> { self.normals.clone() }

    #[wasm_bindgen(getter)]
    pub fn uvs(&self) -> Vec<f32> { self.uvs.clone() }

    #[wasm_bindgen(getter)]
    pub fn lights(&self) -> Vec<f32> { self.lights.clone() }

    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u32> { self.indices.clone() }

    #[wasm_bindgen(getter)]
    pub fn blocks(&self) -> Vec<u8> { self.blocks.clone() }

    #[wasm_bindgen(getter)]
    pub fn quad_count(&self) -> u32 { self.quad_count }
}

#[inline]
fn at(x: usize, y: usize, z: usize) -> usize {
    x + z * PAD + y * PAD_AREA
}

#[inline]
fn opaque(v: u8) -> bool {
    v != 0 && v != 12
}

#[inline]
fn packed_light(light: &[u8], x: usize, y: usize, z: usize) -> (f32, f32) {
    let p = light[at(x, y, z)];
    (((p >> 4) as f32) / 15.0, ((p & 15) as f32) / 15.0)
}

fn build_quads(blocks: &[u8]) -> Vec<Quad> {
    let mut quads = Vec::new();

    for face in 0..6usize {
        for slice in 0..SIZE {
            // A u16 row is the binary face mask for one row of the slice.
            // key[0..256] is retained alongside it so greedy merging remains
            // material-aware instead of merging different block types.
            let mut row_masks = [0u16; SIZE];
            let mut keys = [0u8; SIZE * SIZE];

            for v in 0..SIZE {
                let mut mask = 0u16;
                for u in 0..SIZE {
                    let (x, y, z) = match face {
                        0 | 1 => (slice, v, u),
                        2 | 3 => (u, slice, v),
                        _ => (u, v, slice),
                    };

                    let p = at(x + 1, y + 1, z + 1);
                    let block = blocks[p];
                    if !opaque(block) {
                        continue;
                    }

                    let np = match face {
                        0 => at(x + 2, y + 1, z + 1),
                        1 => at(x, y + 1, z + 1),
                        2 => at(x + 1, y + 2, z + 1),
                        3 => at(x + 1, y, z + 1),
                        4 => at(x + 1, y + 1, z + 2),
                        _ => at(x + 1, y + 1, z),
                    };

                    if opaque(blocks[np]) {
                        continue;
                    }

                    mask |= 1u16 << u;
                    keys[v * SIZE + u] = block;
                }
                row_masks[v] = mask;
            }

            let mut used = [false; SIZE * SIZE];

            for v0 in 0..SIZE {
                for u0 in 0..SIZE {
                    let i0 = v0 * SIZE + u0;
                    if used[i0] || (row_masks[v0] & (1u16 << u0)) == 0 {
                        continue;
                    }

                    let key = keys[i0];
                    let mut w = 1usize;

                    while u0 + w < SIZE {
                        let i = v0 * SIZE + u0 + w;
                        if used[i] || keys[i] != key ||
                           (row_masks[v0] & (1u16 << (u0 + w))) == 0 {
                            break;
                        }
                        w += 1;
                    }

                    let mut h = 1usize;
                    'grow: while v0 + h < SIZE {
                        for u in u0..u0 + w {
                            let i = (v0 + h) * SIZE + u;
                            if used[i] || keys[i] != key ||
                               (row_masks[v0 + h] & (1u16 << u)) == 0 {
                                break 'grow;
                            }
                        }
                        h += 1;
                    }

                    for vv in v0..v0 + h {
                        for uu in u0..u0 + w {
                            used[vv * SIZE + uu] = true;
                        }
                    }

                    let (x, y, z) = match face {
                        0 | 1 => (slice, v0, u0),
                        2 | 3 => (u0, slice, v0),
                        _ => (u0, v0, slice),
                    };

                    quads.push(Quad {
                        x: x as u8,
                        y: y as u8,
                        z: z as u8,
                        w: w as u8,
                        h: h as u8,
                        face: face as u8,
                        block: key,
                        _pad: 0,
                    });
                }
            }
        }
    }

    quads
}

fn emit(quads: &[Quad], light: &[u8]) -> MeshData {
    let mut out = MeshData {
        positions: Vec::with_capacity(quads.len() * 12),
        normals: Vec::with_capacity(quads.len() * 12),
        uvs: Vec::with_capacity(quads.len() * 8),
        lights: Vec::with_capacity(quads.len() * 8),
        indices: Vec::with_capacity(quads.len() * 6),
        blocks: Vec::with_capacity(quads.len() * 4),
    };

    for q in quads {
        let base = (out.positions.len() / 3) as u32;
        let x = q.x as f32;
        let y = q.y as f32;
        let z = q.z as f32;
        let w = q.w as f32;
        let h = q.h as f32;

        let verts = match q.face as usize {
            0 => [[x+1.0,y,z], [x+1.0,y,z+h], [x+1.0,y+w,z+h], [x+1.0,y+w,z]],
            1 => [[x,y,z+h], [x,y,z], [x,y+w,z], [x,y+w,z+h]],
            2 => [[x,y+1.0,z+h], [x+w,y+1.0,z+h], [x+w,y+1.0,z], [x,y+1.0,z]],
            3 => [[x,y,z], [x+w,y,z], [x+w,y,z+h], [x,y,z+h]],
            4 => [[x,y,z+1.0], [x+w,y,z+1.0], [x+w,y+h,z+1.0], [x,y+h,z+1.0]],
            _ => [[x+w,y,z], [x,y,z], [x,y+h,z], [x+w,y+h,z]],
        };

        let normal = match q.face as usize {
            0 => [1i8,0,0],
            1 => [-1,0,0],
            2 => [0,1,0],
            3 => [0,-1,0],
            4 => [0,0,1],
            _ => [0,0,-1],
        };

        let lx = (q.x as usize + 1).min(PAD - 1);
        let ly = (q.y as usize + 1).min(PAD - 1);
        let lz = (q.z as usize + 1).min(PAD - 1);
        let (sky, block) = packed_light(light, lx, ly, lz);

        for (k, v) in verts.iter().enumerate() {
            out.positions.extend_from_slice(v);
            out.normals.extend_from_slice(&normal);
            let uv = match k {
                0 => [0.1, 0.1],
                1 => [0.9, 0.1],
                2 => [0.9, 0.9],
                _ => [0.1, 0.9],
            };
            out.uvs.extend_from_slice(&uv);
            out.lights.extend_from_slice(&[sky, block]);
            out.blocks.push(q.block);
        }

        out.indices.extend_from_slice(&[
            base, base + 1, base + 2,
            base, base + 2, base + 3,
        ]);
    }

    out
}

#[wasm_bindgen]
pub fn mesh_chunk(blocks: &[u8], light: &[u8]) -> Result<MeshResult, JsValue> {
    if blocks.len() != PAD_VOLUME || light.len() != PAD_VOLUME {
        return Err(JsValue::from_str(
            "Physicscraft mesher expects padded 18x18x18 block and light buffers"
        ));
    }

    let quads = build_quads(blocks);
    let data = emit(&quads, light);

    Ok(MeshResult {
        positions: data.positions,
        normals: data.normals,
        uvs: data.uvs,
        lights: data.lights,
        indices: data.indices,
        blocks: data.blocks,
        quad_count: quads.len() as u32,
    })
}

#[wasm_bindgen]
pub fn padded_size() -> usize { PAD_VOLUME }

#[wasm_bindgen]
pub fn version() -> String {
    "physicscraft-binary-greedy-mesher-0.1".into()
}

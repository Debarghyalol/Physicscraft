import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPNG(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(8 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);

    let crc = 0xffffffff;
    for (let i = 4; i < 8 + len; i++) {
      const byte = buf[i];
      for (let j = 0; j < 8; j++) {
        if ((crc ^ (byte >> j)) & 1) {
          crc = (crc >>> 1) ^ 0xedb88320;
        } else {
          crc = crc >>> 1;
        }
      }
    }
    buf.writeInt32BE(~crc, 8 + len);
    return buf;
  }

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    rgbaBuffer.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idatData = zlib.deflateSync(scanlines);
  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const outDir = path.resolve('public/textures/environment');
fs.mkdirSync(outDir, { recursive: true });

// 1. Generate Sun PNG (64x64)
{
  const W = 64;
  const H = 64;
  const buf = Buffer.alloc(W * H * 4, 0);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const idx = (y * W + x) * 4;
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = a;
  }

  function fillRect(rx, ry, rw, rh, r, g, b, a = 255) {
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  // Aura
  fillRect(8, 8, 48, 48, 255, 215, 110, 50);
  // Corona
  fillRect(16, 16, 32, 32, 255, 235, 150, 160);
  // Sun square
  fillRect(20, 20, 24, 24, 255, 250, 225, 240);
  // Core
  fillRect(24, 24, 16, 16, 255, 255, 255, 255);

  const png = createPNG(W, H, buf);
  fs.writeFileSync(path.join(outDir, 'sun.png'), png);
  console.log('Created sun.png');
}

// 2. Generate 8 Moon Phase PNGs and combined moon_phases.png
{
  const phaseBufs = [];
  const W = 32;
  const H = 32;

  for (let phase = 0; phase < 8; phase++) {
    const buf = Buffer.alloc(W * H * 4, 0);

    const isPixelLit = (px, py) => {
      switch (phase) {
        case 0: return true; // Full moon
        case 1: return px < 24; // Waning gibbous
        case 2: return px < 16; // Third quarter
        case 3: return px < 8; // Waning crescent
        case 4: return false; // New moon
        case 5: return px >= 24; // Waxing crescent
        case 6: return px >= 16; // First quarter
        case 7: return px >= 8; // Waxing gibbous
        default: return true;
      }
    };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        if (isPixelLit(x, y)) {
          const isCrater =
            (x >= 6 && x <= 10 && y >= 8 && y <= 12) ||
            (x >= 18 && x <= 22 && y >= 16 && y <= 20) ||
            (x >= 10 && x <= 14 && y >= 22 && y <= 25) ||
            ((x + y * 7) % 11 === 0 && x > 2 && x < 30 && y > 2 && y < 30);

          if (isCrater) {
            buf[idx] = 176;
            buf[idx + 1] = 181;
            buf[idx + 2] = 190;
            buf[idx + 3] = 255;
          } else {
            const v = (x + y) % 3 === 0 ? 212 : 242;
            buf[idx] = v;
            buf[idx + 1] = v + 6;
            buf[idx + 2] = Math.min(255, v + 15);
            buf[idx + 3] = 255;
          }
        } else if (phase === 4) {
          // Faint outline for new moon
          if (x === 0 || x === W - 1 || y === 0 || y === H - 1) {
            buf[idx] = 30;
            buf[idx + 1] = 40;
            buf[idx + 2] = 60;
            buf[idx + 3] = 90;
          }
        }
      }
    }

    const png = createPNG(W, H, buf);
    fs.writeFileSync(path.join(outDir, `moon_phase_${phase}.png`), png);
    phaseBufs.push(buf);
  }

  // Combined 4x2 Minecraft atlas (128x64)
  const atlasW = 128;
  const atlasH = 64;
  const atlasBuf = Buffer.alloc(atlasW * atlasH * 4, 0);

  for (let phase = 0; phase < 8; phase++) {
    const col = phase % 4;
    const row = Math.floor(phase / 4);
    const srcBuf = phaseBufs[phase];

    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const srcIdx = (y * 32 + x) * 4;
        const dstIdx = ((row * 32 + y) * atlasW + (col * 32 + x)) * 4;
        srcBuf.copy(atlasBuf, dstIdx, srcIdx, srcIdx + 4);
      }
    }
  }

  const atlasPng = createPNG(atlasW, atlasH, atlasBuf);
  fs.writeFileSync(path.join(outDir, 'moon_phases.png'), atlasPng);
  console.log('Created moon_phases.png and 8 individual moon_phase_*.png files');
}

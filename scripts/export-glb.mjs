// Builds the aquarium and writes it to models/aquarium.glb.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildAquarium } from '../src/aquarium.js';

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n;
});

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}

// Minimal 8-bit PNG writer that keeps only the channels an image uses: grey, RGB or RGBA.
// Each row uses whichever of the None, Sub and Up filters leaves the smallest residue, the
// usual heuristic for a smaller file.
function encodePng(width, height, rgba) {
  let opaque = true, grey = true;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 255) opaque = false;
    if (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2]) grey = false;
  }
  const channels = opaque ? (grey ? [0] : [0, 1, 2]) : [0, 1, 2, 3];
  const bpp = channels.length, stride = width * bpp;
  const rows = Buffer.alloc(height * stride);
  for (let i = 0, o = 0; i < rgba.length; i += 4) for (const c of channels) rows[o++] = rgba[i + c];
  const raw = Buffer.alloc(height * (stride + 1));
  const trial = [0, 1, 2].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const at = y * stride;
    let best = 0, bestSum = Infinity;
    for (let filter = 0; filter < 3; filter++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const left = filter === 1 && x >= bpp ? rows[at + x - bpp] : 0;
        const above = filter === 2 && y > 0 ? rows[at + x - stride] : 0;
        const value = (rows[at + x] - left - above) & 0xff;
        trial[filter][x] = value;
        sum += value < 128 ? value : 256 - value;
      }
      if (sum < bestSum) [best, bestSum] = [filter, sum];
    }
    raw[y * (stride + 1)] = best;
    trial[best].copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = [0, 0, 0, 2, 6][bpp]; // colour type: grey, RGB or RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

// GLTFExporter relies on a few browser APIs that Node lacks. It encodes textures through a
// canvas: this stand-in takes the pixels of a DataTexture and hands back a PNG.
globalThis.ImageData = class {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
};
globalThis.OffscreenCanvas = class {
  getContext() {
    return { putImageData: (image) => (this.image = image) };
  }
  convertToBlob({ type }) {
    return Promise.resolve(new Blob([encodePng(this.image.width, this.image.height, this.image.data)], { type }));
  }
};
// It also reads its buffers back through FileReader, assigning onloadend only after calling
// read*, so the callback must fire asynchronously.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
};

const { root, clip } = buildAquarium();
root.updateMatrixWorld(true);

let meshes = 0, triangles = 0;
root.traverse((o) => {
  if (!o.isMesh) return;
  meshes++;
  triangles += (o.geometry.index ?? o.geometry.attributes.position).count / 3;
});

const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: [clip] });
const out = new URL('../models/aquarium.glb', import.meta.url);
await mkdir(new URL('.', out), { recursive: true });
await writeFile(out, Buffer.from(glb));

console.log(`models/aquarium.glb: ${(glb.byteLength / 1024).toFixed(0)} KB, ${meshes} meshes, ${triangles} triangles, ${clip.tracks.length} animation tracks`);

// Builds the aquarium and writes it to models/aquarium.glb.
import { mkdir, writeFile } from 'node:fs/promises';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildAquarium } from '../src/aquarium.js';

// GLTFExporter reads its buffers back through the browser FileReader, which Node lacks.
// It assigns onloadend after calling read*, so the callback must fire asynchronously.
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

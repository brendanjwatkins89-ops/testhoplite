// Procedural textures, generated as raw pixels so the model needs no image files.
import * as THREE from 'three';
import { TAU, clamp, hash, lerp, smooth } from './core.js';

// Value noise in [-1, 1] that repeats every (px, py) cells, so textures built from it tile.
function tileNoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const n = (a, b) => hash((xi + a) % px, (yi + b) % py, seed);
  return lerp(lerp(n(0, 0), n(1, 0), u), lerp(n(0, 1), n(1, 1), u), v) * 2 - 1;
}

// pixel(i, j, rgb) fills rgb with values in 0..1.
function texture(name, size, colorSpace, pixel) {
  const data = new Uint8Array(size * size * 4);
  const rgb = [0, 0, 0];
  for (let j = 0, k = 0; j < size; j++) {
    for (let i = 0; i < size; i++, k += 4) {
      pixel(i, j, rgb);
      for (let c = 0; c < 3; c++) data[k + c] = Math.round(clamp(rgb[c], 0, 1) * 255);
      data[k + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.name = name;
  map.colorSpace = colorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

// A tiling height field, sampled once per pixel.
function heightField(size, heightAt) {
  const height = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) height[j * size + i] = heightAt(i / size, j / size);
  return (i, j) => height[((j + size) % size) * size + ((i + size) % size)];
}

function normalMap(name, size, at, strength) {
  // Six bits a channel are plenty for bumps this noisy, and they compress far better.
  const coarse = (value) => Math.round(value * 63.75) / 63.75;
  return texture(name, size, THREE.NoColorSpace, (i, j, rgb) => {
    // glTF tangent space: +X runs along U and +Y against V.
    const x = -(at(i + 1, j) - at(i - 1, j)) * strength, y = (at(i, j + 1) - at(i, j - 1)) * strength;
    const inv = 0.5 / Math.hypot(x, y, 1);
    rgb[0] = coarse(0.5 + x * inv);
    rgb[1] = coarse(0.5 + y * inv);
    rgb[2] = coarse(0.5 + inv);
  });
}

// Fine-grained bumps for the sand.
export function grainNormalMap(size = 256) {
  const at = heightField(size, (u, v) => {
    let h = 0;
    for (let o = 0, cells = 8; o < 4; o++, cells *= 2) h += (0.5 - 0.05 * o) * tileNoise(u * cells, v * cells, cells, cells, o + 1);
    return h;
  });
  return normalMap('Grain_Normal', size, at, 1.4);
}

// Weathered stone: sharp ridges with dark crevices between them and thin pale veins. The
// colour is a grey that the stone's own vertex colours tint.
export function stoneMaps(size = 256) {
  const at = heightField(size, (u, v) => {
    let h = 0, amp = 0.5;
    for (let o = 0, cells = 4; o < 5; o++, cells *= 2, amp *= 0.55) h += amp * (1 - Math.abs(tileNoise(u * cells, v * cells, cells, cells, o + 21))) ** 2;
    return h;
  });
  const color = texture('Stone_Color', size, THREE.SRGBColorSpace, (i, j, rgb) => {
    const u = i / size, v = j / size;
    const vein = Math.abs(tileNoise(u * 3, v * 3, 3, 3, 31)) / 0.01;
    const grey = lerp(0.14, 0.4, smooth((at(i, j) - 0.25) / 0.6)) + 0.05 * tileNoise(u * 64, v * 64, 64, 64, 33);
    rgb[0] = rgb[1] = rgb[2] = lerp(0.72, grey, smooth(vein));
  });
  return { color, normal: normalMap('Stone_Normal', size, at, 5) };
}

// Wood with the grain running along V, as a grey for the material's colour to tint.
export function woodColorMap(size = 256) {
  return texture('Wood_Color', size, THREE.SRGBColorSpace, (i, j, rgb) => {
    const u = i / size, v = j / size;
    const drift = tileNoise(u * 3, v * 2, 3, 2, 11);
    const rings = Math.sin(TAU * (u * 7 + 1.2 * drift));
    const fibre = tileNoise(u * 96, v * 3, 96, 3, 12);
    const pore = tileNoise(u * 48, v * 16, 48, 16, 13);
    rgb[0] = rgb[1] = rgb[2] = lerp(0.5, 1, clamp(0.5 + 0.11 * rings + 0.15 * fibre + 0.08 * pore, 0, 1));
  });
}

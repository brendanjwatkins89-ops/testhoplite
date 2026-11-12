// Shared constants and building blocks for the aquarium model.
// Units are metres and Y is up. Tank coordinates are centred on the tank, with y = 0 at the
// underside of the bottom glass.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const SIZE = { width: 1.0, height: 0.5, depth: 0.4, glass: 0.008, stand: 0.75, water: 0.45 };
// Every animation track repeats a whole number of times in this period, so the clip loops seamlessly.
export const LOOP_SECONDS = 24;

export const { width: W, height: H, depth: D, glass: G, stand: STAND_H, water: WATER_Y } = SIZE;
export const XI = W / 2 - G; // interior half-extents
export const ZI = D / 2 - G;
export const TAU = Math.PI * 2;
export const { lerp, clamp } = THREE.MathUtils;
export const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- randomness

export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(x, y, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise in [-1, 1].
export function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
  const n = (a, b, c) => hash(xi + a, yi + b, zi + c);
  return lerp(
    lerp(lerp(n(0, 0, 0), n(1, 0, 0), u), lerp(n(0, 1, 0), n(1, 1, 0), u), v),
    lerp(lerp(n(0, 0, 1), n(1, 0, 1), u), lerp(n(0, 1, 1), n(1, 1, 1), u), v),
    w,
  ) * 2 - 1;
}

export function fbm(x, y, z, octaves = 3) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f, z * f);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}

// ---------------------------------------------------------------- scene objects

export const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

export function material(name, params, Type = THREE.MeshStandardMaterial) {
  const m = new Type(params);
  m.name = name;
  return m;
}

// Vertex colours are built as floats and stored as normalised 16-bit integers. Bytes would
// be smaller still, but the colours are linear and dark tones would band.
export function pack(geometry) {
  const color = geometry.attributes.color;
  if (color && color.array instanceof Float32Array) {
    const packed = new Uint16Array(color.array.length);
    for (let i = 0; i < packed.length; i++) packed[i] = Math.round(clamp(color.array[i], 0, 1) * 65535);
    geometry.setAttribute('color', new THREE.BufferAttribute(packed, color.itemSize, true));
  }
  return geometry;
}

export function mesh(name, geometry, mat, position) {
  const m = new THREE.Mesh(pack(geometry), mat);
  m.name = name;
  if (position) m.position.fromArray(position);
  return m;
}

export function group(name, ...children) {
  const g = new THREE.Group();
  g.name = name;
  if (children.length) g.add(...children);
  return g;
}

// ---------------------------------------------------------------- geometry

// Untextured parts do not need UVs in the exported file.
export function bare(geometry) {
  geometry.deleteAttribute('uv');
  return geometry;
}

export function box(name, size, mat, position) {
  return mesh(name, bare(new THREE.BoxGeometry(...size)), mat, position);
}

export function merge(parts, groups = false) {
  const g = mergeGeometries(parts, groups);
  if (!g) throw new Error('mergeGeometries failed: parts have mismatched attributes');
  return g;
}

// Welds coincident vertices and drops the triangles that collapse as a result.
export function weld(geometry, tolerance) {
  const g = mergeVertices(geometry, tolerance);
  const index = g.index.array, kept = [];
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    if (a !== b && b !== c && a !== c) kept.push(a, b, c);
  }
  g.setIndex(kept);
  return g;
}

export function paint(geometry, colorAt) {
  const pos = geometry.attributes.position;
  const col = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    colorAt(p.fromBufferAttribute(pos, i), c, i);
    c.toArray(col, i * 4);
    col[i * 4 + 3] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geometry;
}

// Indexed (nu x nv) patch. fn(u, v, o, i, j) fills o.p (position), o.c and o.a (colour and
// alpha) and, when asked for, o.s (how far the vertex travels when a plant sways) and o.uv.
// Face normals point along dv x du.
export function grid(nu, nv, fn, { sway = false, uv = false } = {}) {
  const count = (nu + 1) * (nv + 1);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 4);
  const sw = sway ? new Float32Array(count) : null, tex = uv ? new Float32Array(count * 2) : null;
  const o = { p: new THREE.Vector3(), c: new THREE.Color(), a: 1, s: 0, uv: new THREE.Vector2() };
  for (let j = 0, k = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++, k++) {
      o.a = 1;
      o.s = 0;
      fn(i / nu, j / nv, o, i, j);
      o.p.toArray(pos, k * 3);
      o.c.toArray(col, k * 4);
      col[k * 4 + 3] = o.a;
      if (sw) sw[k] = o.s;
      if (tex) o.uv.toArray(tex, k * 2);
    }
  }
  const index = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = i + j * (nu + 1), b = a + 1, c = a + nu + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  if (sw) g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  if (tex) g.setAttribute('uv', new THREE.BufferAttribute(tex, 2));
  g.setIndex(index);
  return g;
}

const icoCache = new Map();
// Unit icosphere with shared vertices and positions only.
export function ico(detail) {
  if (!icoCache.has(detail)) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    icoCache.set(detail, mergeVertices(g));
  }
  return icoCache.get(detail).clone();
}

// Tube along a spline through `points`. radius is a number or (t, angle) => number; passing
// color(t, angle, c, position) adds vertex colours, and `tile` adds UVs that wrap once round
// the tube and repeat every `tile` metres along it.
export function tube(points, { radius, color, tile, segments = 24, radial = 8, tension = 0.5 }) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', tension);
  const frames = curve.computeFrenetFrames(segments, false);
  const length = curve.getLength();
  const centre = new THREE.Vector3();
  const g = grid(radial, segments, (u, t, o, i, j) => {
    const a = ((i % radial) / radial) * TAU; // the last column repeats the first, so the seam can weld
    const r = typeof radius === 'function' ? radius(t, a) : radius;
    curve.getPointAt(t, centre);
    o.p.copy(centre).addScaledVector(frames.normals[j], Math.cos(a) * r).addScaledVector(frames.binormals[j], -Math.sin(a) * r);
    if (color) color(t, a, o.c, o.p);
    if (tile) o.uv.set(u, (t * length) / tile);
  }, { uv: Boolean(tile) });
  if (!color) g.deleteAttribute('color');
  g.computeVertexNormals();
  // Each copy of the seam column was shaded from one side only; give both the same normal.
  const normal = g.attributes.normal, n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let j = 0; j <= segments; j++) {
    const k = j * (radial + 1);
    n.fromBufferAttribute(normal, k).add(m.fromBufferAttribute(normal, k + radial)).normalize();
    normal.setXYZ(k, n.x, n.y, n.z);
    normal.setXYZ(k + radial, n.x, n.y, n.z);
  }
  return weld(g, 1e-6);
}

// Tangents for a normal-mapped surface, so every viewer bends the light the same way.
export function tangents(geometry) {
  geometry.computeTangents();
  // computeTangents assumes V runs up the image; glTF's runs down it, which mirrors the frame.
  const w = geometry.attributes.tangent.array;
  for (let i = 3; i < w.length; i += 4) w[i] = -w[i];
  return geometry;
}

// Box-projected UVs in metres, so a texture keeps its scale on parts of any size. Each
// triangle is projected along the axis it faces most squarely, and vertices are split where
// neighbours disagree, so no triangle is smeared across two projections. The texture's V
// axis follows Y on upright faces and X on level ones.
export function boxUV(geometry, tile, [ou, ov] = [0, 0]) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = c.sub(b).cross(a.sub(b));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = i; k < i + 3; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const [u, v] = ay > ax && ay > az ? [z, x] : ax > az ? [z, y] : [x, y];
      uv[k * 2] = u / tile + ou;
      uv[k * 2 + 1] = v / tile + ov;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return weld(g, 1e-6);
}

// ---------------------------------------------------------------- animation

// Weights for a single morph target swinging between -1 and 1, `cycles` times per loop.
export function swayTrack(name, cycles, phase, samplesPerCycle = 16) {
  const count = cycles * samplesPerCycle;
  const times = [], values = [];
  for (let i = 0; i <= count; i++) {
    times.push((i / count) * LOOP_SECONDS);
    values.push(Math.sin((TAU * i) / samplesPerCycle + phase));
  }
  return new THREE.NumberKeyframeTrack(`${name}.morphTargetInfluences`, times, values);
}

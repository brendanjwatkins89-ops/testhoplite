// Procedural aquarium model, exported to GLB by scripts/export-glb.mjs.
// Units are metres, Y is up, the origin is the centre of the floor under the stand.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const SIZE = { width: 1.0, height: 0.5, depth: 0.4, glass: 0.008, stand: 0.75, water: 0.45 };
// Every animation track repeats a whole number of times in this period, so the clip loops seamlessly.
export const LOOP_SECONDS = 24;

const { width: W, height: H, depth: D, glass: G, stand: STAND_H, water: WATER_Y } = SIZE;
const XI = W / 2 - G; // interior half-extents
const ZI = D / 2 - G;
const LOOP = LOOP_SECONDS;
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const { lerp, clamp } = THREE.MathUtils;
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- helpers

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x, y, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise in [-1, 1].
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
  const n = (a, b, c) => hash(xi + a, yi + b, zi + c);
  return lerp(
    lerp(lerp(n(0, 0, 0), n(1, 0, 0), u), lerp(n(0, 1, 0), n(1, 1, 0), u), v),
    lerp(lerp(n(0, 0, 1), n(1, 0, 1), u), lerp(n(0, 1, 1), n(1, 1, 1), u), v),
    w,
  ) * 2 - 1;
}

function fbm(x, y, z, octaves = 3) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f, z * f);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}

const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

function material(name, params) {
  const m = new THREE.MeshStandardMaterial(params);
  m.name = name;
  return m;
}

function mesh(name, geometry, mat, position) {
  const m = new THREE.Mesh(geometry, mat);
  m.name = name;
  if (position) m.position.fromArray(position);
  return m;
}

function group(name, ...children) {
  const g = new THREE.Group();
  g.name = name;
  if (children.length) g.add(...children);
  return g;
}

// Nothing is textured, so UVs are dead weight in the exported file.
function bare(geometry) {
  geometry.deleteAttribute('uv');
  return geometry;
}

function box(name, size, mat, position) {
  return mesh(name, bare(new THREE.BoxGeometry(...size)), mat, position);
}

function merge(parts) {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('mergeGeometries failed: parts have mismatched attributes');
  return g;
}

function paint(geometry, colorAt) {
  const pos = geometry.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    colorAt(p.fromBufferAttribute(pos, i), c, i);
    c.toArray(col, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geometry;
}

// Indexed (nu x nv) patch. fn(u, v, o) fills o.p (position), o.c (colour) and, for plants,
// o.s (how far the vertex travels when swaying). Face normals point along dv x du.
function grid(nu, nv, fn, sway = false) {
  const count = (nu + 1) * (nv + 1);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const sw = sway ? new Float32Array(count) : null;
  const o = { p: new THREE.Vector3(), c: new THREE.Color(), s: 0 };
  for (let j = 0, k = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++, k++) {
      o.s = 0;
      fn(i / nu, j / nv, o);
      o.p.toArray(pos, k * 3);
      o.c.toArray(col, k * 3);
      if (sw) sw[k] = o.s;
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
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (sw) g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  g.setIndex(index);
  return g;
}

const icoCache = new Map();
function ico(detail) {
  if (!icoCache.has(detail)) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    icoCache.set(detail, mergeVertices(g));
  }
  return icoCache.get(detail).clone();
}

// Tube along a spline whose radius tapers from r0 to r1.
function taperedTube(points, r0, r1, segments = 24, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const g = bare(new THREE.TubeGeometry(curve, segments, 1, radial, false));
  const pos = g.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    curve.getPointAt(i / segments, c);
    const r = lerp(r0, r1, i / segments) * (1 + 0.25 * noise(c.x * 60, c.y * 60, c.z * 60));
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  return g;
}

// ---------------------------------------------------------------- furniture

function buildStand() {
  const wood = material('Wood', { color: srgb(0.24, 0.155, 0.1), roughness: 0.55 });
  const woodLight = material('Wood_Light', { color: srgb(0.34, 0.225, 0.14), roughness: 0.5 });
  const woodDark = material('Wood_Dark', { color: srgb(0.12, 0.08, 0.055), roughness: 0.6 });
  const metal = material('Metal', { color: srgb(0.78, 0.78, 0.8), roughness: 0.3, metalness: 1 });

  const bw = W + 0.04, bd = D + 0.04, topT = 0.03, plinthH = 0.06;
  const bodyH = STAND_H - topT - plinthH;
  const midY = plinthH + bodyH / 2;
  const stand = group(
    'Stand',
    box('Stand_Plinth', [bw - 0.06, plinthH, bd - 0.05], woodDark, [0, plinthH / 2, -0.005]),
    box('Stand_Body', [bw, bodyH, bd], wood, [0, midY, 0]),
    box('Stand_Top', [bw + 0.03, topT, bd + 0.03], woodDark, [0, STAND_H - topT / 2, 0]),
  );
  const doorW = bw / 2 - 0.012;
  for (const side of [-1, 1]) {
    const tag = side < 0 ? 'L' : 'R';
    stand.add(
      box(`Stand_Door_${tag}`, [doorW, bodyH - 0.02, 0.014], woodLight, [side * (doorW / 2 + 0.003), midY, bd / 2 + 0.007]),
      mesh(`Stand_Handle_${tag}`, bare(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 12)), metal, [side * 0.04, midY + 0.1, bd / 2 + 0.018]),
    );
  }
  return stand;
}

function frame(w, d, wall, h) {
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(new THREE.BoxGeometry(w, h, wall).translate(0, 0, s * (d / 2 - wall / 2)));
    parts.push(new THREE.BoxGeometry(wall, h, d - 2 * wall).translate(s * (w / 2 - wall / 2), 0, 0));
  }
  return bare(merge(parts));
}

function buildTank() {
  // depthWrite stays off for every see-through surface so their draw order cannot hide the contents.
  const glass = material('Glass', { color: srgb(0.8, 0.93, 0.9), roughness: 0.03, transparent: true, opacity: 0.14, depthWrite: false });
  const trim = material('Trim', { color: srgb(0.04, 0.04, 0.045), roughness: 0.45 });
  const wallH = H - G, wallY = G + wallH / 2;
  return group(
    'Tank',
    box('Glass_Bottom', [W, G, D], glass, [0, G / 2, 0]),
    box('Glass_Front', [W, wallH, G], glass, [0, wallY, D / 2 - G / 2]),
    box('Glass_Back', [W, wallH, G], glass, [0, wallY, -(D / 2 - G / 2)]),
    box('Glass_Left', [G, wallH, D - 2 * G], glass, [-(W / 2 - G / 2), wallY, 0]),
    box('Glass_Right', [G, wallH, D - 2 * G], glass, [W / 2 - G / 2, wallY, 0]),
    mesh('Trim_Bottom', frame(W + 0.008, D + 0.008, G + 0.008, 0.03), trim, [0, 0.015, 0]),
    mesh('Trim_Top', frame(W + 0.008, D + 0.008, G + 0.008, 0.03), trim, [0, H - 0.011, 0]),
  );
}

function buildLight() {
  const housing = material('Light_Housing', { color: srgb(0.08, 0.08, 0.09), roughness: 0.35, metalness: 0.8 });
  const led = material('Light_LED', { color: srgb(1, 1, 1), emissive: srgb(1, 0.97, 0.9), emissiveIntensity: 4, roughness: 0.4 });
  const y = H + 0.07, legBottom = H + 0.004, legTop = y - 0.008;
  const light = group(
    'Light',
    box('Light_Bar', [W + 0.01, 0.016, 0.14], housing, [0, y, 0]),
    box('Light_Panel', [W - 0.1, 0.002, 0.1], led, [0, y - 0.009, 0]),
  );
  for (const side of [-1, 1]) {
    light.add(box(`Light_Leg_${side < 0 ? 'L' : 'R'}`, [0.01, legTop - legBottom, 0.05], housing, [side * (W / 2), (legTop + legBottom) / 2, 0]));
  }
  return light;
}

// ---------------------------------------------------------------- hardscape

// Sand slopes up towards the back, with a mound under the main rock group.
function sandHeight(x, z) {
  const zn = (z + ZI) / (2 * ZI);
  const mound = 0.02 * Math.exp(-(((x + 0.28) / 0.16) ** 2 + ((z + 0.04) / 0.11) ** 2));
  return G + 0.088 - 0.04 * smooth(zn) + 0.009 * fbm(x * 6, 0.5, z * 6, 2) + mound;
}

function buildSubstrate() {
  const light = srgb(0.74, 0.64, 0.45), dark = srgb(0.52, 0.43, 0.29);
  const xi = XI - 0.0005, zi = ZI - 0.0005;
  const grain = (x, z, c) => c.copy(light).lerp(dark, clamp(0.5 + 0.9 * fbm(x * 45, 3.1, z * 45, 2), 0, 1));
  const top = grid(72, 30, (u, v, o) => {
    const x = lerp(-xi, xi, u), z = lerp(-zi, zi, v);
    o.p.set(x, sandHeight(x, z), z);
    grain(x, z, o.c);
  });
  const wall = (ax, az, bx, bz, n) =>
    grid(n, 1, (u, v, o) => {
      const x = lerp(ax, bx, u), z = lerp(az, bz, u);
      o.p.set(x, v === 0 ? sandHeight(x, z) : G, z);
      o.c.copy(light).lerp(dark, 0.55);
    });
  const g = merge([top, wall(-xi, zi, xi, zi, 72), wall(xi, zi, xi, -zi, 30), wall(xi, -zi, -xi, -zi, 72), wall(-xi, -zi, -xi, zi, 30)]);
  g.computeVertexNormals();
  return mesh('Sand', g, material('Sand', { vertexColors: true, roughness: 0.95 }));
}

function rockGeometry(seed, radius, scale, x, z) {
  const dark = srgb(0.27, 0.26, 0.26), pale = srgb(0.58, 0.54, 0.48), moss = srgb(0.22, 0.36, 0.14);
  const g = ico(6);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const bump = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 1.3 + seed, v.y * 1.3 + seed * 1.7, v.z * 1.3 - seed, 3);
    const fine = fbm(v.x * 4.5 - seed, v.y * 4.5, v.z * 4.5 + seed * 2.1, 2);
    bump[i] = n + fine * 0.5;
    v.multiplyScalar(1 + 0.5 * n + 0.14 * fine);
    if (v.y < -0.5) v.y = -0.5 + (v.y + 0.5) * 0.15; // flat underside
    v.x *= scale[0] * radius;
    v.y *= scale[1] * radius;
    v.z *= scale[2] * radius;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.rotateY(seed * 1.3);
  g.computeVertexNormals();
  const normal = g.attributes.normal;
  paint(g, (p, c, i) => {
    c.copy(dark).lerp(pale, clamp(0.5 + 1.1 * bump[i], 0, 1));
    const mossy = smooth((normal.getY(i) - 0.5) / 0.35) * smooth(0.6 + 1.6 * fbm(p.x * 28 + seed, p.y * 28, p.z * 28, 2));
    c.lerp(moss, mossy * 0.75);
  });
  return g.translate(x, sandHeight(x, z) + radius * scale[1] * 0.4, z);
}

function buildRocks(rand) {
  const stone = material('Stone', { vertexColors: true, roughness: 0.88 });
  const rocks = merge([
    rockGeometry(1.7, 0.07, [1.3, 0.85, 1.0], -0.275, -0.05),
    rockGeometry(4.2, 0.05, [1.15, 0.8, 1.0], -0.15, 0.005),
    rockGeometry(7.9, 0.036, [1.2, 0.75, 0.9], -0.37, 0.045),
    rockGeometry(11.3, 0.052, [1.25, 0.85, 0.9], 0.33, -0.09),
    rockGeometry(15.1, 0.03, [1.1, 0.8, 1.0], 0.245, 0.075),
  ]);

  const palette = [srgb(0.42, 0.4, 0.38), srgb(0.62, 0.58, 0.52), srgb(0.3, 0.27, 0.25), srgb(0.78, 0.74, 0.68), srgb(0.5, 0.38, 0.3)];
  const parts = [];
  for (let i = 0; i < 100; i++) {
    const x = lerp(-XI + 0.02, XI - 0.02, rand());
    const z = lerp(-ZI + 0.02, ZI - 0.02, Math.sqrt(rand())); // denser near the front glass
    const r = lerp(0.005, 0.014, rand() ** 2);
    const g = ico(1);
    g.scale(r * lerp(1, 1.6, rand()), r * lerp(0.5, 0.8, rand()), r * lerp(0.8, 1.3, rand()));
    g.rotateY(rand() * TAU);
    g.translate(x, sandHeight(x, z) + r * 0.2, z);
    const tone = palette[Math.floor(rand() * palette.length)].clone().multiplyScalar(lerp(0.8, 1.15, rand()));
    parts.push(paint(g, (p, c) => c.copy(tone)));
  }
  const pebbles = merge(parts);
  pebbles.computeVertexNormals();
  return group('Hardscape', mesh('Rocks', rocks, stone), mesh('Pebbles', pebbles, stone));
}

function buildDriftwood() {
  const dark = srgb(0.2, 0.125, 0.07), pale = srgb(0.46, 0.31, 0.18);
  const branches = [
    [[[0.2, 0.06, -0.06], [0.14, 0.115, -0.04], [0.085, 0.17, -0.01], [0.04, 0.225, 0.03], [-0.02, 0.265, 0.05]], 0.017, 0.005],
    [[[0.105, 0.15, -0.025], [0.14, 0.205, 0.025], [0.2, 0.245, 0.045], [0.265, 0.26, 0.035]], 0.01, 0.003],
    [[[0.06, 0.2, 0.01], [0.015, 0.225, -0.05], [-0.04, 0.235, -0.1]], 0.008, 0.003],
    [[[0.2, 0.065, -0.06], [0.27, 0.058, -0.02], [0.325, 0.048, 0.04]], 0.013, 0.004],
    [[[0.19, 0.065, -0.06], [0.16, 0.07, -0.11], [0.1, 0.07, -0.145]], 0.011, 0.004],
  ];
  const g = merge(
    branches.map(([points, r0, r1]) =>
      paint(taperedTube(points, r0, r1), (p, c) => c.copy(dark).lerp(pale, clamp(0.5 + 1.2 * fbm(p.x * 70, p.y * 14, p.z * 70, 2), 0, 1))),
    ),
  );
  return mesh('Driftwood', g, material('Driftwood', { vertexColors: true, roughness: 0.8 }));
}

// ---------------------------------------------------------------- plants

function ribbonBlade({ height, width, dir, bend, twist, tint }, segments) {
  const dark = srgb(0.08, 0.3, 0.09), pale = srgb(0.42, 0.68, 0.2);
  const cd = Math.cos(dir), sd = Math.sin(dir);
  return grid(2, segments, (u, t, o) => {
    const lean = bend * height * t * t;
    const a = dir + Math.PI / 2 + twist * t;
    // Tips keep a sliver of width so no vertex is left with a zero-length normal.
    const w = width * Math.pow(1 - 0.99 * t, 0.5) * (0.45 + 0.55 * Math.min(1, t * 5));
    const side = (u - 0.5) * 2;
    const fold = (1 - Math.abs(side)) * w * 0.25; // shallow V cross-section
    o.p.set(
      cd * lean + (Math.cos(a) * side * w) / 2 + Math.sin(a) * fold,
      height * t * (1 - 0.25 * bend * t),
      sd * lean + (Math.sin(a) * side * w) / 2 - Math.cos(a) * fold,
    );
    o.c.copy(dark).lerp(pale, t).multiplyScalar(tint);
    o.s = t * t * height;
  }, true);
}

function vallisneria(rand, blades, maxHeight) {
  const parts = [];
  for (let i = 0; i < blades; i++) {
    const a = rand() * TAU, r = rand() * 0.028;
    const blade = ribbonBlade({
      height: maxHeight * lerp(0.5, 1, rand()),
      width: lerp(0.009, 0.014, rand()),
      dir: rand() * TAU,
      bend: lerp(0.08, 0.4, rand()),
      twist: lerp(-2.2, 2.2, rand()),
      tint: lerp(0.8, 1.15, rand()),
    }, 9);
    parts.push(blade.translate(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return parts;
}

function swordPlant(rand, leaves, size) {
  const dark = srgb(0.06, 0.28, 0.09), pale = srgb(0.32, 0.6, 0.17), stalk = srgb(0.45, 0.62, 0.28);
  const SEG = 8;
  const parts = [];
  for (let i = 0; i < leaves; i++) {
    const dir = (i / leaves) * TAU + rand() * 0.5;
    const length = size * lerp(0.6, 1, rand()), width = length * lerp(0.26, 0.34, rand());
    // The leaf tilts from a0 (near vertical) at the base to a1 at the tip.
    const a0 = lerp(0.05, 0.45, rand()), a1 = a0 + lerp(0.6, 1.2, rand());
    const line = [];
    for (let j = 0, r = 0, y = 0; j <= SEG; j++) {
      line.push([r, y]);
      const a = lerp(a0, a1, (j + 0.5) / SEG);
      r += (Math.sin(a) * length) / SEG;
      y += (Math.cos(a) * length) / SEG;
    }
    const cd = Math.cos(dir), sd = Math.sin(dir), tint = lerp(0.85, 1.15, rand());
    parts.push(grid(4, SEG, (u, t, o) => {
      const [r, y] = line[Math.round(t * SEG)];
      const a = lerp(a0, a1, t), q = clamp((t - 0.3) / 0.7, 0, 1);
      const half = t < 0.3 ? 0.003 : Math.max(0.0006, 0.003 * (1 - q) + (width / 2) * Math.pow(Math.sin(Math.PI * q), 0.6) * (1 - 0.2 * q));
      const side = (u - 0.5) * 2, fold = Math.abs(side) * half * 0.35;
      const rr = r - Math.cos(a) * fold;
      o.p.set(cd * rr - sd * side * half, y + Math.sin(a) * fold, sd * rr + cd * side * half);
      if (t < 0.3) o.c.copy(stalk);
      else o.c.copy(dark).lerp(pale, 1 - Math.abs(side) * 0.8).multiplyScalar(tint);
      o.s = t * t * length * 0.5;
    }, true));
  }
  return parts;
}

function stemPlant(rand, stems, height) {
  const low = srgb(0.3, 0.42, 0.14), high = srgb(0.82, 0.15, 0.22);
  const parts = [];
  const node = new THREE.Vector3();
  for (let s = 0; s < stems; s++) {
    const bx = (rand() - 0.5) * 0.07, bz = (rand() - 0.5) * 0.05;
    const h = height * lerp(0.6, 1, rand());
    const lx = (rand() - 0.5) * 0.09, lz = (rand() - 0.5) * 0.06;
    const at = (t, out) => out.set(bx + lx * t * t, h * t, bz + lz * t * t);
    const tint = lerp(0.85, 1.1, rand());
    parts.push(grid(3, 6, (u, t, o) => {
      at(t, o.p);
      o.p.x += Math.cos(u * TAU) * 0.0016;
      o.p.z += Math.sin(u * TAU) * 0.0016;
      o.c.copy(low).lerp(high, t * 0.6).multiplyScalar(0.8);
      o.s = t * t * h;
    }, true));
    const nodes = Math.round(h / 0.018), spin = rand() * TAU;
    for (let k = 1; k <= nodes; k++) {
      const t = k / nodes;
      at(t, node);
      const { x: px, y: py, z: pz } = node;
      const length = lerp(0.03, 0.016, t), wide = length * 0.42, tilt = lerp(0.35, 0.9, t);
      for (let m = 0; m < 2; m++) {
        const dir = spin + k * 1.9 + m * Math.PI;
        const cd = Math.cos(dir), sd = Math.sin(dir);
        parts.push(grid(2, 2, (u, v, o) => {
          const side = (u - 0.5) * 2, half = wide * Math.sin(Math.PI * (0.15 + 0.8 * v));
          const out = length * v * Math.cos(tilt);
          const up = length * v * Math.sin(tilt) - Math.abs(side) * half * 0.3;
          o.p.set(px + cd * out - sd * side * half, py + up, pz + sd * out + cd * side * half);
          o.c.copy(low).lerp(high, smooth(t * 1.15)).multiplyScalar(tint * (0.85 + 0.25 * v));
          o.s = t * t * h;
        }, true));
      }
    }
  }
  return parts;
}

function carpet(rand) {
  const parts = [];
  for (let i = 0; i < 46; i++) {
    const x = lerp(-0.45, 0.17, rand()), z = lerp(0.055, ZI - 0.02, rand());
    const y = sandHeight(x, z) - 0.002;
    for (let b = 0; b < 4; b++) {
      const blade = ribbonBlade({
        height: lerp(0.018, 0.042, rand()),
        width: 0.0045,
        dir: rand() * TAU,
        bend: lerp(0.4, 1, rand()),
        twist: 0,
        tint: lerp(0.95, 1.3, rand()),
      }, 3);
      parts.push(blade.translate(x + (rand() - 0.5) * 0.012, y, z + (rand() - 0.5) * 0.012));
    }
  }
  return parts;
}

// Merges plant parts and turns the per-vertex sway distance into a morph target.
// (x0, z0) is where the plant will stand, so leaves can be kept inside the glass even mid-sway.
function finishPlant(parts, x0, z0) {
  const amp = 0.08;
  const g = merge(parts);
  const pos = g.attributes.position, sway = g.attributes.sway;
  const limX = XI - 0.01 - amp * 0.36, limZ = ZI - 0.012;
  const delta = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, clamp(pos.getX(i) + x0, -limX, limX) - x0);
    pos.setZ(i, clamp(pos.getZ(i) + z0, -limZ, limZ) - z0);
    delta[i * 3] = sway.getX(i) * amp;
    delta[i * 3 + 2] = sway.getX(i) * amp * 0.25;
  }
  g.deleteAttribute('sway');
  g.computeVertexNormals();
  const morph = new THREE.BufferAttribute(delta, 3);
  morph.name = 'sway';
  g.morphAttributes.position = [morph];
  g.morphTargetsRelative = true;
  return g;
}

function weightTrack(name, cycles, phase, samplesPerCycle) {
  const count = cycles * samplesPerCycle;
  const times = [], values = [];
  for (let i = 0; i <= count; i++) {
    times.push((i / count) * LOOP);
    values.push(Math.sin((TAU * i) / samplesPerCycle + phase));
  }
  return new THREE.NumberKeyframeTrack(`${name}.morphTargetInfluences`, times, values);
}

function buildPlants(rand, tracks) {
  const mat = material('Plant', { vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  const plants = group('Plants');
  const place = (name, parts, x, z, cycles) => {
    const y = parts.absolute ? 0 : sandHeight(x, z) - 0.004;
    plants.add(mesh(name, finishPlant(parts, x, z), mat, [x, y, z]));
    tracks.push(weightTrack(name, cycles, rand() * TAU, 16));
  };
  [[-0.43, -0.14, 12], [-0.22, -0.155, 11], [0.07, -0.15, 12], [0.29, -0.155, 10]].forEach(([x, z, blades], i) => {
    place(`Plant_Vallisneria_${i + 1}`, vallisneria(rand, blades, WATER_Y - 0.02 - sandHeight(x, z)), x, z, 3);
  });
  place('Plant_Ludwigia_1', stemPlant(rand, 7, 0.25), -0.07, -0.11, 4);
  place('Plant_Ludwigia_2', stemPlant(rand, 5, 0.19), 0.39, -0.1, 4);
  place('Plant_Sword_1', swordPlant(rand, 11, 0.16), -0.02, -0.07, 3);
  place('Plant_Sword_2', swordPlant(rand, 8, 0.11), 0.37, 0.03, 3);
  place('Plant_Carpet', Object.assign(carpet(rand), { absolute: true }), 0, 0, 4);
  return plants;
}

// ---------------------------------------------------------------- fish

// Body thickness along the fish: 0 at the nose (s = 0), 1 at `peak`, `tail` at the tail root (s = 1).
function profile(s, peak, tail, nose = 1) {
  if (s <= peak) return Math.pow(Math.sqrt(1 - (1 - s / peak) ** 2), nose);
  const q = (s - peak) / (1 - peak);
  return tail + (1 - tail) * (0.5 + 0.5 * Math.cos(Math.PI * q));
}

function finGeometry(outline, colorAt, place) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  paint(g, colorAt);
  place?.(g);
  return g;
}

// Fish are modelled nose-forward along +X at unit length, then scaled. A single "wag" morph
// target bends the rear half sideways, which reads as swimming without a skeleton.
function fishGeometry({ length, rings, top, bottom, width, skin, fins, eye, wag }) {
  const AROUND = 14;
  const body = grid(AROUND, rings, (u, s, o) => {
    const ca = Math.cos(u * TAU), sa = Math.sin(u * TAU);
    // Both ends close to a point; one colour there lets the whole ring weld into a single vertex.
    const pole = s === 0 || s === 1, k = s === 1 ? 0 : 1;
    o.p.set(0.5 - s, (ca >= 0 ? top(s) : bottom(s)) * ca * k, width(s) * sa * k);
    skin(s, pole ? 0 : ca, o.c);
  });
  const parts = [mergeVertices(body, 1e-5)];
  for (const fin of fins) {
    for (const side of fin.paired ? [-1, 1] : [0]) {
      parts.push(finGeometry(fin.outline, fin.color, (g) => {
        if (!side) return;
        // Paired fins hinge at their first outline point and splay away from the body.
        const [hx, hy] = fin.outline[0];
        g.translate(-hx, -hy, 0).rotateX(-side * fin.splay).translate(hx, hy, side * fin.offset);
      }));
    }
  }
  const pupil = srgb(0.02, 0.02, 0.02);
  for (const side of [-1, 1]) {
    const e = ico(1).scale(eye.r, eye.r, eye.r);
    paint(e, (p, c) => c.copy(p.z * side > eye.r * 0.5 ? pupil : eye.iris));
    parts.push(e.translate(eye.x, eye.y, side * eye.z));
  }

  const g = merge(parts).scale(length, length, length);
  g.computeVertexNormals();
  g.computeBoundingBox();
  const pos = g.attributes.position;
  const x0 = 0.15 * length, tailX = g.boundingBox.min.x;
  const delta = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = clamp((x0 - pos.getX(i)) / (x0 - tailX), 0, 1);
    delta[i * 3 + 2] = wag * length * s * s;
  }
  const morph = new THREE.BufferAttribute(delta, 3);
  morph.name = 'wag';
  g.morphAttributes.position = [morph];
  g.morphTargetsRelative = true;
  return g;
}

function neonTetra() {
  const back = srgb(0.34, 0.37, 0.22), neon = srgb(0.05, 0.75, 1), red = srgb(0.92, 0.09, 0.1);
  const belly = srgb(0.88, 0.9, 0.88), clear = srgb(0.86, 0.88, 0.84);
  const finColor = (p, c) => c.copy(clear);
  return fishGeometry({
    length: 0.045,
    rings: 16,
    wag: 0.2,
    top: (s) => 0.135 * profile(s, 0.36, 0.25),
    bottom: (s) => 0.15 * profile(s, 0.34, 0.22),
    width: (s) => 0.07 * profile(s, 0.3, 0.15),
    skin: (s, ca, c) => {
      if (ca > 0.5) c.copy(back);
      else if (ca > 0) c.copy(s < 0.8 ? neon : back);
      else if (ca > -0.5) c.copy(s > 0.45 ? red : belly);
      else c.copy(s > 0.7 ? red : belly);
    },
    fins: [
      {
        outline: [[-0.46, 0.045], [-0.6, 0.16], [-0.76, 0.22], [-0.68, 0.05], [-0.63, 0], [-0.68, -0.05], [-0.76, -0.22], [-0.6, -0.16], [-0.46, -0.045]],
        color: (p, c) => c.copy(red).lerp(clear, smooth((-0.48 - p.x) / 0.12)),
      },
      { outline: [[0.05, 0.12], [-0.02, 0.27], [-0.12, 0.25], [-0.17, 0.12]], color: finColor },
      { outline: [[-0.12, -0.13], [-0.2, -0.26], [-0.3, -0.2], [-0.36, -0.09]], color: finColor },
      { outline: [[0.2, -0.06], [0.1, -0.02], [0.03, -0.1], [0.1, -0.16]], color: finColor, paired: true, splay: 1.0, offset: 0.055 },
    ],
    eye: { r: 0.035, x: 0.33, y: 0.03, z: 0.04, iris: srgb(0.92, 0.92, 0.86) },
  });
}

function goldfish() {
  const orange = srgb(1, 0.36, 0.03), red = srgb(0.93, 0.2, 0.03), belly = srgb(1, 0.68, 0.26), edge = srgb(1, 0.78, 0.5);
  const finColor = (cx, cy) => (p, c) => c.copy(orange).lerp(edge, smooth(Math.hypot(p.x - cx, p.y - cy) / 0.4));
  return fishGeometry({
    length: 0.08,
    rings: 16,
    wag: 0.16,
    top: (s) => 0.21 * profile(s, 0.42, 0.28),
    bottom: (s) => 0.25 * profile(s, 0.45, 0.22),
    width: (s) => 0.16 * profile(s, 0.38, 0.12),
    skin: (s, ca, c) => c.copy(orange).lerp(red, smooth((0.3 - s) / 0.3) * 0.6).lerp(belly, smooth(0.2 - ca)),
    fins: [
      {
        outline: [[-0.44, 0.05], [-0.62, 0.26], [-0.92, 0.4], [-0.84, 0.12], [-0.76, 0], [-0.84, -0.12], [-0.92, -0.4], [-0.62, -0.26], [-0.44, -0.05]],
        color: finColor(-0.45, 0),
      },
      { outline: [[0.12, 0.17], [0.05, 0.36], [-0.12, 0.38], [-0.28, 0.3], [-0.34, 0.14]], color: finColor(-0.1, 0.15) },
      { outline: [[-0.2, -0.17], [-0.26, -0.34], [-0.38, -0.28], [-0.4, -0.12]], color: finColor(-0.3, -0.15) },
      { outline: [[0.08, -0.2], [0, -0.36], [-0.1, -0.3], [-0.06, -0.2]], color: finColor(0, -0.2), paired: true, splay: 0.45, offset: 0.05 },
      { outline: [[0.22, -0.07], [0.1, -0.02], [0.02, -0.12], [0.1, -0.2]], color: finColor(0.2, -0.07), paired: true, splay: 1.0, offset: 0.125 },
    ],
    eye: { r: 0.04, x: 0.34, y: 0.05, z: 0.095, iris: srgb(0.95, 0.8, 0.35) },
  });
}

function angelfish() {
  const silver = srgb(0.84, 0.86, 0.82), gold = srgb(0.8, 0.7, 0.4), black = srgb(0.06, 0.06, 0.07);
  const bars = [0.13, 0.42, 0.7, 0.98];
  const bar = (s) => Math.max(...bars.map((b) => Math.exp(-(((s - b) / 0.04) ** 2))));
  const finColor = (p, c) => c.copy(silver).lerp(black, bar(0.5 - p.x) * 0.85);
  return fishGeometry({
    length: 0.065,
    rings: 22,
    wag: 0.12,
    top: (s) => 0.4 * profile(s, 0.48, 0.16, 1.5),
    bottom: (s) => 0.4 * profile(s, 0.48, 0.16, 1.5),
    width: (s) => 0.075 * profile(s, 0.35, 0.2),
    skin: (s, ca, c) => c.copy(silver).lerp(gold, smooth((ca - 0.3) / 0.7) * 0.5).lerp(black, bar(s) * 0.9),
    fins: [
      { outline: [[0, 0.36], [-0.1, 0.62], [-0.34, 0.98], [-0.3, 0.55], [-0.44, 0.07]], color: finColor },
      { outline: [[-0.02, -0.36], [-0.12, -0.62], [-0.36, -1], [-0.32, -0.55], [-0.44, -0.07]], color: finColor },
      { outline: [[-0.46, 0.06], [-0.66, 0.26], [-0.78, 0.3], [-0.74, 0], [-0.78, -0.3], [-0.66, -0.26], [-0.46, -0.06]], color: finColor },
      { outline: [[0.16, -0.34], [0.1, -0.5], [-0.1, -1.05], [0.14, -0.5], [0.21, -0.35]], color: finColor, paired: true, splay: 0.12, offset: 0.03 },
      { outline: [[0.2, -0.05], [0.08, 0], [0.02, -0.1], [0.1, -0.17]], color: finColor, paired: true, splay: 1.0, offset: 0.06 },
    ],
    eye: { r: 0.045, x: 0.3, y: 0.06, z: 0.04, iris: srgb(0.85, 0.3, 0.1) },
  });
}

// Samples a closed path (u in [0, 1] -> [x, y, z]) into position/rotation keys that keep the
// fish pointing along its direction of travel, plus the tail-wag weights.
function swimTracks(fish, path, wagCycles, wagPhase) {
  const SAMPLES = 96;
  const times = [], positions = [], rotations = [];
  const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const forward = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const basis = new THREE.Matrix4(), q = new THREE.Quaternion(), previous = new THREE.Quaternion();
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    p.fromArray(path(u));
    forward.subVectors(b.fromArray(path(u + 1e-3)), a.fromArray(path(u - 1e-3))).normalize();
    side.crossVectors(forward, UP).normalize();
    up.crossVectors(side, forward);
    q.setFromRotationMatrix(basis.makeBasis(forward, up, side));
    // Keep neighbouring keys on the same hemisphere so interpolation takes the short way round.
    if (i > 0 && q.dot(previous) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    previous.copy(q);
    times.push(u * LOOP);
    positions.push(p.x, p.y, p.z);
    rotations.push(q.x, q.y, q.z, q.w);
  }
  fish.position.fromArray(positions);
  fish.quaternion.fromArray(rotations);
  return [
    new THREE.VectorKeyframeTrack(`${fish.name}.position`, times, positions),
    new THREE.QuaternionKeyframeTrack(`${fish.name}.quaternion`, times, rotations),
    weightTrack(fish.name, wagCycles, wagPhase, 4),
  ];
}

function buildFish(rand, tracks) {
  const mat = material('Fish', { vertexColors: true, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide });
  const fish = group('Fish');
  const add = (name, geometry, path, wagCycles) => {
    const m = mesh(name, geometry, mat);
    fish.add(m);
    tracks.push(...swimTracks(m, path, wagCycles, rand() * TAU));
  };

  // A school of tetras circling the tank near the surface, two laps per loop.
  const tetra = neonTetra();
  for (let i = 0; i < 7; i++) {
    const phase = i * 0.021 + rand() * 0.01, reach = lerp(0.92, 1.04, rand());
    const dx = (rand() - 0.5) * 0.05, dy = (rand() - 0.5) * 0.04, dz = (rand() - 0.5) * 0.04;
    add(`Fish_NeonTetra_${i + 1}`, tetra, (u) => {
      const a = TAU * (2 * u + phase);
      return [0.02 + dx + 0.36 * reach * Math.cos(a), 0.385 + dy + 0.015 * Math.sin(2 * a + i), dz + 0.115 * reach * Math.sin(a)];
    }, 84);
  }

  // Goldfish patrol the open lane along the front glass.
  const gold = goldfish();
  [[0, 0], [0.36, 0.035], [0.69, -0.015]].forEach(([phase, dy], i) => {
    add(`Fish_Goldfish_${i + 1}`, gold, (u) => {
      const a = -TAU * (u + phase);
      return [0.08 + 0.33 * Math.cos(a), 0.2 + dy + 0.018 * Math.sin(2 * a + i), 0.115 + 0.045 * Math.sin(a)];
    }, 48);
  });

  // Angelfish drift in a figure of eight above the rocks, a quarter lap apart so they never meet at the crossing.
  const angel = angelfish();
  [0, 0.25].forEach((phase, i) => {
    add(`Fish_Angelfish_${i + 1}`, angel, (u) => {
      const a = TAU * (u + phase);
      return [-0.23 + 0.17 * Math.sin(a), 0.285 + 0.02 * Math.sin(a + 1), 0.085 * Math.sin(2 * a)];
    }, 30);
  });
  return fish;
}

// ---------------------------------------------------------------- equipment and water

const AIR_STONE = [0.455, -0.155];

function buildEquipment() {
  const [sx, sz] = AIR_STONE;
  const sy = sandHeight(sx, sz);
  const dark = material('Equipment_Dark', { color: srgb(0.06, 0.06, 0.065), roughness: 0.3 });
  const tubing = material('Tubing', { color: srgb(0.78, 0.84, 0.8), roughness: 0.4 });
  const cable = (points, r) => bare(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.25), 48, r, 6, false));
  const rimY = H + 0.0066, behind = -(D / 2 + 0.0125);
  return group(
    'Equipment',
    mesh('Air_Stone', bare(new THREE.CylinderGeometry(0.011, 0.013, 0.028, 12)), material('Air_Stone', { color: srgb(0.4, 0.52, 0.62), roughness: 0.95 }), [sx, sy + 0.011, sz]),
    mesh('Air_Tube', cable([[sx, sy + 0.025, sz], [0.468, 0.25, -0.172], [0.47, 0.47, -0.178], [0.47, rimY, -0.19], [0.47, rimY, behind + 0.004], [0.47, 0.46, behind], [0.47, 0.3, behind]], 0.0022), tubing),
    mesh('Heater_Body', bare(new THREE.CylinderGeometry(0.011, 0.011, 0.19, 12)), material('Heater_Glass', { color: srgb(0.16, 0.16, 0.17), roughness: 0.12, metalness: 0.3 }), [-0.462, 0.3, -0.15]),
    mesh('Heater_Cap', bare(new THREE.CylinderGeometry(0.013, 0.013, 0.03, 12)), dark, [-0.462, 0.41, -0.15]),
    mesh('Heater_Lamp', bare(new THREE.CylinderGeometry(0.0115, 0.0115, 0.008, 12)), material('Heater_Lamp', { color: srgb(1, 0.4, 0.1), emissive: srgb(1, 0.35, 0.05), emissiveIntensity: 2 }), [-0.462, 0.37, -0.15]),
    mesh('Heater_Cable', cable([[-0.462, 0.42, -0.15], [-0.468, 0.47, -0.176], [-0.47, rimY, -0.19], [-0.47, rimY, behind + 0.004], [-0.47, 0.46, behind], [-0.47, 0.3, behind]], 0.002), dark),
  );
}

function buildBubbles(rand, tracks) {
  const mat = material('Bubble', { color: srgb(0.9, 0.97, 1), roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false });
  const geometry = bare(new THREE.SphereGeometry(1, 10, 8));
  const [ox, oz] = AIR_STONE;
  const oy = sandHeight(ox, oz) + 0.03;
  const STEPS = 8; // keys per rise
  const bubbles = group('Bubbles');
  for (let i = 0; i < 26; i++) {
    const cycles = [8, 10, 12][i % 3], rise = LOOP / cycles;
    const start = Math.floor(rand() * STEPS); // where in its rise the bubble is at t = 0
    const r = lerp(0.002, 0.0045, rand());
    const heading = rand() * TAU, spread = lerp(0.003, 0.022, rand()), wobble = rand() * TAU;
    const at = (k) => [
      ox + Math.cos(heading) * spread * k + 0.004 * Math.sin(TAU * 2 * k + wobble),
      lerp(oy, WATER_Y - r, k),
      oz + Math.sin(heading) * spread * k + 0.004 * Math.cos(TAU * 2 * k + wobble),
    ];
    const times = [], values = [];
    for (let n = 0; n <= cycles * STEPS; n++) {
      const t = (n * rise) / STEPS, step = (n + start) % STEPS;
      // On reaching the surface the bubble snaps back to the air stone between two adjacent keys.
      if (step === 0 && n > 0) {
        times.push(t - 0.002);
        values.push(...at(1));
      }
      times.push(t);
      values.push(...at(step / STEPS));
    }
    const m = mesh(`Bubble_${String(i + 1).padStart(2, '0')}`, geometry, mat);
    m.scale.setScalar(r);
    m.position.fromArray(values);
    bubbles.add(m);
    tracks.push(new THREE.VectorKeyframeTrack(`${m.name}.position`, times, values));
  }
  return bubbles;
}

function buildWater() {
  const depth = WATER_Y - G - 0.0005;
  const volume = material('Water_Volume', { color: srgb(0.3, 0.72, 0.8), roughness: 0.2, transparent: true, opacity: 0.12, depthWrite: false });
  const surfaceMat = material('Water_Surface', { color: srgb(0.6, 0.86, 0.95), roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  const xi = XI - 0.0005, zi = ZI - 0.0005;
  const surface = grid(36, 14, (u, v, o) => {
    const x = lerp(-xi, xi, u), z = lerp(-zi, zi, v);
    o.p.set(x, 0.0012 * (Math.sin(x * 38 + 1) + Math.sin(z * 47 + x * 23)), z);
  });
  surface.deleteAttribute('color');
  surface.computeVertexNormals();
  return group(
    'Water',
    box('Water_Volume', [2 * xi, depth, 2 * zi], volume, [0, G + depth / 2, 0]),
    mesh('Water_Surface', surface, surfaceMat, [0, WATER_Y, 0]),
  );
}

// ---------------------------------------------------------------- assembly

export function buildAquarium() {
  const rand = rng(20261112);
  const tracks = [];
  const tank = buildTank();
  tank.position.y = STAND_H;
  tank.add(
    buildLight(),
    buildSubstrate(),
    buildRocks(rand),
    buildDriftwood(),
    buildPlants(rand, tracks),
    buildEquipment(),
    buildFish(rand, tracks),
    buildBubbles(rand, tracks),
    buildWater(),
  );
  const root = group('Aquarium', buildStand(), tank);
  return { root, clip: new THREE.AnimationClip('Aquarium_Loop', LOOP, tracks) };
}

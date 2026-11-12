// Plants. Each rooted plant is one mesh with a "sway" morph target driven by its own track.
import * as THREE from 'three';
import { TAU, WATER_Y, XI, ZI, clamp, fbm, grid, group, lerp, material, merge, mesh, smooth, srgb, swayTrack } from './core.js';
import { ROCKS, sandHeight } from './scape.js';

const FLOW = 0.1; // heading (radians from +X) in which long leaves trail under the surface
const SWAY = 0.08; // sideways travel at full morph weight, per metre of sway distance stored on a vertex

// Tall ribbons. Blades longer than the water is deep bend over and trail along the surface.
function vallisneria(rand, x0, z0, blades) {
  const dark = srgb(0.07, 0.27, 0.08), pale = srgb(0.4, 0.66, 0.2), old = srgb(0.42, 0.36, 0.14);
  const depth = WATER_Y - sandHeight(x0, z0);
  const parts = [];
  for (let i = 0; i < blades; i++) {
    const a = rand() * TAU, r = rand() * 0.03;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    // Each blade rises straight, bends over through a quarter circle of radius `bend` and
    // then lies flat just under the surface, trailing off on its own heading.
    const ceiling = depth - lerp(0.004, 0.018, rand()), bend = lerp(0.06, 0.11, rand()), rise = ceiling - bend;
    const heading = FLOW + lerp(-0.2, 0.45, rand()), fx = Math.cos(heading), fz = Math.sin(heading);
    // Height, distance trailed and how far over the blade has turned (0 to 1), s metres along it.
    const shape = (s) => {
      const th = (s - rise) / bend;
      if (th <= 0) return [s, 0, 0];
      if (th < Math.PI / 2) return [rise + bend * Math.sin(th), bend * (1 - Math.cos(th)), th / (Math.PI / 2)];
      return [ceiling, bend * (th - Math.PI / 2 + 1), 1];
    };
    // A third of the blades are young and stop short of the surface.
    let length = depth * (rand() < 0.33 ? lerp(0.35, 0.8, rand()) : lerp(0.9, 1.45, rand()));
    while (x0 + bx + shape(length)[1] * fx > XI - 0.05) length *= 0.92; // do not trail into the end glass
    const width = lerp(0.008, 0.013, rand());
    const leanDir = rand() * TAU, lean = lerp(0.02, 0.1, rand());
    const face = lerp(-0.9, 0.9, rand()), twist = lerp(-0.6, 0.6, rand());
    // Once a blade lies flat its width has to turn across its heading, whichever way is nearer.
    const turn = -fz * Math.cos(face) + fx * Math.sin(face) >= 0 ? 1 : -1;
    const tint = lerp(0.8, 1.15, rand()), aged = rand() < 0.15 ? lerp(0.3, 0.7, rand()) : 0;
    parts.push(grid(2, 16, (u, t, o) => {
      const [y, drift, over] = shape(length * t), flat = smooth(over);
      const angle = face + twist * t;
      let cx = lerp(Math.cos(angle), -fz * turn, flat), cz = lerp(Math.sin(angle), fx * turn, flat);
      const norm = Math.hypot(cx, cz);
      cx /= norm;
      cz /= norm;
      const side = (u - 0.5) * 2;
      // Tips keep a sliver of width so no vertex is left with a zero-length normal.
      const w = width * (0.5 + 0.5 * Math.min(1, t * 6)) * Math.sqrt(1 - 0.985 * t);
      const fold = (1 - Math.abs(side)) * w * 0.22; // shallow V cross-section
      o.p.set(
        bx + Math.cos(leanDir) * lean * y + fx * drift + (cx * side * w) / 2 + cz * fold * (1 - flat),
        y - fold * flat,
        bz + Math.sin(leanDir) * lean * y + fz * drift + (cz * side * w) / 2 - cx * fold * (1 - flat),
      );
      o.c.copy(dark).lerp(pale, 0.8 * t + 0.2 * (1 - Math.abs(side))).lerp(old, aged * t);
      o.c.multiplyScalar(tint * lerp(0.55, 1, smooth(t * 3)));
      o.s = t * t * length * 0.7;
    }, { sway: true }));
  }
  return parts;
}

const SWORD = { dark: srgb(0.06, 0.28, 0.09), pale: srgb(0.32, 0.6, 0.17), stalk: srgb(0.45, 0.62, 0.28), wide: 0.3 };
const CRYPT = { dark: srgb(0.2, 0.22, 0.08), pale: srgb(0.42, 0.4, 0.16), stalk: srgb(0.4, 0.3, 0.16), wide: 0.26, ruffle: 0.5, spread: [0.25, 0.7] };
const ANUBIAS = { dark: srgb(0.04, 0.19, 0.07), pale: srgb(0.17, 0.4, 0.13), stalk: srgb(0.22, 0.36, 0.14), wide: 0.5, spread: [0.3, 0.9] };

// Leaves radiating from one crown: sword plants, cryptocorynes, anubias.
function rosette(rand, { leaves, size, dark, pale, stalk, wide, ruffle = 0, spread = [0.05, 0.45] }) {
  const SEG = 8;
  const parts = [];
  for (let i = 0; i < leaves; i++) {
    const dir = (i / leaves) * TAU + rand() * 0.5;
    const length = size * lerp(0.6, 1, rand()), width = length * wide * lerp(0.85, 1.15, rand());
    // The leaf tilts from a0 (near vertical) at the base to a1 at the tip.
    const a0 = lerp(spread[0], spread[1], rand()), a1 = a0 + lerp(0.6, 1.2, rand());
    const line = [];
    for (let j = 0, r = 0, y = 0; j <= SEG; j++) {
      line.push([r, y]);
      const a = lerp(a0, a1, (j + 0.5) / SEG);
      r += (Math.sin(a) * length) / SEG;
      y += (Math.cos(a) * length) / SEG;
    }
    const cd = Math.cos(dir), sd = Math.sin(dir), tint = lerp(0.85, 1.15, rand()), wave = rand() * TAU;
    parts.push(grid(4, SEG, (u, t, o, _, j) => {
      const [r, y] = line[j];
      const a = lerp(a0, a1, t), q = clamp((t - 0.3) / 0.7, 0, 1);
      const blade = (width / 2) * Math.pow(Math.sin(Math.PI * q), 0.6) * (1 - 0.2 * q);
      const half = Math.max(0.0006, t < 0.3 ? 0.0025 : 0.0025 * (1 - q) + blade);
      const side = (u - 0.5) * 2;
      const lift = Math.abs(side) * half * (0.35 + ruffle * Math.sin(t * 16 + wave));
      const rr = r - Math.cos(a) * lift;
      o.p.set(cd * rr - sd * side * half, y + Math.sin(a) * lift, sd * rr + cd * side * half);
      if (t < 0.3) o.c.copy(stalk);
      else o.c.copy(dark).lerp(pale, 1 - Math.abs(side) * 0.8).multiplyScalar(tint);
      o.c.multiplyScalar(lerp(0.55, 1, smooth(t * 2.5)));
      o.s = t * t * length * 0.5;
    }, { sway: true }));
  }
  return parts;
}

const LUDWIGIA = { low: srgb(0.3, 0.42, 0.14), high: srgb(0.8, 0.14, 0.2), leaf: [0.034, 0.02, 0.38] };
const HYGROPHILA = { low: srgb(0.12, 0.34, 0.1), high: srgb(0.46, 0.7, 0.24), leaf: [0.044, 0.024, 0.2] };

const LEAF_POINTS = [[0.5, 0], [0, 0.3], [1, 0.3], [0.5, 0.5], [0, 0.7], [1, 0.7], [0.5, 1]];
const LEAF_INDEX = [0, 1, 3, 0, 3, 2, 1, 4, 3, 3, 5, 2, 4, 6, 3, 3, 6, 5];

// A small oval leaf of six triangles: base, tip, two points on each edge and one on the
// midrib. fn(u, v, o) works as it does for grid().
function leaflet(fn) {
  const count = LEAF_POINTS.length;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 4), sw = new Float32Array(count);
  const o = { p: new THREE.Vector3(), c: new THREE.Color(), s: 0 };
  LEAF_POINTS.forEach(([u, v], k) => {
    fn(u, v, o);
    o.p.toArray(pos, k * 3);
    o.c.toArray(col, k * 4);
    col[k * 4 + 3] = 1;
    sw[k] = o.s;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  g.setIndex(LEAF_INDEX);
  return g;
}

// Upright stems carrying pairs of leaves, each pair turned a quarter from the last.
// `leaf` is the leaf length at the bottom and top of a stem and its half-width as a share of that.
function stems(rand, count, height, { low, high, leaf }) {
  const parts = [];
  const node = new THREE.Vector3();
  for (let s = 0; s < count; s++) {
    const bx = (rand() - 0.5) * 0.09, bz = (rand() - 0.5) * 0.06;
    const h = height * lerp(0.55, 1, rand());
    const lx = (rand() - 0.5) * 0.09, lz = (rand() - 0.5) * 0.06;
    const at = (t, out) => out.set(bx + lx * t * t, h * t, bz + lz * t * t);
    const tint = lerp(0.85, 1.1, rand());
    parts.push(grid(3, 6, (u, t, o) => {
      at(t, o.p);
      o.p.x += Math.cos(u * TAU) * 0.0016;
      o.p.z += Math.sin(u * TAU) * 0.0016;
      o.c.copy(low).lerp(high, t * 0.6).multiplyScalar(0.65);
      o.s = t * t * h;
    }, { sway: true }));
    const nodes = Math.round(h / 0.017), spin = rand() * TAU;
    for (let k = 1; k <= nodes; k++) {
      const t = k / nodes;
      at(t, node);
      const { x: px, y: py, z: pz } = node;
      const length = lerp(leaf[0], leaf[1], t) * lerp(0.85, 1.15, rand()), wide = length * leaf[2], tilt = lerp(0.15, 0.7, t);
      for (let m = 0; m < 2; m++) {
        const dir = spin + k * (Math.PI / 2 + 0.25) + m * Math.PI;
        const cd = Math.cos(dir), sd = Math.sin(dir);
        parts.push(leaflet((u, v, o) => {
          const side = (u - 0.5) * 2, half = wide * (v < 0.5 ? 0.9 : 0.72);
          const out = length * v * Math.cos(tilt);
          const up = length * v * Math.sin(tilt) - length * 0.3 * v * v - Math.abs(side) * half * 0.35;
          o.p.set(px + cd * out - sd * side * half, py + up, pz + sd * out + cd * side * half);
          o.c.copy(low).lerp(high, smooth(t * 1.15)).multiplyScalar(tint * (0.8 + 0.3 * v) * (1.15 - 0.25 * Math.abs(side)));
          o.s = t * t * h;
        }));
      }
    }
  }
  return parts;
}

// Hairgrass over the front left of the tank, in tank coordinates. It grows in drifts, with
// bare sand between them.
function carpet(rand) {
  const dark = srgb(0.1, 0.33, 0.08), pale = srgb(0.5, 0.78, 0.25);
  const parts = [];
  for (let tufts = 0; tufts < 190; ) {
    const x = lerp(-0.47, 0.08, rand()), z = lerp(0.04, ZI - 0.015, rand());
    if (fbm(x * 9, 1.7, z * 9, 2) < -0.12 || ROCKS.some((rock) => Math.hypot(x - rock.x, z - rock.z) < rock.r * 1.25)) continue;
    tufts++;
    const y = sandHeight(x, z) - 0.002;
    for (let b = 0; b < 5; b++) {
      const dir = rand() * TAU, h = lerp(0.018, 0.042, rand()), lean = h * lerp(0.1, 0.7, rand()), tint = lerp(0.85, 1.25, rand());
      const ox = x + (rand() - 0.5) * 0.016, oz = z + (rand() - 0.5) * 0.016;
      const cd = Math.cos(dir), sd = Math.sin(dir);
      parts.push(grid(1, 1, (u, t, o) => {
        const w = 0.004 * (1 - 0.8 * t) * (u - 0.5);
        o.p.set(ox + cd * lean * t - sd * w, y + h * t, oz + sd * lean * t + cd * w);
        o.c.copy(dark).lerp(pale, t).multiplyScalar(tint * lerp(0.6, 1, t));
      }));
    }
  }
  return parts;
}

// Moss tufts along the driftwood: [x, y, z, radius] in tank coordinates.
const MOSS = [[0.15, 0.122, -0.045, 0.02], [0.1, 0.168, -0.018, 0.017], [0.058, 0.218, 0.018, 0.015], [0.012, 0.252, 0.042, 0.012], [0.15, 0.218, 0.03, 0.013], [0.215, 0.253, 0.044, 0.012], [0.255, 0.066, -0.03, 0.018]];

// Each tuft is a burst of short fronds over the upper side of the branch.
function moss(rand) {
  const dark = srgb(0.06, 0.22, 0.05), pale = srgb(0.34, 0.58, 0.15);
  const out = new THREE.Vector3(), across = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const parts = [];
  for (const [x, y, z, r] of MOSS) {
    for (let b = 0; b < 30; b++) {
      const a = rand() * TAU, rise = lerp(-0.25, 0.95, rand()), flat = Math.sqrt(1 - rise * rise);
      out.set(Math.cos(a) * flat, rise, Math.sin(a) * flat);
      across.crossVectors(out, up).normalize();
      const { x: ox, y: oy, z: oz } = out, { x: sx, z: sz } = across;
      const length = r * lerp(0.7, 1.5, rand()), tint = lerp(0.8, 1.2, rand());
      parts.push(grid(1, 1, (u, t, o) => {
        const reach = length * (0.25 + 0.75 * t), w = 0.005 * (1 - 0.7 * t) * (u - 0.5);
        o.p.set(x + ox * reach + sx * w, y + oy * reach * 0.8, z + oz * reach + sz * w);
        o.c.copy(dark).lerp(pale, t).multiplyScalar(tint);
      }));
    }
  }
  return parts;
}

// name, x, z, sway cycles per loop, builder and, for plants that do not root in the sand, y.
const PLANTING = [
  ['Vallisneria_1', -0.44, -0.15, 3, (rand, x, z) => vallisneria(rand, x, z, 14)],
  ['Vallisneria_2', -0.2, -0.16, 3, (rand, x, z) => vallisneria(rand, x, z, 15)],
  ['Vallisneria_3', 0.08, -0.155, 3, (rand, x, z) => vallisneria(rand, x, z, 14)],
  ['Vallisneria_4', 0.3, -0.16, 3, (rand, x, z) => vallisneria(rand, x, z, 12)],
  ['Hygrophila', -0.335, -0.125, 4, (rand) => stems(rand, 6, 0.2, HYGROPHILA)],
  ['Ludwigia_1', -0.06, -0.115, 4, (rand) => stems(rand, 9, 0.22, LUDWIGIA)],
  ['Ludwigia_2', 0.4, -0.1, 4, (rand) => stems(rand, 7, 0.2, LUDWIGIA)],
  ['Sword_1', -0.02, -0.06, 3, (rand) => rosette(rand, { leaves: 11, size: 0.16, ...SWORD })],
  ['Sword_2', 0.385, 0.02, 3, (rand) => rosette(rand, { leaves: 8, size: 0.11, ...SWORD })],
  ['Crypt_1', -0.425, 0.0, 3, (rand) => rosette(rand, { leaves: 8, size: 0.075, ...CRYPT })],
  ['Crypt_2', 0.275, 0.0, 3, (rand) => rosette(rand, { leaves: 7, size: 0.065, ...CRYPT })],
  ['Anubias', 0.15, -0.035, 2, (rand) => rosette(rand, { leaves: 6, size: 0.06, ...ANUBIAS }), 0.118],
];

// Where plants root, as [x, z, radius, strength] patches of contact shadow for the sand.
export const PLANT_SPOTS = PLANTING.filter((plant) => plant[5] === undefined).map(([, x, z]) => [x, z, 0.04, 0.3]);

// Merges a plant's parts, keeps them inside the glass even mid-sway and turns the per-vertex
// sway distance into a morph target. (x0, z0) is where the plant will stand.
function rooted(parts, x0, z0) {
  const g = merge(parts);
  const pos = g.attributes.position, sway = g.attributes.sway;
  const delta = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const dx = sway.getX(i) * SWAY, dz = dx * 0.25;
    const limX = XI - 0.012 - dx, limZ = ZI - 0.012 - dz;
    pos.setX(i, clamp(pos.getX(i) + x0, -limX, limX) - x0);
    pos.setZ(i, clamp(pos.getZ(i) + z0, -limZ, limZ) - z0);
    delta[i * 3] = dx;
    delta[i * 3 + 2] = dz;
  }
  g.deleteAttribute('sway');
  g.computeVertexNormals();
  const morph = new THREE.BufferAttribute(delta, 3);
  morph.name = 'sway';
  g.morphAttributes.position = [morph];
  g.morphTargetsRelative = true;
  return g;
}

function still(parts) {
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

export function buildPlants(rand, tracks) {
  const mat = material('Plant', { vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
  const plants = group('Plants');
  for (const [name, x, z, cycles, build, y] of PLANTING) {
    plants.add(mesh(`Plant_${name}`, rooted(build(rand, x, z), x, z), mat, [x, y ?? sandHeight(x, z) - 0.004, z]));
    tracks.push(swayTrack(`Plant_${name}`, cycles, rand() * TAU));
  }
  plants.add(mesh('Plant_Carpet', still(carpet(rand)), mat), mesh('Plant_Moss', still(moss(rand)), mat));
  return plants;
}

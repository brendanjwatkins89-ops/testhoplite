// Substrate and hardscape: sand, stones, pebbles and driftwood.
import * as THREE from 'three';
import { G, TAU, XI, ZI, boxUV, clamp, fbm, grid, group, ico, lerp, material, merge, mesh, noise, paint, rng, smooth, srgb, tangents, tube } from './core.js';

// Sand slopes up towards the back, with a mound under the main stone.
export function sandHeight(x, z) {
  const zn = (z + ZI) / (2 * ZI);
  const mound = 0.02 * Math.exp(-(((x + 0.28) / 0.16) ** 2 + ((z + 0.04) / 0.11) ** 2));
  return G + 0.088 - 0.04 * smooth(zn) + 0.009 * fbm(x * 6, 0.5, z * 6, 2) + mound;
}

// r is the base radius, scale stretches it per axis and lean tips the stone over.
export const ROCKS = [
  { seed: 1.7, r: 0.074, scale: [1.2, 1.2, 0.95], x: -0.275, z: -0.05, detail: 8, lean: 0.2 },
  { seed: 4.2, r: 0.05, scale: [1.2, 0.85, 1.0], x: -0.15, z: 0.0, detail: 6, lean: -0.25 },
  { seed: 7.9, r: 0.036, scale: [1.25, 0.75, 0.9], x: -0.375, z: 0.05, detail: 5, lean: 0.1 },
  { seed: 11.3, r: 0.052, scale: [1.25, 0.95, 0.9], x: 0.335, z: -0.09, detail: 6, lean: -0.15 },
  { seed: 15.1, r: 0.028, scale: [1.2, 0.75, 1.0], x: 0.2, z: 0.035, detail: 4, lean: 0 },
  { seed: 19.4, r: 0.022, scale: [1.3, 0.7, 1.0], x: -0.2, z: 0.075, detail: 3, lean: 0 },
];

const GRAIN_TILE = 0.1; // metres of sand covered by one repeat of the grain texture
const STONE_TILE = 0.12;

function buildSand(normalMap, spots) {
  const light = srgb(0.66, 0.58, 0.44), dark = srgb(0.46, 0.39, 0.28);
  const xi = XI - 0.0005, zi = ZI - 0.0005;
  // Whatever rests on the sand darkens it a little, which grounds it in any viewer.
  const contact = (x, z) => {
    let shade = 1;
    for (const [sx, sz, radius, strength] of spots) shade *= 1 - strength * Math.exp(-((x - sx) ** 2 + (z - sz) ** 2) / (radius * radius));
    return shade;
  };
  const top = grid(64, 26, (u, v, o) => {
    const x = lerp(-xi, xi, u), z = lerp(-zi, zi, v);
    o.p.set(x, sandHeight(x, z), z);
    o.c.copy(light).lerp(dark, clamp(0.5 + 0.9 * fbm(x * 45, 3.1, z * 45, 2), 0, 1)).multiplyScalar(contact(x, z));
    o.uv.set(x / GRAIN_TILE, z / GRAIN_TILE);
  }, { uv: true });
  // Side walls close the sand bed against the glass.
  const wall = (ax, az, bx, bz, n) =>
    grid(n, 1, (u, v, o) => {
      const x = lerp(ax, bx, u), z = lerp(az, bz, u), y = v === 0 ? sandHeight(x, z) : G;
      o.p.set(x, y, z);
      o.c.copy(light).lerp(dark, 0.55);
      o.uv.set((x + z) / GRAIN_TILE, y / GRAIN_TILE);
    }, { uv: true });
  const g = merge([top, wall(-xi, zi, xi, zi, 64), wall(xi, zi, xi, -zi, 26), wall(xi, -zi, -xi, -zi, 64), wall(-xi, -zi, -xi, zi, 26)]);
  g.computeVertexNormals();
  return mesh('Sand', tangents(g), material('Sand', { vertexColors: true, roughness: 0.92, normalMap, normalScale: new THREE.Vector2(0.9, 0.9) }));
}

function rockGeometry({ seed, r, scale, x, z, detail, lean }) {
  // Vertex colours only tint the stone texture: a cool grey, greener where algae settles on top.
  const tint = srgb(0.86, 0.9, 0.96), algae = srgb(0.5, 0.72, 0.3);
  const rand = rng(Math.round(seed * 977));
  // Random planar cuts give the stone flat fracture faces instead of a blobby outline.
  const cuts = Array.from({ length: 8 }, () => {
    const y = rand() * 2 - 1, a = rand() * TAU, s = Math.sqrt(1 - y * y);
    return { n: new THREE.Vector3(s * Math.cos(a), y, s * Math.sin(a)), d: lerp(0.6, 0.9, rand()) };
  });
  const g = ico(detail);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const tone = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const big = fbm(v.x * 1.2 + seed, v.y * 1.2 + seed * 1.7, v.z * 1.2 - seed, 3);
    const crag = 1 - 2.2 * Math.abs(fbm(v.x * 2.6 - seed, v.y * 2.6, v.z * 2.6 + seed * 2.1, 3));
    const fine = fbm(v.x * 7 + seed * 3, v.y * 7, v.z * 7, 2);
    tone[i] = crag + fine;
    v.multiplyScalar(1 + 0.4 * big + 0.14 * (crag - 0.6) + 0.06 * fine);
    for (const cut of cuts) {
      const over = v.dot(cut.n) - cut.d;
      if (over > 0) v.addScaledVector(cut.n, -0.85 * over);
    }
    pos.setXYZ(i, v.x * scale[0] * r, v.y * scale[1] * r, v.z * scale[2] * r);
  }
  g.rotateZ(lean).rotateY(seed * 1.3);
  g.computeVertexNormals();
  g.computeBoundingBox();
  const { min, max } = g.boundingBox, height = max.y - min.y;
  const normal = g.attributes.normal;
  paint(g, (p, c, i) => {
    c.copy(tint).multiplyScalar(lerp(0.7, 1, clamp(0.5 + 0.5 * tone[i], 0, 1)));
    const film = smooth((normal.getY(i) - 0.5) / 0.4) * smooth(0.5 + 1.5 * fbm(p.x * 30 - seed, p.y * 30, p.z * 30, 2));
    c.lerp(algae, 0.5 * film);
    // Darker towards the sand line: a cheap stand-in for contact shadow.
    c.multiplyScalar(lerp(0.45, 1, smooth((p.y - min.y) / height / 0.45 - 0.35)));
  });
  // The lowest fifth of the stone sits in the sand.
  return tangents(boxUV(g, STONE_TILE)).translate(x, sandHeight(x, z) - min.y - 0.22 * height, z);
}

function buildPebbles(rand) {
  const palette = [srgb(0.42, 0.4, 0.38), srgb(0.6, 0.57, 0.52), srgb(0.28, 0.26, 0.25), srgb(0.74, 0.71, 0.66), srgb(0.47, 0.37, 0.3)];
  const parts = [];
  const add = (x, z, r) => {
    const g = ico(r > 0.0075 ? 1 : 0);
    g.scale(r * lerp(1, 1.5, rand()), r * lerp(0.45, 0.75, rand()), r * lerp(0.8, 1.2, rand()));
    g.rotateY(rand() * TAU);
    g.translate(x, sandHeight(x, z) + r * 0.15, z);
    const tone = palette[Math.floor(rand() * palette.length)].clone().multiplyScalar(lerp(0.8, 1.15, rand()));
    parts.push(paint(g, (p, c) => c.copy(tone)));
  };
  // Scree gathers around the stones; a few more lie scattered over the open sand.
  for (const rock of ROCKS) {
    for (let i = 0; i < 6; i++) {
      const a = rand() * TAU, d = rock.r * lerp(1.15, 1.9, rand());
      const x = clamp(rock.x + Math.cos(a) * d * rock.scale[0], -XI + 0.02, XI - 0.02);
      const z = clamp(rock.z + Math.sin(a) * d * rock.scale[2], -ZI + 0.02, ZI - 0.02);
      add(x, z, lerp(0.004, 0.012, rand() ** 1.5));
    }
  }
  for (let i = 0; i < 22; i++) add(lerp(-XI + 0.02, XI - 0.02, rand()), lerp(-ZI + 0.03, ZI - 0.02, Math.sqrt(rand())), lerp(0.003, 0.009, rand() ** 2));
  const g = merge(parts);
  g.computeVertexNormals();
  return mesh('Pebbles', g, material('Pebble', { vertexColors: true, roughness: 0.75 }));
}

// Spline control points in tank coordinates and the radius at each end.
const BRANCHES = [
  { path: [[0.2, 0.06, -0.06], [0.14, 0.115, -0.04], [0.085, 0.17, -0.01], [0.04, 0.225, 0.03], [-0.02, 0.265, 0.05]], r: [0.019, 0.004] },
  { path: [[0.105, 0.15, -0.025], [0.14, 0.205, 0.025], [0.2, 0.245, 0.045], [0.265, 0.26, 0.035]], r: [0.011, 0.0025] },
  { path: [[0.06, 0.2, 0.01], [0.015, 0.225, -0.05], [-0.04, 0.235, -0.1]], r: [0.008, 0.002] },
  { path: [[0.2, 0.065, -0.06], [0.27, 0.058, -0.02], [0.325, 0.048, 0.04]], r: [0.014, 0.004] },
  { path: [[0.19, 0.065, -0.06], [0.16, 0.07, -0.11], [0.1, 0.07, -0.145]], r: [0.012, 0.004] },
];

function buildDriftwood(wood, bark) {
  // Tints for the wood-grain texture, which runs along each branch.
  const dark = srgb(0.42, 0.28, 0.17), pale = srgb(0.95, 0.7, 0.45);
  const parts = BRANCHES.map(({ path, r: [r0, r1] }, k) =>
    tube(path, {
      segments: 22,
      radial: 9,
      tile: 0.14,
      // Ridges run along the branch like weathered grain, and the tip closes to (almost) a point.
      radius: (t, a) => lerp(r0, r1, t ** 0.8) * Math.min(1, (1 - t) * 12 + 0.08) * (1 + 0.2 * noise(Math.cos(a) * 2.2 + k * 7, Math.sin(a) * 2.2, t * 2.5 + k)),
      color: (t, a, c, p) => {
        c.copy(dark).lerp(pale, clamp(0.5 + 0.9 * noise(Math.cos(a) * 3 - k * 5, Math.sin(a) * 3, t * 1.2 + k), 0, 1));
        c.multiplyScalar(lerp(0.5, 1, smooth((p.y - sandHeight(p.x, p.z)) / 0.03)));
      },
    }),
  );
  const mat = material('Driftwood', { map: wood, normalMap: bark, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true, roughness: 0.85 });
  return mesh('Driftwood', tangents(merge(parts)), mat);
}

// `spots` are extra [x, z, radius, strength] patches of contact shadow, for things planted in the sand.
export function buildScape(rand, spots, { grain, stone, wood }) {
  const stoneMat = material('Stone', { map: stone.color, normalMap: stone.normal, vertexColors: true, roughness: 0.85 });
  const rockSpots = ROCKS.map((rock) => [rock.x, rock.z, rock.r * Math.max(rock.scale[0], rock.scale[2]) * 1.25, 0.45]);
  return [
    buildSand(grain, [...rockSpots, [0.2, -0.06, 0.05, 0.4], ...spots]),
    group('Hardscape', mesh('Rocks', merge(ROCKS.map(rockGeometry)), stoneMat), buildPebbles(rand)),
    buildDriftwood(wood, stone.normal),
  ];
}

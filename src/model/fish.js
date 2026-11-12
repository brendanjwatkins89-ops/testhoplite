// Fish. Each is one mesh, nose towards +X, with an opaque body and translucent fins. A single
// "wag" morph target bends the rear half sideways, which reads as swimming without a skeleton.
import * as THREE from 'three';
import { LOOP_SECONDS as LOOP, TAU, clamp, fbm, grid, group, hash, lerp, material, merge, mesh, pack, smooth, srgb, swayTrack, weld } from './core.js';

const UP = new THREE.Vector3(0, 1, 0);
const PUPIL = srgb(0.015, 0.015, 0.015);
const WHITE = srgb(0.95, 0.93, 0.88);

// Body thickness along the fish: 0 at the nose (s = 0), 1 at `peak`, `tail` at the tail root (s = 1).
function profile(s, peak, tail, nose = 1) {
  if (s <= peak) return Math.pow(Math.sqrt(1 - (1 - s / peak) ** 2), nose);
  const q = (s - peak) / (1 - peak);
  return tail + (1 - tail) * (0.5 + 0.5 * Math.cos(Math.PI * q));
}

// A fin is a fan of rays from a root line inside the body out to an outer edge. `outline`
// runs from one end of the root, round the edge, to the other end, in body lengths.
function fin({ outline, rays, color, alpha = [0.9, 0.55], ruffle = 0, paired }) {
  const [ax, ay] = outline[0], [bx, by] = outline[outline.length - 1];
  const edge = new THREE.CatmullRomCurve3(outline.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'catmullrom', 0.4);
  const tip = new THREE.Vector3();
  const build = (side) => {
    const g = grid(rays, 3, (u, v, o, i) => {
      edge.getPoint(lerp(0.05, 0.95, u), tip);
      o.p.set(lerp(lerp(ax, bx, u), tip.x, v), lerp(lerp(ay, by, u), tip.y, v), ruffle * v * Math.sin(u * 9 + side));
      color(o.p, o.c);
      // Every other ray is darker and denser, which reads as the fin's rays.
      o.c.multiplyScalar(i % 2 ? 0.8 : 1);
      o.a = lerp(alpha[0], alpha[1], v) * (i % 2 ? 1 : 0.85);
    });
    // Paired fins hinge at the front of their root and splay away from the body.
    if (side) g.translate(-ax, -ay, 0).rotateX(-side * paired.splay).translate(ax, ay, side * paired.offset);
    return g;
  };
  return paired ? [build(-1), build(1)] : [build(0)];
}

// A low dome with a crisp pupil: rings at the centre, the pupil's edge, just outside it and the rim.
function eyeGeometry({ r, x, y, iris }, z, side) {
  const RINGS = [0, 0.52, 0.6, 1];
  return weld(grid(10, 3, (u, v, o, i, j) => {
    const rho = RINGS[j] * r, a = u * TAU * side; // winding flips with the side, so the dome faces out
    o.p.set(x + Math.cos(a) * rho, y + Math.sin(a) * rho, side * (z + 0.5 * r * (1 - RINGS[j] ** 2)));
    o.c.copy(j < 2 ? PUPIL : iris);
  }), 1e-6);
}

function fishGeometry({ length, rings, around, top, bottom, width, skin, fins, eye, wag }) {
  const body = weld(grid(around, rings, (u, s, o, i, j) => {
    const ca = Math.cos(u * TAU), sa = Math.sin(u * TAU);
    // Both ends close to a point; one colour there lets the whole ring weld into a single vertex.
    const pole = j === 0 || j === rings, k = j === rings ? 0 : 1;
    o.p.set(0.5 - s, (ca >= 0 ? top(s) : bottom(s)) * ca * k, width(s) * sa * k);
    skin(s, pole ? 0 : ca, o.c);
    // Vertex-to-vertex variation stands in for the glint of individual scales.
    if (!pole) o.c.multiplyScalar(0.92 + 0.16 * hash(i % around, j, 3));
  }), 1e-5);
  // The eye's rim sits just under the skin at its front edge.
  const s0 = 0.5 - eye.x - eye.r;
  const eyeZ = width(s0) * Math.sqrt(Math.max(0, 1 - (eye.y / top(s0)) ** 2)) - 0.003;
  const solid = merge([body, eyeGeometry(eye, eyeZ, -1), eyeGeometry(eye, eyeZ, 1)]);
  // Two material groups: the body and eyes, then the fins.
  const g = merge([solid, merge(fins.flatMap(fin))], true).scale(length, length, length);
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
  return pack(g);
}

function neonTetra() {
  const back = srgb(0.3, 0.33, 0.2), teal = srgb(0.15, 0.85, 0.75), neon = srgb(0.04, 0.6, 1), red = srgb(0.9, 0.07, 0.09);
  const belly = srgb(0.86, 0.88, 0.86), clear = srgb(0.8, 0.84, 0.82);
  const stripe = new THREE.Color();
  const plain = (p, c) => c.copy(clear);
  const sheer = [0.45, 0.2];
  return fishGeometry({
    length: 0.038,
    rings: 16,
    around: 12,
    wag: 0.2,
    top: (s) => 0.115 * profile(s, 0.34, 0.28),
    bottom: (s) => 0.135 * profile(s, 0.36, 0.24),
    width: (s) => 0.062 * profile(s, 0.3, 0.16),
    skin: (s, ca, c) => {
      c.copy(belly);
      c.lerp(red, smooth((s - 0.4) / 0.1) * smooth((0.3 - ca) / 0.25) * smooth((ca + 0.8) / 0.3));
      c.lerp(stripe.copy(teal).lerp(neon, s), smooth((ca - 0.05) / 0.2) * smooth((0.82 - s) / 0.08));
      c.lerp(back, smooth((ca - 0.55) / 0.25));
    },
    fins: [
      {
        outline: [[-0.46, 0.04], [-0.6, 0.15], [-0.75, 0.21], [-0.66, 0.05], [-0.63, 0], [-0.66, -0.05], [-0.75, -0.21], [-0.6, -0.15], [-0.46, -0.04]],
        rays: 8,
        alpha: [0.6, 0.25],
        color: (p, c) => c.copy(red).lerp(clear, smooth((-0.48 - p.x) / 0.1)),
      },
      { outline: [[0.04, 0.1], [-0.03, 0.26], [-0.12, 0.24], [-0.16, 0.1]], rays: 4, alpha: sheer, color: plain },
      { outline: [[-0.12, -0.115], [-0.2, -0.25], [-0.3, -0.19], [-0.36, -0.075]], rays: 4, alpha: sheer, color: plain },
      { outline: [[0.02, -0.12], [-0.04, -0.2], [-0.09, -0.125]], rays: 2, alpha: sheer, color: plain, paired: { splay: 0.5, offset: 0.02 } },
      { outline: [[0.2, -0.03], [0.08, 0], [0, -0.07], [0.06, -0.14], [0.19, -0.08]], rays: 4, alpha: sheer, color: plain, paired: { splay: 1, offset: 0.05 } },
    ],
    eye: { r: 0.036, x: 0.34, y: 0.02, iris: srgb(0.75, 0.85, 0.9) },
  });
}

// Body, head and belly colours, and how much of the body is white.
const GOLDFISH = [
  { body: srgb(1, 0.36, 0.03), head: srgb(0.93, 0.2, 0.03), belly: srgb(1, 0.68, 0.26), white: 0 },
  { body: srgb(0.96, 0.27, 0.04), head: srgb(0.9, 0.16, 0.03), belly: srgb(0.97, 0.93, 0.86), white: 0.6 },
  { body: srgb(1, 0.52, 0.08), head: srgb(1, 0.4, 0.05), belly: srgb(1, 0.8, 0.4), white: 0 },
];

function goldfish(variant) {
  const { body, head, belly, white } = GOLDFISH[variant];
  const edge = body.clone().lerp(WHITE, 0.55);
  const patch = (x, y) => white * smooth((fbm(x * 3 + variant * 5, y * 4, 0.5, 2) + 0.05) / 0.2);
  const finColor = (cx, cy) => (p, c) => c.copy(body).lerp(edge, smooth(Math.hypot(p.x - cx, p.y - cy) / 0.4)).lerp(WHITE, patch(p.x, p.y));
  const top = (s) => 0.2 * profile(s, 0.4, 0.3), bottom = (s) => 0.24 * profile(s, 0.44, 0.24);
  return fishGeometry({
    length: 0.075,
    rings: 24,
    around: 16,
    wag: 0.16,
    top,
    bottom,
    width: (s) => 0.15 * profile(s, 0.36, 0.13),
    skin: (s, ca, c) => {
      c.copy(body).lerp(head, 0.6 * smooth((0.3 - s) / 0.3)).lerp(belly, smooth(0.2 - ca));
      c.lerp(WHITE, patch(0.5 - s, ca * (ca > 0 ? top(s) : bottom(s))));
      c.multiplyScalar(1 - 0.25 * Math.exp(-(((s - 0.25) / 0.025) ** 2))); // the gill cover's edge
    },
    fins: [
      {
        outline: [[-0.44, 0.05], [-0.62, 0.27], [-0.95, 0.42], [-0.86, 0.13], [-0.76, 0], [-0.86, -0.13], [-0.95, -0.42], [-0.62, -0.27], [-0.44, -0.05]],
        rays: 12,
        ruffle: 0.035,
        color: finColor(-0.45, 0),
      },
      { outline: [[0.13, 0.165], [0.06, 0.36], [-0.12, 0.38], [-0.27, 0.3], [-0.33, 0.14]], rays: 9, ruffle: 0.015, color: finColor(-0.1, 0.15) },
      { outline: [[-0.2, -0.17], [-0.27, -0.34], [-0.38, -0.28], [-0.4, -0.12]], rays: 5, color: finColor(-0.3, -0.15) },
      { outline: [[0.08, -0.2], [0, -0.36], [-0.1, -0.3], [-0.06, -0.2]], rays: 4, color: finColor(0, -0.2), paired: { splay: 0.45, offset: 0.05 } },
      { outline: [[0.22, -0.05], [0.1, -0.01], [0.01, -0.1], [0.08, -0.19], [0.2, -0.11]], rays: 5, alpha: [0.8, 0.4], color: finColor(0.2, -0.07), paired: { splay: 1, offset: 0.115 } },
    ],
    eye: { r: 0.04, x: 0.34, y: 0.05, iris: srgb(0.95, 0.8, 0.35) },
  });
}

function angelfish() {
  const silver = srgb(0.84, 0.86, 0.82), gold = srgb(0.8, 0.7, 0.4), black = srgb(0.05, 0.05, 0.06);
  const bars = [0.13, 0.42, 0.7, 0.98];
  const bar = (s) => Math.max(...bars.map((b) => Math.exp(-(((s - b) / 0.04) ** 2))));
  const finColor = (p, c) => c.copy(silver).lerp(black, bar(0.5 - p.x) * 0.85);
  const height = (s) => 0.4 * profile(s, 0.48, 0.16, 1.5);
  return fishGeometry({
    length: 0.065,
    rings: 24,
    around: 14,
    wag: 0.12,
    top: height,
    bottom: height,
    width: (s) => 0.07 * profile(s, 0.35, 0.2),
    skin: (s, ca, c) => c.copy(silver).lerp(gold, smooth((ca - 0.3) / 0.7) * 0.5).lerp(black, bar(s) * 0.9),
    fins: [
      { outline: [[0, 0.36], [-0.1, 0.62], [-0.34, 0.98], [-0.3, 0.55], [-0.44, 0.07]], rays: 10, alpha: [0.95, 0.7], color: finColor },
      { outline: [[-0.02, -0.36], [-0.12, -0.62], [-0.36, -1], [-0.32, -0.55], [-0.44, -0.07]], rays: 10, alpha: [0.95, 0.7], color: finColor },
      { outline: [[-0.46, 0.06], [-0.66, 0.26], [-0.78, 0.3], [-0.74, 0], [-0.78, -0.3], [-0.66, -0.26], [-0.46, -0.06]], rays: 10, alpha: [0.9, 0.5], color: finColor },
      { outline: [[0.16, -0.34], [0.1, -0.5], [-0.1, -1.05], [0.14, -0.5], [0.21, -0.35]], rays: 2, alpha: [0.95, 0.8], color: finColor, paired: { splay: 0.12, offset: 0.03 } },
      { outline: [[0.2, -0.05], [0.08, 0], [0.02, -0.1], [0.08, -0.17], [0.19, -0.11]], rays: 4, alpha: [0.5, 0.25], color: finColor, paired: { splay: 1, offset: 0.055 } },
    ],
    eye: { r: 0.045, x: 0.3, y: 0.06, iris: srgb(0.85, 0.3, 0.1) },
  });
}

// Every fish gets its own geometry object over shared buffers. A mesh with two materials loads
// as a group whose parts are found by name when animating, and instances of one glTF mesh
// would share those names.
function instance(geometry) {
  const g = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) g.setAttribute(name, attribute);
  g.setIndex(geometry.index);
  g.morphAttributes = geometry.morphAttributes;
  g.morphTargetsRelative = geometry.morphTargetsRelative;
  g.groups = geometry.groups;
  return g;
}

// A closed curve in plan (t in [0, 1] -> [x, z]) re-parametrised by distance, so fish hold a
// steady speed along it and keep their spacing through the turns.
function circuit(curve, samples = 720) {
  const points = Array.from({ length: samples }, (_, i) => curve(i / samples));
  const point = (i) => points[((i % samples) + samples) % samples];
  const along = [0];
  for (let i = 1; i <= samples; i++) along.push(along[i - 1] + Math.hypot(point(i)[0] - point(i - 1)[0], point(i)[1] - point(i - 1)[1]));
  const length = along[samples];
  const heading = (i) => [point(i + 1)[0] - point(i - 1)[0], point(i + 1)[1] - point(i - 1)[1]];
  // The point `s` metres along the curve, shifted `side` metres to the right of travel.
  const at = (s, side = 0) => {
    s = ((s % length) + length) % length;
    let lo = 0, hi = samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (along[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - along[lo]) / (along[hi] - along[lo]);
    const [ax, az] = point(lo), [bx, bz] = point(hi), [atx, atz] = heading(lo), [btx, btz] = heading(hi);
    const tx = lerp(atx, btx, t), tz = lerp(atz, btz, t), norm = Math.hypot(tx, tz);
    return [lerp(ax, bx, t) - (tz / norm) * side, lerp(az, bz, t) + (tx / norm) * side];
  };
  return { length, at };
}

// Two straights joined by semicircles of radius r; `half` is half the overall length.
const stadium = (cx, cz, half, r) => (t) => {
  const a = t * TAU;
  return [cx + Math.sign(Math.cos(a)) * (half - r) + r * Math.cos(a), cz + r * Math.sin(a)];
};

// Samples a closed path (u in [0, 1] -> [x, y, z]) into position and rotation keys, plus the
// tail-wag weights. The fish points along the chord from `lead` behind to `lead` ahead of
// where it is (in units of u), which eases it into turns instead of snapping round.
function swimTracks(fish, path, lead, wagCycles, wagPhase) {
  const SAMPLES = 120;
  const times = [], positions = [], rotations = [];
  const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const forward = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const basis = new THREE.Matrix4(), q = new THREE.Quaternion(), previous = new THREE.Quaternion();
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    p.fromArray(path(u));
    forward.subVectors(b.fromArray(path(u + lead)), a.fromArray(path(u - lead))).normalize();
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
    swayTrack(fish.name, wagCycles, wagPhase, 4),
  ];
}

// Where each tetra holds station in the school: metres ahead along the route, to the right
// of it and above it. No two slots are closer than a fish is long.
const SCHOOL = [[0, 0, 0], [0.045, 0.022, 0.012], [0.05, -0.02, -0.01], [0.095, 0.004, 0.022], [0.105, -0.026, 0.006], [0.15, 0.02, -0.006], [0.16, -0.008, -0.02]];

export function buildFish(rand, tracks) {
  const materials = [
    material('Fish', { vertexColors: true, roughness: 0.3, metalness: 0.2 }),
    material('Fish_Fin', { vertexColors: true, roughness: 0.5, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  ];
  const fish = group('Fish');
  // `travel` is how far the fish swims in one loop; the chord it points along is as long as its body.
  const add = (name, geometry, size, travel, path, wagCycles) => {
    const m = mesh(name, instance(geometry), materials);
    m.scale.setScalar(size);
    fish.add(m);
    const lead = ((geometry.boundingBox.max.x - geometry.boundingBox.min.x) * size) / 2 / travel;
    tracks.push(...swimTracks(m, path, lead, wagCycles, rand() * TAU));
  };

  // A school of tetras circling the right of the tank near the surface, two laps per loop.
  const tetra = neonTetra(), route = circuit(stadium(0.135, 0.045, 0.255, 0.085));
  SCHOOL.forEach(([ahead, right, above], i) => {
    add(`Fish_NeonTetra_${i + 1}`, tetra, lerp(0.85, 1.1, rand()), 2 * route.length, (u) => {
      const [x, z] = route.at(2 * route.length * u + ahead, right);
      return [x, 0.365 + above + 0.008 * Math.sin(TAU * 3 * u + i), z];
    }, 84);
  });

  // Goldfish patrol the open lane along the front glass, the other way round. They turn almost
  // on the spot at each end; the right-hand end sits further back, because there the tail is
  // what swings towards the glass.
  const lane = circuit((t) => {
    const c = Math.cos(TAU * t);
    return [0.125 + 0.285 * c, 0.112 + 0.032 * Math.sin(TAU * t) - 0.03 * Math.max(0, c) ** 2];
  });
  [[0, 0, 1.05], [0.36, 0.02, 0.95], [0.69, -0.02, 0.8]].forEach(([phase, dy, size], i) => {
    add(`Fish_Goldfish_${i + 1}`, goldfish(i), size, lane.length, (u) => {
      const [x, z] = lane.at(-lane.length * (u + phase));
      return [x, 0.195 + dy + 0.015 * Math.sin(TAU * 2 * u + 2 * i), z];
    }, 48);
  });

  // Angelfish drift in a figure of eight over the stones on the left, a quarter lap apart so
  // they never meet at the crossing.
  const angel = angelfish(), eight = circuit((t) => [-0.315 + 0.1 * Math.sin(TAU * t), 0.03 + 0.07 * Math.sin(2 * TAU * t)]);
  [[0, 1], [0.25, 0.85]].forEach(([phase, size], i) => {
    add(`Fish_Angelfish_${i + 1}`, angel, size, eight.length, (u) => {
      const [x, z] = eight.at(eight.length * (u + phase));
      return [x, 0.328 + 0.012 * Math.sin(TAU * u + 1 + 2 * i), z];
    }, 30);
  });
  return fish;
}

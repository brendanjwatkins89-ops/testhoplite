// Equipment: heater, filter pipes, air stone and the bubbles it makes.
import * as THREE from 'three';
import { D, H, LOOP_SECONDS as LOOP, TAU, WATER_Y, bare, group, lerp, material, merge, mesh, srgb, tube } from './core.js';
import { sandHeight } from './scape.js';

const AIR_STONE = [0.455, -0.155];
const RIM = H + 0.004; // top of the trim, which hoses and cables climb over
const BEHIND = -(D / 2 + 0.004); // outer face of the back trim

function cylinder(r, length, x, y, z, axis = 'y') {
  const g = new THREE.CylinderGeometry(r, r, length, 14);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  return bare(g.translate(x, y, z));
}

// Continues a hose or cable of radius r up the back glass at x, over the rim and down behind the tank.
function overRim(start, x, r) {
  const top = RIM + r + 0.0015, back = BEHIND - r - 0.002;
  return [...start, [x, top - 0.03, -0.18], [x, top, -0.186], [x, top, back + 0.005], [x, top - 0.03, back], [x, 0.25, back]];
}

export function buildEquipment() {
  const dark = material('Equipment_Dark', { color: srgb(0.05, 0.05, 0.055), roughness: 0.35 });
  const pipe = material('Filter_Pipe', { color: srgb(0.1, 0.13, 0.11), roughness: 0.3 });
  const hose = material('Hose', { color: srgb(0.72, 0.8, 0.74), roughness: 0.45 });
  const [sx, sz] = AIR_STONE, sy = sandHeight(sx, sz);
  const hx = -0.452, hz = -0.172; // heater
  const fx = -0.385, fz = -0.178; // filter intake
  const run = (points, r, radial = 6) => tube(points, { radius: r, segments: 40, radial, tension: 0.25 });
  return group(
    'Equipment',
    mesh('Air_Stone', bare(new THREE.CylinderGeometry(0.011, 0.013, 0.028, 12)), material('Air_Stone', { color: srgb(0.4, 0.52, 0.62), roughness: 0.95 }), [sx, sy + 0.011, sz]),
    mesh('Air_Line', run(overRim([[sx, sy + 0.025, sz], [0.468, 0.25, -0.176]], 0.47, 0.0022), 0.0022), hose),
    mesh('Heater_Body', cylinder(0.011, 0.19, hx, 0.3, hz), material('Heater_Glass', { color: srgb(0.2, 0.2, 0.21), roughness: 0.1, metalness: 0.2 })),
    mesh('Heater_Cap', cylinder(0.013, 0.03, hx, 0.41, hz), dark),
    mesh('Heater_Lamp', cylinder(0.0113, 0.006, hx, 0.385, hz), material('Heater_Lamp', { color: srgb(1, 0.4, 0.1), emissive: srgb(1, 0.35, 0.05), emissiveIntensity: 2 })),
    mesh('Heater_Cups', merge([cylinder(0.012, 0.012, hx, 0.25, -0.186, 'z'), cylinder(0.012, 0.012, hx, 0.35, -0.186, 'z')]), hose),
    mesh('Heater_Cable', run(overRim([[hx, 0.425, hz]], hx, 0.002), 0.002), dark),
    mesh('Filter_Strainer', merge([cylinder(0.012, 0.075, fx, 0.165, fz), cylinder(0.0135, 0.005, fx, 0.145, fz), cylinder(0.0135, 0.005, fx, 0.185, fz)]), pipe),
    mesh('Filter_Intake', run(overRim([[fx, 0.2, fz], [fx, 0.4, fz]], fx, 0.008), 0.008, 10), pipe),
    mesh('Filter_Outflow', run(overRim([[0.325, 0.405, -0.165], [0.362, 0.406, -0.17], [0.383, 0.425, -0.176]], 0.385, 0.008), 0.008, 10), pipe),
    mesh('Filter_Nozzle', cylinder(0.0105, 0.02, 0.318, 0.405, -0.165, 'x'), pipe),
  );
}

export function buildBubbles(rand, tracks) {
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
    m.scale.set(r, r * 0.8, r); // rising bubbles flatten
    m.position.fromArray(values);
    bubbles.add(m);
    tracks.push(new THREE.VectorKeyframeTrack(`${m.name}.position`, times, values));
  }
  return bubbles;
}

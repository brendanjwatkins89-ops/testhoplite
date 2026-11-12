// The cabinet, the glass tank itself and its lamp.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { D, G, H, STAND_H, W, XI, ZI, bare, box, boxUV, group, material, merge, mesh, srgb, tube } from './core.js';

export const MAT = 0.005; // foam mat between the cabinet and the tank

const WOOD_TILE = 0.45; // metres of wood covered by one repeat of the grain texture

export function buildStand(woodMap) {
  const wood = material('Wood', { map: woodMap, color: srgb(0.46, 0.3, 0.17), roughness: 0.45 });
  const dark = material('Stand_Dark', { color: srgb(0.015, 0.015, 0.015), roughness: 0.9 });
  const metal = material('Metal', { color: srgb(0.78, 0.78, 0.8), roughness: 0.28, metalness: 1 });

  // Slightly rounded edges catch the light; each panel samples a different patch of grain.
  const panel = (name, size, position, grain) =>
    mesh(name, boxUV(new RoundedBoxGeometry(...size, 1, 0.003), WOOD_TILE, grain), wood, position);

  const bw = W + 0.06, bd = D + 0.06, topT = 0.025, plinthH = 0.07;
  const bodyH = STAND_H - topT - plinthH, midY = plinthH + bodyH / 2;
  const doorW = bw / 2 - 0.0045, doorT = 0.018, doorZ = bd / 2 + 0.003 + doorT / 2;
  const stand = group(
    'Stand',
    box('Stand_Plinth', [bw - 0.05, plinthH, bd - 0.045], dark, [0, plinthH / 2, -0.005]),
    panel('Stand_Body', [bw, bodyH, bd], [0, midY, 0], [0.13, 0.4]),
    panel('Stand_Top', [bw + 0.024, topT, bd + 0.024], [0, STAND_H - topT / 2, 0], [0.31, 0.77]),
    // A black sheet behind the doors, so the gaps around them read as shadow.
    box('Stand_Recess', [bw - 0.01, bodyH - 0.01, 0.002], dark, [0, midY, bd / 2 + 0.001]),
  );
  for (const side of [-1, 1]) {
    const tag = side < 0 ? 'L' : 'R';
    const hx = side * 0.05, hy = midY + 0.13, hz = doorZ + doorT / 2;
    const post = (y) => new THREE.CylinderGeometry(0.0035, 0.0035, 0.022, 10).rotateX(Math.PI / 2).translate(hx, y, hz + 0.011);
    stand.add(
      panel(`Stand_Door_${tag}`, [doorW, bodyH - 0.008, doorT], [side * (doorW / 2 + 0.0015), midY, doorZ], [0.37 + side * 0.17, 0.11 + side * 0.26]),
      mesh(`Stand_Handle_${tag}`, bare(merge([new THREE.CylinderGeometry(0.005, 0.005, 0.18, 12).translate(hx, hy, hz + 0.022), post(hy - 0.06), post(hy + 0.06)])), metal),
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

export function buildShell() {
  // depthWrite stays off for every see-through surface so their draw order cannot hide the contents.
  const glass = material('Glass', { color: srgb(0.78, 0.92, 0.88), roughness: 0.02, transparent: true, opacity: 0.12, depthWrite: false });
  const trim = material('Trim', { color: srgb(0.035, 0.035, 0.04), roughness: 0.55 });
  const wallH = H - G, wallY = G + wallH / 2;
  // Black silicone beads in the upright corners, as on a glued glass tank.
  const bead = (x, z) => new THREE.BoxGeometry(0.005, wallH - 0.004, 0.005).rotateY(Math.PI / 4).translate(x, wallY, z);
  return group(
    'Shell',
    box('Glass_Bottom', [W, G, D], glass, [0, G / 2, 0]),
    box('Glass_Front', [W, wallH, G], glass, [0, wallY, D / 2 - G / 2]),
    box('Glass_Back', [W, wallH, G], glass, [0, wallY, -(D / 2 - G / 2)]),
    box('Glass_Left', [G, wallH, D - 2 * G], glass, [-(W / 2 - G / 2), wallY, 0]),
    box('Glass_Right', [G, wallH, D - 2 * G], glass, [W / 2 - G / 2, wallY, 0]),
    mesh('Trim_Bottom', frame(W + 0.008, D + 0.008, G + 0.008, 0.03), trim, [0, 0.015, 0]),
    mesh('Trim_Top', frame(W + 0.008, D + 0.008, G + 0.008, 0.03), trim, [0, H - 0.011, 0]),
    mesh('Silicone', bare(merge([bead(-XI, -ZI), bead(XI, -ZI), bead(-XI, ZI), bead(XI, ZI)])), material('Silicone', { color: srgb(0.02, 0.02, 0.022), roughness: 0.35 })),
    // Black film on the outside of the back glass.
    box('Background', [W - 0.004, H - 0.008, 0.0015], material('Background', { color: srgb(0.01, 0.012, 0.016), roughness: 0.7 }), [0, H / 2, -(D / 2 + 0.0012)]),
    box('Mat', [W + 0.012, MAT, D + 0.012], material('Foam', { color: srgb(0.03, 0.03, 0.03), roughness: 0.95 }), [0, -MAT / 2, 0]),
  );
}

export function buildLight() {
  const housing = material('Light_Housing', { color: srgb(0.06, 0.06, 0.065), roughness: 0.4, metalness: 0.9 });
  const led = material('Light_LED', { color: srgb(1, 1, 1), emissive: srgb(1, 0.96, 0.88), emissiveIntensity: 5, roughness: 0.5 });
  const y = H + 0.085, rim = H + 0.004, behind = -(D / 2 + 0.03);
  const light = group(
    'Light',
    box('Light_Bar', [W - 0.03, 0.016, 0.13], housing, [0, y, 0]),
    box('Light_Panel', [W - 0.12, 0.002, 0.095], led, [0, y - 0.009, 0]),
    mesh(
      'Light_Cable',
      tube([[0.4, y + 0.008, -0.05], [0.4, y + 0.012, -0.13], [0.4, y - 0.02, behind + 0.008], [0.4, 0.3, behind], [0.4, 0.02, behind]], { radius: 0.003, segments: 28, radial: 6 }),
      material('Cable', { color: srgb(0.02, 0.02, 0.02), roughness: 0.6 }),
    ),
  );
  for (const side of [-1, 1]) {
    // A foot resting on the rim and an end plate up the side of the bar.
    const foot = new THREE.BoxGeometry(0.024, 0.008, 0.07).translate(side * (W / 2 - 0.004), rim + 0.004, 0);
    const plate = new THREE.BoxGeometry(0.006, y - rim, 0.05).translate(side * (W / 2 - 0.012), (y + rim) / 2 + 0.008, 0);
    light.add(mesh(`Light_Bracket_${side < 0 ? 'L' : 'R'}`, bare(merge([foot, plate])), housing));
  }
  return light;
}

// Water: a surface with travelling ripples, a faintly tinted volume and the meniscus at the glass.
import * as THREE from 'three';
import { G, LOOP_SECONDS as LOOP, TAU, WATER_Y, XI, ZI, box, grid, group, lerp, material, merge, mesh, srgb } from './core.js';

// wavelength (m), heading (rad), amplitude (m), phase
const WAVES = [[0.2, 0.17, 0.0016, 0], [0.14, -0.6, 0.0011, 2.1], [0.1, 1.05, 0.0007, 4.4]];

export function buildWater(tracks) {
  const xi = XI - 0.0005, zi = ZI - 0.0005, depth = WATER_Y - G - 0.0005;
  const volume = material('Water_Volume', { color: srgb(0.35, 0.72, 0.78), roughness: 0.2, transparent: true, opacity: 0.1, depthWrite: false });
  const skin = material('Water_Surface', { color: srgb(0.62, 0.86, 0.92), roughness: 0.04, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });

  // The ripples live entirely in two morph targets a quarter period apart, so blending them
  // with cos/sin weights makes the wave trains travel. Over a flat base the normal of a
  // height field is linear in the height, which keeps the blended normals exact.
  const surface = grid(48, 18, (u, v, o) => o.p.set(lerp(-xi, xi, u), 0, lerp(-zi, zi, v)));
  surface.deleteAttribute('color');
  const pos = surface.attributes.position, count = pos.count;
  const up = new Float32Array(count * 3);
  const height = [new Float32Array(count * 3), new Float32Array(count * 3)];
  const slope = [new Float32Array(count * 3), new Float32Array(count * 3)];
  for (let i = 0; i < count; i++) {
    up[i * 3 + 1] = 1;
    for (const [wavelength, heading, a, phase] of WAVES) {
      const kx = (TAU / wavelength) * Math.cos(heading), kz = (TAU / wavelength) * Math.sin(heading);
      const th = kx * pos.getX(i) + kz * pos.getZ(i) + phase, s = Math.sin(th), c = Math.cos(th);
      // a sin(th - wt) = a sin(th) cos(wt) - a cos(th) sin(wt)
      height[0][i * 3 + 1] += a * s;
      height[1][i * 3 + 1] -= a * c;
      slope[0][i * 3] -= a * kx * c;
      slope[0][i * 3 + 2] -= a * kz * c;
      slope[1][i * 3] -= a * kx * s;
      slope[1][i * 3 + 2] -= a * kz * s;
    }
  }
  surface.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  surface.morphAttributes.position = height.map((d) => new THREE.BufferAttribute(d, 3));
  surface.morphAttributes.normal = slope.map((d) => new THREE.BufferAttribute(d, 3));
  surface.morphTargetsRelative = true;
  const top = mesh('Water_Surface', surface, skin, [0, WATER_Y, 0]);
  top.morphTargetInfluences[0] = 1; // a still frame keeps its ripples

  const CYCLES = 16, STEPS = 8;
  const times = [], weights = [];
  for (let i = 0; i <= CYCLES * STEPS; i++) {
    times.push((i / (CYCLES * STEPS)) * LOOP);
    weights.push(Math.cos((TAU * i) / STEPS), Math.sin((TAU * i) / STEPS));
  }
  tracks.push(new THREE.NumberKeyframeTrack('Water_Surface.morphTargetInfluences', times, weights));

  // The meniscus: water creeping a few millimetres up the glass all the way round.
  const rim = (ax, az, bx, bz) =>
    grid(1, 1, (u, v, o) => {
      const x = lerp(ax, bx, u), z = lerp(az, bz, u), inset = v === 0 ? 0.004 : 0;
      o.p.set(x - Math.sign(x) * inset, v === 0 ? 0 : 0.003, z - Math.sign(z) * inset);
    });
  const meniscus = merge([rim(-xi, zi, xi, zi), rim(xi, zi, xi, -zi), rim(xi, -zi, -xi, -zi), rim(-xi, -zi, -xi, zi)]);
  meniscus.deleteAttribute('color');
  meniscus.computeVertexNormals();

  return group(
    'Water',
    box('Water_Volume', [2 * xi, depth, 2 * zi], volume, [0, G + depth / 2, 0]),
    top,
    mesh('Water_Meniscus', meniscus, skin, [0, WATER_Y, 0]),
  );
}

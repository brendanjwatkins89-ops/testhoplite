// Procedural aquarium model, exported to GLB by scripts/export-glb.mjs.
// Units are metres, Y is up, the origin is the centre of the floor under the stand.
import * as THREE from 'three';
import { LOOP_SECONDS, STAND_H, group, rng } from './model/core.js';
import { buildBubbles, buildEquipment } from './model/equipment.js';
import { buildFish } from './model/fish.js';
import { MAT, buildLight, buildShell, buildStand } from './model/furniture.js';
import { PLANT_SPOTS, buildPlants } from './model/plants.js';
import { buildScape } from './model/scape.js';
import { grainNormalMap, stoneMaps, woodColorMap } from './model/textures.js';
import { buildWater } from './model/water.js';

export function buildAquarium() {
  const rand = rng(20261112);
  const tracks = [];
  const wood = woodColorMap();
  const tank = group(
    'Tank',
    buildShell(),
    buildLight(),
    ...buildScape(rand, PLANT_SPOTS, { grain: grainNormalMap(), stone: stoneMaps(), wood }),
    buildPlants(rand, tracks),
    buildEquipment(),
    buildFish(rand, tracks),
    buildBubbles(rand, tracks),
    buildWater(tracks),
  );
  tank.position.y = STAND_H + MAT;
  const root = group('Aquarium', buildStand(wood), tank);
  return { root, clip: new THREE.AnimationClip('Aquarium_Loop', LOOP_SECONDS, tracks) };
}

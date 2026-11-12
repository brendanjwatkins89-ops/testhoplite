import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const LAMP_DISTANCE = 6; // metres above the water, far enough that its rays are near parallel
const LAMP_RANGE = 3; // brightest value the lamp's 8-bit light pattern can hold, relative to plain light
// Materials that are all reflection, with how strongly each mirrors the room. Alpha blending
// would fade their highlights along with their tint, so here they add light instead.
const REFLECTIVE = { Glass: 0.8, Water_Surface: 1, Bubble: 1.5 };

const SCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Light through a rippled surface. Each wave train tilts the surface, which shifts where its
// light lands, and curves it, which squeezes or spreads that light. Where the sheet of light
// folds over itself it piles up into bright lines.
const CAUSTICS_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform vec2 extent; // metres covered by the whole pattern
  uniform vec2 pool; // half-size in metres of the lit rectangle
  varying vec2 vUv;

  void wave(vec2 p, float wavelength, float heading, float focus, float speed, inout vec2 shift, inout vec3 curve) {
    vec2 dir = vec2(cos(heading), sin(heading));
    float phase = dot(dir, p) * 6.2832 / wavelength - speed * time;
    shift += focus * wavelength / 6.2832 * cos(phase) * dir;
    curve += focus * sin(phase) * vec3(dir.x * dir.x, dir.y * dir.y, dir.x * dir.y);
  }

  // How far the light leaving the surface at p is spread out, and how far it is shifted.
  float spread(vec2 p, out vec2 shift) {
    shift = vec2(0.0);
    vec3 curve = vec3(0.0);
    wave(p, 0.16, 0.2, 0.42, 1.9, shift, curve);
    wave(p, 0.115, -0.75, 0.4, 2.6, shift, curve);
    wave(p, 0.085, 1.15, 0.36, -3.1, shift, curve);
    wave(p, 0.062, 2.4, 0.3, 3.7, shift, curve);
    wave(p, 0.047, -1.9, 0.24, -4.3, shift, curve);
    wave(p, 0.21, 1.7, 0.3, 1.4, shift, curve);
    return abs((1.0 + curve.x) * (1.0 + curve.y) - curve.z * curve.z);
  }

  void main() {
    vec2 target = (vUv - 0.5) * extent;
    // Walk back from a point on the sand to the patch of surface whose light lands there.
    vec2 shift;
    float thin = spread(target, shift);
    thin = spread(target + shift, shift);
    thin = spread(target + shift, shift);
    float light = 0.25 + 0.7 / (thin + 0.07);
    vec2 edge = smoothstep(pool, pool - 0.015, abs(target));
    gl_FragColor = vec4(vec3(min(light / ${LAMP_RANGE.toFixed(1)}, 1.0) * edge.x * edge.y), 1.0);
  }
`;

// A soft patch of shadow on the floor around the cabinet's footprint.
const FLOOR_VERTEX = /* glsl */ `
  varying vec2 vPoint;
  void main() {
    vPoint = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FLOOR_FRAGMENT = /* glsl */ `
  uniform vec2 footprint;
  varying vec2 vPoint;
  void main() {
    float away = length(max(abs(vPoint) - footprint, 0.0));
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.6 * exp(-away * 7.0));
  }
`;

// Renders the aquarium GLB into `container`. `source` is a URL or an ArrayBuffer.
export function createViewer(container, source) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = 'block';
  container.append(renderer.domElement);

  // A dim room: soft light from all round and one key light, so the tank's own lamp dominates.
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;
  const key = new THREE.DirectionalLight();
  key.intensity = 0.8;
  key.position.set(1.5, 2.5, 2.5);
  scene.add(key);

  // The tank's lamp: a narrow spot far overhead, masked to the water and carrying the ripple pattern.
  const caustics = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, extent: { value: new THREE.Vector2(1, 1) }, pool: { value: new THREE.Vector2() } },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: CAUSTICS_FRAGMENT,
  });
  const pattern = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false });
  const patternScene = new THREE.Scene().add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), caustics));
  const patternCamera = new THREE.Camera();
  const lamp = new THREE.SpotLight();
  lamp.intensity = 3.2 * LAMP_RANGE;
  lamp.decay = 0;
  lamp.map = pattern.texture;
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.radius = 3;
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.0015;
  lamp.visible = false;
  scene.add(lamp, lamp.target);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.55;
  controls.minDistance = 0.4;
  controls.maxDistance = 6;

  // Until the user takes over, the camera frames the tank and drifts from side to side.
  const focus = new THREE.Box3();
  let touched = false, time = 0;
  controls.addEventListener('start', () => {
    touched = true;
  });

  function frame() {
    if (touched || focus.isEmpty()) return;
    const size = focus.getSize(new THREE.Vector3()), centre = focus.getCenter(new THREE.Vector3());
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = 1.3 * Math.max(size.y / 2 / tan, size.x / 2 / (tan * camera.aspect)) + size.z / 2;
    const turn = 0.25 + 0.3 * Math.sin(time * 0.25);
    controls.target.copy(centre);
    camera.position.set(Math.sin(turn), 0.17, Math.cos(turn)).normalize().multiplyScalar(distance).add(centre);
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = container;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frame();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function lightTank(model) {
    // The lamp housing sits between this stand-in light and the water, so it must neither
    // block the light nor catch it: it is drawn as plain black.
    const housing = new THREE.MeshBasicMaterial();
    housing.color.setScalar(0.004);
    model.getObjectByName('Light')?.traverse((o) => {
      if (!o.isMesh || o.material.emissiveIntensity > 1) return;
      o.castShadow = false;
      o.material = housing;
    });
    const water = model.getObjectByName('Water_Volume');
    if (!water) return;
    const box = new THREE.Box3().setFromObject(water);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const reach = Math.hypot(size.x, size.z) / 2;
    lamp.position.set(centre.x, box.max.y + LAMP_DISTANCE, centre.z + 0.001);
    lamp.target.position.set(centre.x, box.min.y, centre.z);
    lamp.angle = Math.atan((reach * 1.05) / LAMP_DISTANCE);
    lamp.shadow.camera.near = LAMP_DISTANCE - 0.15;
    lamp.shadow.camera.far = LAMP_DISTANCE + size.y + 0.05;
    caustics.uniforms.extent.value.setScalar(2 * (LAMP_DISTANCE + size.y / 2) * Math.tan(lamp.angle));
    caustics.uniforms.pool.value.set(size.x / 2 - 0.004, size.z / 2 - 0.004);
    lamp.visible = true;
  }

  function groundShadow(model) {
    const stand = model.getObjectByName('Stand');
    if (!stand) return;
    const box = new THREE.Box3().setFromObject(stand);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const material = new THREE.ShaderMaterial({
      uniforms: { footprint: { value: new THREE.Vector2(size.x / 2, size.z / 2) } },
      vertexShader: FLOOR_VERTEX,
      fragmentShader: FLOOR_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 2, size.z + 2), material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centre.x, box.min.y + 0.001, centre.z);
    scene.add(floor);
  }

  let mixer = null, playing = true;
  const onLoad = (gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !o.material.transparent;
      o.receiveShadow = true;
      const mirror = REFLECTIVE[o.material.name];
      if (mirror === undefined) return;
      o.material.color.setScalar(0);
      o.material.opacity = 1;
      o.material.envMapIntensity = mirror;
      // Add colour without touching the canvas's alpha, so the page still shows through empty glass.
      o.material.blending = THREE.CustomBlending;
      o.material.blendSrc = o.material.blendDst = o.material.blendDstAlpha = THREE.OneFactor;
      o.material.blendSrcAlpha = THREE.ZeroFactor;
    });
    lightTank(gltf.scene);
    groundShadow(gltf.scene);
    scene.add(gltf.scene);
    focus.setFromObject(gltf.scene.getObjectByName('Tank') ?? gltf.scene);
    mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) mixer.clipAction(clip).play();
    frame();
    container.dataset.ready = 'true';
  };
  const onError = (error) => console.error('Failed to load the aquarium model', error);
  const loader = new GLTFLoader();
  if (typeof source === 'string') loader.load(source, onLoad, undefined, onError);
  else loader.parse(source, '', onLoad, onError);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (playing) {
      time += dt;
      mixer?.update(dt);
      frame();
    }
    controls.update();
    if (lamp.visible) {
      caustics.uniforms.time.value = time;
      renderer.setRenderTarget(pattern);
      renderer.render(patternScene, patternCamera);
      renderer.setRenderTarget(null);
    }
    renderer.render(scene, camera);
  });

  return {
    setPlaying(value) {
      playing = value;
    },
  };
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Renders the aquarium GLB into `container`. `source` is a URL or an ArrayBuffer.
export function createViewer(container, source) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;

  const sun = new THREE.DirectionalLight();
  sun.intensity = 2;
  sun.position.set(1.4, 3, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 8 });
  // Stands in for the tank's own lamp, which is only an emissive strip in the model.
  const lamp = new THREE.DirectionalLight();
  lamp.intensity = 1.1;
  lamp.position.set(0, 4, 0.3);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.ShadowMaterial({ opacity: 0.3 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(sun, lamp, floor);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.maxPolarAngle = Math.PI * 0.55;
  controls.minDistance = 0.4;
  controls.maxDistance = 6;

  // The camera keeps framing the tank until the user takes over.
  const focus = new THREE.Box3();
  let touched = false;
  controls.addEventListener('start', () => {
    touched = true;
    controls.autoRotate = false;
  });

  function frame() {
    if (focus.isEmpty()) return;
    const size = focus.getSize(new THREE.Vector3()), centre = focus.getCenter(new THREE.Vector3());
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = 1.3 * Math.max(size.y / 2 / tan, size.x / 2 / (tan * camera.aspect)) + size.z / 2;
    controls.target.copy(centre);
    camera.position.copy(centre).add(new THREE.Vector3(0.4, 0.18, 1).normalize().multiplyScalar(distance));
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = container;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!touched) frame();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let mixer = null, playing = true;
  const onLoad = (gltf) => {
    gltf.scene.traverse((o) => {
      if (o.isMesh) o.castShadow = !o.material.transparent;
    });
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
    if (playing) mixer?.update(dt);
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    setPlaying(value) {
      playing = value;
    },
  };
}

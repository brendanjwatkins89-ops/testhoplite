import modelUrl from '../models/aquarium.glb?url';
import { createViewer } from './viewer.js';

const viewer = createViewer(document.getElementById('view'), modelUrl);

document.getElementById('download').href = modelUrl;

const toggle = document.getElementById('toggle');
let playing = true;
toggle.addEventListener('click', () => {
  playing = !playing;
  viewer.setPlaying(playing);
  toggle.textContent = playing ? 'Пауза' : 'Пуск';
});

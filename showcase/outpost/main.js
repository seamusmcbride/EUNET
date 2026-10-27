import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const ARENA = 38; // half-width of the playable square

// ---------- Renderer, sky and lighting ----------
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x6a4a5a, 0.012);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 600);
camera.rotation.order = 'YXZ';

const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(86), THREE.MathUtils.degToRad(200));
const sky = new Sky();
sky.scale.setScalar(1000);
sky.material.uniforms.turbidity.value = 8;
sky.material.uniforms.rayleigh.value = 2.5;
sky.material.uniforms.mieCoefficient.value = 0.008;
sky.material.uniforms.mieDirectionalG.value = 0.85;
sky.material.uniforms.sunPosition.value.copy(sun);
scene.add(sky);

// Image-based lighting from the sky gives metals realistic reflections
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(sky.clone());
scene.environment = pmrem.fromScene(envScene, 0.04).texture;
scene.environmentIntensity = 0.6;

const sunLight = new THREE.DirectionalLight(0xffb27a, 3.2);
sunLight.position.copy(sun).multiplyScalar(80);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.04;
scene.add(sunLight);
scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x3a2418, 0.5));

// ---------- Procedural textures ----------
function canvasTex(size, draw, rep = 1, color = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 8;
  return t;
}
const groundMap = canvasTex(512, (ctx, s) => {
  ctx.fillStyle = '#5a4436'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    ctx.fillStyle = `rgba(${v > 0.5 ? '140,105,80' : '40,28,22'},${Math.random() * 0.25})`;
    const r = Math.random() * 6;
    ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2); ctx.fill();
  }
}, 24);
const groundRough = canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 3000; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`; ctx.fillRect(Math.random() * s, Math.random() * s, 3, 3); }
}, 24, false);
const panelMap = canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#6d747a'; ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#3c4247'; ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(s, i * 64); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, s); ctx.stroke();
  for (let i = 0; i < 1500; i++) { ctx.fillStyle = `rgba(30,20,10,${Math.random() * 0.15})`; ctx.fillRect(Math.random() * s, Math.random() * s, 2, 4); }
  ctx.fillStyle = '#e8a33a'; for (let x = 0; x < s; x += 32) { ctx.beginPath(); ctx.moveTo(x, s - 18); ctx.lineTo(x + 16, s - 18); ctx.lineTo(x + 6, s); ctx.lineTo(x - 10, s); ctx.fill(); }
});
const crateColors = ['#a2472e', '#2e6aa2', '#c9a02c', '#4d7d3a'];
const crateMaps = crateColors.map((col) => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = col; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#00000033'; for (let x = 8; x < s; x += 20) ctx.fillRect(x, 0, 8, s);
  ctx.strokeStyle = '#00000066'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, s - 10, s - 10);
  ctx.fillStyle = '#ffffffcc'; ctx.font = 'bold 36px sans-serif'; ctx.fillText('KS-' + ((Math.random() * 900 + 100) | 0), 24, 60);
  for (let i = 0; i < 800; i++) { ctx.fillStyle = `rgba(60,40,20,${Math.random() * 0.2})`; ctx.fillRect(Math.random() * s, Math.random() * s, 3, 3); }
}));

// ---------- World ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 1, 1),
  new THREE.MeshStandardMaterial({ map: groundMap, roughnessMap: groundRough, roughness: 1, metalness: 0 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const obstacles = []; // axis-aligned boxes {minX,maxX,minZ,maxZ,top}
function addBox(mesh, w, d, h) {
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  obstacles.push({ minX: mesh.position.x - w / 2, maxX: mesh.position.x + w / 2, minZ: mesh.position.z - d / 2, maxZ: mesh.position.z + d / 2, top: mesh.position.y + h / 2 });
}

// Shipping containers around the yard
const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
for (let i = 0; i < 22; i++) {
  const a = rng() * Math.PI * 2, r = 9 + rng() * 26;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  const along = rng() < 0.5;
  const w = along ? 6 : 2.4, d = along ? 2.4 : 6;
  const stack = rng() < 0.3 ? 2 : 1;
  for (let k = 0; k < stack; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, d),
      new THREE.MeshStandardMaterial({ map: crateMaps[(rng() * 4) | 0], roughness: 0.55, metalness: 0.5 }));
    m.position.set(x, 1.3 + k * 2.6, z);
    if (k === 0) addBox(m, w, d, 2.6 * stack); else { m.castShadow = m.receiveShadow = true; scene.add(m); }
  }
}

// Central reactor: the glowing heart of the outpost
const reactor = new THREE.Group();
const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 1.2, 40), new THREE.MeshStandardMaterial({ map: panelMap, metalness: 0.8, roughness: 0.35 }));
base.position.y = 0.6;
const core = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 5, 32), new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x3fe0ff, emissiveIntensity: 3, roughness: 0.2 }));
core.position.y = 3.6;
const rings = [];
for (let i = 0; i < 3; i++) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2 - i * 0.25, 0.12, 12, 64), new THREE.MeshStandardMaterial({ color: 0x9aa7b0, metalness: 1, roughness: 0.25 }));
  ring.position.y = 2.4 + i * 1.3; ring.rotation.x = Math.PI / 2;
  rings.push(ring); reactor.add(ring);
}
reactor.add(base, core);
reactor.traverse((o) => { o.castShadow = o.receiveShadow = true; });
core.castShadow = false;
scene.add(reactor);
obstacles.push({ minX: -3.6, maxX: 3.6, minZ: -3.6, maxZ: 3.6, top: 6 });
const reactorLight = new THREE.PointLight(0x3fe0ff, 60, 30, 1.6);
reactorLight.position.y = 4;
scene.add(reactorLight);

// Perimeter towers with blinking beacons, plus a fence of pylons
const beacons = [];
for (const [x, z] of [[-ARENA, -ARENA], [ARENA, -ARENA], [-ARENA, ARENA], [ARENA, ARENA]]) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1, 14, 8), new THREE.MeshStandardMaterial({ map: panelMap, metalness: 0.7, roughness: 0.4 }));
  t.position.set(x, 7, z);
  addBox(t, 2, 2, 14);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3020, emissiveIntensity: 4 }));
  b.position.set(x, 14.4, z);
  scene.add(b); beacons.push(b);
}
const pylonGeo = new THREE.BoxGeometry(0.3, 2.2, 0.3);
const pylonMat = new THREE.MeshStandardMaterial({ color: 0x2b3238, metalness: 0.8, roughness: 0.4, emissive: 0xff8a2a, emissiveIntensity: 0.0 });
const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, 4 * 38);
let pi = 0;
const pm = new THREE.Matrix4();
for (let i = 0; i < 38; i++) {
  const t = -ARENA + (i / 37) * ARENA * 2;
  for (const [x, z] of [[t, -ARENA], [t, ARENA], [-ARENA, t], [ARENA, t]]) pylons.setMatrixAt(pi++, pm.makeTranslation(x, 1.1, z));
}
pylons.castShadow = true;
scene.add(pylons);

// Distant mesas for a sense of scale
const mesaMat = new THREE.MeshStandardMaterial({ color: 0x6b3f2c, roughness: 1, flatShading: true });
for (let i = 0; i < 26; i++) {
  const a = (i / 26) * Math.PI * 2 + rng() * 0.2, r = 120 + rng() * 80;
  const h = 15 + rng() * 40;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(8 + rng() * 14, 14 + rng() * 20, h, 7), mesaMat);
  m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
  m.rotation.y = rng() * 3;
  scene.add(m);
}
// Boulders inside the arena
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a5440, roughness: 0.95, flatShading: true });
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(rockGeo, rockMat);
  const s = 0.3 + rng() * 0.9;
  m.scale.set(s * (1 + rng()), s, s * (1 + rng() * 0.5));
  m.position.set((rng() - 0.5) * ARENA * 1.9, s * 0.4, (rng() - 0.5) * ARENA * 1.9);
  if (Math.hypot(m.position.x, m.position.z) < 6) continue;
  m.rotation.set(rng(), rng() * 3, rng());
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}

// Drifting dust in the air
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(1500 * 3);
for (let i = 0; i < dustPos.length; i += 3) { dustPos[i] = (Math.random() - 0.5) * 90; dustPos[i + 1] = Math.random() * 12; dustPos[i + 2] = (Math.random() - 0.5) * 90; }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffd0a0, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false }));
scene.add(dust);

// ---------- Weapon (attached to the camera) ----------
const gun = new THREE.Group();
const gunMetal = new THREE.MeshStandardMaterial({ color: 0x2a3036, metalness: 0.9, roughness: 0.3 });
const gunLight = new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x3fe0ff, emissiveIntensity: 2.5 });
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.55), gunMetal);
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.42, 16), gunMetal);
barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.42);
const strip = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.015, 0.4), gunLight);
strip.position.set(0, 0.03, -0.02);
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), gunMetal);
grip.position.set(0, -0.11, 0.12); grip.rotation.x = 0.3;
const coil = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 24), gunLight);
coil.position.set(0, 0.02, -0.3);
gun.add(gunBody, barrel, strip, grip, coil);
gun.scale.setScalar(0.6);
camera.add(gun);
scene.add(camera);
const muzzle = new THREE.PointLight(0x4fe3ff, 0, 8, 2);
muzzle.position.set(0.22, -0.16, -1.0);
camera.add(muzzle);

// ---------- Effects: tracers, sparks, explosions ----------
const effects = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0x9ff4ff, transparent: true });
function tracer(from, to) {
  const g = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(g, tracerMat.clone());
  scene.add(line);
  effects.push({ obj: line, life: 0.08, max: 0.08, kind: 'fade' });
}
function burst(pos, color, count, speed, life) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3), v = [];
  for (let i = 0; i < count; i++) {
    p.set([pos.x, pos.y, pos.z], i * 3);
    v.push(new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random())));
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(pts);
  effects.push({ obj: pts, life, max: life, kind: 'burst', v });
}
function explosion(pos) {
  burst(pos, 0xffa040, 120, 9, 0.9);
  burst(pos, 0x4fe3ff, 40, 5, 0.6);
  const flash = new THREE.PointLight(0xffa040, 120, 20, 2);
  flash.position.copy(pos);
  scene.add(flash);
  effects.push({ obj: flash, life: 0.35, max: 0.35, kind: 'light', peak: 120 });
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.5, 32), new THREE.MeshBasicMaterial({ color: 0xffc080, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  shock.position.copy(pos); shock.lookAt(camera.position);
  scene.add(shock);
  effects.push({ obj: shock, life: 0.4, max: 0.4, kind: 'ring' });
}

// ---------- Drones ----------
const droneBodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 1, roughness: 0.25 });
const droneEyeMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 5 });
const droneRingMat = new THREE.MeshStandardMaterial({ color: 0x8a939c, metalness: 1, roughness: 0.35 });
function makeDrone(heavy) {
  const g = new THREE.Group();
  const s = heavy ? 1.4 : 1;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5 * s, 32, 24), droneBodyMat);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s, 16, 16), droneEyeMat);
  eye.position.z = 0.42 * s;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75 * s, 0.06 * s, 10, 48), droneRingMat);
  ring.rotation.x = Math.PI / 2;
  const fins = [];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.5 * s, 0.25 * s), droneBodyMat);
    f.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.5 * s, -0.35 * s, Math.sin((i / 3) * Math.PI * 2) * 0.5 * s);
    fins.push(f); g.add(f);
  }
  g.add(body, eye, ring);
  g.traverse((o) => { o.castShadow = true; });
  return { group: g, ring, radius: 0.75 * s };
}

const bolts = [];
const boltGeo = new THREE.SphereGeometry(0.12, 10, 10);
const boltMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3a20, emissiveIntensity: 6 });

// ---------- Game state ----------
const player = { pos: new THREE.Vector3(0, 0, 14), vy: 0, yaw: 0, pitch: 0, hp: 100, energy: 100, cooldown: 0, onGround: true, recoil: 0, hurt: 0 };
let drones = [], wave = 0, score = 0, running = false, waveTimer = 0, betweenWaves = false;
const $ = (id) => document.getElementById(id);

function spawnWave() {
  wave++;
  const count = 3 + wave * 2;
  for (let i = 0; i < count; i++) {
    const heavy = wave > 1 && i % 4 === 3;
    const d = makeDrone(heavy);
    const a = Math.random() * Math.PI * 2, r = ARENA + 6 + Math.random() * 10;
    d.group.position.set(Math.cos(a) * r, 4 + Math.random() * 4, Math.sin(a) * r);
    scene.add(d.group);
    drones.push({ ...d, heavy, hp: heavy ? 6 : 3, speed: (heavy ? 3 : 5) + wave * 0.25, fireCd: 2 + Math.random() * 2, phase: Math.random() * 10, strafe: Math.random() < 0.5 ? 1 : -1 });
  }
  showBanner(`WAVE ${wave}`);
  hud();
}
function reset() {
  drones.forEach((d) => scene.remove(d.group)); drones = [];
  bolts.forEach((b) => scene.remove(b.mesh)); bolts.length = 0;
  Object.assign(player, { hp: 100, energy: 100, cooldown: 0, vy: 0, yaw: 0, pitch: 0, hurt: 0 });
  player.pos.set(0, 0, 14);
  wave = 0; score = 0; betweenWaves = false;
  spawnWave();
}

let bannerTimer;
function showBanner(text) {
  const b = $('banner'); b.textContent = text; b.style.opacity = 1;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.style.opacity = 0), 1600);
}
function hud() {
  $('wave').textContent = wave; $('score').textContent = score.toLocaleString(); $('left').textContent = drones.length;
  $('hpText').textContent = Math.ceil(player.hp); $('hpFill').style.width = player.hp + '%';
  $('hpGauge').classList.toggle('low', player.hp < 30);
  $('enText').textContent = Math.floor(player.energy); $('enFill').style.width = player.energy + '%';
}

// ---------- Audio ----------
let audio;
function sfx(type) {
  if (!audio) return;
  const t = audio.currentTime, g = audio.createGain();
  g.connect(audio.destination);
  if (type === 'boom') {
    const buf = audio.createBuffer(1, audio.sampleRate * 0.8, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
    const src = audio.createBufferSource(); src.buffer = buf;
    const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    src.connect(f); f.connect(g); g.gain.value = 0.5; src.start(t);
    return;
  }
  const o = audio.createOscillator();
  const [type_, f0, f1, len, vol] = { zap: ['sawtooth', 1400, 180, 0.14, 0.12], hit: ['square', 900, 1200, 0.05, 0.08], hurt: ['triangle', 200, 80, 0.25, 0.25], enemy: ['sine', 700, 300, 0.2, 0.06] }[type];
  o.type = type_; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g); o.start(t); o.stop(t + len);
}

// ---------- Input ----------
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
const canvas = renderer.domElement;
let locked = false, dragLook = null, mouseDown = false;
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
function lockPointer() {
  if (matchMedia('(pointer: coarse)').matches) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* fall back to drag-to-look */ }
}
function look(dx, dy) {
  // Chrome sometimes reports a huge jump on the first event after pointer lock; drop it
  if (Math.abs(dx) > 250 || Math.abs(dy) > 250) return;
  player.yaw -= dx * 0.0022;
  player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch - dy * 0.0022));
}
addEventListener('mousemove', (e) => {
  if (!running) return;
  if (locked) look(e.movementX, e.movementY);
  else if (dragLook) { look(e.clientX - dragLook.x, e.clientY - dragLook.y); dragLook = { x: e.clientX, y: e.clientY }; }
});
canvas.addEventListener('mousedown', (e) => {
  if (!running || e.button !== 0) return;
  if (!locked) { lockPointer(); dragLook = { x: e.clientX, y: e.clientY }; }
  mouseDown = true;
});
addEventListener('mouseup', () => { mouseDown = false; dragLook = null; });

const touch = { move: null, look: null, mx: 0, mz: 0, firing: false };
canvas.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2 && !touch.move) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY };
    else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) {
      touch.mx = Math.max(-1, Math.min(1, (t.clientX - touch.move.x) / 50));
      touch.mz = Math.max(-1, Math.min(1, (t.clientY - touch.move.y) / 50));
    } else if (touch.look && t.identifier === touch.look.id) {
      look((t.clientX - touch.look.x) * 2, (t.clientY - touch.look.y) * 2);
      touch.look.x = t.clientX; touch.look.y = t.clientY;
    }
  }
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.mz = 0; }
    if (touch.look && t.identifier === touch.look.id) touch.look = null;
  }
});
const fireBtn = $('fireBtn');
fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); touch.firing = true; });
fireBtn.addEventListener('touchend', () => { touch.firing = false; });

// ---------- Combat ----------
const raycaster = new THREE.Raycaster();
const stats = { shots: 0 };
const tmp = new THREE.Vector3();
function fire() {
  if (player.cooldown > 0 || player.energy < 6) return;
  player.cooldown = 0.14; player.energy -= 6; player.recoil = 1;
  muzzle.intensity = 30;
  sfx('zap');
  raycaster.setFromCamera({ x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01 }, camera);
  const targets = drones.map((d) => d.group);
  const solids = [ground, reactor, ...scene.children.filter((o) => o.isMesh && o.castShadow && o !== ground)];
  const hits = raycaster.intersectObjects([...targets, ...solids], true);
  stats.shots++;
  const start = new THREE.Vector3(0.2, -0.17, -0.85).applyMatrix4(camera.matrixWorld);
  let end = raycaster.ray.at(120, tmp.clone());
  if (hits.length) {
    end = hits[0].point;
    const drone = drones.find((d) => d.group === hits[0].object.parent || d.group === hits[0].object);
    if (drone) {
      drone.hp--;
      burst(end, 0x9ff4ff, 18, 4, 0.3);
      sfx('hit');
      $('cross').classList.add('hit'); setTimeout(() => $('cross').classList.remove('hit'), 90);
      if (drone.hp <= 0) killDrone(drone);
    } else {
      burst(end, 0xffc070, 10, 3, 0.25);
    }
  }
  tracer(start, end);
}
function killDrone(d) {
  explosion(d.group.position.clone());
  sfx('boom');
  scene.remove(d.group);
  drones = drones.filter((x) => x !== d);
  score += d.heavy ? 250 : 100;
  hud();
  if (!drones.length) { betweenWaves = true; waveTimer = 3; showBanner('WAVE CLEARED'); player.hp = Math.min(100, player.hp + 25); }
}
function damage(n) {
  player.hp -= n; player.hurt = 1; sfx('hurt'); hud();
  if (player.hp <= 0) gameOver();
}

function collide(pos, r) {
  pos.x = Math.max(-ARENA + 1, Math.min(ARENA - 1, pos.x));
  pos.z = Math.max(-ARENA + 1, Math.min(ARENA - 1, pos.z));
  for (const b of obstacles) {
    if (pos.y > b.top - 0.1) continue;
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX)), cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
    if (d < r) {
      if (d === 0) { pos.x += r; continue; }
      pos.x = cx + (dx / d) * r; pos.z = cz + (dz / d) * r;
    }
  }
}

// ---------- Flow ----------
function begin() {
  try { audio = audio || new AudioContext(); audio.resume(); } catch { audio = null; }
  reset();
  $('start').hidden = true; $('end').hidden = true;
  running = true;
  lockPointer();
}
function gameOver() {
  running = false;
  if (document.exitPointerLock) document.exitPointerLock();
  $('endText').textContent = `You held out to wave ${wave} with ${score.toLocaleString()} points.`;
  $('end').hidden = false;
}
$('play').onclick = begin;
$('again').onclick = begin;

// ---------- Post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Main loop ----------
const clock = new THREE.Clock();
let bob = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

  if (running) {
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.6 : 1;
    let f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - touch.mz;
    let r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + touch.mx;
    if (keys.has('ArrowLeft')) player.yaw += 2.2 * dt;
    if (keys.has('ArrowRight')) player.yaw -= 2.2 * dt;
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    const sp = 7 * sprint * dt, sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    player.pos.x += (-sin * f + cos * r) * sp;
    player.pos.z += (-cos * f - sin * r) * sp;
    if (len > 0.05 && player.onGround) bob += dt * 10 * sprint;
    if (keys.has('Space') && player.onGround) { player.vy = 6; player.onGround = false; }
    player.vy -= 18 * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.vy = 0; player.onGround = true; }
    collide(player.pos, 0.5);

    player.cooldown = Math.max(0, player.cooldown - dt);
    player.energy = Math.min(100, player.energy + dt * 22);
    if (mouseDown || touch.firing) fire();

    for (const d of drones) {
      const p = d.group.position;
      const toPlayer = tmp.set(player.pos.x - p.x, player.pos.y + 1.6 - p.y, player.pos.z - p.z);
      const dist = toPlayer.length();
      toPlayer.normalize();
      // Close in to ~12 m, then circle and keep height
      const desired = dist > 12 ? 1 : dist < 7 ? -0.6 : 0;
      p.addScaledVector(toPlayer, desired * d.speed * dt);
      const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(d.strafe * d.speed * 0.5 * dt);
      p.add(side);
      p.y += (3.5 + Math.sin(t * 1.5 + d.phase) * 1.2 - p.y) * dt;
      d.group.lookAt(player.pos.x, player.pos.y + 1.6, player.pos.z);
      d.ring.rotation.z += dt * 4;
      d.fireCd -= dt;
      if (d.fireCd <= 0 && dist < 40) {
        d.fireCd = (d.heavy ? 1.6 : 2.4) + Math.random() * 1.5 - Math.min(wave * 0.1, 0.8);
        const m = new THREE.Mesh(boltGeo, boltMat);
        m.position.copy(p);
        scene.add(m);
        const aim = new THREE.Vector3(player.pos.x, player.pos.y + 1.4, player.pos.z).sub(p).normalize();
        bolts.push({ mesh: m, vel: aim.multiplyScalar(d.heavy ? 16 : 20), life: 4, dmg: d.heavy ? 18 : 9 });
        sfx('enemy');
      }
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      const bp = b.mesh.position;
      const hitPlayer = Math.hypot(bp.x - player.pos.x, bp.z - player.pos.z) < 0.6 && bp.y > player.pos.y && bp.y < player.pos.y + 2;
      if (hitPlayer) damage(b.dmg);
      const blocked = obstacles.some((o) => bp.x > o.minX && bp.x < o.maxX && bp.z > o.minZ && bp.z < o.maxZ && bp.y < o.top);
      if (hitPlayer || blocked || b.life <= 0 || bp.y < 0.05) {
        if (!hitPlayer) burst(bp.clone(), 0xff6a3a, 12, 3, 0.3);
        scene.remove(b.mesh); bolts.splice(i, 1);
      }
    }
    if (betweenWaves && (waveTimer -= dt) <= 0) { betweenWaves = false; spawnWave(); }
    hud();
  } else {
    // Slow orbit behind the menus
    player.yaw = t * 0.08; player.pitch = -0.08;
    player.pos.set(Math.sin(t * 0.08) * 22, 2, Math.cos(t * 0.08) * 22);
  }

  // Camera and weapon motion
  const bobY = Math.sin(bob) * 0.04, bobX = Math.cos(bob * 0.5) * 0.03;
  camera.position.set(player.pos.x, player.pos.y + 1.6 + (running ? bobY : 0), player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  player.recoil = Math.max(0, player.recoil - dt * 8);
  gun.position.set(0.2 + bobX, -0.19 + bobY * 0.5, -0.5 + player.recoil * 0.05);
  gun.rotation.x = player.recoil * 0.08;
  gun.visible = running;
  muzzle.intensity = Math.max(0, muzzle.intensity - dt * 400);
  player.hurt = Math.max(0, player.hurt - dt * 1.8);
  $('dmg').style.opacity = player.hurt * 0.8;

  // Ambient animation
  rings.forEach((r, i) => { r.rotation.z = t * (0.6 + i * 0.4) * (i % 2 ? -1 : 1); r.rotation.x = Math.PI / 2 + Math.sin(t + i) * 0.15; });
  core.material.emissiveIntensity = 2.5 + Math.sin(t * 3) * 0.8;
  reactorLight.intensity = 50 + Math.sin(t * 3) * 15;
  beacons.forEach((b, i) => { b.material.emissiveIntensity = (Math.sin(t * 4 + i) > 0.6) ? 6 : 0.3; });
  dust.rotation.y = t * 0.01;

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    const k = Math.max(0, e.life / e.max);
    if (e.kind === 'burst') {
      const arr = e.obj.geometry.attributes.position.array;
      e.v.forEach((v, j) => { v.y -= 9 * dt; arr[j * 3] += v.x * dt; arr[j * 3 + 1] += v.y * dt; arr[j * 3 + 2] += v.z * dt; });
      e.obj.geometry.attributes.position.needsUpdate = true;
      e.obj.material.opacity = k;
    } else if (e.kind === 'light') e.obj.intensity = e.peak * k;
    else if (e.kind === 'ring') { e.obj.scale.setScalar(1 + (1 - k) * 14); e.obj.material.opacity = k; }
    else e.obj.material.opacity = k;
    if (e.life <= 0) { scene.remove(e.obj); e.obj.geometry?.dispose(); effects.splice(i, 1); }
  }

  // Keep the sun's shadow box centred on the player
  sunLight.position.copy(sun).multiplyScalar(80).add(player.pos);
  sunLight.target.position.copy(player.pos);
  sunLight.target.updateMatrixWorld();

  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Read-only stats for automated tests
window.__outpost = { get state() { return {
  running, wave, score, hp: player.hp, shots: stats.shots, drones: drones.length, yaw: player.yaw, pitch: player.pitch,
  eye: player.pos.toArray(), targets: drones.map((d) => d.group.position.toArray()),
}; } };

import * as THREE from 'three';

// Level layout: # wall, . floor, P player start, E enemy, B brute (tougher enemy),
// H health, A shells, X exit pad
const MAP = [
  '########################',
  '#P..#......#.....#.....#',
  '#...#..E...#..A..#..E..#',
  '#...#......#.....#.....#',
  '#.......####..E......B.#',
  '#...#......#.....#.....#',
  '##.###.....###.###.....#',
  '#.....#....#.....####.##',
  '#..E..#.H..#..E.....#..#',
  '#.....#....#........#..#',
  '#..A.......####..####.E#',
  '#.....#....#..........##',
  '###.###.E..#..H...B....#',
  '#.......#..#...........#',
  '#..E....#..######.######',
  '#.......#..#...A.....E.#',
  '#H...B.....#....##.....#',
  '#.......#..#..E.##..X..#',
  '########################',
];
const W = MAP[0].length, D = MAP.length;
const isWall = (x, z) => x < 0 || z < 0 || x >= W || z >= D || MAP[z | 0][x | 0] === '#';

// ---------- Procedural textures (all drawn here, no image files) ----------
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}
const noise = (ctx, s, n, a) => { for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * a})`; ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2); } };
const wallTex = canvasTex(128, (ctx, s) => {
  ctx.fillStyle = '#5a3a28'; ctx.fillRect(0, 0, s, s);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 4; col++) {
    const off = row % 2 ? 16 : 0, x = col * 32 + off, y = row * 16;
    const v = 70 + Math.random() * 30;
    ctx.fillStyle = `rgb(${v + 40},${v * 0.6},${v * 0.4})`;
    ctx.fillRect(x + 1, y + 1, 30, 14); ctx.fillRect(x - 127, y + 1, 30, 14);
  }
  noise(ctx, s, 1500, 0.35);
  ctx.fillStyle = '#2a1a12'; ctx.fillRect(0, 118, s, 10);
  ctx.fillStyle = '#c8a040'; for (let x = 4; x < s; x += 16) ctx.fillRect(x, 120, 6, 6);
});
const floorTex = canvasTex(128, (ctx, s) => {
  ctx.fillStyle = '#2b2622'; ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#3a332c' : '#332d27'; ctx.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
  }
  noise(ctx, s, 2000, 0.4);
}, W);
const ceilTex = canvasTex(64, (ctx, s) => {
  ctx.fillStyle = '#1c1816'; ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#2c2622'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, s - 4, s - 4);
  noise(ctx, s, 400, 0.5);
}, W);

// Enemy sprites: frames drawn once, swapped per state
function monsterFrame(kind, state) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const body = kind === 'brute' ? '#5b7d2a' : '#a8321e';
  const dark = kind === 'brute' ? '#2f4512' : '#5a140a';
  if (state === 'dead') {
    ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(64, 116, 50, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(64, 110, 38, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe9a0'; ctx.fillRect(40, 106, 6, 4); ctx.fillRect(80, 104, 6, 4);
  } else {
    const flash = state === 'hurt';
    const lift = state === 'attack' ? -6 : 0;
    ctx.fillStyle = flash ? '#fff' : dark;
    ctx.fillRect(36, 92, 18, 34); ctx.fillRect(74, 92, 18, 34); // legs
    ctx.fillStyle = flash ? '#fff' : body;
    ctx.beginPath(); ctx.ellipse(64, 70 + lift, 36, 34, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(64, 34 + lift, 26, 24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash ? '#ddd' : '#e8d8b0'; // horns
    ctx.beginPath(); ctx.moveTo(42, 22 + lift); ctx.lineTo(30, -2 + lift); ctx.lineTo(50, 16 + lift); ctx.fill();
    ctx.beginPath(); ctx.moveTo(86, 22 + lift); ctx.lineTo(98, -2 + lift); ctx.lineTo(78, 16 + lift); ctx.fill();
    ctx.fillStyle = state === 'attack' ? '#fff27a' : '#ffcc00'; // eyes
    ctx.fillRect(48, 28 + lift, 10, 7); ctx.fillRect(70, 28 + lift, 10, 7);
    ctx.fillStyle = '#1a0503'; ctx.fillRect(52, 44 + lift, 24, state === 'attack' ? 12 : 5); // mouth
    ctx.fillStyle = flash ? '#fff' : body; // arms
    const armY = state === 'attack' ? 40 : 66;
    ctx.fillRect(14, armY, 18, 12); ctx.fillRect(96, armY, 18, 12);
    if (state === 'attack') { ctx.fillStyle = '#ff8a1e'; ctx.beginPath(); ctx.arc(64, 70, 12, 0, Math.PI * 2); ctx.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}
const FRAMES = {};
for (const kind of ['imp', 'brute']) {
  FRAMES[kind] = {};
  for (const st of ['idle', 'hurt', 'attack', 'dead']) FRAMES[kind][st] = monsterFrame(kind, st);
}
function pickupTex(kind) {
  return canvasTex(64, (ctx) => {
    if (kind === 'H') {
      ctx.fillStyle = '#eee'; ctx.fillRect(10, 18, 44, 34);
      ctx.fillStyle = '#d01818'; ctx.fillRect(28, 22, 8, 26); ctx.fillRect(19, 31, 26, 8);
    } else {
      ctx.fillStyle = '#6b4a1e'; ctx.fillRect(8, 26, 48, 26);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = '#c42a1a'; ctx.fillRect(12 + i * 11, 14, 8, 16); ctx.fillStyle = '#d4a640'; ctx.fillRect(12 + i * 11, 26, 8, 5); }
    }
  });
}

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0806);
scene.fog = new THREE.Fog(0x0c0806, 2, 15);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 50);
camera.rotation.order = 'YXZ';

const wallGeo = new THREE.BoxGeometry(1, 1.6, 1);
const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
let wallCount = 0;
MAP.forEach((row) => [...row].forEach((c) => { if (c === '#') wallCount++; }));
const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
const m4 = new THREE.Matrix4();
let wi = 0;
MAP.forEach((row, z) => [...row].forEach((c, x) => { if (c === '#') walls.setMatrixAt(wi++, m4.makeTranslation(x + 0.5, 0.8, z + 0.5)); }));
scene.add(walls);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: floorTex }));
floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, D / 2);
floorTex.repeat.set(W, D);
scene.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: ceilTex }));
ceil.rotation.x = Math.PI / 2; ceil.position.set(W / 2, 1.6, D / 2);
ceilTex.repeat.set(W, D);
scene.add(ceil);

scene.add(new THREE.AmbientLight(0x6a4a3a, 0.9));
const torch = new THREE.PointLight(0xffc89a, 14, 9, 1.6);
scene.add(torch);
const muzzleLight = new THREE.PointLight(0xffb040, 0, 6, 1.5);
scene.add(muzzleLight);
// A few red ceiling lamps for mood
[[5, 8], [14, 4], [3, 15], [20, 12], [14, 16]].forEach(([x, z]) => {
  const l = new THREE.PointLight(0xff3a20, 6, 6, 1.8); l.position.set(x + 0.5, 1.4, z + 0.5); scene.add(l);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0xff5a3a })); bulb.position.copy(l.position); scene.add(bulb);
});

// ---------- Game state ----------
const player = { x: 0, z: 0, yaw: 0, pitch: 0, hp: 100, ammo: 20, bob: 0, recoil: 0, cooldown: 0, hurt: 0, kills: 0, alive: true };
let enemies = [], pickups = [], shots = [], exitPos, running = false, startTime = 0;

function setupLevel() {
  enemies.forEach((e) => scene.remove(e.sprite));
  pickups.forEach((p) => scene.remove(p.sprite));
  shots.forEach((s) => scene.remove(s.mesh));
  enemies = []; pickups = []; shots = [];
  Object.assign(player, { hp: 100, ammo: 20, kills: 0, alive: true, hurt: 0, cooldown: 0, recoil: 0, pitch: 0 });
  MAP.forEach((row, z) => [...row].forEach((c, x) => {
    const cx = x + 0.5, cz = z + 0.5;
    if (c === 'P') { player.x = cx; player.z = cz; player.yaw = -Math.PI * 0.75; }
    if (c === 'E' || c === 'B') {
      const kind = c === 'B' ? 'brute' : 'imp';
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: FRAMES[kind].idle, transparent: true, alphaTest: 0.5 }));
      const size = kind === 'brute' ? 1.3 : 1.05;
      sprite.scale.set(size, size, 1); sprite.position.set(cx, size / 2, cz);
      scene.add(sprite);
      enemies.push({ kind, sprite, x: cx, z: cz, hp: kind === 'brute' ? 9 : 4, state: 'idle', timer: 0, attackCd: 1 + Math.random(), awake: false, speed: kind === 'brute' ? 1.3 : 1.9, size });
    }
    if (c === 'H' || c === 'A') {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: pickupTex(c), transparent: true, alphaTest: 0.5 }));
      sprite.scale.set(0.45, 0.45, 1); sprite.position.set(cx, 0.22, cz);
      scene.add(sprite);
      pickups.push({ kind: c, sprite, x: cx, z: cz });
    }
    if (c === 'X') exitPos = { x: cx, z: cz };
  }));
  if (!scene.getObjectByName('exit')) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0x30ff70 }));
    pad.name = 'exit'; pad.rotation.x = -Math.PI / 2; pad.position.set(exitPos.x, 0.01, exitPos.z);
    scene.add(pad);
    const glow = new THREE.PointLight(0x30ff70, 8, 4); glow.position.set(exitPos.x, 0.5, exitPos.z); scene.add(glow);
  }
  updateHud();
}

// Line of sight: step along the segment checking wall cells
function canSee(ax, az, bx, bz) {
  const dist = Math.hypot(bx - ax, bz - az), steps = Math.ceil(dist / 0.1);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWall(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}
// Move with separate x/z checks so you slide along walls
function tryMove(o, dx, dz, r) {
  const nx = o.x + dx;
  if (!isWall(nx + Math.sign(dx) * r, o.z - r * 0.7) && !isWall(nx + Math.sign(dx) * r, o.z + r * 0.7)) o.x = nx;
  const nz = o.z + dz;
  if (!isWall(o.x - r * 0.7, nz + Math.sign(dz) * r) && !isWall(o.x + r * 0.7, nz + Math.sign(dz) * r)) o.z = nz;
}

// ---------- Audio (synthesised, starts after the first click) ----------
let audio;
function sfx(type) {
  if (!audio) return;
  const t = audio.currentTime, g = audio.createGain();
  g.connect(audio.destination);
  if (type === 'shot' || type === 'boom') {
    const len = type === 'shot' ? 0.35 : 0.5;
    const buf = audio.createBuffer(1, audio.sampleRate * len, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = audio.createBufferSource(); src.buffer = buf;
    const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = type === 'shot' ? 1800 : 600;
    src.connect(f); f.connect(g); g.gain.value = type === 'shot' ? 0.6 : 0.4; src.start(t);
  } else {
    const o = audio.createOscillator();
    const cfg = { hurt: ['sawtooth', 160, 60, 0.25], growl: ['sawtooth', 90, 50, 0.4], pickup: ['square', 520, 880, 0.15], die: ['sawtooth', 220, 40, 0.6], click: ['square', 1200, 900, 0.05] }[type];
    o.type = cfg[0]; o.frequency.setValueAtTime(cfg[1], t); o.frequency.exponentialRampToValueAtTime(cfg[2], t + cfg[3]);
    g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + cfg[3]);
    o.connect(g); o.start(t); o.stop(t + cfg[3]);
  }
}

// ---------- Input ----------
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); fire(); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
const gl = renderer.domElement;
let locked = false, dragLook = null;
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === gl; });
function lockPointer() {
  if (matchMedia('(pointer: coarse)').matches) return;
  try { const p = gl.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* drag-to-look fallback */ }
}
addEventListener('mousemove', (e) => {
  if (!running) return;
  if (locked) look(e.movementX, e.movementY);
  else if (dragLook) { look(e.clientX - dragLook.x, e.clientY - dragLook.y); dragLook = { x: e.clientX, y: e.clientY }; }
});
function look(dx, dy) {
  player.yaw -= dx * 0.0025;
  player.pitch = Math.max(-0.5, Math.min(0.5, player.pitch - dy * 0.0018));
}
gl.addEventListener('mousedown', (e) => {
  if (!running || e.button !== 0) return;
  if (!locked) { lockPointer(); dragLook = { x: e.clientX, y: e.clientY }; }
  fire();
});
addEventListener('mouseup', () => { dragLook = null; });

// Touch: left half is a joystick, right half turns
const touch = { move: null, look: null, mx: 0, mz: 0 };
gl.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2 && !touch.move) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY };
    else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
}, { passive: true });
gl.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) {
      touch.mx = Math.max(-1, Math.min(1, (t.clientX - touch.move.x) / 50));
      touch.mz = Math.max(-1, Math.min(1, (t.clientY - touch.move.y) / 50));
    } else if (touch.look && t.identifier === touch.look.id) {
      look((t.clientX - touch.look.x) * 2.2, (t.clientY - touch.look.y) * 1.5);
      touch.look.x = t.clientX; touch.look.y = t.clientY;
    }
  }
}, { passive: true });
gl.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.mz = 0; }
    if (touch.look && t.identifier === touch.look.id) touch.look = null;
  }
});
document.getElementById('fireBtn').addEventListener('touchstart', (e) => { e.preventDefault(); fire(); });

// ---------- Combat ----------
function fire() {
  if (!running || player.cooldown > 0) return;
  if (player.ammo <= 0) { sfx('click'); flashMsg('Out of shells'); player.cooldown = 0.3; return; }
  player.ammo--; player.cooldown = 0.75; player.recoil = 1;
  muzzleLight.intensity = 25;
  sfx('shot');
  // Shotgun: 7 pellets in a spread, each hits the nearest enemy along its line
  const fwd = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
  for (let p = 0; p < 7; p++) {
    const spread = (Math.random() - 0.5) * 0.12;
    const dir = { x: fwd.x * Math.cos(spread) - fwd.z * Math.sin(spread), z: fwd.x * Math.sin(spread) + fwd.z * Math.cos(spread) };
    let best = null, bestT = Infinity;
    for (const e of enemies) {
      if (e.state === 'dead') continue;
      const ex = e.x - player.x, ez = e.z - player.z;
      const t = ex * dir.x + ez * dir.z;
      if (t <= 0 || t > 20) continue;
      const miss = Math.abs(ex * dir.z - ez * dir.x);
      if (miss < e.size * 0.35 && t < bestT && canSee(player.x, player.z, e.x, e.z)) { best = e; bestT = t; }
    }
    if (best) hit(best, bestT < 3 ? 1.5 : 1);
  }
  // The noise wakes every enemy that can see you
  enemies.forEach((e) => { if (canSee(e.x, e.z, player.x, player.z)) e.awake = true; });
}
function hit(e, dmg) {
  e.hp -= dmg; e.awake = true;
  if (e.hp <= 0 && e.state !== 'dead') {
    e.state = 'dead'; e.sprite.material.map = FRAMES[e.kind].dead;
    e.sprite.position.y = e.size / 2 - 0.02;
    player.kills++; sfx('die'); updateHud();
    if (player.kills === enemies.length) flashMsg('Bunker cleared. Get to the exit.');
  } else if (e.state !== 'dead') { e.state = 'hurt'; e.timer = 0.15; }
}
function damagePlayer(n) {
  if (!player.alive) return;
  player.hp = Math.max(0, player.hp - n); player.hurt = 1; sfx('hurt'); updateHud();
  if (player.hp <= 0) { player.alive = false; end(false); }
}

const fireballGeo = new THREE.SphereGeometry(0.1, 8, 8);
function spawnFireball(e) {
  const mesh = new THREE.Mesh(fireballGeo, new THREE.MeshBasicMaterial({ color: e.kind === 'brute' ? 0x80ff40 : 0xff7a20 }));
  mesh.position.set(e.x, 0.75, e.z);
  scene.add(mesh);
  const dx = player.x - e.x, dz = player.z - e.z, len = Math.hypot(dx, dz);
  const speed = e.kind === 'brute' ? 4 : 5.5;
  shots.push({ mesh, x: e.x, z: e.z, vx: (dx / len) * speed, vz: (dz / len) * speed, dmg: e.kind === 'brute' ? 20 : 10, life: 4 });
  sfx('growl');
}

// ---------- HUD (weapon + crosshair + damage) ----------
const hud = document.getElementById('hud');
const hctx = hud.getContext('2d');
function drawWeapon(dt, moving) {
  const w = hud.width, h = hud.height, s = Math.min(w, h * 1.4) / 900;
  hctx.clearRect(0, 0, w, h);
  if (player.hurt > 0) {
    const g = hctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.8);
    g.addColorStop(0, 'rgba(200,0,0,0)'); g.addColorStop(1, `rgba(200,0,0,${player.hurt * 0.6})`);
    hctx.fillStyle = g; hctx.fillRect(0, 0, w, h);
  }
  if (!running) return;
  hctx.strokeStyle = '#ffe9b0cc'; hctx.lineWidth = 2 * s;
  const cx = w / 2, cy = h / 2;
  hctx.beginPath(); hctx.moveTo(cx - 10 * s, cy); hctx.lineTo(cx - 4 * s, cy); hctx.moveTo(cx + 4 * s, cy); hctx.lineTo(cx + 10 * s, cy);
  hctx.moveTo(cx, cy - 10 * s); hctx.lineTo(cx, cy - 4 * s); hctx.moveTo(cx, cy + 4 * s); hctx.lineTo(cx, cy + 10 * s); hctx.stroke();

  const bobX = Math.sin(player.bob) * 18 * s * (moving ? 1 : 0.2), bobY = Math.abs(Math.cos(player.bob)) * 14 * s * (moving ? 1 : 0.2);
  const gx = cx + bobX, gy = h - 70 * s + bobY + player.recoil * 60 * s;
  hctx.save(); hctx.translate(gx, gy); hctx.scale(s, s);
  if (player.recoil > 0.6) { // muzzle flash
    hctx.fillStyle = '#ffd040'; hctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 40 : 110; hctx.lineTo(Math.cos(a) * r, -330 + Math.sin(a) * r * 0.7); }
    hctx.fill(); hctx.fillStyle = '#fff6c0'; hctx.beginPath(); hctx.arc(0, -330, 36, 0, Math.PI * 2); hctx.fill();
  }
  hctx.fillStyle = '#2a2a2e'; hctx.fillRect(-38, -320, 32, 260); hctx.fillRect(6, -320, 32, 260); // barrels
  hctx.fillStyle = '#4a4a52'; hctx.fillRect(-34, -320, 8, 260); hctx.fillRect(10, -320, 8, 260);
  hctx.fillStyle = '#111'; hctx.beginPath(); hctx.arc(-22, -320, 11, 0, Math.PI * 2); hctx.arc(22, -320, 11, 0, Math.PI * 2); hctx.fill();
  hctx.fillStyle = '#6b3f1e'; hctx.beginPath(); hctx.moveTo(-70, -80); hctx.lineTo(70, -80); hctx.lineTo(90, 80); hctx.lineTo(-90, 80); hctx.fill(); // stock
  hctx.fillStyle = '#8a5428'; hctx.fillRect(-60, -80, 30, 160);
  hctx.fillStyle = '#c8916a'; hctx.beginPath(); hctx.ellipse(70, -40, 46, 60, -0.4, 0, Math.PI * 2); hctx.fill(); // hand
  hctx.restore();
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
function updateHud() {
  $('hp').textContent = player.hp; $('ammo').textContent = player.ammo; $('kills').textContent = `${player.kills}/${enemies.length}`;
}
let msgTimer;
function flashMsg(text) {
  const m = $('msg'); m.textContent = text; m.style.opacity = 1;
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { m.style.opacity = 0; }, 1800);
}
function begin() {
  try { audio = audio || new AudioContext(); audio.resume(); } catch { audio = null; }
  setupLevel();
  $('start').hidden = true; $('end').hidden = true;
  running = true; startTime = performance.now();
  lockPointer();
  flashMsg('Find the green exit pad');
}
function end(won) {
  running = false;
  if (document.exitPointerLock) document.exitPointerLock();
  const secs = ((performance.now() - startTime) / 1000) | 0;
  $('endTitle').textContent = won ? 'ESCAPED' : 'YOU DIED';
  $('endTitle').style.color = won ? '#30ff70' : '';
  $('endText').textContent = `${player.kills} of ${enemies.length} killed · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  $('again').textContent = won ? 'Play again' : 'Try again';
  $('end').hidden = false;
}
$('play').onclick = begin;
$('again').onclick = begin;

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  const dpr = Math.min(devicePixelRatio, 2);
  hud.width = innerWidth * dpr; hud.height = innerHeight * dpr;
}
addEventListener('resize', resize);
resize();
setupLevel();

// ---------- Main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  let moving = false;
  if (running) {
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.7 : 1;
    let f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - touch.mz;
    let r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + touch.mx;
    if (keys.has('ArrowLeft')) player.yaw += 2.4 * dt;
    if (keys.has('ArrowRight')) player.yaw -= 2.4 * dt;
    const len = Math.hypot(f, r);
    if (len > 0.05) {
      if (len > 1) { f /= len; r /= len; }
      const sp = 3.4 * run * dt, sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
      tryMove(player, (-sin * f + cos * r) * sp, (-cos * f - sin * r) * sp, 0.25);
      player.bob += dt * 9 * run; moving = true;
    }
    player.cooldown = Math.max(0, player.cooldown - dt);

    for (const p of pickups) {
      if (!p.sprite.visible) continue;
      p.sprite.position.y = 0.22 + Math.sin(now / 300 + p.x) * 0.04;
      if (Math.hypot(p.x - player.x, p.z - player.z) < 0.5) {
        if (p.kind === 'H' && player.hp >= 100) continue;
        p.sprite.visible = false; sfx('pickup');
        if (p.kind === 'H') { player.hp = Math.min(100, player.hp + 30); flashMsg('+30 health'); }
        else { player.ammo += 10; flashMsg('+10 shells'); }
        updateHud();
      }
    }

    for (const e of enemies) {
      if (e.state === 'dead') continue;
      const dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz);
      const sees = dist < 14 && canSee(e.x, e.z, player.x, player.z);
      if (sees && dist < 9) e.awake = true;
      if (e.state === 'hurt' || e.state === 'attack') {
        if ((e.timer -= dt) <= 0) e.state = 'idle';
      } else if (e.awake) {
        if (dist > 1.1) tryMove(e, (dx / dist) * e.speed * dt, (dz / dist) * e.speed * dt, 0.3);
        e.attackCd -= dt;
        if (e.attackCd <= 0 && sees) {
          e.state = 'attack'; e.timer = 0.35;
          e.attackCd = (e.kind === 'brute' ? 2.4 : 1.7) + Math.random();
          if (dist < 1.3) damagePlayer(e.kind === 'brute' ? 18 : 8); else spawnFireball(e);
        }
      }
      e.sprite.material.map = FRAMES[e.kind][e.state];
      e.sprite.position.set(e.x, e.size / 2 + (e.awake && e.state === 'idle' ? Math.abs(Math.sin(now / 120 + e.x)) * 0.04 : 0), e.z);
    }

    shots = shots.filter((s) => {
      s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt;
      s.mesh.position.set(s.x, 0.75, s.z);
      const hitPlayer = Math.hypot(s.x - player.x, s.z - player.z) < 0.35;
      if (hitPlayer) damagePlayer(s.dmg);
      if (hitPlayer || isWall(s.x, s.z) || s.life <= 0) { scene.remove(s.mesh); return false; }
      return true;
    });

    if (exitPos && Math.hypot(exitPos.x - player.x, exitPos.z - player.z) < 0.5) end(true);
  }
  player.recoil = Math.max(0, player.recoil - dt * 4);
  player.hurt = Math.max(0, player.hurt - dt * 2);
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 150);

  const headBob = moving ? Math.sin(player.bob * 2) * 0.025 : 0;
  camera.position.set(player.x, 0.85 + headBob, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  torch.position.set(player.x, 1.1, player.z);
  muzzleLight.position.set(player.x - Math.sin(player.yaw) * 0.5, 0.8, player.z - Math.cos(player.yaw) * 0.5);
  renderer.render(scene, camera);
  drawWeapon(dt, moving);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Read-only stats for automated tests
window.__bunker = { get state() { return { running, hp: player.hp, ammo: player.ammo, kills: player.kills, enemies: enemies.length, x: player.x, z: player.z }; } };

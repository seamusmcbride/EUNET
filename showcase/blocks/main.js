const COLS = 10, ROWS = 20, HIDDEN = 2;
const COLORS = { I: '#22d3ee', O: '#facc15', T: '#a855f7', S: '#22c55e', Z: '#ef4444', J: '#3b82f6', L: '#f97316' };
const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};
// Wall kicks tried in order when a rotation collides
const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-2, 0], [2, 0]];
const LINE_SCORE = [0, 100, 300, 500, 800];

const board = document.getElementById('board');
const ctx = board.getContext('2d');
const holdCtx = document.getElementById('hold').getContext('2d');
const nextCtx = document.getElementById('next').getContext('2d');
let CELL = 30;

function fit() {
  const mobile = innerWidth < 700 || matchMedia('(pointer: coarse)').matches;
  const h = innerHeight - (mobile ? 250 : 60);
  CELL = Math.max(16, Math.min(34, Math.floor(h / ROWS), Math.floor((innerWidth - 32) / COLS)));
  const dpr = Math.min(devicePixelRatio, 2);
  board.width = COLS * CELL * dpr; board.height = ROWS * CELL * dpr;
  board.style.width = COLS * CELL + 'px'; board.style.height = ROWS * CELL + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', fit);
fit();

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

let grid, piece, bag, queue, held, canHold, score, lines, level, dropTimer, lockTimer, running, paused, over;
let particles = [], flashRows = [], shake = 0;
const $ = (id) => document.getElementById(id);
$('best').textContent = store.get('blocks-best') || 0;

function newBag() {
  const b = Object.keys(SHAPES);
  for (let i = b.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
function take() {
  while (queue.length < 6) { if (!bag.length) bag = newBag(); queue.push(bag.pop()); }
  return queue.shift();
}
function spawn(type = take()) {
  const m = SHAPES[type].map((r) => r.slice());
  piece = { type, m, x: ((COLS - m[0].length) / 2) | 0, y: type === 'I' ? -1 : 0 };
  lockTimer = null; dropTimer = 0;
  if (collides(piece.m, piece.x, piece.y)) gameOver();
}
function collides(m, px, py) {
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) {
    if (!m[y][x]) continue;
    const gx = px + x, gy = py + y + HIDDEN;
    if (gx < 0 || gx >= COLS || gy >= ROWS + HIDDEN || (gy >= 0 && grid[gy][gx])) return true;
  }
  return false;
}
function rotate(dir) {
  const m = piece.m, n = m.length;
  const r = m.map((row, y) => row.map((_, x) => (dir > 0 ? m[n - 1 - x][y] : m[x][n - 1 - y])));
  for (const [kx, ky] of KICKS) {
    if (!collides(r, piece.x + kx, piece.y + ky)) { piece.m = r; piece.x += kx; piece.y += ky; resetLock(); return; }
  }
}
function move(dx) { if (!collides(piece.m, piece.x + dx, piece.y)) { piece.x += dx; resetLock(); } }
function ghostY() { let y = piece.y; while (!collides(piece.m, piece.x, y + 1)) y++; return y; }
function resetLock() { if (lockTimer != null) lockTimer = 0; }

function softDrop() {
  if (!collides(piece.m, piece.x, piece.y + 1)) { piece.y++; score += 1; dropTimer = 0; }
}
function hardDrop() {
  const g = ghostY();
  score += (g - piece.y) * 2;
  piece.y = g;
  shake = 6;
  lock();
}
function hold() {
  if (!canHold) return;
  const t = piece.type;
  if (held) spawn(held); else spawn();
  held = t; canHold = false;
}

function lock() {
  piece.m.forEach((row, y) => row.forEach((v, x) => { if (v) { const gy = piece.y + y + HIDDEN; if (gy >= 0) grid[gy][piece.x + x] = piece.type; } }));
  if (piece.y + HIDDEN < HIDDEN && piece.m.some((row, y) => row.some((v) => v && piece.y + y < 0))) return gameOver();
  const full = [];
  grid.forEach((row, y) => { if (row.every(Boolean)) full.push(y); });
  if (full.length) {
    full.forEach((y) => burst(y - HIDDEN));
    flashRows = full.map((y) => ({ y: y - HIDDEN, t: 1 }));
    for (const y of full) { grid.splice(y, 1); grid.unshift(Array(COLS).fill(null)); }
    lines += full.length;
    score += LINE_SCORE[full.length] * level;
    level = 1 + ((lines / 10) | 0);
    shake = 4 + full.length * 3;
  }
  lockTimer = null;
  canHold = true;
  spawn();
}

function burst(row) {
  for (let i = 0; i < 40; i++) {
    particles.push({ x: Math.random() * COLS * CELL, y: (row + 0.5) * CELL, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 1) * 6,
      life: 1, color: Object.values(COLORS)[(Math.random() * 7) | 0] });
  }
}

function gameOver() {
  over = true; running = false;
  const best = Math.max(score, +(store.get('blocks-best') || 0));
  store.set('blocks-best', best);
  $('best').textContent = best;
  $('msg').innerHTML = `Game over — ${score.toLocaleString()} points, ${lines} lines.`;
  $('start').textContent = 'Play again';
  $('overlay').classList.remove('hidden');
}

function start() {
  grid = Array.from({ length: ROWS + HIDDEN }, () => Array(COLS).fill(null));
  bag = []; queue = []; held = null; canHold = true;
  score = 0; lines = 0; level = 1; dropTimer = 0; lockTimer = null;
  running = true; paused = false; over = false; particles = [];
  spawn();
  $('overlay').classList.add('hidden');
}
$('start').onclick = start;

// Input, with auto-repeat for held left/right/down
const actions = {
  left: () => move(-1), right: () => move(1), soft: softDrop, hard: hardDrop,
  rotate: () => rotate(1), rotateBack: () => rotate(-1), hold,
};
const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'soft', ' ': 'hard', ArrowUp: 'rotate', x: 'rotate', X: 'rotate', z: 'rotateBack', Z: 'rotateBack', c: 'hold', C: 'hold', Shift: 'hold' };
const REPEAT = new Set(['left', 'right', 'soft']);
const heldKeys = new Map();
function press(a) {
  if (!running || paused) return;
  actions[a]();
  if (REPEAT.has(a)) heldKeys.set(a, { t: 0, first: true });
}
function release(a) { heldKeys.delete(a); }
addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (running) paused = !paused; return; }
  if (e.key === 'Enter' && !running) return start();
  const a = KEYMAP[e.key];
  if (!a || e.repeat) return;
  e.preventDefault();
  press(a);
});
addEventListener('keyup', (e) => { const a = KEYMAP[e.key]; if (a) release(a); });
document.querySelectorAll('.touch button').forEach((b) => {
  const a = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(a); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => release(a)));
});

// Drawing
function cell(c, x, y, color, size = CELL, alpha = 1) {
  c.globalAlpha = alpha;
  const g = c.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, color); g.addColorStop(1, shade(color, -0.35));
  c.fillStyle = g;
  c.beginPath(); c.roundRect(x + 1, y + 1, size - 2, size - 2, size * 0.18); c.fill();
  c.fillStyle = '#ffffff40';
  c.beginPath(); c.roundRect(x + 3, y + 3, size - 6, size * 0.28, size * 0.12); c.fill();
  c.globalAlpha = 1;
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + v * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function drawMini(c, type, w, h, oy = 0) {
  if (!type) return;
  const m = SHAPES[type], s = 20;
  const cells = [];
  m.forEach((row, y) => row.forEach((v, x) => v && cells.push([x, y])));
  const minX = Math.min(...cells.map((p) => p[0])), maxX = Math.max(...cells.map((p) => p[0]));
  const minY = Math.min(...cells.map((p) => p[1])), maxY = Math.max(...cells.map((p) => p[1]));
  const ox = (w - (maxX - minX + 1) * s) / 2, oyy = oy + (h - (maxY - minY + 1) * s) / 2;
  cells.forEach(([x, y]) => cell(c, ox + (x - minX) * s, oyy + (y - minY) * s, COLORS[type], s, c === holdCtx && !canHold ? 0.35 : 1));
}

function draw() {
  const W = COLS * CELL, H = ROWS * CELL;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.85; if (shake < 0.3) shake = 0; }
  ctx.strokeStyle = '#ffffff08';
  for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, H); ctx.stroke(); }
  for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(W, y * CELL); ctx.stroke(); }
  if (grid) {
    for (let y = HIDDEN; y < ROWS + HIDDEN; y++) for (let x = 0; x < COLS; x++) if (grid[y][x]) cell(ctx, x * CELL, (y - HIDDEN) * CELL, COLORS[grid[y][x]]);
    if (running || paused) {
      const gy = ghostY();
      piece.m.forEach((row, y) => row.forEach((v, x) => {
        if (!v) return;
        ctx.strokeStyle = COLORS[piece.type] + '88'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect((piece.x + x) * CELL + 3, (gy + y) * CELL + 3, CELL - 6, CELL - 6, 5); ctx.stroke();
        cell(ctx, (piece.x + x) * CELL, (piece.y + y) * CELL, COLORS[piece.type]);
      }));
    }
  }
  flashRows = flashRows.filter((f) => (f.t -= 0.06) > 0);
  flashRows.forEach((f) => { ctx.fillStyle = `rgba(255,255,255,${f.t * 0.7})`; ctx.fillRect(0, f.y * CELL, W, CELL); });
  particles = particles.filter((p) => (p.life -= 0.02) > 0);
  particles.forEach((p) => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.25;
    ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 4, 4);
  });
  ctx.globalAlpha = 1;
  if (paused) { ctx.fillStyle = '#0a0a12cc'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = '700 28px "Space Grotesk"'; ctx.textAlign = 'center'; ctx.fillText('PAUSED', W / 2, H / 2); }
  ctx.restore();

  holdCtx.clearRect(0, 0, 104, 70); drawMini(holdCtx, held, 104, 70);
  nextCtx.clearRect(0, 0, 104, 230);
  (queue || []).slice(0, 4).forEach((t, i) => drawMini(nextCtx, t, 104, 56, i * 57));
  if (grid) { $('score').textContent = score.toLocaleString(); $('lines').textContent = lines; $('level').textContent = level; }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(now - last, 100);
  last = now;
  if (running && !paused) {
    for (const [a, s] of heldKeys) {
      s.t += dt;
      const delay = s.first ? 170 : a === 'soft' ? 35 : 50;
      if (s.t >= delay) { s.t = 0; s.first = false; actions[a](); }
    }
    const interval = Math.max(50, 800 * Math.pow(0.85, level - 1));
    dropTimer += dt;
    if (dropTimer >= interval) {
      dropTimer = 0;
      if (!collides(piece.m, piece.x, piece.y + 1)) piece.y++;
      else if (lockTimer == null) lockTimer = 0;
    }
    if (lockTimer != null) {
      if (!collides(piece.m, piece.x, piece.y + 1)) lockTimer = null;
      else if ((lockTimer += dt) > 500) lock();
    }
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

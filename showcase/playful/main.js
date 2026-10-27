import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Mouse, MouseConstraint, Events, Vector } = Matter;

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const engine = Engine.create({ gravity: { y: 1.2 } });
const world = engine.world;
const PALETTE = ['#16110f', '#fff4e0', '#ffd23f', '#3a86ff', '#8338ec', '#06d6a0', '#ff006e'];
const FONT = '"Bricolage Grotesque", system-ui, sans-serif';
let W, H, dpr, walls = [];

function resize() {
  dpr = Math.min(devicePixelRatio, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  Composite.remove(world, walls);
  const t = 200;
  walls = [
    Bodies.rectangle(W / 2, H + t / 2, W * 3, t, { isStatic: true }),
    Bodies.rectangle(W / 2, -t / 2, W * 3, t, { isStatic: true }),
    Bodies.rectangle(-t / 2, H / 2, t, H * 3, { isStatic: true }),
    Bodies.rectangle(W + t / 2, H / 2, t, H * 3, { isStatic: true }),
  ];
  Composite.add(world, walls);
}

// Each body carries how to draw itself in `plugin.draw`
function letter(ch, x, y, size) {
  ctx.font = `800 ${size}px ${FONT}`;
  const w = Math.max(ctx.measureText(ch).width, size * 0.35);
  const b = Bodies.rectangle(x, y, w, size * 0.74, { restitution: 0.3, friction: 0.4, chamfer: { radius: 6 } });
  b.plugin.draw = { kind: 'letter', ch, size, w, color: '#16110f' };
  return b;
}
function shape(x, y) {
  const s = 30 + Math.random() * 50;
  const color = PALETTE[(Math.random() * PALETTE.length) | 0];
  const k = Math.random();
  let b;
  if (k < 0.35) {
    b = Bodies.circle(x, y, s / 2, { restitution: 0.6 });
    b.plugin.draw = { kind: 'circle', r: s / 2, color };
  } else if (k < 0.65) {
    b = Bodies.rectangle(x, y, s * 2, s * 0.8, { chamfer: { radius: s * 0.4 }, restitution: 0.4 });
    b.plugin.draw = { kind: 'pill', w: s * 2, h: s * 0.8, color };
  } else if (k < 0.85) {
    b = Bodies.polygon(x, y, 3, s * 0.6, { restitution: 0.3 });
    b.plugin.draw = { kind: 'poly', color };
  } else {
    b = Bodies.polygon(x, y, 5, s * 0.55, { restitution: 0.3 });
    b.plugin.draw = { kind: 'star', r: s * 0.55, color };
  }
  Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.3);
  return b;
}

let items = [];
function spawnWord() {
  const word = 'GRAVITY';
  const size = Math.min(W / 5.2, 220);
  const total = word.length * size * 0.62;
  // Drop pieces in one at a time from just under the ceiling
  [...word].forEach((ch, i) => {
    later(i * 120, () => add(letter(ch, W / 2 - total / 2 + i * size * 0.64 + size * 0.3, size * 0.6, size)));
  });
  const small = ['play', 'is', 'a', 'serious', 'thing'];
  small.forEach((w, i) => later(1100 + i * 180, () => add(pillWord(w, W * (0.2 + i * 0.15), 60))));
}
let timers = [];
function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
function pillWord(text, x, y) {
  ctx.font = `500 28px ${FONT}`;
  const w = ctx.measureText(text).width + 44;
  const b = Bodies.rectangle(x, y, w, 56, { chamfer: { radius: 28 }, restitution: 0.4 });
  b.plugin.draw = { kind: 'tag', text, w, h: 56, color: '#fff4e0' };
  return b;
}
function add(b) { items.push(b); Composite.add(world, b); }

function reset() {
  timers.forEach(clearTimeout);
  timers = [];
  Composite.remove(world, items);
  items = [];
  engine.gravity.x = 0; engine.gravity.y = 1.2;
  spawnWord();
  for (let i = 0; i < 14; i++) later(2000 + i * 90, () => add(shape(60 + Math.random() * (W - 120), 60)));
}

resize();
addEventListener('resize', resize);

const mouse = Mouse.create(canvas);
mouse.pixelRatio = 1;
const mc = MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.2, render: { visible: false } } });
Composite.add(world, mc);
// Let the page receive wheel events
mouse.element.removeEventListener('wheel', mouse.mousewheel);

// Click on empty space drops a new shape
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, body: mc.body }; });
canvas.addEventListener('pointerup', (e) => {
  if (downAt && !mc.body && !downAt.body && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) {
    for (let i = 0; i < 3; i++) add(shape(e.clientX + (Math.random() - 0.5) * 40, e.clientY - i * 40));
  }
  downAt = null;
});

document.getElementById('flip').onclick = () => { engine.gravity.y = engine.gravity.y > 0 ? -1.2 : 1.2; engine.gravity.x = 0; };
document.getElementById('zero').onclick = () => {
  engine.gravity.y = 0; engine.gravity.x = 0;
  items.forEach((b) => Body.applyForce(b, b.position, Vector.create((Math.random() - 0.5) * 0.02 * b.mass, -0.03 * b.mass)));
};
document.getElementById('party').onclick = () => {
  for (let i = 0; i < 40; i++) {
    const b = shape(W / 2, H / 2);
    Body.scale(b, 0.45, 0.45);
    b.plugin.draw.r && (b.plugin.draw.r *= 0.45);
    b.plugin.draw.w && (b.plugin.draw.w *= 0.45, b.plugin.draw.h *= 0.45);
    Body.setVelocity(b, { x: (Math.random() - 0.5) * 40, y: -10 - Math.random() * 25 });
    add(b);
  }
};
document.getElementById('reset').onclick = reset;

// Tilt a phone to steer gravity
addEventListener('deviceorientation', (e) => {
  if (e.gamma == null) return;
  engine.gravity.x = gsapClamp(e.gamma / 45);
  engine.gravity.y = gsapClamp(e.beta / 45);
});
const gsapClamp = (v) => Math.max(-1.2, Math.min(1.2, v));

// Drawing
function drawBody(b) {
  const d = b.plugin.draw;
  if (!d) return;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  ctx.fillStyle = d.color;
  ctx.strokeStyle = '#16110f';
  ctx.lineWidth = 3;
  if (d.kind === 'letter') {
    ctx.font = `800 ${d.size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.ch, 0, d.size * 0.04);
  } else if (d.kind === 'circle') {
    ctx.beginPath(); ctx.arc(0, 0, d.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#16110f'; ctx.beginPath(); ctx.arc(d.r * 0.3, -d.r * 0.2, d.r * 0.12, 0, Math.PI * 2);
    ctx.arc(-d.r * 0.3, -d.r * 0.2, d.r * 0.12, 0, Math.PI * 2); ctx.fill();
  } else if (d.kind === 'pill' || d.kind === 'tag') {
    ctx.beginPath(); ctx.roundRect(-d.w / 2, -d.h / 2, d.w, d.h, d.h / 2); ctx.fill(); ctx.stroke();
    if (d.kind === 'tag') {
      ctx.fillStyle = '#16110f'; ctx.font = `500 28px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.text, 0, 2);
    }
  } else {
    ctx.rotate(-b.angle); ctx.translate(-b.position.x, -b.position.y);
    ctx.beginPath();
    b.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

const countEl = document.getElementById('count');
Events.on(engine, 'afterUpdate', () => {
  // Drop anything that escaped the walls
  items = items.filter((b) => {
    const out = b.position.y > H + 600 || b.position.y < -3000 || Math.abs(b.position.x - W / 2) > W * 2;
    if (out) Composite.remove(world, b);
    return !out;
  });
});

let last = performance.now();
function frame(now) {
  Engine.update(engine, Math.min(now - last, 32));
  last = now;
  ctx.clearRect(0, 0, W, H);
  items.forEach(drawBody);
  countEl.textContent = items.length;
  requestAnimationFrame(frame);
}

document.fonts.load(`800 100px ${FONT}`).finally(() => { reset(); requestAnimationFrame(frame); });

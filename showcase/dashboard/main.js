// Project list is maintained here; machine and git data come from status.json, written at build time.
const PROJECTS = [
  { name: 'Orbit', desc: 'Immersive 3D website: planet, rings, scroll-driven camera', status: 'live', href: '../immersive/index.html' },
  { name: 'Atelier', desc: 'Editorial magazine site with kinetic type and horizontal gallery', status: 'live', href: '../editorial/index.html' },
  { name: 'Gravity', desc: 'Physics playground with draggable letters and shapes', status: 'live', href: '../playful/index.html' },
  { name: 'Blocks', desc: 'Falling-block puzzle game', status: 'live', href: '../blocks/index.html' },
  { name: 'Bunker', desc: 'Retro first-person shooter', status: 'live', href: '../bunker/index.html' },
  { name: 'Outpost', desc: 'High-end 3D game with real-time shadows and effects', status: 'live', href: '../outpost/index.html' },
  { name: 'Portal', desc: 'Sign-in, documents, cameras, photo editor, admin. Runs on the rented server (portal/ folder)', status: 'live' },
  { name: 'VR world', desc: 'WebXR world built from iPhone scans', status: 'planned' },
];
const LABEL = { live: 'Live', building: 'In progress', planned: 'Planned' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

$('projects').innerHTML = PROJECTS.map((p) => `
  <tr><td><strong>${esc(p.name)}</strong><div class="desc">${esc(p.desc)}</div></td>
  <td><span class="pill ${p.status}">${LABEL[p.status]}</span></td>
  <td>${p.href && p.status !== 'planned' ? `<a href="${p.href}">Open</a>` : '<span class="desc">Not yet</span>'}</td></tr>`).join('');

function cell(label, value, pct) {
  return `<div class="cell"><small>${label}</small><b>${value}</b>${pct != null ? `<div class="meter"><i style="width:${Math.min(100, pct)}%"></i></div>` : ''}</div>`;
}

fetch('../status.json').then((r) => r.json()).then((s) => {
  const live = PROJECTS.filter((p) => p.status === 'live').length;
  const m = s.machine;
  const memUsed = m.memoryGb - m.memoryFreeGb;
  $('stamp').textContent = `Snapshot ${new Date(s.generated).toLocaleString()} · ${s.branch}`;
  $('strip').innerHTML = [
    cell('Live projects', `${live}/${PROJECTS.length}`, (live / PROJECTS.length) * 100),
    cell('Commits', s.commits.length),
    cell('Memory used', `${memUsed.toFixed(1)} / ${m.memoryGb} GB`, (memUsed / m.memoryGb) * 100),
    cell('Disk used', `${m.diskUsedGb} / ${m.diskSizeGb} GB`, (m.diskUsedGb / m.diskSizeGb) * 100),
    cell('Machine uptime', `${m.uptimeMin} min`),
  ].join('');
  $('log').innerHTML = s.commits.slice(0, 10).map((c) => `
    <li><span class="mono">${esc(c.hash)}</span><div>${esc(c.subject)}<time datetime="${esc(c.date)}">${ago(c.date)}</time></div></li>`).join('');
  $('machine').innerHTML = [['OS', m.os], ['CPU', m.cpu], ['Memory', `${m.memoryGb} GB`], ['Load (1/5/15 min)', m.load.join(' / ')], ['Repository', `${s.repo} @ ${s.branch}`]]
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  $('tools').innerHTML = Object.entries(s.tools).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v ?? 'not installed')}</dd>`).join('');
}).catch(() => {
  $('stamp').textContent = 'Status file missing: run npm run build';
});

// EUNET portal front end: one page, one view per #hash.
const view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

async function api(path, opts = {}) {
  const headers = { 'X-EUNET': '1', ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...opts.headers };
  const res = await fetch('/api' + path, { ...opts, headers, body: opts.json ? JSON.stringify(opts.json) : opts.body });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Signed out'); }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Request failed (${res.status})`);
  return res.status === 204 ? null : res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
}

let me;
const views = { home, files, cameras, photos, games, admin, account };

async function route() {
  const name = location.hash.slice(1).split('/')[0] || 'home';
  const fn = views[name] && (name !== 'admin' || me.role === 'admin') ? views[name] : home;
  document.querySelectorAll('nav.side a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + (views[name] ? name : 'home')));
  document.querySelectorAll('nav.side a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
  stopCameras();
  try { await fn(); } catch (e) { view.innerHTML = `<div class="card"><p class="error">${esc(e.message)}</p></div>`; }
}

// ---------- Dashboard ----------
async function home() {
  view.innerHTML = `<div class="head"><div><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${esc(me.displayName)}</h1><p class="muted">Server status and recent activity.</p></div></div><div id="dash" class="muted">Loading…</div>`;
  const s = await api('/status');
  const up = s.uptimeSeconds, upText = up < 3600 ? `${Math.round(up / 60)} min` : up < 86400 ? `${(up / 3600).toFixed(1)} h` : `${(up / 86400).toFixed(1)} days`;
  const used = s.disk.totalGb - s.disk.freeGb;
  let audit = '';
  if (me.role === 'admin') {
    const rows = await api('/audit?take=8');
    audit = `<section class="card"><h2>Recent activity</h2>${auditTable(rows)}</section>`;
  }
  document.getElementById('dash').outerHTML = `
    <div class="tiles">
      <div class="tile"><small>Server uptime</small><b>${upText}</b></div>
      <div class="tile"><small>Documents</small><b>${s.library.files}</b></div>
      <div class="tile"><small>Library size</small><b>${size(s.library.bytes)}</b></div>
      <div class="tile"><small>Disk used</small><b>${used.toFixed(0)} / ${s.disk.totalGb.toFixed(0)} GB</b></div>
      <div class="tile"><small>Users</small><b>${s.users}</b></div>
    </div>
    <div class="cols">
      <section class="card"><h2>Server</h2><table>
        <tr><td class="muted">Host</td><td class="mono">${esc(s.server)}</td></tr>
        <tr><td class="muted">System</td><td class="mono">${esc(s.os)}</td></tr>
        <tr><td class="muted">Runtime</td><td class="mono">${esc(s.runtime)}</td></tr>
        <tr><td class="muted">CPUs</td><td class="mono">${s.cpus}</td></tr>
        <tr><td class="muted">Portal memory</td><td class="mono">${s.processMemoryMb} MB</td></tr>
        <tr><td class="muted">Started</td><td class="mono">${when(s.started)}</td></tr>
      </table></section>
      ${audit || `<section class="card"><h2>Shortcuts</h2><p><a href="#files">Open documents</a> · <a href="#cameras">View cameras</a> · <a href="#photos">Edit a photo</a></p></section>`}
    </div>`;
}
function auditTable(rows) {
  if (!rows.length) return '<p class="muted">Nothing yet.</p>';
  return `<div class="table-box" style="border:0"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>${rows.map((r) => `
    <tr><td class="mono">${when(r.at)}</td><td>${esc(r.user ?? '—')}</td><td>${esc(r.action)}</td><td class="mono">${esc(r.detail ?? '')}${r.ip ? ` <span class="muted">${esc(r.ip)}</span>` : ''}</td></tr>`).join('')}</table></div>`;
}

// ---------- Documents ----------
let folder = '';
async function files() {
  const items = await api('/files?path=' + encodeURIComponent(folder));
  const parts = folder ? folder.split('/') : [];
  const crumbs = [`<button data-go="">Library</button>`, ...parts.map((p, i) => `/ <button data-go="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`)].join('');
  view.innerHTML = `
    <div class="head"><div><h1>Documents</h1><nav class="crumbs" aria-label="Folder">${crumbs}</nav></div>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button id="newFolder" type="button">New folder</button><label class="btn" for="upload">Upload files<input id="upload" type="file" multiple hidden /></label></div></div>
    <div class="drop" id="drop">Drop files here to upload to this folder</div>
    <p class="error" id="fileError" role="alert"></p>
    <div class="table-box"><table>
      <thead><tr><th>Name</th><th style="text-align:right">Size</th><th>Modified</th><th></th></tr></thead>
      <tbody>${items.length ? items.map((f) => `
        <tr><td>${f.isFolder ? `<button class="rowlink" data-go="${esc(f.path)}">📁 ${esc(f.name)}</button>` : `<a href="/api/files/download?path=${encodeURIComponent(f.path)}&inline=true" target="_blank" rel="noopener">${esc(f.name)}</a>`}</td>
        <td class="num">${f.isFolder ? '' : size(f.size)}</td><td class="mono">${when(f.modified)}</td>
        <td style="text-align:right;white-space:nowrap">${f.isFolder ? '' : `<a class="btn" href="/api/files/download?path=${encodeURIComponent(f.path)}">Download</a> `}<button class="danger" data-del="${esc(f.path)}" data-name="${esc(f.name)}">Delete</button></td></tr>`).join('')
        : '<tr><td colspan="4" class="muted">This folder is empty. Upload a file or create a folder to get started.</td></tr>'}</tbody>
    </table></div>`;
  view.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { folder = b.dataset.go; files(); });
  view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => confirmDelete(b));
  document.getElementById('newFolder').onclick = async () => {
    const name = await ask('Folder name');
    if (!name) return;
    try { await api('/files/folder', { method: 'POST', json: { path: folder, name } }); files(); } catch (e) { fileError(e); }
  };
  document.getElementById('upload').onchange = (e) => upload(e.target.files);
  const drop = document.getElementById('drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); };
}
const fileError = (e) => { document.getElementById('fileError').textContent = e.message; };
async function upload(list, path = folder) {
  if (!list.length) return;
  const body = new FormData();
  for (const f of list) body.append('files', f, f.name);
  const drop = document.getElementById('drop');
  if (drop) drop.textContent = `Uploading ${list.length} file${list.length > 1 ? 's' : ''}…`;
  try { await api('/files/upload?path=' + encodeURIComponent(path), { method: 'POST', body }); if (location.hash.startsWith('#files')) files(); }
  catch (e) { if (drop) fileError(e); else throw e; }
}
function confirmDelete(btn) {
  if (btn.dataset.armed) {
    api('/files?path=' + encodeURIComponent(btn.dataset.del), { method: 'DELETE' }).then(files, fileError);
    return;
  }
  btn.dataset.armed = '1';
  btn.textContent = `Confirm delete`;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Delete'; } }, 3000);
}
// Small inline prompt (window.prompt is blocked in some embedded browsers)
function ask(label) {
  return new Promise((resolve) => {
    const box = document.createElement('form');
    box.className = 'card';
    box.innerHTML = `<label for="askInput">${esc(label)}<input id="askInput" required /></label><div style="display:flex;gap:8px;margin-top:10px"><button class="primary">OK</button><button type="button" id="askCancel">Cancel</button></div>`;
    view.prepend(box);
    box.querySelector('input').focus();
    box.onsubmit = (e) => { e.preventDefault(); const v = box.querySelector('input').value.trim(); box.remove(); resolve(v); };
    box.querySelector('#askCancel').onclick = () => { box.remove(); resolve(null); };
  });
}

// ---------- Cameras ----------
let streams = [];
function stopCameras() { streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); streams = []; }
async function cameras() {
  const list = await api('/cameras');
  view.innerHTML = `
    <div class="head"><div><h1>Cameras</h1><p class="muted">Network cameras from the server's camera list, plus this device's own camera.</p></div>
    <button id="local" type="button">Show this device's camera</button></div>
    <div class="cams" id="cams">${list.map((c) => `
      <div class="cam"><span class="label">${esc(c.name)}</span>${
        c.type === 'mjpeg' || c.type === 'snapshot' ? `<img alt="${esc(c.name)}" src="${esc(c.url)}" data-snapshot="${c.type === 'snapshot' ? 1 : ''}">`
        : c.type === 'video' ? `<video src="${esc(c.url)}" autoplay muted playsinline loop></video>`
        : `<div class="off">Unsupported camera type “${esc(c.type)}”</div>`}</div>`).join('')}</div>
    ${list.length ? '' : `<div class="card"><h2>No cameras configured</h2><p class="muted" style="margin-top:6px">Add cameras to <span class="mono">data/cameras.json</span> on the server. Each entry needs a name, a type (<span class="mono">mjpeg</span>, <span class="mono">snapshot</span> or <span class="mono">video</span>) and a URL. RTSP cameras need a relay such as go2rtc; see the README.</p></div>`}`;
  // Refresh snapshot cameras every 2 seconds
  const timer = setInterval(() => {
    if (!location.hash.startsWith('#cameras')) return clearInterval(timer);
    view.querySelectorAll('img[data-snapshot="1"]').forEach((img) => { const u = new URL(img.src, location.href); u.searchParams.set('t', Date.now()); img.src = u; });
  }, 2000);
  document.getElementById('local').onclick = async (e) => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streams.push(s);
      const cam = document.createElement('div');
      cam.className = 'cam';
      cam.innerHTML = '<span class="label">This device</span><video autoplay muted playsinline></video>';
      cam.querySelector('video').srcObject = s;
      document.getElementById('cams').prepend(cam);
      e.target.disabled = true;
    } catch {
      e.target.textContent = 'Camera blocked or unavailable';
    }
  };
}

// ---------- Photo editor ----------
const FILTERS = [
  ['brightness', 'Brightness', 0, 200, 100, '%'], ['contrast', 'Contrast', 0, 200, 100, '%'], ['saturate', 'Saturation', 0, 200, 100, '%'],
  ['hue-rotate', 'Hue', -180, 180, 0, 'deg'], ['blur', 'Blur', 0, 10, 0, 'px'], ['sepia', 'Warmth', 0, 100, 0, '%'], ['grayscale', 'Black & white', 0, 100, 0, '%'],
];
const PRESETS = { Original: {}, Vivid: { contrast: 115, saturate: 150 }, Film: { contrast: 90, sepia: 25, saturate: 85 }, Noir: { grayscale: 100, contrast: 130 }, Cool: { 'hue-rotate': -15, saturate: 110, brightness: 105 } };
async function photos() {
  const st = { img: null, name: 'photo', rotate: 0, flipX: false, values: Object.fromEntries(FILTERS.map((f) => [f[0], f[4]])) };
  view.innerHTML = `
    <div class="head"><div><h1>Photo editor</h1><p class="muted">Open a photo, adjust it, then download it or save it to Documents.</p></div>
    <label class="btn" for="pick">Open photo<input id="pick" type="file" accept="image/*" hidden /></label></div>
    <div class="editor">
      <div class="stage" id="stage"><p class="muted">Open a photo to start editing. JPEG, PNG and WebP work.</p></div>
      <div class="card controls">
        <div><h2>Looks</h2><div class="row" id="presets">${Object.keys(PRESETS).map((p) => `<button type="button" data-preset="${p}">${p}</button>`).join('')}</div></div>
        ${FILTERS.map(([k, label, min, max]) => `<label for="f-${k}">${label} <input id="f-${k}" type="range" min="${min}" max="${max}" value="${st.values[k]}" data-k="${k}" /></label>`).join('')}
        <div><h2>Transform</h2><div class="row"><button type="button" id="rotL">Rotate left</button><button type="button" id="rotR">Rotate right</button><button type="button" id="flip">Flip</button></div></div>
        <div class="row"><button class="primary" type="button" id="save" disabled>Save to Documents</button><button type="button" id="dl" disabled>Download</button></div>
        <p class="muted" id="saveMsg" role="status"></p>
      </div>
    </div>`;
  const stage = document.getElementById('stage');
  const canvas = document.createElement('canvas');
  const draw = () => {
    if (!st.img) return;
    const turned = st.rotate % 180 !== 0;
    canvas.width = turned ? st.img.height : st.img.width;
    canvas.height = turned ? st.img.width : st.img.height;
    const ctx = canvas.getContext('2d');
    ctx.filter = FILTERS.map(([k, , , , , unit]) => `${k}(${st.values[k]}${unit})`).join(' ');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((st.rotate * Math.PI) / 180);
    ctx.scale(st.flipX ? -1 : 1, 1);
    ctx.drawImage(st.img, -st.img.width / 2, -st.img.height / 2);
  };
  const sync = () => FILTERS.forEach(([k]) => { document.getElementById('f-' + k).value = st.values[k]; });
  document.getElementById('pick').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    st.name = file.name.replace(/\.[^.]+$/, '');
    const img = new Image();
    img.onload = () => {
      // Cap very large photos so editing stays responsive
      const scale = Math.min(1, 3000 / Math.max(img.width, img.height));
      if (scale < 1) {
        const c = document.createElement('canvas'); c.width = img.width * scale; c.height = img.height * scale;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        st.img = c;
      } else st.img = img;
      stage.replaceChildren(canvas);
      document.getElementById('save').disabled = document.getElementById('dl').disabled = false;
      draw();
    };
    img.src = URL.createObjectURL(file);
  };
  view.querySelectorAll('input[type=range]').forEach((r) => r.oninput = () => { st.values[r.dataset.k] = +r.value; draw(); });
  view.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => {
    FILTERS.forEach(([k, , , , def]) => { st.values[k] = PRESETS[b.dataset.preset][k] ?? def; });
    sync(); draw();
  });
  document.getElementById('rotL').onclick = () => { st.rotate = (st.rotate + 270) % 360; draw(); };
  document.getElementById('rotR').onclick = () => { st.rotate = (st.rotate + 90) % 360; draw(); };
  document.getElementById('flip').onclick = () => { st.flipX = !st.flipX; draw(); };
  const blob = () => new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  document.getElementById('dl').onclick = async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await blob()); a.download = `${st.name}-edited.jpg`; a.click();
  };
  document.getElementById('save').onclick = async () => {
    const msg = document.getElementById('saveMsg');
    try {
      await api('/files/folder', { method: 'POST', json: { path: '', name: 'Photos' } }).catch(() => {});
      await upload([new File([await blob()], `${st.name}-edited.jpg`, { type: 'image/jpeg' })], 'Photos');
      msg.textContent = `Saved to Documents › Photos as ${st.name}-edited.jpg`;
    } catch (e) { msg.textContent = e.message; }
  };
}

// ---------- Games ----------
const GAMES = [
  ['outpost', 'Outpost', 'Modern 3D shooter with drone waves'],
  ['bunker', 'Bunker', 'Retro first-person shooter'],
  ['blocks', 'Blocks', 'Falling-block puzzle'],
  ['playful', 'Gravity', 'Physics playground'],
  ['immersive', 'Orbit', '3D scroll experience'],
  ['editorial', 'Atelier', 'Editorial magazine site'],
];
async function games() {
  view.innerHTML = `<div class="head"><div><h1>Games &amp; showcase</h1><p class="muted">Each one opens in a new tab.</p></div><a class="btn" href="/showcase/dashboard/index.html" target="_blank" rel="noopener">Project control room</a></div>
    <div class="games">${GAMES.map(([dir, name, desc]) => `<a class="game" href="/showcase/${dir}/index.html" target="_blank" rel="noopener"><b>${name}</b><span class="muted">${desc}</span></a>`).join('')}</div>`;
}

// ---------- Admin ----------
async function admin() {
  const [users, rows] = await Promise.all([api('/users'), api('/audit?take=100')]);
  view.innerHTML = `
    <div class="head"><div><h1>Users &amp; audit</h1><p class="muted">Manage who can sign in and review security events.</p></div></div>
    <div class="cols">
      <section class="card"><h2>Users</h2>
        <table>${users.map((u) => `<tr><td><strong>${esc(u.displayName)}</strong><div class="mono muted">${esc(u.name)}</div></td><td><span class="pill">${esc(u.role)}</span></td>
          <td style="text-align:right">${u.name.toLowerCase() === me.name.toLowerCase() ? '<span class="muted">You</span>' : `<button class="danger" data-rm="${esc(u.name)}">Remove</button>`}</td></tr>`).join('')}</table>
      </section>
      <form class="card" id="addUser" style="display:grid;gap:12px"><h2>Add a user</h2>
        <label for="nu-name">User name<input id="nu-name" autocomplete="off" required /></label>
        <label for="nu-display">Display name<input id="nu-display" /></label>
        <label for="nu-pass">Temporary password (10+ characters)<input id="nu-pass" type="password" autocomplete="new-password" required /></label>
        <label for="nu-role">Role<select id="nu-role"><option value="user">User</option><option value="admin">Administrator</option></select></label>
        <p class="error" id="userError" role="alert"></p>
        <button class="primary">Add user</button>
      </form>
    </div>
    <section class="card"><h2>Audit log</h2>${auditTable(rows)}</section>`;
  view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirm remove'; return; }
    try { await api('/users/' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' }); admin(); } catch (e) { document.getElementById('userError').textContent = e.message; }
  });
  document.getElementById('addUser').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', json: { name: val('nu-name'), displayName: val('nu-display'), password: document.getElementById('nu-pass').value, role: val('nu-role') } });
      admin();
    } catch (err) { document.getElementById('userError').textContent = err.message; }
  };
}
const val = (id) => document.getElementById(id).value.trim();

// ---------- Account ----------
async function account() {
  view.innerHTML = `
    <div class="head"><div><h1>My account</h1><p class="muted">Signed in as <span class="mono">${esc(me.name)}</span> (${esc(me.role)}).</p></div></div>
    <form class="card" id="pw" style="display:grid;gap:12px;max-width:440px"><h2>Change password</h2>
      <label for="pw-cur">Current password<input id="pw-cur" type="password" autocomplete="current-password" required /></label>
      <label for="pw-new">New password (10+ characters)<input id="pw-new" type="password" autocomplete="new-password" required minlength="10" /></label>
      <p class="error" id="pwMsg" role="status"></p>
      <button class="primary">Change password</button>
    </form>`;
  document.getElementById('pw').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pwMsg');
    try {
      await api('/me/password', { method: 'POST', json: { current: document.getElementById('pw-cur').value, new: document.getElementById('pw-new').value } });
      msg.style.color = 'var(--ok)'; msg.textContent = 'Password changed.'; e.target.reset();
    } catch (err) { msg.style.color = ''; msg.textContent = err.message; }
  };
}

// ---------- Start ----------
document.getElementById('logout').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => {}); location.href = '/login.html'; };
try {
  me = await api('/me');
  document.getElementById('who').innerHTML = `${esc(me.displayName)}<br><span class="muted">${esc(me.role)}</span>`;
  document.getElementById('adminLink').hidden = me.role !== 'admin';
  addEventListener('hashchange', route);
  route();
} catch { /* redirected to sign-in */ }

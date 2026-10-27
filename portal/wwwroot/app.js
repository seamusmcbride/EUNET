// EUNET portal front end: one page, one view per #hash, styled with Tabler.
const view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
// File links: real API on the server, in-memory copies in the demo
const fileUrl = (path, inline) => window.EUNET_DEMO?.url?.(path) ?? `/api/files/download?path=${encodeURIComponent(path)}${inline ? '&inline=true' : ''}`;
const initials = (n) => String(n ?? '?').split(/[\s._-]+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

async function api(path, opts = {}) {
  if (window.EUNET_DEMO) return window.EUNET_DEMO(path, opts);
  const headers = { 'X-EUNET': '1', ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...opts.headers };
  const res = await fetch('/api' + path, { ...opts, headers, body: opts.json ? JSON.stringify(opts.json) : opts.body });
  if (res.status === 401) { location.href = 'login.html'; throw new Error('Signed out'); }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Request failed (${res.status})`);
  return res.status === 204 ? null : res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
}

// Page frame: Tabler page header + body
function page({ pretitle, title, actions = '', body }) {
  view.innerHTML = `
    ${window.EUNET_DEMO ? '<div class="bg-warning-lt text-center py-1 demo-banner"><i class="ti ti-flask me-1"></i>Demo mode: sample data, nothing is saved. The real portal runs on your server.</div>' : ''}
    <div class="page-header d-print-none"><div class="container-xl"><div class="row g-2 align-items-center">
      <div class="col"><div class="page-pretitle">${pretitle}</div><h2 class="page-title">${title}</h2></div>
      <div class="col-auto ms-auto"><div class="btn-list">${actions}</div></div>
    </div></div></div>
    <div class="page-body"><div class="container-xl">${body}</div></div>`;
}
const fail = (e) => `<div class="alert alert-danger"><i class="ti ti-alert-triangle me-2"></i>${esc(e.message ?? e)}</div>`;

let me;
const charts = [];
const views = { home, files, assistant, cameras, photos, games, admin, account };

async function route() {
  const name = location.hash.slice(1) || 'home';
  const key = views[name] && (name !== 'admin' || me.role === 'admin') ? name : 'home';
  document.querySelectorAll('#nav .nav-item').forEach((li) => li.classList.toggle('active', li.querySelector('a').getAttribute('href') === '#' + key));
  stopCameras();
  charts.splice(0).forEach((c) => c.destroy());
  try { await views[key](); } catch (e) { page({ pretitle: 'Error', title: 'Something went wrong', body: fail(e) }); }
  // Close the mobile menu after navigating
  document.getElementById('sidebar-menu').classList.remove('show');
}

// ---------- Dashboard ----------
async function home() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const [s, act, audit] = await Promise.all([api('/status'), api('/activity'), me.role === 'admin' ? api('/audit?take=7') : Promise.resolve(null)]);
  const up = s.uptimeSeconds, upText = up < 3600 ? `${Math.round(up / 60)} min` : up < 86400 ? `${(up / 3600).toFixed(1)} hours` : `${(up / 86400).toFixed(1)} days`;
  const usedGb = s.disk.totalGb - s.disk.freeGb, usedPct = Math.round((usedGb / s.disk.totalGb) * 100);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const stat = (icon, color, value, label, sub) => `
    <div class="col-sm-6 col-lg-3"><div class="card card-sm"><div class="card-body"><div class="row align-items-center">
      <div class="col-auto"><span class="bg-${color} text-white avatar"><i class="ti ti-${icon} fs-2"></i></span></div>
      <div class="col"><div class="fw-semibold">${value}</div><div class="text-secondary">${label}${sub ? ` · ${sub}` : ''}</div></div>
    </div></div></div></div>`;

  page({
    pretitle: new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }),
    title: `${greeting}, ${esc(me.displayName.split(' ')[0])}`,
    actions: `<a href="#files" class="btn btn-primary"><i class="ti ti-upload me-2"></i>Upload files</a>`,
    body: `
    <div class="row row-deck row-cards">
      ${stat('server-2', 'green', 'Online', 'Server', `up ${upText}`)}
      ${stat('files', 'blue', `${s.library.files} files`, 'Documents', size(s.library.bytes))}
      ${stat('users', 'purple', s.users, 'Accounts', `${sum(act.signIns)} sign-ins in 14 days`)}
      ${stat('shield-exclamation', sum(act.failedSignIns) ? 'orange' : 'teal', sum(act.failedSignIns), 'Failed sign-ins', 'last 14 days')}

      <div class="col-lg-8"><div class="card">
        <div class="card-header"><h3 class="card-title">Activity</h3><div class="card-actions text-secondary small">Last 14 days, from the audit log</div></div>
        <div class="card-body"><div id="chartActivity" style="min-height:260px"></div></div>
      </div></div>
      <div class="col-lg-4"><div class="card">
        <div class="card-header"><h3 class="card-title">Storage</h3></div>
        <div class="card-body">
          <div id="chartDisk" style="min-height:200px"></div>
          <div class="d-flex justify-content-between small text-secondary mt-2"><span><span class="badge bg-primary me-1"></span>Used ${usedGb.toFixed(0)} GB</span><span><span class="badge bg-secondary-lt me-1"></span>Free ${s.disk.freeGb.toFixed(0)} GB</span></div>
        </div>
      </div></div>

      <div class="col-lg-${audit ? 7 : 12}"><div class="card">
        <div class="card-header"><h3 class="card-title">Server</h3><div class="card-actions"><span class="badge bg-green-lt"><span class="status-dot status-green status-dot-animated me-1"></span>Healthy</span></div></div>
        <div class="card-body"><div class="datagrid">
          ${[['Host', s.server], ['Operating system', s.os], ['Runtime', s.runtime], ['Processors', `${s.cpus} cores`], ['Portal memory', `${s.processMemoryMb} MB`], ['Running since', when(s.started)]]
            .map(([k, v]) => `<div class="datagrid-item"><div class="datagrid-title">${k}</div><div class="datagrid-content">${esc(v)}</div></div>`).join('')}
        </div>
        <div class="mt-4"><div class="d-flex mb-1 small"><span>Disk</span><span class="ms-auto text-secondary">${usedPct}% used</span></div>
          <div class="progress progress-sm"><div class="progress-bar ${usedPct > 85 ? 'bg-danger' : 'bg-primary'}" style="width:${usedPct}%"></div></div></div>
        </div>
      </div></div>
      ${audit ? `<div class="col-lg-5"><div class="card">
        <div class="card-header"><h3 class="card-title">Recent activity</h3><div class="card-actions"><a href="#admin">View all</a></div></div>
        <div class="list-group list-group-flush">${audit.map(activityRow).join('') || '<div class="list-group-item text-secondary">Nothing yet.</div>'}</div>
      </div></div>` : ''}
    </div>`,
  });

  const css = getComputedStyle(document.documentElement);
  const primary = css.getPropertyValue('--tblr-primary').trim() || '#1a7f5a';
  const muted = css.getPropertyValue('--tblr-secondary').trim() || '#888';
  const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  const base = { chart: { fontFamily: 'inherit', toolbar: { show: false }, background: 'transparent', animations: { enabled: true } }, theme: { mode: dark ? 'dark' : 'light' }, dataLabels: { enabled: false } };
  const labels = act.days.map((d) => new Date(d + 'T00:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short' }));
  const activity = new ApexCharts(document.getElementById('chartActivity'), {
    ...base,
    chart: { ...base.chart, type: 'area', height: 260, stacked: false },
    series: [{ name: 'Sign-ins', data: act.signIns }, { name: 'Uploads', data: act.uploads }, { name: 'Failed sign-ins', data: act.failedSignIns }],
    colors: [primary, '#4263eb', '#f76707'],
    stroke: { width: 2, curve: 'smooth' },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.02 } },
    xaxis: { categories: labels, labels: { style: { colors: muted } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: muted }, formatter: (v) => Math.round(v) }, min: 0, forceNiceScale: true },
    grid: { borderColor: dark ? '#ffffff12' : '#0000000f', strokeDashArray: 4 },
    legend: { position: 'top', horizontalAlign: 'left', labels: { colors: muted } },
    tooltip: { theme: dark ? 'dark' : 'light' },
  });
  const disk = new ApexCharts(document.getElementById('chartDisk'), {
    ...base,
    chart: { ...base.chart, type: 'donut', height: 220 },
    series: [Math.round(usedGb), Math.round(s.disk.freeGb)],
    labels: ['Used', 'Free'],
    colors: [primary, dark ? '#ffffff22' : '#e6e7e9'],
    legend: { show: false },
    stroke: { width: 0 },
    plotOptions: { pie: { donut: { size: '74%', labels: { show: true, name: { color: muted }, value: { fontSize: '22px', fontWeight: 600, color: dark ? '#fff' : '#182433', formatter: (v) => `${v} GB` }, total: { show: true, label: 'Disk used', color: muted, formatter: () => `${usedPct}%` } } } } },
    tooltip: { y: { formatter: (v) => `${v} GB` } },
  });
  activity.render(); disk.render();
  charts.push(activity, disk);
}
const ACTION = {
  login: ['login-2', 'green', 'signed in'], 'login-failed': ['shield-x', 'orange', 'failed to sign in'], logout: ['logout', 'secondary', 'signed out'],
  upload: ['upload', 'blue', 'uploaded'], delete: ['trash', 'red', 'deleted'], 'folder-created': ['folder-plus', 'blue', 'created folder'],
  'user-added': ['user-plus', 'purple', 'added user'], 'user-removed': ['user-minus', 'red', 'removed user'], 'password-changed': ['key', 'teal', 'changed their password'],
  'ai-chat': ['sparkles', 'azure', 'asked the assistant'],
};
function activityRow(r) {
  const [icon, color, verb] = ACTION[r.action] ?? ['point', 'secondary', r.action];
  return `<div class="list-group-item"><div class="row align-items-center g-3">
    <div class="col-auto"><span class="avatar avatar-sm bg-${color}-lt"><i class="ti ti-${icon}"></i></span></div>
    <div class="col text-truncate"><strong>${esc(r.user ?? 'Someone')}</strong> ${verb} ${r.detail ? `<span class="text-secondary">${esc(r.detail)}</span>` : ''}
      <div class="small text-secondary">${ago(r.at)}${r.ip ? ` · ${esc(r.ip)}` : ''}</div></div>
  </div></div>`;
}

// ---------- Documents ----------
let folder = '';
const FILE_ICON = [
  [/\.(jpe?g|png|gif|webp|heic|svg)$/i, 'photo', 'purple'], [/\.pdf$/i, 'file-type-pdf', 'red'], [/\.(docx?|odt|rtf)$/i, 'file-type-doc', 'blue'],
  [/\.(xlsx?|csv|ods)$/i, 'file-type-xls', 'green'], [/\.(pptx?|odp)$/i, 'file-type-ppt', 'orange'], [/\.(zip|7z|rar|tar|gz)$/i, 'file-zip', 'yellow'],
  [/\.(mp4|mov|mkv|webm)$/i, 'movie', 'pink'], [/\.(mp3|wav|flac|m4a)$/i, 'music', 'cyan'], [/\.(txt|md|log|json|xml|ya?ml)$/i, 'file-text', 'secondary'],
  [/\.(pem|crt|cer|key|p12|pfx|csr)$/i, 'certificate', 'teal'],
];
const fileIcon = (name) => FILE_ICON.find(([re]) => re.test(name)) ?? [null, 'file', 'secondary'];

async function files() {
  const items = await api('/files?path=' + encodeURIComponent(folder));
  const parts = folder ? folder.split('/') : [];
  const crumbs = `<ol class="breadcrumb breadcrumb-arrows">
    <li class="breadcrumb-item${parts.length ? '' : ' active'}"><a href="#files" data-go=""><i class="ti ti-home me-1"></i>Library</a></li>
    ${parts.map((p, i) => `<li class="breadcrumb-item${i === parts.length - 1 ? ' active' : ''}"><a href="#files" data-go="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</a></li>`).join('')}</ol>`;
  const folders = items.filter((f) => f.isFolder).length, total = items.reduce((a, f) => a + f.size, 0);
  page({
    pretitle: crumbs, title: parts.at(-1) ?? 'Documents',
    actions: `<button class="btn" id="newFolder"><i class="ti ti-folder-plus me-2"></i>New folder</button>
      <label class="btn btn-primary mb-0" for="upload"><i class="ti ti-upload me-2"></i>Upload<input id="upload" type="file" multiple hidden /></label>`,
    body: `
    <div id="folderForm"></div>
    <div class="card">
      <div class="card-header">
        <div><h3 class="card-title">${items.length - folders} files, ${folders} folders</h3><div class="card-subtitle">${size(total)} in this folder</div></div>
        <div class="card-actions" style="max-width:260px"><div class="input-icon"><span class="input-icon-addon"><i class="ti ti-search"></i></span><input class="form-control" id="filter" placeholder="Filter by name" aria-label="Filter by name" /></div></div>
      </div>
      <div class="card-body border-bottom py-3"><div class="dropzone-box" id="drop"><i class="ti ti-cloud-upload fs-1 d-block mb-1"></i>Drag files here to upload them to <strong>${esc(parts.at(-1) ?? 'Library')}</strong></div>
        <div class="text-danger small mt-2" id="fileError" role="alert"></div></div>
      <div class="table-responsive"><table class="table table-vcenter card-table table-hover">
        <thead><tr><th>Name</th><th class="text-end">Size</th><th>Modified</th><th class="w-1"></th></tr></thead>
        <tbody id="rows">${items.length ? items.map((f) => {
          const [, icon, color] = f.isFolder ? [null, 'folder', 'yellow'] : fileIcon(f.name);
          const dl = fileUrl(f.path), open = fileUrl(f.path, true);
          return `<tr data-name="${esc(f.name.toLowerCase())}">
            <td><div class="d-flex align-items-center gap-3"><span class="file-icon bg-${color}-lt"><i class="ti ti-${icon}"></i></span>
              ${f.isFolder ? `<a href="#files" class="text-reset fw-medium" data-go="${esc(f.path)}">${esc(f.name)}</a>` : `<a href="${open}" target="_blank" rel="noopener" class="text-reset fw-medium">${esc(f.name)}</a>`}</div></td>
            <td class="text-end text-secondary text-nowrap">${f.isFolder ? '—' : size(f.size)}</td>
            <td class="text-secondary text-nowrap">${when(f.modified)}</td>
            <td><div class="btn-list flex-nowrap">${f.isFolder ? '' : `<a class="btn btn-icon btn-ghost-secondary" href="${dl}" title="Download" aria-label="Download ${esc(f.name)}"><i class="ti ti-download"></i></a>`}
              <button class="btn btn-icon btn-ghost-danger" data-del="${esc(f.path)}" title="Delete" aria-label="Delete ${esc(f.name)}"><i class="ti ti-trash"></i></button></div></td></tr>`;
        }).join('') : `<tr><td colspan="4"><div class="empty py-5"><div class="empty-icon"><i class="ti ti-folder-open fs-1"></i></div><p class="empty-title">This folder is empty</p><p class="empty-subtitle text-secondary">Upload files or create a folder to get started.</p></div></td></tr>`}</tbody>
      </table></div>
    </div>`,
  });
  view.querySelectorAll('[data-go]').forEach((a) => a.onclick = (e) => { e.preventDefault(); folder = a.dataset.go; files(); });
  view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => confirmDelete(b));
  document.getElementById('filter').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    view.querySelectorAll('#rows tr[data-name]').forEach((tr) => { tr.hidden = q && !tr.dataset.name.includes(q); });
  };
  document.getElementById('newFolder').onclick = () => {
    const box = document.getElementById('folderForm');
    box.innerHTML = `<form class="card mb-3"><div class="card-body"><label class="form-label" for="folderName">New folder name</label>
      <div class="input-group"><input class="form-control" id="folderName" required placeholder="e.g. Contracts 2026" /><button class="btn btn-primary">Create</button><button type="button" class="btn" id="cancelFolder">Cancel</button></div></div></form>`;
    const form = box.querySelector('form');
    form.querySelector('input').focus();
    form.querySelector('#cancelFolder').onclick = () => { box.innerHTML = ''; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/files/folder', { method: 'POST', json: { path: folder, name: form.querySelector('input').value.trim() } }); files(); }
      catch (err) { fileError(err); }
    };
  };
  document.getElementById('upload').onchange = (e) => upload(e.target.files);
  const drop = document.getElementById('drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); };
}
const fileError = (e) => { const el = document.getElementById('fileError'); if (el) el.textContent = e.message; };
async function upload(list, path = folder) {
  if (!list.length) return;
  const body = new FormData();
  for (const f of list) body.append('files', f, f.name);
  const drop = document.getElementById('drop');
  if (drop) drop.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Uploading ${list.length} file${list.length > 1 ? 's' : ''}…`;
  try { await api('/files/upload?path=' + encodeURIComponent(path), { method: 'POST', body }); if (location.hash.startsWith('#files')) files(); }
  catch (e) { if (drop) fileError(e); else throw e; }
}
function confirmDelete(btn) {
  if (btn.dataset.armed) {
    api('/files?path=' + encodeURIComponent(btn.dataset.del), { method: 'DELETE' }).then(files, fileError);
    return;
  }
  btn.dataset.armed = '1';
  btn.classList.replace('btn-ghost-danger', 'btn-danger');
  btn.innerHTML = '<i class="ti ti-check"></i>';
  btn.title = 'Click again to delete';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.classList.replace('btn-danger', 'btn-ghost-danger'); btn.innerHTML = '<i class="ti ti-trash"></i>'; } }, 3000);
}

// ---------- Assistant (local AI through the server) ----------
const chat = { messages: [], model: null, busy: false };
async function streamChat(onText) {
  if (window.EUNET_DEMO) return window.EUNET_DEMO.chat(chat.messages, onText);
  const res = await fetch('/api/ai/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EUNET': '1' },
    body: JSON.stringify({ model: chat.model, messages: chat.messages }),
  });
  if (res.status === 401) { location.href = 'login.html'; return; }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Request failed (${res.status})`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    onText(dec.decode(value, { stream: true }));
  }
}
// Plain text with paragraphs, bullet lists and **bold**, all escaped first
const formatReply = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').split(/\n{2,}/).map((p) => {
  const lines = p.split('\n');
  return lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))
    ? `<ul class="mb-2 ps-3">${lines.map((l) => `<li>${l.replace(/^\s*([-*•]|\d+\.)\s/, '')}</li>`).join('')}</ul>`
    : `<p class="mb-2">${lines.join('<br>')}</p>`;
}).join('');
const SUGGESTIONS = ['Explain the difference between a root CA and an issuing CA', 'Write a short policy for strong passwords', 'Summarise what a CSR contains', 'Draft a polite email asking for an invoice'];

async function assistant() {
  const info = await api('/ai/models');
  if (!chat.model || !info.models.includes(chat.model)) chat.model = info.selected;
  page({
    pretitle: info.available ? `Runs on this server · ${info.models.length} model${info.models.length === 1 ? '' : 's'}` : 'Local AI',
    title: 'Assistant',
    actions: info.available ? `<select class="form-select w-auto" id="model" aria-label="Model">${info.models.map((m) => `<option ${m === chat.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <button class="btn" id="newChat"><i class="ti ti-plus me-2"></i>New chat</button>` : '',
    body: !info.available ? `<div class="card"><div class="empty">
        <div class="empty-icon"><i class="ti ti-plug-connected-x fs-1"></i></div><p class="empty-title">The local AI isn't running</p>
        <p class="empty-subtitle text-secondary">Install <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a> on this server, then run <code>ollama pull qwen2.5:3b</code>. The portal finds it at the address set in <code>Ollama:Url</code>.</p></div></div>`
      : `<div class="card" style="height:calc(100vh - 12rem);min-height:420px">
        <div class="card-body scrollable" id="chatLog" style="flex:1;overflow-y:auto"></div>
        <div class="card-footer">
          <form id="chatForm" class="d-flex gap-2 align-items-end">
            <textarea id="prompt" class="form-control" rows="1" placeholder="Ask anything. Your question stays on this server." style="resize:none;max-height:160px" aria-label="Message"></textarea>
            <button class="btn btn-primary btn-icon" id="send" aria-label="Send"><i class="ti ti-send"></i></button>
          </form>
          <div class="small text-secondary mt-2"><i class="ti ti-lock me-1"></i>Answers come from a model on your own server. Nothing is sent to an outside AI service.</div>
        </div>
      </div>`,
  });
  if (!info.available) return;
  const log = document.getElementById('chatLog'), prompt = document.getElementById('prompt'), form = document.getElementById('chatForm');
  const bubble = (role, html) => `<div class="chat-item mb-3"><div class="row g-2 align-items-end ${role === 'user' ? 'justify-content-end' : ''}">
      ${role === 'user' ? '' : '<div class="col-auto"><span class="avatar avatar-sm bg-primary-lt"><i class="ti ti-sparkles"></i></span></div>'}
      <div class="col-auto" style="max-width:min(75%, 720px)"><div class="chat-bubble ${role === 'user' ? 'chat-bubble-me' : ''}"><div class="chat-bubble-body">${html}</div></div></div>
      ${role === 'user' ? `<div class="col-auto"><span class="avatar avatar-sm">${esc(initials(me.displayName))}</span></div>` : ''}</div></div>`;
  const render = () => {
    log.innerHTML = chat.messages.length ? chat.messages.map((m) => bubble(m.role, m.role === 'user' ? `<p class="mb-0">${esc(m.content).replace(/\n/g, '<br>')}</p>` : formatReply(m.content) || '<span class="spinner-border spinner-border-sm"></span>')).join('')
      : `<div class="empty"><div class="empty-icon"><i class="ti ti-sparkles fs-1 text-primary"></i></div><p class="empty-title">What can I help with?</p>
          <div class="d-flex flex-wrap gap-2 justify-content-center mt-2">${SUGGESTIONS.map((s) => `<button type="button" class="btn btn-sm" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
    log.scrollTop = log.scrollHeight;
    log.querySelectorAll('[data-suggest]').forEach((b) => b.onclick = () => { prompt.value = b.dataset.suggest; form.requestSubmit(); });
  };
  render();
  document.getElementById('model').onchange = (e) => { chat.model = e.target.value; };
  document.getElementById('newChat').onclick = () => { if (!chat.busy) { chat.messages = []; render(); prompt.focus(); } };
  prompt.oninput = () => { prompt.style.height = 'auto'; prompt.style.height = prompt.scrollHeight + 'px'; };
  prompt.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = prompt.value.trim();
    if (!text || chat.busy) return;
    chat.busy = true; document.getElementById('send').disabled = true;
    prompt.value = ''; prompt.style.height = 'auto';
    chat.messages.push({ role: 'user', content: text });
    const reply = { role: 'assistant', content: '' };
    chat.messages.push(reply);
    render();
    try {
      await streamChat((t) => {
        reply.content += t;
        const last = log.querySelectorAll('.chat-bubble-body');
        last[last.length - 1].innerHTML = formatReply(reply.content);
        log.scrollTop = log.scrollHeight;
      });
      if (!reply.content) reply.content = '(No answer came back. Try again or pick another model.)';
    } catch (err) {
      reply.content = err.message;
    }
    render();
    chat.busy = false;
    if (document.getElementById('send')) { document.getElementById('send').disabled = false; prompt.focus(); }
  };
  prompt.focus();
}

// ---------- Cameras ----------
let streams = [];
function stopCameras() { streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); streams = []; }
async function cameras() {
  const list = await api('/cameras');
  const feed = (c) => c.type === 'mjpeg' || c.type === 'snapshot' ? `<img alt="${esc(c.name)}" src="${esc(c.url)}" ${c.type === 'snapshot' ? 'data-snapshot="1"' : ''}>`
    : c.type === 'video' ? `<video src="${esc(c.url)}" autoplay muted playsinline loop></video>` : `<div class="d-grid text-secondary" style="place-items:center">Unsupported type “${esc(c.type)}”</div>`;
  page({
    pretitle: `${list.length} configured`, title: 'Cameras',
    actions: `<button class="btn" id="local"><i class="ti ti-device-laptop me-2"></i>Add this device's camera</button>`,
    body: `<div class="row row-cards" id="cams">${list.map((c) => `
      <div class="col-md-6 col-xl-4"><div class="card">
        <div class="position-relative"><span class="cam-badge badge bg-dark text-white"><span class="status-dot status-red status-dot-animated"></span>LIVE</span><div class="ratio ratio-16x9 cam-feed card-img-top">${feed(c)}</div></div>
        <div class="card-body py-2 d-flex align-items-center"><div><div class="fw-medium">${esc(c.name)}</div><div class="small text-secondary">${esc(c.location ?? c.type)}</div></div>
          <span class="ms-auto small text-secondary" data-clock>${new Date().toLocaleTimeString()}</span></div>
      </div></div>`).join('')}</div>
      ${list.length ? '' : `<div class="card"><div class="empty"><div class="empty-icon"><i class="ti ti-video-off fs-1"></i></div><p class="empty-title">No cameras configured yet</p>
        <p class="empty-subtitle text-secondary">Add cameras to <code>data/cameras.json</code> on the server. RTSP cameras need a relay such as go2rtc; see the README.</p></div></div>`}`,
  });
  const timer = setInterval(() => {
    if (!location.hash.startsWith('#cameras')) return clearInterval(timer);
    view.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = new Date().toLocaleTimeString(); });
    view.querySelectorAll('img[data-snapshot]').forEach((img) => { const u = new URL(img.src, location.href); u.searchParams.set('t', Date.now()); img.src = u; });
  }, 2000);
  const localBtn = document.getElementById('local');
  localBtn.onclick = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streams.push(s);
      const col = document.createElement('div');
      col.className = 'col-md-6 col-xl-4';
      col.innerHTML = `<div class="card"><div class="position-relative"><span class="cam-badge badge bg-dark text-white"><span class="status-dot status-red status-dot-animated"></span>LIVE</span><div class="ratio ratio-16x9 cam-feed card-img-top"><video autoplay muted playsinline></video></div></div>
        <div class="card-body py-2"><div class="fw-medium">This device</div><div class="small text-secondary">Only visible to you</div></div></div>`;
      col.querySelector('video').srcObject = s;
      document.getElementById('cams').prepend(col);
      localBtn.disabled = true;
    } catch {
      localBtn.innerHTML = '<i class="ti ti-video-off me-2"></i>Camera blocked or unavailable';
    }
  };
}

// ---------- Photo editor ----------
const FILTERS = [
  ['brightness', 'Brightness', 0, 200, 100, '%', 'sun'], ['contrast', 'Contrast', 0, 200, 100, '%', 'contrast'], ['saturate', 'Saturation', 0, 200, 100, '%', 'droplet'],
  ['hue-rotate', 'Hue', -180, 180, 0, 'deg', 'color-swatch'], ['sepia', 'Warmth', 0, 100, 0, '%', 'temperature'], ['grayscale', 'Black & white', 0, 100, 0, '%', 'circle-half-2'], ['blur', 'Blur', 0, 10, 0, 'px', 'blur'],
];
const PRESETS = { Original: {}, Vivid: { contrast: 115, saturate: 150 }, Film: { contrast: 90, sepia: 25, saturate: 85, brightness: 105 }, Noir: { grayscale: 100, contrast: 130 }, Cool: { 'hue-rotate': -15, saturate: 110, brightness: 105 }, Fade: { contrast: 80, brightness: 112, saturate: 70 } };
const cssFilter = (v) => FILTERS.map(([k, , , , def, unit]) => `${k}(${v[k] ?? def}${unit})`).join(' ');
async function photos() {
  const st = { img: null, url: null, name: 'photo', rotate: 0, flipX: false, values: Object.fromEntries(FILTERS.map((f) => [f[0], f[4]])) };
  page({
    pretitle: 'Tools', title: 'Photo editor',
    actions: `<label class="btn btn-primary mb-0" for="pick"><i class="ti ti-photo-plus me-2"></i>Open photo<input id="pick" type="file" accept="image/*" hidden /></label>`,
    body: `<div class="row g-3">
      <div class="col-lg-8"><div class="card"><div class="editor-stage" id="stage">
        <div class="empty"><div class="empty-icon"><i class="ti ti-photo fs-1"></i></div><p class="empty-title">Open a photo to start</p><p class="empty-subtitle text-secondary">JPEG, PNG and WebP. Nothing leaves your device until you save it.</p></div>
      </div></div></div>
      <div class="col-lg-4"><div class="card">
        <div class="card-header"><ul class="nav nav-tabs card-header-tabs" data-bs-toggle="tabs">
          <li class="nav-item"><a href="#tab-looks" class="nav-link active" data-bs-toggle="tab">Looks</a></li>
          <li class="nav-item"><a href="#tab-adjust" class="nav-link" data-bs-toggle="tab">Adjust</a></li>
        </ul></div>
        <div class="card-body"><div class="tab-content">
          <div class="tab-pane active show" id="tab-looks"><div class="row g-2" id="presets">${Object.keys(PRESETS).map((p) => `
            <div class="col-4"><button type="button" class="btn preset" data-preset="${p}"><div class="swatch" data-swatch="${p}"></div><span class="small">${p}</span></button></div>`).join('')}</div></div>
          <div class="tab-pane" id="tab-adjust">${FILTERS.map(([k, label, min, max, def, , icon]) => `
            <div class="mb-3"><label class="form-label d-flex align-items-center" for="f-${k}"><i class="ti ti-${icon} me-2 text-secondary"></i>${label}<span class="ms-auto text-secondary small" id="v-${k}">${def}</span></label>
            <input id="f-${k}" type="range" class="form-range" min="${min}" max="${max}" value="${def}" data-k="${k}" /></div>`).join('')}</div>
        </div>
        <div class="hr-text my-3">Transform</div>
        <div class="btn-group w-100" role="group">
          <button type="button" class="btn" id="rotL" title="Rotate left"><i class="ti ti-rotate-2"></i></button>
          <button type="button" class="btn" id="rotR" title="Rotate right"><i class="ti ti-rotate-clockwise-2"></i></button>
          <button type="button" class="btn" id="flip" title="Flip"><i class="ti ti-flip-vertical"></i></button>
          <button type="button" class="btn" id="reset" title="Reset"><i class="ti ti-restore"></i></button>
        </div></div>
        <div class="card-footer d-flex gap-2">
          <button class="btn btn-primary flex-fill" type="button" id="save" disabled><i class="ti ti-device-floppy me-2"></i>Save to Documents</button>
          <button class="btn btn-icon" type="button" id="dl" disabled title="Download" aria-label="Download"><i class="ti ti-download"></i></button>
        </div>
        <div class="px-3 pb-3 small" id="saveMsg" role="status"></div>
      </div></div>
    </div>`,
  });
  const stage = document.getElementById('stage');
  const canvas = document.createElement('canvas');
  const draw = () => {
    if (!st.img) return;
    const turned = st.rotate % 180 !== 0;
    canvas.width = turned ? st.img.height : st.img.width;
    canvas.height = turned ? st.img.width : st.img.height;
    const ctx = canvas.getContext('2d');
    ctx.filter = cssFilter(st.values);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((st.rotate * Math.PI) / 180);
    ctx.scale(st.flipX ? -1 : 1, 1);
    ctx.drawImage(st.img, -st.img.width / 2, -st.img.height / 2);
  };
  const sync = () => FILTERS.forEach(([k]) => { document.getElementById('f-' + k).value = st.values[k]; document.getElementById('v-' + k).textContent = st.values[k]; });
  // Tabler's tab plugin needs to see tabs added after page load
  view.querySelectorAll('[data-bs-toggle="tab"]').forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    view.querySelectorAll('[data-bs-toggle="tab"]').forEach((x) => x.classList.toggle('active', x === a));
    view.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', '#' + p.id === a.getAttribute('href')));
    view.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('show', '#' + p.id === a.getAttribute('href')));
  });
  document.getElementById('pick').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    st.name = file.name.replace(/\.[^.]+$/, '');
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(file);
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
      view.querySelectorAll('[data-swatch]').forEach((s) => { s.style.backgroundImage = `url(${st.url})`; s.style.filter = cssFilter({ ...Object.fromEntries(FILTERS.map((f) => [f[0], f[4]])), ...PRESETS[s.dataset.swatch] }); });
      document.getElementById('save').disabled = document.getElementById('dl').disabled = false;
      draw();
    };
    img.src = st.url;
  };
  view.querySelectorAll('input[type=range]').forEach((r) => r.oninput = () => { st.values[r.dataset.k] = +r.value; document.getElementById('v-' + r.dataset.k).textContent = r.value; draw(); });
  const applyPreset = (name) => { FILTERS.forEach(([k, , , , def]) => { st.values[k] = PRESETS[name][k] ?? def; }); sync(); draw(); };
  view.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => {
    view.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('btn-primary', x === b));
    applyPreset(b.dataset.preset);
  });
  document.getElementById('rotL').onclick = () => { st.rotate = (st.rotate + 270) % 360; draw(); };
  document.getElementById('rotR').onclick = () => { st.rotate = (st.rotate + 90) % 360; draw(); };
  document.getElementById('flip').onclick = () => { st.flipX = !st.flipX; draw(); };
  document.getElementById('reset').onclick = () => { st.rotate = 0; st.flipX = false; applyPreset('Original'); };
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
      msg.innerHTML = `<span class="text-success"><i class="ti ti-circle-check me-1"></i>Saved to Documents › Photos</span>`;
    } catch (e) { msg.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`; }
  };
}

// ---------- Games ----------
const GAMES = [
  ['outpost', 'Outpost', '3D shooter: hold the outpost against drone waves', 'rocket', 'linear-gradient(135deg,#1a2a44,#b0503a)'],
  ['bunker', 'Bunker', 'Retro first-person shooter', 'skull', 'linear-gradient(135deg,#2a0d08,#e0301e)'],
  ['blocks', 'Blocks', 'Falling-block puzzle', 'layout-grid', 'linear-gradient(135deg,#22d3ee,#a855f7)'],
  ['playful', 'Gravity', 'Physics playground', 'ball-bowling', 'linear-gradient(135deg,#ff5b2e,#ffd23f)'],
  ['immersive', 'Orbit', '3D scroll experience', 'planet', 'linear-gradient(135deg,#0d0a2e,#3b2bff)'],
  ['editorial', 'Atelier', 'Editorial magazine site', 'news', 'linear-gradient(135deg,#6f685c,#c2410c)'],
];
async function games() {
  const base = 'showcase/';
  page({
    pretitle: 'Play', title: 'Games & showcase',
    actions: `<a class="btn" href="${base}dashboard/index.html" target="_blank" rel="noopener"><i class="ti ti-chart-dots me-2"></i>Project control room</a>`,
    body: `<div class="row row-cards">${GAMES.map(([dir, name, desc, icon, bg]) => `
      <div class="col-sm-6 col-lg-4"><a class="card card-link card-link-pop text-reset text-decoration-none" href="${base}${dir}/index.html" target="_blank" rel="noopener">
        <div class="game-art" style="background:${bg}"><i class="ti ti-${icon}"></i></div>
        <div class="card-body"><h3 class="card-title mb-1">${name}</h3><div class="text-secondary">${desc}</div></div>
      </a></div>`).join('')}</div>`,
  });
}

// ---------- Admin ----------
async function admin() {
  const [users, rows] = await Promise.all([api('/users'), api('/audit?take=100')]);
  page({
    pretitle: 'Administration', title: 'Users & audit',
    body: `<div class="row row-cards">
      <div class="col-lg-7"><div class="card">
        <div class="card-header"><h3 class="card-title">Accounts</h3><div class="card-actions"><span class="badge bg-secondary-lt">${users.length}</span></div></div>
        <div class="table-responsive"><table class="table table-vcenter card-table">
          <thead><tr><th>User</th><th>Role</th><th>Created</th><th class="w-1"></th></tr></thead>
          <tbody>${users.map((u) => `<tr>
            <td><div class="d-flex align-items-center gap-2"><span class="avatar avatar-sm bg-primary-lt">${esc(initials(u.displayName))}</span><div><div class="fw-medium">${esc(u.displayName)}</div><div class="small text-secondary">${esc(u.name)}</div></div></div></td>
            <td><span class="badge ${u.role === 'admin' ? 'bg-purple-lt' : 'bg-secondary-lt'}">${u.role === 'admin' ? 'Administrator' : 'User'}</span></td>
            <td class="text-secondary">${new Date(u.created).toLocaleDateString()}</td>
            <td>${u.name.toLowerCase() === me.name.toLowerCase() ? '<span class="text-secondary small">You</span>' : `<button class="btn btn-sm btn-ghost-danger" data-rm="${esc(u.name)}">Remove</button>`}</td></tr>`).join('')}</tbody>
        </table></div>
      </div></div>
      <div class="col-lg-5"><form class="card" id="addUser">
        <div class="card-header"><h3 class="card-title">Add a user</h3></div>
        <div class="card-body">
          <div class="mb-3"><label class="form-label required" for="nu-name">User name</label><input class="form-control" id="nu-name" autocomplete="off" required placeholder="jane.doe" /></div>
          <div class="mb-3"><label class="form-label" for="nu-display">Full name</label><input class="form-control" id="nu-display" placeholder="Jane Doe" /></div>
          <div class="mb-3"><label class="form-label required" for="nu-pass">Temporary password</label><input class="form-control" id="nu-pass" type="password" autocomplete="new-password" required /><small class="form-hint">At least 10 characters. Ask them to change it after signing in.</small></div>
          <div class="mb-1"><label class="form-label">Role</label><div class="form-selectgroup">
            <label class="form-selectgroup-item"><input type="radio" name="role" value="user" class="form-selectgroup-input" checked /><span class="form-selectgroup-label"><i class="ti ti-user me-1"></i>User</span></label>
            <label class="form-selectgroup-item"><input type="radio" name="role" value="admin" class="form-selectgroup-input" /><span class="form-selectgroup-label"><i class="ti ti-shield-star me-1"></i>Administrator</span></label>
          </div></div>
          <div class="text-danger small mt-2" id="userError" role="alert"></div>
        </div>
        <div class="card-footer text-end"><button class="btn btn-primary"><i class="ti ti-user-plus me-2"></i>Add user</button></div>
      </form></div>
      <div class="col-12"><div class="card">
        <div class="card-header"><h3 class="card-title">Audit log</h3><div class="card-actions text-secondary small">Newest first</div></div>
        <div class="table-responsive"><table class="table table-vcenter card-table table-striped">
          <thead><tr><th>When</th><th>Who</th><th>Event</th><th>Detail</th><th>Address</th></tr></thead>
          <tbody>${rows.map((r) => { const [icon, color, verb] = ACTION[r.action] ?? ['point', 'secondary', r.action]; return `<tr>
            <td class="text-secondary text-nowrap">${when(r.at)}</td><td>${esc(r.user ?? '—')}</td>
            <td><span class="badge bg-${color}-lt"><i class="ti ti-${icon} me-1"></i>${esc(verb)}</span></td>
            <td class="text-secondary">${esc(r.detail ?? '')}</td><td class="text-secondary font-monospace small">${esc(r.ip ?? '')}</td></tr>`; }).join('')}</tbody>
        </table></div>
      </div></div>
    </div>`,
  });
  view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirm'; b.classList.replace('btn-ghost-danger', 'btn-danger'); return; }
    try { await api('/users/' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' }); admin(); } catch (e) { document.getElementById('userError').textContent = e.message; }
  });
  document.getElementById('addUser').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', json: { name: val('nu-name'), displayName: val('nu-display'), password: document.getElementById('nu-pass').value, role: view.querySelector('input[name=role]:checked').value } });
      admin();
    } catch (err) { document.getElementById('userError').textContent = err.message; }
  };
}
const val = (id) => document.getElementById(id).value.trim();

// ---------- Account ----------
async function account() {
  page({
    pretitle: 'Settings', title: 'My account',
    body: `<div class="row row-cards">
      <div class="col-md-5 col-lg-4"><div class="card"><div class="card-body text-center py-4">
        <span class="avatar avatar-xl bg-primary-lt mb-3">${esc(initials(me.displayName))}</span>
        <h3 class="m-0 mb-1">${esc(me.displayName)}</h3><div class="text-secondary">${esc(me.name)}</div>
        <div class="mt-3"><span class="badge ${me.role === 'admin' ? 'bg-purple-lt' : 'bg-secondary-lt'}">${me.role === 'admin' ? 'Administrator' : 'User'}</span></div>
      </div><div class="card-footer"><button class="btn w-100" id="logout2"><i class="ti ti-logout me-2"></i>Sign out</button></div></div></div>
      <div class="col-md-7 col-lg-8"><form class="card" id="pw">
        <div class="card-header"><h3 class="card-title">Change password</h3></div>
        <div class="card-body">
          <div class="mb-3"><label class="form-label" for="pw-cur">Current password</label><input class="form-control" id="pw-cur" type="password" autocomplete="current-password" required /></div>
          <div class="mb-3"><label class="form-label" for="pw-new">New password</label><input class="form-control" id="pw-new" type="password" autocomplete="new-password" required minlength="10" />
            <div class="progress progress-sm mt-2"><div class="progress-bar" id="pwMeter" style="width:0%"></div></div><small class="form-hint" id="pwHint">At least 10 characters. A short phrase is easier to remember.</small></div>
          <div class="small" id="pwMsg" role="status"></div>
        </div>
        <div class="card-footer text-end"><button class="btn btn-primary">Change password</button></div>
      </form></div>
    </div>`,
  });
  document.getElementById('logout2').onclick = signOut;
  document.getElementById('pw-new').oninput = (e) => {
    const v = e.target.value, score = Math.min(100, v.length * 6 + (/[A-Z]/.test(v) ? 10 : 0) + (/\d/.test(v) ? 10 : 0) + (/[^\w]/.test(v) ? 15 : 0));
    const bar = document.getElementById('pwMeter');
    bar.style.width = score + '%';
    bar.className = 'progress-bar ' + (score < 50 ? 'bg-danger' : score < 80 ? 'bg-warning' : 'bg-success');
  };
  document.getElementById('pw').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pwMsg');
    try {
      await api('/me/password', { method: 'POST', json: { current: document.getElementById('pw-cur').value, new: document.getElementById('pw-new').value } });
      msg.innerHTML = '<span class="text-success"><i class="ti ti-circle-check me-1"></i>Password changed.</span>'; e.target.reset();
    } catch (err) { msg.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`; }
  };
}

// ---------- Start ----------
async function signOut() { await api('/logout', { method: 'POST' }).catch(() => {}); location.href = 'login.html'; }
document.getElementById('logout').onclick = signOut;
try {
  me = await api('/me');
  document.getElementById('meName').textContent = me.displayName;
  document.getElementById('meRole').textContent = me.role === 'admin' ? 'Administrator' : 'User';
  document.getElementById('meAvatar').textContent = initials(me.displayName);
  document.getElementById('adminNav').hidden = me.role !== 'admin';
  addEventListener('hashchange', route);
  route();
} catch { /* redirected to sign-in */ }

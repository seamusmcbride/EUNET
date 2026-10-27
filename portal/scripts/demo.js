// Demo mode: answers the portal's API calls in the browser with sample data. Not shipped with the real portal.
(() => {
  const day = 86400000, now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const seeded = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  const users = [
    { name: 'seamus', displayName: 'Seamus McBride', role: 'admin', created: iso(now - 40 * day) },
    { name: 'mary.kelly', displayName: 'Mary Kelly', role: 'user', created: iso(now - 33 * day) },
    { name: 'tom.byrne', displayName: 'Tom Byrne', role: 'admin', created: iso(now - 30 * day) },
    { name: 'aoife.walsh', displayName: 'Aoife Walsh', role: 'user', created: iso(now - 12 * day) },
    { name: 'niall.doyle', displayName: 'Niall Doyle', role: 'user', created: iso(now - 4 * day) },
  ];
  const files = new Map(); // path -> { isFolder, size, modified, blob }
  const addFolder = (path, age) => files.set(path, { isFolder: true, size: 0, modified: iso(now - age) });
  const addFile = (path, size, age, blob) => files.set(path, { isFolder: false, size, modified: iso(now - age), blob });
  ['Certificates', 'Contracts', 'Finance', 'Photos', 'Projects', 'Projects/Dublin office fit-out'].forEach((f, i) => addFolder(f, (i + 2) * day));
  [['Network design v3.pdf', 245760, 2 * day], ['Q3 budget.xlsx', 52010, 3 * day], ['Site survey notes.docx', 87950, 5 * day], ['Kickoff notes.md', 2140, 6 * day],
    ['Certificates/root-ca.crt', 1932, 9 * day], ['Certificates/issuing-ca-2026.crt', 2210, 9 * day], ['Certificates/web01.csr', 1104, day],
    ['Finance/Invoices October.pdf', 412300, day], ['Projects/Dublin office fit-out/Floor plan.pdf', 1820400, 7 * day],
  ].forEach(([p, s, a]) => addFile(p, s, a));
  ['1015', '1018', '1036', '1043'].forEach((id, i) => addFile(`Photos/Site photo ${i + 1}.jpg`, 180000 + i * 23000, (i + 1) * day, `showcase/img/${id}.jpg`));

  const audit = [];
  const log = (at, user, action, detail) => audit.push({ at: iso(at), user, ip: user === 'unknown' ? '185.220.101.7' : `10.0.0.${users.findIndex((u) => u.name === user) + 20}`, action, detail });
  for (let d = 13; d >= 0; d--) {
    const base = now - d * day - 6 * 3600000;
    const n = 2 + Math.floor(seeded() * 6);
    for (let i = 0; i < n; i++) log(base + i * 1500000, users[Math.floor(seeded() * users.length)].name, 'login');
    for (let i = 0; i < Math.floor(seeded() * 5); i++) log(base + i * 1700000 + 900000, users[Math.floor(seeded() * users.length)].name, 'upload', 'Projects/notes.pdf');
    if (seeded() < 0.3) for (let i = 0; i < 1 + Math.floor(seeded() * 4); i++) log(base + 600000 + i * 20000, 'unknown', 'login-failed');
  }
  log(now - 3600000, 'mary.kelly', 'upload', 'Finance/Invoices October.pdf');
  log(now - 1800000, 'seamus', 'folder-created', 'Projects/Dublin office fit-out');
  log(now - 900000, 'tom.byrne', 'user-added', 'niall.doyle');
  log(now - 60000, 'seamus', 'login');
  audit.sort((a, b) => a.at.localeCompare(b.at));

  const json = (v) => JSON.parse(JSON.stringify(v));
  const err = (msg) => { throw new Error(msg); };
  const children = (folder) => [...files.entries()]
    .filter(([p]) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) === folder : folder === '')
    .map(([p, f]) => ({ name: p.split('/').pop(), path: p, isFolder: f.isFolder, size: f.size, modified: f.modified }))
    .sort((a, b) => (b.isFolder - a.isFolder) || a.name.localeCompare(b.name));
  const params = (path) => new URL(path, 'https://x').searchParams;

  async function demoApi(path, opts = {}) {
    await new Promise((r) => setTimeout(r, 120));
    const method = opts.method ?? 'GET', route = path.split('?')[0], q = params(path);
    if (route === '/me') return { name: 'seamus', displayName: 'Seamus McBride', role: 'admin' };
    if (route === '/logout') return null;
    if (route === '/status') {
      const list = [...files.values()].filter((f) => !f.isFolder);
      return { server: 'eunet-web-01', os: 'Ubuntu 24.04.5 LTS', runtime: '.NET 10.0.13', started: iso(now - 9 * day - 4 * 3600000), uptimeSeconds: 9 * 86400 + 4 * 3600,
        cpus: 8, processMemoryMb: 142, disk: { totalGb: 480, freeGb: 311 }, library: { files: list.length, bytes: list.reduce((a, f) => a + f.size, 0) }, users: users.length };
    }
    if (route === '/activity') {
      const days = [...Array(14)].map((_, i) => new Date(now - (13 - i) * day).toISOString().slice(0, 10));
      const count = (a) => days.map((d) => audit.filter((e) => e.at.startsWith(d) && e.action === a).length);
      return { days, signIns: count('login'), failedSignIns: count('login-failed'), uploads: count('upload') };
    }
    if (route === '/audit') return json(audit.slice(-(+q.get('take') || 50)).reverse());
    if (route === '/users' && method === 'GET') return json(users);
    if (route === '/users' && method === 'POST') {
      const b = opts.json;
      if (!/^[a-zA-Z0-9._-]{2,32}$/.test(b.name ?? '')) err('User names use 2-32 letters, numbers, dots, dashes or underscores.');
      if ((b.password ?? '').length < 10) err('Use at least 10 characters for the password.');
      if (users.some((u) => u.name.toLowerCase() === b.name.toLowerCase())) err('That user name is taken.');
      users.push({ name: b.name, displayName: b.displayName || b.name, role: b.role, created: iso(Date.now()) });
      log(Date.now(), 'seamus', 'user-added', b.name);
      return null;
    }
    if (route.startsWith('/users/') && method === 'DELETE') {
      users.splice(users.findIndex((u) => u.name === decodeURIComponent(route.slice(7))), 1);
      return null;
    }
    if (route === '/me/password') { if ((opts.json.new ?? '').length < 10) err('Use at least 10 characters.'); return null; }
    if (route === '/cameras') return [
      { name: 'Front entrance', location: 'Ground floor', type: 'snapshot', url: 'showcase/img/1043.jpg' },
      { name: 'Car park', location: 'North side', type: 'snapshot', url: 'showcase/img/1050.jpg' },
      { name: 'Loading bay', location: 'Rear yard', type: 'snapshot', url: 'showcase/img/1036.jpg' },
    ];
    if (route === '/files' && method === 'GET') return children(q.get('path') ?? '');
    if (route === '/files' && method === 'DELETE') {
      const p = q.get('path');
      if (files.get(p)?.isFolder && children(p).length) err('Empty the folder first.');
      files.delete(p);
      return null;
    }
    if (route === '/files/folder') {
      const p = [opts.json.path, opts.json.name.trim()].filter(Boolean).join('/');
      if (files.has(p)) err('Something with that name already exists.');
      addFolder(p, 0); log(Date.now(), 'seamus', 'folder-created', p);
      return p;
    }
    if (route === '/files/upload') {
      const dir = q.get('path') ?? '';
      for (const f of opts.body.getAll('files')) {
        const p = [dir, f.name].filter(Boolean).join('/');
        addFile(p, f.size, 0, URL.createObjectURL(f)); log(Date.now(), 'seamus', 'upload', p);
      }
      return [];
    }
    err('Not available in the demo.');
  }
  demoApi.url = (path) => files.get(path)?.blob ?? '#';
  window.EUNET_DEMO = demoApi;
})();

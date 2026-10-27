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
    if (route === '/certs') {
      const c = (cn, days, life, alg, size, sig, isCa, self, names, warnings, status, path) => ({
        path, index: 0, subject: `CN=${cn}, O=EUNET, C=IE`, commonName: cn, issuer: self ? `CN=${cn}, O=EUNET, C=IE` : isCa ? 'CN=EUNET Root CA 2026, O=EUNET, C=IE' : 'CN=EUNET Issuing CA 1, O=EUNET, C=IE',
        notBefore: iso(now + (days - life) * day), notAfter: iso(now + days * day), daysLeft: days, keyAlgorithm: alg, keySize: size, signatureAlgorithm: sig,
        isCa, selfSigned: self, names, sha256: [...Array(32)].map(() => Math.floor(seeded() * 256).toString(16).padStart(2, '0')).join('').toUpperCase(),
        serial: [...Array(16)].map(() => Math.floor(seeded() * 16).toString(16)).join('').toUpperCase(), status, warnings, foundIn: [path] });
      return [
        c('old-intranet.eunet.local', -298, 366, 'RSA', 2048, 'sha256RSA', false, false, ['old-intranet.eunet.local'], ['Expired'], 'invalid', 'Certificates/old-intranet.crt'),
        c('vpn.eunet.local', 11, 90, 'ECDSA', 256, 'sha256ECDSA', false, false, ['vpn.eunet.local'], ['Expires in 11 days'], 'warning', 'Certificates/vpn.crt'),
        c('portal.eunet.local', 74, 90, 'RSA', 2048, 'sha256RSA', false, false, ['portal.eunet.local', 'eunet.example.com'], [], 'ok', 'Certificates/portal.crt'),
        c('web01.eunet.local', 199, 200, 'RSA', 2048, 'sha256RSA', false, false, ['web01.eunet.local'], [], 'ok', 'Certificates/web01.der'),
        c('legacy-app.eunet.local', 299, 300, 'RSA', 1024, 'sha1RSA', false, false, ['legacy-app.eunet.local'], ['Weak key: RSA 1024', 'Weak signature: sha1RSA'], 'warning', 'Certificates/legacy-app.crt'),
        c('EUNET Issuing CA 1', 1824, 1825, 'RSA', 3072, 'sha256RSA', true, false, [], [], 'ok', 'Certificates/issuing-chain.pem'),
        c('EUNET Root CA 2026', 3649, 3650, 'RSA', 4096, 'sha256RSA', true, true, [], [], 'ok', 'Certificates/root-ca.crt'),
      ];
    }
    if (route === '/ai/models') return { available: true, models: ['qwen2.5:3b', 'llama3.2:3b', 'gemma3:4b'], selected: 'qwen2.5:3b' };
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
  // The real assistant streams from a model on the server; the demo types out a canned answer
  demoApi.chat = async (messages, onText) => {
    const q = messages.at(-2)?.content ?? '';
    const answer = /\bca\b|certificate|csr/i.test(q)
      ? 'A **root CA** is the top of the trust chain. Its key signs only a few certificates and is usually kept offline.\n\nAn **issuing CA** is signed by the root and does the day-to-day work:\n- issues certificates to servers and users\n- publishes revocation lists\n- can be replaced without rebuilding trust\n\n(Demo answer. On your server this comes from the local model.)'
      : `This is the demo, so I can't run a model here. On your server the assistant answers "${q.slice(0, 80)}" using the local model you've installed with Ollama, and the conversation never leaves the machine.`;
    for (const word of answer.split(/(?<=\s)/)) { onText(word); await new Promise((r) => setTimeout(r, 25)); }
  };
  window.EUNET_DEMO = demoApi;
})();

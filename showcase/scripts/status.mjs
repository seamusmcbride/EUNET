// Writes public/status.json for the project dashboard: git history, project list and a machine snapshot.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const version = (cmd) => sh(cmd).split('\n')[0] || null;

const commits = sh('git log -n 30 --pretty=format:%h%x09%aI%x09%s')
  .split('\n').filter(Boolean)
  .map((l) => { const [hash, date, subject] = l.split('\t'); return { hash, date, subject }; });

const disk = sh("df -k / | tail -1").split(/\s+/);

const status = {
  generated: new Date().toISOString(),
  branch: sh('git rev-parse --abbrev-ref HEAD'),
  repo: 'seamusmcbride/eunet',
  commits,
  machine: {
    os: sh('grep PRETTY_NAME /etc/os-release').replace(/PRETTY_NAME="?|"/g, '') || os.type(),
    cpu: `${os.cpus().length} × ${os.cpus()[0]?.model.replace(/\s+/g, ' ') ?? 'CPU'}`,
    memoryGb: +(os.totalmem() / 2 ** 30).toFixed(1),
    memoryFreeGb: +(os.freemem() / 2 ** 30).toFixed(1),
    diskUsedGb: disk[2] ? +(disk[2] / 2 ** 20).toFixed(1) : null,
    diskSizeGb: disk[1] ? +(disk[1] / 2 ** 20).toFixed(1) : null,
    uptimeMin: Math.round(os.uptime() / 60),
    load: os.loadavg().map((n) => +n.toFixed(2)),
  },
  tools: {
    node: process.version,
    python: version('python3 --version'),
    dotnet: version('dotnet --version'),
    powershell: version("pwsh -NoLogo -c '$PSVersionTable.PSVersion.ToString()'"),
    nginx: version('nginx -v 2>&1'),
    docker: version('docker --version'),
    git: version('git --version'),
  },
};

writeFileSync(new URL('../public/status.json', import.meta.url), JSON.stringify(status, null, 2));
console.log(`status.json: ${commits.length} commits, uptime ${status.machine.uptimeMin} min`);

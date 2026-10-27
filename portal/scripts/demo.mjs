// Builds demo-dist/: the portal front end with sample data in place of the server, for previewing without a backend.
import { cpSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('demo-dist/', root);
rmSync(out, { recursive: true, force: true });
cpSync(new URL('wwwroot/', root), out, { recursive: true, filter: (src) => !src.includes('/wwwroot/showcase') });
cpSync(new URL('scripts/demo.js', root), new URL('demo.js', out));

const showcase = new URL('../showcase/dist/', root);
if (existsSync(showcase)) cpSync(showcase, new URL('showcase/', out), { recursive: true });
else console.warn('Build the showcase first to include the games in the demo.');

// Load demo.js before the app scripts
for (const page of ['index.html', 'login.html']) {
  const file = new URL(page, out);
  writeFileSync(file, readFileSync(file, 'utf8').replace('<script src="theme.js"></script>', '<script src="theme.js"></script>\n  <script src="demo.js"></script>'));
}
// Hosts that serve the start page as index.html need the sign-in page there, so the app moves to app.html
renameSync(new URL('index.html', out), new URL('app.html', out));
const loginJs = new URL('login.js', out);
writeFileSync(loginJs, readFileSync(loginJs, 'utf8').replaceAll("'index.html'", "'app.html'"));
console.log('Demo written to demo-dist/');

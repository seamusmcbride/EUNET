// Copies the UI libraries from node_modules into wwwroot/lib so the site serves them itself (no CDN).
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const lib = new URL('../wwwroot/lib/', import.meta.url);
const nm = new URL('../node_modules/', import.meta.url);
rmSync(lib, { recursive: true, force: true });
const copy = (from, to) => { mkdirSync(new URL('.', new URL(to, lib)), { recursive: true }); cpSync(new URL(from, nm), new URL(to, lib), { recursive: true }); };

copy('@tabler/core/dist/css/tabler.min.css', 'tabler/tabler.min.css');
copy('@tabler/core/dist/js/tabler.min.js', 'tabler/tabler.min.js');
copy('@tabler/icons-webfont/dist/tabler-icons.min.css', 'tabler-icons/tabler-icons.min.css');
for (const ext of ['woff2', 'woff', 'ttf']) copy(`@tabler/icons-webfont/dist/fonts/tabler-icons.${ext}`, `tabler-icons/fonts/tabler-icons.${ext}`);
copy('apexcharts/dist/apexcharts.min.js', 'apexcharts/apexcharts.min.js');
console.log('Copied Tabler, Tabler Icons and ApexCharts to wwwroot/lib');

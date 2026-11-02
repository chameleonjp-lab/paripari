import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const site = resolve(root, '_site');
// A fresh CI checkout must have a fresh staging directory; never force-delete data.
mkdirSync(site);
for (const entry of ['index.html', 'src', 'assets']) cpSync(resolve(root, entry), resolve(site, entry), { recursive: true });
writeFileSync(resolve(site, '.nojekyll'), '');


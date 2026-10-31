import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const site = resolve(root, '_site');
rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
for (const entry of ['index.html', 'src']) cpSync(resolve(root, entry), resolve(site, entry), { recursive: true });
writeFileSync(resolve(site, '.nojekyll'), '');

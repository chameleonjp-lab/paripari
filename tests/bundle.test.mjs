import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../dist/paripari.html', import.meta.url), 'utf8');
const definitions = new Set([...html.matchAll(/def\('([^']+)'/g)].map(match => match[1]));
const required = new Set([...html.matchAll(/require\('([^']+)'/g)].map(match => match[1]));
for (const name of required) assert.ok(definitions.has(name), `Bundle missing module: ${name}`);
console.log('Bundle dependency closure verified');

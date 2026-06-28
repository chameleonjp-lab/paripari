// src/ の ES Modules を 1ファイル自己完結HTML (dist/paripari.html) にまとめる。
// サーバー不要で file:// から直接開いて遊べる形にバンドルする。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const r = (p) => resolve(root, p);

// 依存順（require は遅延評価なので順不同でも動くが、可読性のため整列）
const MODULES = [
  'config', 'judge', 'scoring', 'storage', 'haptics',
  'particles', 'input', 'enemy', 'renderer', 'ui', 'game', 'main',
];

function transform(name, src) {
  const exported = new Set();

  // import 文を require へ変換
  let code = src.replace(
    /^\s*import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]\.\/([A-Za-z0-9_$]+)\.js['"];?\s*$/gm,
    (_, ns, mod) => `const ${ns} = require('${mod}');`,
  ).replace(
    /^\s*import\s+\{([^}]+)\}\s+from\s+['"]\.\/([A-Za-z0-9_$]+)\.js['"];?\s*$/gm,
    (_, names, mod) => `const {${names.trim()}} = require('${mod}');`,
  );

  // export 宣言を通常宣言へ（名前を収集）
  code = code.replace(
    /^export\s+(async\s+)?(function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm,
    (_, asy, kind, id) => { exported.add(id); return `${asy || ''}${kind} ${id}`; },
  );
  // export { a, b } 形式
  code = code.replace(/^export\s*\{([^}]+)\}\s*;?\s*$/gm, (_, names) => {
    names.split(',').forEach((n) => { const id = n.trim().split(/\s+as\s+/)[0]; if (id) exported.add(id); });
    return '';
  });

  const tail = exported.size
    ? `\n  Object.assign(exports, { ${[...exported].join(', ')} });\n`
    : '\n';

  return `  def('${name}', function(module, exports, require){\n${code}\n${tail}  });`;
}

const defs = MODULES.map((m) => transform(m, readFileSync(r(`src/js/${m}.js`), 'utf8'))).join('\n\n');

const bundle = `(function(){
  var reg = {};
  function def(name, fn){ reg[name] = { fn: fn, mod: null }; }
  function require(name){
    var e = reg[name];
    if (!e) throw new Error('module not found: ' + name);
    if (!e.mod){ e.mod = { exports: {} }; e.fn(e.mod, e.mod.exports, require); }
    return e.mod.exports;
  }
${defs}

  require('main');
})();`;

// index.html を土台にCSS/JSをインライン化
let html = readFileSync(r('index.html'), 'utf8');
const css = readFileSync(r('src/css/style.css'), 'utf8');

html = html
  .replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`)
  .replace(/<script type="module"[^>]*><\/script>/, `<script>\n${bundle}\n</script>`);

mkdirSync(r('dist'), { recursive: true });
writeFileSync(r('dist/paripari.html'), html);
console.log('built dist/paripari.html (' + Math.round(html.length / 1024) + ' KB)');

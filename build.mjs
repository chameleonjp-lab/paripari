// 分割ソースを正本として、依存関係を検証した単一HTMLを生成する。
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));

export async function buildSingleHtml(sourceRoot = root) {
  const result = await build({
    absWorkingDir: sourceRoot,
    entryPoints: ['src/js/main.js'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    charset: 'utf8',
    legalComments: 'inline',
    metafile: true,
    logLevel: 'silent',
  });
  if (result.outputFiles.length !== 1 ||
      Object.values(result.metafile.outputs).some((output) => output.imports.length > 0)) {
    throw new Error('単一HTMLの外部依存が残っています。');
  }

  let html = await readFile(resolve(sourceRoot, 'index.html'), 'utf8');
  const css = await readFile(resolve(sourceRoot, 'src/css/style.css'), 'utf8');
  const styleTag = /<link\s+rel="stylesheet"\s+href="src\/css\/style\.css"\s*\/?\s*>/g;
  const scriptTag = /<script\s+type="module"\s+src="src\/js\/main\.js"\s*><\/script>/g;
  if ([...html.matchAll(styleTag)].length !== 1 || [...html.matchAll(scriptTag)].length !== 1) {
    throw new Error('CSSと起動処理の参照を各1件指定してください。');
  }
  const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  html = html.replace(styleTag, () => `<style>\n${css}\n</style>`)
    .replace(scriptTag, () => `<script>\n${script}\n</script>`);
  if (/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel=["']stylesheet["']/i.test(html) ||
      /@import\b|url\(\s*["']?(?!data:|#)/i.test(css)) {
    throw new Error('配布HTMLに外部スクリプトまたはCSSの依存が残っています。');
  }
  return { html, dependencies: Object.keys(result.metafile.inputs).sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { html, dependencies } = await buildSingleHtml();
    const output = resolve(root, 'dist/paripari.html');
    if (process.argv.includes('--check')) {
      if (await readFile(output, 'utf8') !== html) throw new Error('dist/paripari.htmlを再生成してください。');
      console.log('配布HTMLと分割ソースは一致しています。');
    } else {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, html);
      console.log(`built dist/paripari.html (${Math.round(Buffer.byteLength(html) / 1024)} KB; ${dependencies.length} modules)`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

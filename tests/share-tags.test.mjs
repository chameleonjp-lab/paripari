import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {setLanguage,t,formatNumber,languages} from '../src/js/i18n.js';
import {currentGameUrl} from '../src/js/platform.js';import {CONFIG} from '../src/js/config.js';
const source=readFileSync(new URL('../src/js/main.js',import.meta.url),'utf8');
function real(name){const fn=source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];assert.ok(fn);return new Function('t','formatNumber','currentGameUrl',`return (${fn})`)(t,formatNumber,currentGameUrl);}
const home=real('shareTextForHome'),result=real('shareTextForResult');
function weighted(text){return [...text.replace(/https:\/\/\S+/g,'x'.repeat(23))].reduce((n,ch)=>{const c=ch.codePointAt(0);return n+((c<=4351||(c>=8192&&c<=8205)||(c>=8208&&c<=8223)||(c>=8242&&c<=8247))?1:2)},0);}
for(const [lang] of languages)test(`${lang}: actual home/result text keeps details, formal tags and X length`,()=>{
 setLanguage(lang,{persist:false});
 const samples=[home(),...[0,999999,2147483647].map(score=>result({score,rank:score?'S':'C',maxCombo:score?1000000:0,perfectRate:score?100:0,tier:CONFIG.TIERS.length}))];
 for(const text of samples){assert.match(text,/#パリパリ #ゲーム制作/u);assert.ok(text.endsWith('https://chameleonjp-lab.github.io/paripari/'));assert.ok(weighted(text)<=280,`${lang}: weighted ${weighted(text)}`);}
 assert.ok(samples[1].includes(formatNumber(0)));assert.ok(samples[3].includes(formatNumber(2147483647)));
});

import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
import {isolateBrowserNetwork} from './browser-network-safety.mjs';
const languages=['ja','en','es','pt-BR','zh-Hans','fr','de','ko','ru','it','zh-Hant','id','tr','vi','th'];
const rankingURL='https://mlpnjgezrnhdxsxolyzj.supabase.co/rest/v1/rpc/get_best_score_ranking';
async function fixture(browser,baseURL,viewport){
 const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,locale:'ja-JP',serviceWorkers:'block'});
 await isolateBrowserNetwork(context,baseURL);
 await context.route(rankingURL,route=>route.fulfill({json:Array.from({length:30},(_,i)=>({rank_no:i+1,display_name:`Mock Player ${i+1}`,best_score:9000-i}))}));
 const page=await context.newPage(),errors=[],writes=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&request.url()!==rankingURL)writes.push('unexpected-write');});
 await page.addInitScript(()=>{window.__shareIntents=[];window.open=url=>{window.__shareIntents.push(url);return {opener:null}};});
 await page.goto(baseURL+'index.html');await page.waitForFunction(()=>window.PariPari);await page.locator('#screen-title').waitFor({state:'visible'});
 return {context,page,errors,writes};
}
function targetMetrics(el){
 const rect=el.getBoundingClientRect(),style=getComputedStyle(el);let opacity=1,visible=true;
 for(let node=el;node;node=node.parentElement){const s=getComputedStyle(node);opacity*=Number(s.opacity);if(node.hidden||s.display==='none'||['hidden','collapse'].includes(s.visibility))visible=false;}
 const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
 return {width:rect.width,height:rect.height,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,vw:innerWidth,vh:innerHeight,visible,opacity,hit:hit===el||el.contains(hit),disabled:el.disabled,text:el.textContent.trim(),background:style.backgroundColor,color:style.color,clipped:el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1};
}
async function settle(el){
 let previous='',stable=0;
 for(let frame=0;frame<120;frame++){
  await new Promise(resolve=>requestAnimationFrame(resolve));let active=false;
  for(let node=el;node;node=node.parentElement)if(node.getAnimations().some(a=>a.effect?.getTiming().iterations!==Infinity&&(a.pending||a.playState==='running')))active=true;
  const r=el.getBoundingClientRect(),key=JSON.stringify([r.x,r.y,r.width,r.height]);stable=!active&&key===previous?stable+1:0;previous=key;if(stable>=2)return;
 }
 throw Error('Share target layout did not stabilize: '+previous);
}
async function accept(page,selector,lang,screen,engine,dir){
 const button=page.locator(selector),sizes=['ja','en','de'].includes(lang)?[{width:393,height:852},{width:852,height:393},{width:393,height:600}]:[{width:393,height:852}];
 for(const size of sizes){
  const prefix=resolve(dir,`${engine}-${lang}-${screen}-${size.width}x${size.height}`);await page.setViewportSize(size);await button.scrollIntoViewIfNeeded();
  try{await button.evaluate(settle);}catch(error){await page.screenshot({path:prefix+'-stability-failure.png'});throw error;}
  const m=await button.evaluate(targetMetrics);await page.screenshot({path:prefix+'-diagnostic.png'});
  assert.ok(m.visible&&m.opacity===1&&!m.disabled&&m.hit,JSON.stringify(m));assert.ok(m.width>=44&&m.height>=44,JSON.stringify(m));assert.ok(m.left>=0&&m.right<=m.vw+1&&m.top>=0&&m.bottom<=m.vh+1);assert.equal(m.clipped,false);assert.equal(m.background,'rgb(0, 0, 0)');assert.equal(m.color,'rgb(255, 255, 255)');if(lang==='ja')assert.equal(m.text,'Xでシェア');
  await button.focus();await page.mouse.move((m.left+m.right)/2,(m.top+m.bottom)/2);await page.mouse.down();const pressed=await button.evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  if(['ja','en','de'].includes(lang))await page.screenshot({path:prefix+'-pressed.png'});await page.mouse.move(0,0);await page.mouse.up();assert.equal(pressed.background,'rgb(0, 0, 0)');assert.equal(pressed.color,'rgb(255, 255, 255)');
  const count=await page.evaluate(()=>window.__shareIntents.length);await button.tap();await page.waitForFunction(n=>window.__shareIntents.length===n+1,count);
  const url=new URL(await page.evaluate(()=>window.__shareIntents.at(-1)));assert.equal(url.origin,'https://x.com');assert.ok(['/intent/post','/intent/tweet'].includes(url.pathname));const text=url.searchParams.get('text');assert.match(text,/#パリパリ #ゲーム制作/u);assert.ok(text.includes('https://chameleonjp-lab.github.io/paripari/'));
  if(screen==='result')assert.ok(text.includes((await page.locator('#result-score').textContent()).trim()));
 }
}

export async function checkShareAcceptance(browser,engine,baseURL){
 const dir=resolve(process.env.PARIPARI_TEST_ARTIFACTS||'test-artifacts/share');mkdirSync(dir,{recursive:true});
 const {context,page,errors,writes}=await fixture(browser,baseURL,{width:393,height:852});
 try{
  const target=page.locator('#btn-home-share');for(const [property,value] of [['opacity','0'],['display','none']]){const old=await target.evaluate((el,[p,v])=>{const old=el.parentElement.style[p];el.parentElement.style[p]=v;return old;},[property,value]);try{const m=await target.evaluate(targetMetrics);assert.ok(!m.visible||m.opacity===0);}finally{await target.evaluate((el,[p,v])=>el.parentElement.style[p]=v,[property,old]);}}
  for(const lang of languages){await page.selectOption('#language',lang);await page.waitForFunction(l=>document.documentElement.lang===l,lang);await accept(page,'#btn-home-share',lang,'home',engine,dir);}
  await page.selectOption('#language','ja');await page.waitForFunction(()=>document.documentElement.lang==='ja');await page.fill('#player-name','');await page.setViewportSize({width:393,height:852});await page.click('#btn-play');
  await page.waitForFunction(()=>window.PariPari.game.isPlaying());
  await page.waitForFunction(()=>window.PariPari.game.state==='OVER',{},{timeout:15000});await page.locator('#screen-result').waitFor({state:'visible'});
  const snapshot=()=>{const g=window.PariPari.game;return {state:g.state,time:g.gameTime,hp:g.hp,score:g.score,maxCombo:g.maxCombo,attempts:g.totalAttempts}};
  const result=await page.evaluate(snapshot);assert.equal(result.hp,0);assert.ok(result.time>0);assert.deepEqual(writes,[]);
  for(const lang of languages){await page.evaluate(async lang=>(await import('/src/js/i18n.js')).setLanguage(lang),lang);await accept(page,'#btn-result-share',lang,'result',engine,dir);assert.deepEqual(await page.evaluate(snapshot),result);}
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log(JSON.stringify({engine,shareAcceptance15Locales:true,actualNaturalResult:result,anonymousScoreWrites:0}));
 }finally{await context.close();}
}
export async function captureShareMaterial(browser,engine,baseURL){
 const dir=resolve(process.env.PARIPARI_TEST_ARTIFACTS||'test-artifacts/share');mkdirSync(dir,{recursive:true});
 const {context,page,errors,writes}=await fixture(browser,baseURL,{width:1200,height:800});
 try{
  await page.selectOption('#language','ja');await page.fill('#player-name','');await page.click('#btn-play');await page.waitForFunction(()=>window.PariPari.game.isPlaying());
  await page.waitForFunction(()=>{const g=window.PariPari.game,a=g.attack;if(!a||a.resolved)return false;const progress=(g.gameTime-a.spawnAt)/(a.impactAt-a.spawnAt);return progress>=0.45&&progress<0.85;},{},{timeout:15000});
  const material=await page.evaluate(()=>{const canvas=document.querySelector('#game-canvas'),g=window.PariPari.game;return {png:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,state:g.state,attackDirection:g.attack?.dir}});
  assert.equal(material.state,'PLAYING');assert.ok(['L','R','U','D'].includes(material.attackDirection));assert.match(material.png,/^data:image\/png;base64,/);assert.ok(material.width>0&&material.height>0);writeFileSync(resolve(dir,`${engine}-actual-attack-canvas.png`),Buffer.from(material.png.split(',')[1],'base64'));await page.screenshot({path:resolve(dir,`${engine}-actual-attack-screen.png`)});
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log(JSON.stringify({engine,material:{width:material.width,height:material.height,state:material.state,attackDirection:material.attackDirection},anonymousScoreWrites:0}));
 }finally{await context.close();}
}

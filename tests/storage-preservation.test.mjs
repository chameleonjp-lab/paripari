import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const file = process.env.STORAGE_SOURCE || new URL('../src/js/storage.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8');
let sequence = 0;
async function setup(raw = null) {
  const values = new Map(raw === null ? [] : [['paripari.best', raw]]);
  let readsFail = false, writesFail = false;
  const writes = [];
  globalThis.localStorage = {
    getItem(k) { if (readsFail) throw Error('read refused'); return values.get(k) ?? null; },
    setItem(k, v) { if (writesFail) throw Error('write refused'); writes.push([k,v]); values.set(k,v); },
  };
  const api = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${sequence++}`).toString('base64')}`);
  return { api, values, writes, readFailure(v) { readsFail=v; }, writeFailure(v) { writesFail=v; } };
}
test('read refusal preserves unread original; recovery resumes monotonic updates', async () => {
 const h=await setup('900'); h.readFailure(true);
 assert.equal(h.api.getBest(),0); assert.equal(h.api.setBest(100),undefined);
 assert.equal(h.values.get('paripari.best'),'900'); assert.equal(h.writes.length,0);
 h.readFailure(false); assert.equal(h.api.getBest(),900); h.api.setBest(200); assert.equal(h.values.get('paripari.best'),'900');
 h.api.setBest(1000); assert.equal(h.values.get('paripari.best'),'1000');
});
for (const raw of ['{broken','unknown-format','100points','1e3','', 'Infinity','9007199254740993']) test(`unknown raw is preserved: ${JSON.stringify(raw)}`, async()=>{
 const h=await setup(raw); h.api.setBest(100); assert.equal(h.values.get('paripari.best'),raw); assert.equal(h.writes.length,0);
});
test('lower or equal results do not rewrite a known best', async()=>{
 const h=await setup('900'); h.api.setBest(100); h.api.setBest(900); assert.equal(h.values.get('paripari.best'),'900'); assert.equal(h.writes.length,0);
});
test('game getBest/setBest gap preserves a higher value written meanwhile',async()=>{
 const h=await setup('100'); assert.equal(h.api.getBest(),100); h.values.set('paripari.best','900'); h.api.setBest(200); assert.equal(h.values.get('paripari.best'),'900');
});
test('valid scores retain flooring and nonnegative clamp, keys and undefined return',async()=>{
 const h=await setup(); assert.equal(h.api.setBest(-1),undefined); assert.equal(h.api.getBest(),0);
 h.api.setBest(12.9); assert.equal(h.api.getBest(),12); assert.equal(h.values.get('paripari.best'),'12'); assert.deepEqual([...h.values.keys()],['paripari.best']);
});
test('recognized padded decimal retains old read meaning without unnecessary rewrite',async()=>{
 const h=await setup(' 00900 '); assert.equal(h.api.getBest(),900); h.api.setBest(200); assert.equal(h.values.get('paripari.best'),' 00900 '); h.api.setBest(1000); assert.equal(h.values.get('paripari.best'),'1000');
});
for (const n of [NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1,undefined,null,'200']) test(`invalid non-game score does not change data: ${String(n)}`,async()=>{
 const h=await setup('100'); h.api.setBest(n); assert.equal(h.values.get('paripari.best'),'100'); assert.equal(h.writes.length,0);
});
test('write failure keeps original and remains nonthrowing',async()=>{
 const h=await setup('100'); h.writeFailure(true); assert.equal(h.api.setBest(900),undefined); assert.equal(h.values.get('paripari.best'),'100');
});
test('settings remain unchanged by best update',async()=>{
 const h=await setup('100'); h.values.set('paripari.settings','{"vibrate":false,"reducedMotion":true}');
 h.api.setBest(900); assert.deepEqual(h.api.getSettings(),{vibrate:false,reducedMotion:true});
 h.api.setSettings({vibrate:true,reducedMotion:false}); assert.equal(h.values.get('paripari.settings'),'{"vibrate":true,"reducedMotion":false}');
});

import assert from 'node:assert/strict';
import { GameSound, soundPreferences } from '../src/js/sound.js';
assert.deepEqual(soundPreferences(), {enabled:true,volume:0.35});
assert.deepEqual(soundPreferences({sound:false,volume:0}), {enabled:false,volume:0});
assert.deepEqual(soundPreferences({sound:'false',volume:-1}), {enabled:true,volume:0.35});
let starts=0, stops=0;
const context={state:'suspended',currentTime:1,destination:{},resume:async function(){this.state='running';},suspend:async function(){this.state='suspended';},
  createOscillator:()=>({frequency:{},connect(){},disconnect(){},start(){starts++;},stop(){stops++;}}),
  createGain:()=>({gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}})};
const sound=new GameSound({},()=>context);
await sound.unlock(); sound.play('start'); assert.equal(starts,2);
sound.play('good'); assert.equal(starts,2,'rapid duplicate is suppressed');
context.currentTime+=1; sound.play('perfect'); assert.equal(starts,4); assert.equal(sound.voices.size,2);
sound.play('result'); assert.equal(starts,6,'result supersedes final hit'); assert.ok(stops>=4);
sound.configure({sound:false,volume:0.8}); assert.equal(sound.voices.size,0); sound.play('start'); assert.equal(starts,6);
sound.configure({sound:true,volume:0}); sound.play('start'); assert.equal(starts,6);
sound.configure({sound:true,volume:0.35}); sound.suspend(); assert.equal(context.state,'suspended');
context.currentTime+=10; sound.play('perfect'); assert.equal(starts,6,'old cues never replay after suspension');
await sound.unlock(); assert.equal(starts,6); sound.play('perfect'); assert.equal(starts,8);
await new GameSound({},()=>{throw Error('unsupported');}).unlock();
console.log('Audio preferences, bounded voices, priority, suspend and unavailable audio verified');

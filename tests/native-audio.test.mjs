import test from 'node:test';
import assert from 'node:assert/strict';
import {GameSound} from '../src/js/sound.js';
function fixture(){let stopped=0,disconnected=0; const c={state:'running',currentTime:1,destination:{},resume(){this.state='running';return Promise.resolve()},createOscillator(){return {frequency:{},connect(){},disconnect(){disconnected++},start(){},stop(){stopped++}}},createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){disconnected++}}}}; return {c,get stopped(){return stopped},get disconnected(){return disconnected}}}
test('native interruption immediately releases current voices',async()=>{const f=fixture(),s=new GameSound({},()=>f.c);await s.unlock();s.play('start');assert.equal(s.voices.size,2);f.c.state='interrupted';f.c.onstatechange?.();assert.equal(s.voices.size,0);assert.equal(f.disconnected,4)});

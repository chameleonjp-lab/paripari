import test from 'node:test';import assert from 'node:assert/strict';import {acknowledgeResult,OUTBOX_KEY} from '../src/js/outbox.js';
const id='00000000-0000-4000-8000-000000000099',expected={run:{name:'A',startId:'00000000-0000-4000-8000-000000000098',submissionId:id,clientVersion:'v1'},result:{score:1}};
test('missing per-ID raw cannot acknowledge different fallback legacy payload',()=>{const raw=JSON.stringify({version:1,entries:[{...expected,result:{score:2}}]}),m=new Map([[OUTBOX_KEY,raw]]),s={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};assert.throws(()=>acknowledgeResult(s,id,expected),/conflict/i);assert.equal(m.get(OUTBOX_KEY),raw);assert.equal(m.has(OUTBOX_KEY+':'+id),false)});

import {createRun,submitSavedResult} from '../src/js/ranking.js';
import {readOutbox,isAcknowledged} from '../src/js/outbox.js';
function memory(){const m=new Map();return {get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}}
function responses(name,p,patch={}){
 if(name==='start_game_play_v1')return {accepted:true,play_id:'11111111-1111-4111-8111-111111111111',game_slug:p.p_game_slug,client_version:p.p_client_version,start_id:p.p_start_id,display_name:p.p_display_name,normalized_name:p.p_display_name,duplicate:false};
 if(name==='finish_game_play_v1')return {accepted:true,play_id:p.p_play_id,game_slug:p.p_game_slug,result_type:p.p_result_type,reached_wave:p.p_reached_wave,score:p.p_score,duplicate:false};
 return [{accepted:true,result_submission_id:p.p_submission_id,result_play_id:p.p_play_id,was_duplicate:false,result_normalized_name:p.p_display_name,result_display_name:p.p_display_name,result_first_score:100,result_best_score:100,result_play_count:1,is_first_play:true,is_new_best:true,...patch}];
}
for(const [label,patch]of Object.entries({firstOverflow:{result_first_score:2147483648},firstUnderflow:{result_first_score:-2147483649},bestOverflow:{result_best_score:2147483648},bestUnderflow:{result_best_score:-2147483649},countOverflow:{result_play_count:2147483648}})){
 test(`dedicated submit rejects ${label} and preserves exact retry receipt`,async()=>{
 const storage=memory(),run=createRun('A'),result={score:100},submits=[];let responsePatch=patch;
 const rpc=async(n,p)=>{if(n==='submit_score_idempotent_v1')submits.push(structuredClone(p));return responses(n,p,responsePatch)};
 await assert.rejects(submitSavedResult(storage,run,result,rpc),/malformed/);
 assert.equal(isAcknowledged(storage,run.submissionId),false);const pending=readOutbox(storage);assert.equal(pending.length,1);
 responsePatch={was_duplicate:true};await submitSavedResult(storage,pending[0].run,pending[0].result,rpc);
 assert.equal(readOutbox(storage).length,0);assert.equal(isAcknowledged(storage,run.submissionId),true);assert.deepEqual(submits[1],submits[0]);
 });
}
for(const first of [-2147483648,-1,0,2147483647])test(`dedicated submit preserves signed historical first ${first}`,async()=>{const storage=memory(),run=createRun('A');await submitSavedResult(storage,run,{score:100},async(n,p)=>responses(n,p,{result_first_score:first,result_best_score:2147483647,result_play_count:2147483647}));assert.equal(isAcknowledged(storage,run.submissionId),true)});

test('valid duplicate may return the current aggregate display without changing receipt identity',async()=>{const storage=memory(),run=createRun('Alice');await submitSavedResult(storage,run,{score:100},async(n,p)=>responses(n,p,{was_duplicate:true,result_display_name:'Current display'}));assert.equal(isAcknowledged(storage,run.submissionId),true)});
for(const display of [null,undefined,'   ','a'.repeat(21),123])test(`duplicate display must be a valid string: ${String(display)}`,async()=>{const storage=memory(),run=createRun('Alice');await assert.rejects(submitSavedResult(storage,run,{score:100},async(n,p)=>responses(n,p,{was_duplicate:true,result_display_name:display})),/malformed/);assert.equal(readOutbox(storage).length,1);assert.equal(isAcknowledged(storage,run.submissionId),false)});

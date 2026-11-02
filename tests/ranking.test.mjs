import assert from 'node:assert/strict';
import { createRun, submitRun, loadTopRanking } from '../src/js/ranking.js';
const calls = [];
let lost = true;
const rpc = async (name, payload) => {
  calls.push([name,payload]);
  if(name === 'start_game_play_v1') return {accepted:true,play_id:'11111111-1111-4111-8111-111111111111',game_slug:payload.p_game_slug,client_version:payload.p_client_version,start_id:payload.p_start_id,display_name:payload.p_display_name,normalized_name:payload.p_display_name,duplicate:false};
  if(name === 'submit_score_idempotent_v1' && lost) { lost=false; throw new Error('response lost'); }
  return name==='finish_game_play_v1' ? {accepted:true,play_id:payload.p_play_id,game_slug:payload.p_game_slug,result_type:payload.p_result_type,reached_wave:payload.p_reached_wave,score:payload.p_score,duplicate:false} : [{accepted:true,result_submission_id:payload.p_submission_id,result_play_id:payload.p_play_id,was_duplicate:false,result_normalized_name:payload.p_display_name,result_display_name:payload.p_display_name,result_first_score:123,result_best_score:123,result_play_count:1,is_first_play:true,is_new_best:true}];
};
const anon=createRun('  ',()=> 'id');
await submitRun(anon,123,rpc);
assert.equal(calls.length,0);
const run=createRun(' Alice ',()=> 'id');
assert.equal(run.name,'Alice');
assert.ok(Object.isFrozen(run));
await assert.rejects(submitRun(run,123,rpc),/response lost/);
await Promise.all([submitRun(run,123,rpc),submitRun(run,123,rpc)]);
const submissions=calls.filter(x=>x[0]==='submit_score_idempotent_v1');
assert.equal(submissions.length,2);
assert.deepEqual(submissions[0],submissions[1]);
await submitRun(run,123,rpc);
assert.equal(calls.filter(x=>x[0]==='submit_score_idempotent_v1').length,2);
let fetched;
await loadTopRanking(async (...args)=> {fetched=args;return []});
assert.deepEqual(fetched,['get_best_score_ranking',{p_game_slug:'paripari',p_limit:30}]);
console.log('Optional participation, immutable run, idempotent retry and top30 verified');

for (const malformed of [{}, {accepted:'true'}, {accepted:false}, {accepted:true,result_submission_id:'wrong',result_play_id:'11111111-1111-4111-8111-111111111111',was_duplicate:true}]) {
 let n=0,attempts=0;const requests=[];const frozen=createRun('Frozen',()=>`malformed-${JSON.stringify(malformed)}-${n++}`);
 const gateway=async(name,payload)=>{
  if(name==='start_game_play_v1')return {accepted:true,play_id:'11111111-1111-4111-8111-111111111111',game_slug:payload.p_game_slug,client_version:payload.p_client_version,start_id:payload.p_start_id,display_name:payload.p_display_name,normalized_name:payload.p_display_name,duplicate:false};
  if(name==='finish_game_play_v1')return {accepted:true,play_id:payload.p_play_id,game_slug:payload.p_game_slug,result_type:payload.p_result_type,reached_wave:payload.p_reached_wave,score:payload.p_score,duplicate:false};
  requests.push({...payload});if(++attempts===1)return malformed;
  return [{accepted:true,result_submission_id:payload.p_submission_id,result_play_id:payload.p_play_id,was_duplicate:true,result_normalized_name:payload.p_display_name,result_display_name:payload.p_display_name,result_first_score:42,result_best_score:42,result_play_count:1,is_first_play:true,is_new_best:true}];
 };
 await assert.rejects(submitRun(frozen,42,gateway));await submitRun(frozen,42,gateway);
 assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
}
console.log('Malformed and mismatched acknowledgements keep the exact retry payload');

for(const malformed of [null,{},[null],[{rank_no:0,display_name:'A',best_score:1}],[{rank_no:1,display_name:'A',best_score:'1'}]]) {
 await assert.rejects(loadTopRanking(async()=>malformed),/malformed/);
}
// The live specialized contract has JSON objects for start/finish, and one TABLE row for submit.
const contractRun=createRun('Contract',()=>crypto.randomUUID());
const fullAck=p=>[{accepted:true,result_submission_id:p.p_submission_id,result_play_id:p.p_play_id,result_normalized_name:p.p_display_name,result_display_name:p.p_display_name,result_first_score:42,result_best_score:42,result_play_count:1,is_first_play:true,is_new_best:true,was_duplicate:false}];
const playId='11111111-1111-4111-8111-111111111111';
const stages={
 start_game_play_v1:p=>({accepted:true,play_id:playId,game_slug:p.p_game_slug,client_version:p.p_client_version,duplicate:false,start_id:p.p_start_id,display_name:p.p_display_name,normalized_name:p.p_display_name}),
 finish_game_play_v1:p=>({accepted:true,play_id:p.p_play_id,game_slug:p.p_game_slug,result_type:p.p_result_type,reached_wave:p.p_reached_wave,score:p.p_score,duplicate:false}),
 submit_score_idempotent_v1:fullAck,
};
for(const bad of [p=>fullAck(p)[0],p=>[{...fullAck(p)[0],result_normalized_name:'Other'}],p=>[{...fullAck(p)[0],result_play_count:0}],p=>[{...fullAck(p)[0],is_new_best:'true'}]]) {
 const run=createRun('Contract',()=>crypto.randomUUID());
 await assert.rejects(submitRun(run,42,async(n,p)=>n==='submit_score_idempotent_v1'?bad(p):stages[n](p)));
}
await submitRun(contractRun,42,async(n,p)=>stages[n](p));
const { submitSavedResult } = await import('../src/js/ranking.js');
let attempted=0;
await assert.rejects(submitSavedResult({getItem:()=>null,setItem(){throw Error('quota')}},createRun('A'),{score:42},async()=>{attempted++}));
assert.equal(attempted,0,'quota failure must prevent the first public result request');

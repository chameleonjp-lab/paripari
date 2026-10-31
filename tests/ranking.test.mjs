import assert from 'node:assert/strict';
import { createRun, submitRun, loadTopRanking } from '../src/js/ranking.js';
const calls = [];
let lost = true;
const rpc = async (name, payload) => {
  calls.push([name,payload]);
  if(name === 'start_game_play_v1') return {accepted:true,play_id:'server-play',game_slug:payload.p_game_slug,client_version:payload.p_client_version};
  if(name === 'submit_score_idempotent_v1' && lost) { lost=false; throw new Error('response lost'); }
  return name==='finish_game_play_v1' ? [{accepted:true,play_id:payload.p_play_id}] : [{accepted:true,result_submission_id:payload.p_submission_id,result_play_id:payload.p_play_id,was_duplicate:false}];
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

for (const malformed of [{}, {accepted:'true'}, {accepted:false}, {accepted:true,result_submission_id:'wrong',result_play_id:'server-play',was_duplicate:true}]) {
 let n=0,attempts=0;const requests=[];const frozen=createRun('Frozen',()=>`malformed-${JSON.stringify(malformed)}-${n++}`);
 const gateway=async(name,payload)=>{
  if(name==='start_game_play_v1')return {accepted:true,play_id:'server-play',game_slug:payload.p_game_slug,client_version:payload.p_client_version};
  if(name==='finish_game_play_v1')return {accepted:true,play_id:payload.p_play_id};
  requests.push({...payload});if(++attempts===1)return malformed;
  return {accepted:true,result_submission_id:payload.p_submission_id,result_play_id:payload.p_play_id,was_duplicate:true};
 };
 await assert.rejects(submitRun(frozen,42,gateway));await submitRun(frozen,42,gateway);
 assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
}
console.log('Malformed and mismatched acknowledgements keep the exact retry payload');

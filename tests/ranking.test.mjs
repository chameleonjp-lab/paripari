import assert from 'node:assert/strict';
import { createRun, submitRun, loadTopRanking } from '../src/js/ranking.js';
const calls = [];
let lost = true;
const rpc = async (name, payload) => {
  calls.push([name,payload]);
  if(name === 'start_game_play_v1') return {accepted:true,play_id:'server-play'};
  if(name === 'submit_score_idempotent_v1' && lost) { lost=false; throw new Error('response lost'); }
  return [{accepted:true}];
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

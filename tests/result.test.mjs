import test from 'node:test';
import assert from 'node:assert/strict';
import {validResult, saveResult} from '../src/js/result.js';
const good={practiceDone:false,score:100,best:200,isBest:false,maxCombo:1,perfectRate:0,tier:1,rank:'C'};
test('restore rejects malformed and contradictory result fields',()=>{
 assert.equal(validResult(good),true);
 for(const patch of [{rank:'S'},{best:1},{tier:7},{perfectRate:101},{maxCombo:-1},{practiceDone:true},{isBest:'false'}])assert.equal(validResult({...good,...patch}),false);
});
test('silent snapshot rejection is detected even with a guest result',()=>{
 assert.throws(()=>saveResult({setItem(){},getItem:()=>null},'snapshot',{run:{name:''},result:good}),/persist/);
});

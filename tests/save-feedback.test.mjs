import test from 'node:test';
import assert from 'node:assert/strict';
import {validResult} from '../src/js/result.js';
import {setBestLabel} from '../src/js/ui.js';
import * as storage from '../src/js/storage.js';
import {Game} from '../src/js/game.js';
import {showResult} from '../src/js/ui.js';
const rows=[];
function observe({name,raw,score,readFail=false,writeFail=false,noop=false,secondRead}) {
 const values=new Map(raw===null?[]:[['paripari.best',raw]]), writes=[], sounds=[]; let reads=0,result,savedBest;
 globalThis.localStorage={getItem(k){reads++;if(readFail)throw Error('read refused');if(reads===2 && secondRead!==undefined)values.set(k,secondRead);return values.get(k)??null;},setItem(k,v){writes.push([k,v]);if(writeFail)throw Error('write refused');if(!noop)values.set(k,v);}};
 const elements=new Map();globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',hidden:null,classList:{toggle(cls,on){elements.get(id)[cls]=on;}}});return elements.get(id);}};
 const game=new Game({renderer:{},particles:{},settings:{},onSound:s=>sounds.push(s),onGameOver:(r,confirmation)=>{result=r;savedBest=confirmation;showResult(r);setBestLabel(confirmation.best);}});
 game.score=score;game._gameOver();
 const row={name,initial:raw,stored:values.get('paripari.best')??null,writes,reads,sounds,result,savedBest,titleBest:elements.get('title-best').textContent,badgeHidden:elements.get('result-best-badge').hidden}; rows.push(row);return row;
}
const cases=[
 {name:'normal successful best',raw:'100',score:200,stored:'200',isBest:true},
 {name:'normal non-best',raw:'900',score:100,stored:'900',isBest:false},
 {name:'read refusal high original',raw:'900',score:100,readFail:true,stored:'900',isBest:false},
 {name:'write refusal',raw:'100',score:200,writeFail:true,stored:'100',isBest:false},
 {name:'unknown original',raw:'{broken',score:100,stored:'{broken',isBest:false},
 {name:'silently ignored write',raw:'100',score:200,noop:true,stored:'100',isBest:false},
 {name:'higher value arrives between game read and save',raw:'100',score:200,secondRead:'900',stored:'900',isBest:false},
];
for(const c of cases)test(c.name,()=>{const r=observe(c);assert.equal(r.stored,c.stored);assert.equal(r.result.isBest,c.isBest);assert.equal(r.badgeHidden,!c.isBest);assert.deepEqual(r.sounds,[c.isBest?'best':'result']);assert.equal(r.result.score,c.score);assert.equal(validResult(r.result),true);assert.deepEqual(Object.keys(r.result).sort(),['practiceDone','score','best','isBest','maxCombo','perfectRate','tier','rank'].sort());});

test('unknown title best is not rendered as a confirmed zero',()=>{observe({name:'unknown',raw:'{broken',score:100});setBestLabel(null);assert.equal(document.getElementById('title-best').textContent,'—');});
test('storage reports confirmed value and never mutates unknown raw',()=>{
 let raw='100';globalThis.localStorage={getItem:()=>raw,setItem:(_,v)=>{raw=v}};
 assert.deepEqual(storage.saveBest(200),{status:'saved',best:200});
 assert.deepEqual(storage.saveBest(100),{status:'unchanged',best:200});
 raw='{unknown';assert.deepEqual(storage.saveBest(300),{status:'invalid',best:null});assert.equal(raw,'{unknown');
});
test('readback failure cannot announce a confirmed record',()=>{
 let raw='100',reads=0;globalThis.localStorage={getItem:()=>{if(++reads>1)throw Error('readback');return raw},setItem:(_,v)=>{raw=v}};
 assert.deepEqual(storage.saveBest(200),{status:'unconfirmed',best:null});assert.equal(raw,'200');
});
test('legacy setBest still returns undefined',()=>{
 let raw='100';globalThis.localStorage={getItem:()=>raw,setItem:(_,v)=>{raw=v}};
 assert.equal(storage.setBest(200),undefined);assert.equal(raw,'200');
});

for(const raw of ['9007199254740993','9'.repeat(400)]) test(`unsafe legacy best remains raw and result stays valid (${raw.length} digits)`,()=>{
 const r=observe({raw,score:200});
 assert.equal(r.stored,raw);assert.deepEqual(r.writes,[]);
 assert.equal(validResult(r.result),true);assert.equal(r.result.best,200);
 assert.deepEqual(r.savedBest,{status:'invalid',best:null});assert.equal(r.titleBest,'—');
});
for(const c of [
 {name:'successful save',raw:'100',score:200,status:'saved',best:200,title:'200'},
 {name:'failed write',raw:'100',score:200,writeFail:true,status:'write-failed',best:100,title:'100'},
 {name:'failed read',raw:'100',score:200,readFail:true,status:'unavailable',best:null,title:'—'}
]) test(`callback confirmation and title: ${c.name}`,()=>{
 const r=observe(c);assert.deepEqual(r.savedBest,{status:c.status,best:c.best});assert.equal(r.titleBest,c.title);
 assert.equal(validResult(r.result),true);assert.equal(r.result.best,200);
 assert.equal(Object.hasOwn(r.result,'savedBest'),false);
});

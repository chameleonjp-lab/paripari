import {test} from 'node:test';import assert from 'node:assert/strict';
import {isolateBrowserNetwork} from './browser-network-safety.mjs';
test('only known local static GET/HEAD is fetched; external/method/redirect/WS denied',async()=>{
 let handler,ws;const context={route:async(_,fn)=>handler=fn,routeWebSocket:async(_,fn)=>ws=fn};
 for(const base of ['https://example.com/','http://localhost.evil:1234/','http://user@127.0.0.1:1234/','http://127.0.0.1/'])await assert.rejects(isolateBrowserNetwork(context,base));
 await isolateBrowserNetwork(context,'http://127.0.0.1:1234/');
 async function call(url,method='GET',status=200){let fetched=0,aborted=0,fulfilled=0;await handler({request:()=>({url:()=>url,method:()=>method}),fetch:async options=>{assert.deepEqual(options,{maxRedirects:0,maxRetries:2});fetched++;return {status:()=>status}},abort:async()=>aborted++,fulfill:async()=>fulfilled++});return {fetched,aborted,fulfilled}}
 for(const [url,method] of [['https://example.com/','GET'],['http://127.0.0.1:1235/','GET'],['http://127.0.0.1:1234/','POST'],['http://127.0.0.1:1234/','DELETE']])assert.deepEqual(await call(url,method),{fetched:0,aborted:1,fulfilled:0});
 for(const method of ['GET','HEAD'])assert.deepEqual(await call('http://127.0.0.1:1234/src/game.js',method),{fetched:1,aborted:0,fulfilled:1});
 await assert.rejects(call('http://127.0.0.1:1234/','GET',302),/redirect/);let closed=false;ws({close:()=>closed=true});assert.equal(closed,true);
});

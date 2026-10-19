import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {createProvider} from '../server/provider.mjs';

const httpOrigin='http://127.0.0.1:4176',httpsOrigin='https://trial.example.test';
const valid=()=>({id:randomUUID(),feature:'chat',input:{prompt:'検証用の質問'}});
async function request(app,origin,{url='/api/session',method='GET',body,headers={},address='127.0.0.1'}={}){
 const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
 Object.assign(req,{url,method,headers:{host:new URL(origin).host,...(method==='POST'?{origin,'content-type':'application/json'}:{}),...headers},socket:{remoteAddress:address}});
 const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(bytes){this.body=bytes==null?'':Buffer.from(bytes).toString('utf8');}};
 await app.handler(req,res);try{res.json=JSON.parse(res.body);}catch{}return res;
}
async function fixture(t,{origin=httpOrigin,provider,...options}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yamadaya-transport-test-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 let calls=0;
 const app=createApp({mode:'live',budgetUsd:10,directory,origin,textKey:'test-server-credential',imageKey:'test-image-credential',provider:{async run(...args){calls++;return provider?provider.run(...args):{result:{text:'検証回答',sources:[]},cost:.001};}},...options});
 t.after(()=>app.close());
 const first=await request(app,origin),cookie=first.headers['set-cookie'].split(';')[0],headers={cookie,'x-csrf-token':first.json.csrf};
 return {app,origin,directory,first,cookie,headers,calls:()=>calls,send:options=>request(app,origin,options)};
}

test('HTTP loopback session creation and clearing remain non-Secure despite forwarded HTTPS claims',async t=>{
 const f=await fixture(t);
 assert.match(f.first.headers['set-cookie'],/; HttpOnly; SameSite=Strict; Path=\/$/);
 const fresh=await f.send({headers:{'x-forwarded-proto':'https',forwarded:'proto=https;host=trial.example.test'}});
 assert.doesNotMatch(fresh.headers['set-cookie'],/; Secure(?:;|$)/);
 const ended=await f.send({url:'/api/end',method:'POST',headers:{...f.headers,'x-forwarded-proto':'https'}});
 assert.equal(ended.statusCode,200);assert.match(ended.headers['set-cookie'],/; Path=\/; Max-Age=0$/);assert.doesNotMatch(ended.headers['set-cookie'],/Secure/);
 assert.equal(f.calls(),0);
});

test('trusted configured HTTPS origin adds Secure on creation and clear, with CSRF and Origin enforced',async t=>{
 const f=await fixture(t,{origin:httpsOrigin});
 assert.match(f.first.headers['set-cookie'],/; HttpOnly; SameSite=Strict; Path=\/; Secure$/);
 const missingCsrf=await f.send({url:'/api/jobs',method:'POST',headers:{cookie:f.cookie},body:valid()});
 assert.equal(missingCsrf.statusCode,403);assert.equal(f.calls(),0);
 const success=await f.send({url:'/api/jobs',method:'POST',headers:{...f.headers,'x-forwarded-proto':'http'},body:valid()});
 assert.equal(success.statusCode,200);assert.equal(success.json.state,'succeeded');assert.equal(f.calls(),1);
 const ended=await f.send({url:'/api/end',method:'POST',headers:{...f.headers,forwarded:'proto=http'}});
 assert.equal(ended.statusCode,200);assert.match(ended.headers['set-cookie'],/; Path=\/; Secure; Max-Age=0$/);
 assert.equal((await f.send({headers:{cookie:f.cookie}})).headers['set-cookie'].includes('; Secure'),true);
});

for(const [name,extra]of [
 ['wrong Host',{headers:{host:'evil.example.test','x-forwarded-host':'trial.example.test','x-forwarded-proto':'https',forwarded:'host=trial.example.test;proto=https'}}],
 ['wrong Origin',{headers:{origin:'https://evil.example.test','x-forwarded-host':'trial.example.test','x-forwarded-proto':'https'}}],
 ['non-loopback socket',{address:'192.0.2.3',headers:{'x-forwarded-for':'127.0.0.1','x-forwarded-host':'trial.example.test','x-forwarded-proto':'https',forwarded:'for=127.0.0.1;host=trial.example.test;proto=https'}}],
])test(`configured HTTPS rejects ${name} despite proxy header claims`,async t=>{
 const f=await fixture(t,{origin:httpsOrigin});
 const r=await f.send({...extra,url:'/api/jobs',method:'POST',headers:{...f.headers,...extra.headers},body:valid()});
 assert.equal(r.statusCode,403);assert.equal(r.json.notDispatched,true);assert.equal(f.calls(),0);assert.equal(f.app.ledger.usage().count,0);assert.equal(r.headers['set-cookie'],undefined);
});

test('diagnostics retain only fixed structural counters and numeric usage; unknown hold still pauses without retry',async t=>{
 const diagnostic={reason:'unexpected_output_type',outputTypeCounts:{message:1,reasoning:0,web_search_call:0,other:1},searchCallCount:0,searchActionCounts:{search:0,open_page:0,find_in_page:0,other:0},searchStatusCounts:{completed:0,failed:0,incomplete:0,in_progress:0,searching:0,other:0}};
 const forbidden=['raw-private-query','https://private.example.test/secret','private-output-type','private-model-name','test-server-credential','raw-response-body'];
 const failure=Object.assign(Error(forbidden.join(' ')),{code:'UNEXPECTED_TOOL',diagnostic:{...diagnostic,query:forbidden[0],url:forbidden[1],type:forbidden[2],model:forbidden[3],key:forbidden[4],body:forbidden[5],outputTypeCounts:{...diagnostic.outputTypeCounts,[forbidden[2]]:99}},usage:{input_tokens:50,output_tokens:5,total_tokens:55,input_tokens_details:{cached_tokens:0,private_value:forbidden[4]},output_tokens_details:{reasoning_tokens:1},query:forbidden[0],url:forbidden[1],type:forbidden[2],model:forbidden[3],key:forbidden[4],body:forbidden[5],raw:[forbidden[5]]}});
 const f=await fixture(t,{provider:{async run(){throw failure;}}}),body=valid();
 const r=await f.send({url:'/api/jobs',method:'POST',headers:f.headers,body});
 assert.equal(r.statusCode,502);assert.equal(r.json.notDispatched,false);assert.equal(f.calls(),1);
 const file=path.join(f.directory,'diagnostics',`${body.id}.json`),raw=await fs.readFile(file,'utf8'),saved=JSON.parse(raw);
 assert.deepEqual(saved.diagnostic,diagnostic);
 assert.deepEqual(saved.usage,{input_tokens:50,output_tokens:5,total_tokens:55,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:1}});
 assert.equal((await fs.stat(file)).mode&0o777,0o600);assert.equal((await fs.stat(path.dirname(file))).mode&0o777,0o700);
 for(const value of forbidden){assert.ok(!raw.includes(value));assert.ok(!r.body.includes(value));}
 assert.doesNotMatch(r.body,/outputTypeCounts|searchActionCounts|searchStatusCounts|input_tokens/);
 assert.equal(f.app.ledger.usage().reserved,15000);assert.equal(f.app.ledger.usage().uncertain,1);
 const state=await f.send({headers:{cookie:f.cookie}});assert.equal(state.json.spendingPaused,true);
 const next=await f.send({url:'/api/jobs',method:'POST',headers:f.headers,body:valid()});assert.equal(next.statusCode,409);assert.equal(next.json.notDispatched,true);
 const duplicate=await f.send({url:'/api/jobs',method:'POST',headers:f.headers,body});assert.equal(duplicate.json.state,'unknown');assert.equal(duplicate.json.result,null);
 assert.equal((await f.send({url:`/.runtime/diagnostics/${body.id}.json`})).statusCode,404);
 assert.equal(f.calls(),1);assert.equal(f.app.ledger.usage().reserved,15000);
});

test('malformed structural diagnostic fields cannot introduce arbitrary strings, keys, arrays or unbounded counters',async t=>{
 const diagnostic={reason:'raw-private-reason',searchCallCount:10001,outputTypeCounts:{message:10000,reasoning:-1,web_search_call:1.5,other:'1',raw_private_type:7},searchActionCounts:['raw-private-action'],searchStatusCounts:{completed:0,failed:NaN,incomplete:Infinity,in_progress:10001,searching:null,other:1,raw_private_status:8}};
 const f=await fixture(t,{provider:{async run(){throw Object.assign(Error('raw-private-body'),{diagnostic,usage:{input_tokens:'raw-private-token',output_tokens:-1,total_tokens:2.5,raw:['private']}});}}}),body=valid();
 await f.send({url:'/api/jobs',method:'POST',headers:f.headers,body});
 const raw=await fs.readFile(path.join(f.directory,'diagnostics',`${body.id}.json`),'utf8'),saved=JSON.parse(raw);
 assert.deepEqual(saved.diagnostic,{outputTypeCounts:{message:10000},searchStatusCounts:{completed:0,other:1}});assert.deepEqual(saved.usage,{});assert.doesNotMatch(raw,/raw[_-]private/);
 assert.equal(f.calls(),1);assert.equal(f.app.ledger.usage().uncertain,1);
});

test('a malformed provider output is diagnosed structurally before validation with a fake fetcher only',async t=>{
 let fakeFetchCalls=0;
 const forbidden=['private-model-identifier','private-output-kind','https://private.example.test/query','private-answer-body'];
 const provider=createProvider({textKey:'test-server-credential',fetcher:async()=>{fakeFetchCalls++;return new Response(JSON.stringify({model:forbidden[0],status:'completed',output:[{type:forbidden[1],query:forbidden[2],content:[{type:'output_text',text:forbidden[3]}]}],usage:{input_tokens:100,input_tokens_details:{cached_tokens:0},output_tokens:2,total_tokens:102}}));}});
 const f=await fixture(t,{provider}),body=valid();
 const r=await f.send({url:'/api/jobs',method:'POST',headers:f.headers,body});
 const raw=await fs.readFile(path.join(f.directory,'diagnostics',`${body.id}.json`),'utf8'),saved=JSON.parse(raw);
 assert.equal(saved.diagnostic.reason,'unexpected_model');assert.equal(saved.diagnostic.outputTypeCounts.other,1);assert.equal(saved.usage.input_tokens,100);
 for(const value of forbidden){assert.ok(!raw.includes(value));assert.ok(!r.body.includes(value));}
 assert.equal(fakeFetchCalls,1);assert.equal(f.calls(),1);assert.equal(f.app.ledger.usage().uncertain,1);
});

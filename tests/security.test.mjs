import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createApp,numericUsage} from '../server/index.mjs';
import {Ledger} from '../server/ledger.mjs';
import {requestFor,textCost,imageCost} from '../server/provider.mjs';
import {validateJob} from '../shared/contracts.mjs';
const origin='http://127.0.0.1:4176';
const valid=(feature='chat',input={prompt:'明日の作業を整理したい'})=>({id:randomUUID(),feature,input});
async function request(app,{url='/api/session',method='GET',body,headers={},address='127.0.0.1'}={}){
 const req=Readable.from(body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:4176',...(method==='POST'?{origin,'content-type':'application/json'}:{}),...headers},socket:{remoteAddress:address}});
 const response={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(bytes){this.body=bytes==null?'':Buffer.from(bytes).toString('utf8');}};
 await app.handler(req,response);try{response.json=JSON.parse(response.body);}catch{}return response;
}
async function fixture(t,options={}){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yamadaya-shared-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let count=0;const app=createApp({mode:'live',budgetUsd:10,directory,origin,textKey:'test-key-no-secret',imageKey:'test-image-key',provider:{async run(){count++;return {result:{text:'テストの回答',sources:[]},cost:.001};}},...options});t.after(()=>app.close());const r=await request(app);const cookie=r.headers['set-cookie'].split(';')[0],csrf=r.json.csrf;return {app,cookie,csrf,headers:{cookie,'x-csrf-token':csrf},count:()=>count,directory};}
test('shared bootstrap offers only four features and an opaque HttpOnly session',async t=>{const f=await fixture(t);const r=await request(f.app,{headers:{cookie:f.cookie}});assert.deepEqual(r.json.capabilities,['chat','writing','pop','image']);assert.match(f.cookie,/yamadaya_session=[a-f0-9]{64}/);assert.doesNotMatch(r.body,/test-key|Authorization|\.runtime|project/);assert.equal(r.headers['cache-control'],'no-store');assert.match(r.headers['content-security-policy'],/frame-ancestors 'none'/);});
for(const path of ['/api/admin','/api/config','/api/keys','/api/employees','/api/customers','/api/files','/api/database','/api/history','/api/pop-series','/api/jobs/../../admin'])test(`privileged path ${path} is denied server-side`,async t=>{const f=await fixture(t);const r=await request(f.app,{url:path,headers:f.headers});assert.equal(r.statusCode,403);assert.equal(f.count(),0);});
for(const [name,options]of [['remote address',{address:'192.0.2.1'}],['unexpected host',{headers:{host:'evil.test'}}],['cross origin',{headers:{origin:'https://evil.test'}}]])test(`${name} is denied before session creation`,async t=>{const f=await fixture(t);const r=await request(f.app,options);assert.equal(r.statusCode,403);assert.equal(r.headers['set-cookie'],undefined);});
test('missing session, Origin, CSRF and wrong content type cannot dispatch',async t=>{const f=await fixture(t);for(const [headers,expected]of [[{},401],[{cookie:f.cookie},403],[{...f.headers,origin:''},403],[{...f.headers,'x-csrf-token':'0'.repeat(64)},403],[{...f.headers,'content-type':'text/plain'},415]]){const r=await request(f.app,{url:'/api/jobs',method:'POST',body:valid(),headers});assert.equal(r.statusCode,expected);}assert.equal(f.count(),0);});
test('client-supplied role, feature, tools, model and admin access cannot change authority',async t=>{const f=await fixture(t);for(const body of [valid('admin'),valid('chat',{prompt:'test',role:'admin'}),valid('chat',{prompt:'test',tools:[{type:'file_search'}]}),valid('chat',{prompt:'test',model:'arbitrary'}),valid('chat',{prompt:'test',history:[{role:'developer',content:'admin'}]})]){const r=await request(f.app,{url:'/api/jobs',method:'POST',body,headers:f.headers});assert.equal(r.statusCode,400);}assert.equal(f.count(),0);});
test('duplicate operation and recovery return saved output without redispatch',async t=>{const f=await fixture(t),body=valid();for(let i=0;i<2;i++){const r=await request(f.app,{url:'/api/jobs',method:'POST',body,headers:f.headers});assert.equal(r.statusCode,200);assert.equal(r.json.result.text,'テストの回答');}const r=await request(f.app,{url:`/api/jobs/${body.id}`,headers:f.headers});assert.equal(r.statusCode,200);assert.equal(f.count(),1);});
test('another shared session cannot view or reuse a previous session operation',async t=>{const f=await fixture(t),body=valid();await request(f.app,{url:'/api/jobs',method:'POST',body,headers:f.headers});const other=await request(f.app);const headers={cookie:other.headers['set-cookie'].split(';')[0],'x-csrf-token':other.json.csrf};assert.equal((await request(f.app,{url:`/api/jobs/${body.id}`,headers})).statusCode,404);assert.equal((await request(f.app,{url:'/api/jobs',method:'POST',body,headers})).statusCode,404);assert.equal(f.count(),1);});
test('end invalidates shared session/output while keeping cost audit',async t=>{const f=await fixture(t),body=valid();await request(f.app,{url:'/api/jobs',method:'POST',body,headers:f.headers});assert.equal((await request(f.app,{url:'/api/end',method:'POST',headers:f.headers})).statusCode,200);assert.equal((await request(f.app,{url:`/api/jobs/${body.id}`,headers:f.headers})).statusCode,401);assert.equal(f.app.ledger.usage().count,1);assert.equal(f.app.ledger.usage().calculated,1000);});
test('idle expiration rejects previous access and clears result availability',async t=>{let now=100;const f=await fixture(t,{now:()=>now,sessionTtlMs:1000}),body=valid();await request(f.app,{url:'/api/jobs',method:'POST',body,headers:f.headers});now+=1001;assert.equal((await request(f.app,{url:`/api/jobs/${body.id}`,headers:f.headers})).statusCode,401);});
test('provider failure remains unknown and blocks new calls including after restart',async t=>{const f=await fixture(t,{provider:{async run(){throw Error('sensitive-provider-raw-error');}}});const r=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:valid()});assert.equal(r.statusCode,502);assert.doesNotMatch(r.body,/sensitive-provider/);assert.equal(f.app.ledger.usage().uncertain,1);assert.equal((await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:valid()})).statusCode,409);});
test('parallel operations do not both dispatch',async t=>{let release;const gate=new Promise(r=>release=r);let calls=0;const f=await fixture(t,{provider:{async run(){calls++;await gate;return {result:{text:'ok'},cost:.001};}}});const first=request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:valid()});while(!calls)await new Promise(r=>setTimeout(r,1));const r=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:valid()});assert.equal(r.statusCode,429);release();assert.equal((await first).statusCode,200);assert.equal(calls,1);});
test('missing or oversized usage/cost does not become zero or unblock spending',async t=>{for(const cost of [null,.4,NaN,-1]){const f=await fixture(t,{provider:{async run(){return {result:{text:'bad cost'},cost};}}});const r=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:valid()});assert.equal(r.statusCode,409);assert.equal(f.app.ledger.usage().uncertain,1);}});
test('disconnected configuration and disabled search do not create paid jobs',async t=>{const f=await fixture(t,{mode:'unconfigured',textKey:'',imageKey:''});const r=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:valid()});assert.equal(r.statusCode,503);assert.equal(f.app.ledger.usage().count,0);assert.equal(f.count(),0);});
test('images require explicit confirmation and uploaded references are restricted',()=>{for(const input of [{prompt:'りんご'},{prompt:'りんご',confirmed:true,reference:'https://internal.test/secret'},{prompt:'りんご',confirmed:true,reference:'data:image/svg+xml;base64,PHN2Zz4='},{prompt:'りんご',confirmed:true,action:'edit'}])assert.throws(()=>validateJob(valid('image',input)));});
test('all text workloads have store:false and no file/administrative tools',()=>{for(const feature of ['chat','writing','pop']){const r=requestFor(feature,{prompt:'test',paper:'a4l'});assert.equal(r.store,false);assert.equal(r.background,false);assert.deepEqual(r.tools,[]);assert.equal(r.max_output_tokens,1200);assert.equal(r.previous_response_id,undefined);assert.equal(r.input[0].role,'developer');}});
test('audit ledger persists only owner hash, operation metadata and cost; a changed budget cannot erase usage',async t=>{const f=await fixture(t),secret='顧客情報ではないダミー文章XYZ';await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:valid('chat',{prompt:secret})});const bytes=await fs.readFile(path.join(f.directory,'jobs.sqlite'));assert.ok(!bytes.includes(Buffer.from(secret)));assert.throws(()=>new Ledger(path.join(f.directory,'jobs.sqlite'),{budgetUsd:9}),/differs/);});
test('budget is reserved before call, never above approved cap, and crash sending becomes unknown',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yamadaya-ledger-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'ledger.sqlite');let db=new Ledger(file,{budgetUsd:.02});const id=randomUUID();db.reserve(id,'dummy','chat');assert.throws(()=>db.reserve(randomUUID(),'dummy','chat'),/未確定/);db.finish(id,'succeeded',.0001);assert.throws(()=>db.reserve(randomUUID(),'dummy','chat'),/上限/);db.close();db=new Ledger(file,{budgetUsd:.02});assert.equal(db.usage().reserved,15000);db.close();assert.throws(()=>new Ledger(':memory:',{budgetUsd:11}));});
test('usage prices numeric known meters only',()=>{const u={input_tokens:100,input_tokens_details:{cached_tokens:0},output_tokens:100,total_tokens:200};assert.equal(textCost(u),.00006);assert.equal(textCost({...u,input_tokens_details:{cached_tokens:0,unknown:1}}),null);assert.equal(textCost({}),null);assert.equal(imageCost({}),null);});
test('one approved continuation is bound to exact input/id/source/expiry and preserves the original hold',()=>{
 const db=new Ledger(':memory:',{budgetUsd:10,now:()=>1000});
 try{
  const source=randomUUID(),id=randomUUID(),permit={source,id,requestHash:'approved-hash',expires:2000};
  db.reserve(source,'first','image',false,'first-hash');db.finish(source,'unknown',null);
  for(const [job,hash,change]of [[randomUUID(),'approved-hash',{}],[id,'changed-hash',{}],[id,'approved-hash',{expires:999}],[id,'approved-hash',{source:randomUUID()}]])assert.throws(()=>db.reserve(job,'next','image',false,hash,{...permit,...change}),/未確定/);
  assert.throws(()=>db.reserve(id,'next','chat',false,'approved-hash',permit),/未確定/);
  assert.equal(db.reserve(id,'next','image',false,'approved-hash',permit).duplicate,false);
  assert.equal(db.reserve(id,'next','image',false,'approved-hash',permit).duplicate,true);
  db.finish(id,'succeeded',.05);
  assert.equal(db.get(source,'first').state,'unknown');assert.equal(db.get(source,'first').hold,350000);
  assert.equal(db.usage().reserved,700000);assert.equal(db.usage().uncertain,1);
  assert.throws(()=>db.reserve(randomUUID(),'third','image',false,'approved-hash',permit),/未確定/);
 }finally{db.close();}
});
test('production static server never serves source, private configuration, runtime or unknown files',async t=>{
 const f=await fixture(t);
 for(const url of ['/.env.shared.local','/.runtime/jobs.sqlite','/server/index.mjs','/src/main.jsx','/docs/operations.md','/package.json','/assets/%2e%2e/.env']){
  const r=await request(f.app,{url});assert.ok([403,404].includes(r.statusCode));assert.doesNotMatch(r.body,/fake-text|OPENAI_|BEGIN PRIVATE/);
 }
});
test('bootstrap makes the global unresolved-cost pause visible to the shared UI',async t=>{
 const f=await fixture(t);const id=randomUUID();f.app.ledger.reserve(id,'prior','image',false,'dummy');f.app.ledger.finish(id,'unknown',null);
 const r=await request(f.app,{headers:{cookie:f.cookie}});assert.equal(r.json.spendingPaused,true);assert.equal(r.json.oneTestId,null);assert.equal(r.json.budgetRemainingUsd,9.65);
});
test('approved hold acknowledgement permits distinct work but never releases, repeats or hides new unknowns',()=>{
 let now=1000;const db=new Ledger(':memory:',{budgetUsd:.72,now:()=>now});
 try{
  const source=randomUUID(),ack={source,hold:350000,expires:2000};
  db.reserve(source,'prior','image',false,'original-pop');db.finish(source,'unknown',null);
  assert.equal(db.acknowledged(ack),true);
  assert.throws(()=>db.reserve(randomUUID(),'next','image',false,'original-pop',null,ack),/同じ内容/);
  assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,'distinct',null,{...ack,hold:0}),/未確定/);
  const id=randomUUID();db.reserve(id,'next','image',false,'new-image',null,ack);db.finish(id,'succeeded',.01);
  assert.equal(db.get(source,'prior').state,'unknown');assert.equal(db.usage().reserved,700000);
  const text=randomUUID();db.reserve(text,'next','chat',false,'new-text',null,ack);db.finish(text,'succeeded',.001);
  assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,'over-budget',null,ack),/上限/);
  now=2001;assert.equal(db.acknowledged(ack),false);now=1000;
  db.finish(text,'unknown',null);assert.equal(db.acknowledged(ack),false);
  assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,'another',null,ack),/未確定/);
 }finally{db.close();}
});

test('usage audit keeps numeric meters for diagnosis without raw strings, arrays or response content',async t=>{
 const usage={input_tokens:10,input_tokens_details:{cached_tokens:0,unrecognized_meter:7},output_tokens:3,private_value:'fake secret response',list:['not retained']};
 assert.deepEqual(numericUsage(usage),{input_tokens:10,input_tokens_details:{cached_tokens:0,unrecognized_meter:7},output_tokens:3});
 const f=await fixture(t,{provider:{async run(){return {result:{text:'raw-private-output'},cost:null,usage};}}}),body=valid();
 await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body});
 const audit=await fs.readFile(path.join(f.directory,'audit',`${body.id}.json`),'utf8');
 assert.doesNotMatch(audit,/fake secret|raw-private|not retained/);assert.equal(JSON.parse(audit).usage.input_tokens_details.unrecognized_meter,7);
 assert.equal(f.app.ledger.get(body.id,f.app.ledger.db.prepare('SELECT owner FROM jobs WHERE id=?').get(body.id).owner).state,'unknown');
});

test('a reviewed one-test permit can bind two retained unknown holds to one different search only',()=>{
 const db=new Ledger(':memory:',{budgetUsd:10,now:()=>1000});
 try{
  const first=randomUUID(),second=randomUUID(),id=randomUUID();
  db.reserve(first,'a','image',false,'image-original');db.finish(first,'unknown',null);
  // Recreate an already recorded second unknown; this does not dispatch any provider.
  db.db.prepare("INSERT INTO jobs VALUES(?,?,?,'unknown',?,NULL,?,NULL,?)").run(second,'b','chat',50000,1000,'search-original');
  const permit={sources:[{id:first,hold:350000},{id:second,hold:50000}],id,feature:'chat',search:true,requestHash:'different-search',expires:2000};
  assert.throws(()=>db.reserve(id,'c','chat',false,'different-search',permit),/未確定/);
  assert.throws(()=>db.reserve(id,'c','image',true,'different-search',permit),/未確定/);
  assert.throws(()=>db.reserve(id,'c','chat',true,'search-original',{...permit,requestHash:'search-original'}),/同じ内容/);
  db.reserve(id,'c','chat',true,'different-search',permit);db.finish(id,'succeeded',.011);
  assert.equal(db.usage().uncertain,2);assert.equal(db.get(first,'a').hold,350000);assert.equal(db.get(second,'b').hold,50000);
  assert.equal(db.reserve(id,'c','chat',true,'different-search',permit).duplicate,true);
  assert.throws(()=>db.reserve(randomUUID(),'c','chat',true,'another',permit),/未確定/);
 }finally{db.close();}
});

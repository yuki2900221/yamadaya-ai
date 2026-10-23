import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createHash,randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';

const origin='http://127.0.0.1:4176';
const hash=value=>createHash('sha256').update(value).digest('hex');
async function request(app,{url='/api/session',method='GET',body,headers={}}={}){
 const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
 Object.assign(req,{url,method,headers:{host:'127.0.0.1:4176',...(method==='POST'?{origin,'content-type':'application/json'}:{}),...headers},socket:{remoteAddress:'127.0.0.1'}});
 const response={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(bytes){this.body=bytes==null?'':Buffer.from(bytes).toString('utf8');}};
 await app.handler(req,response);response.json=JSON.parse(response.body);return response;
}
async function fixture(t,{changeAck=ack=>ack,failProvider=false}={}){
 let now=1000,calls=0;
 const jobs=[
  {id:randomUUID(),feature:'image',input:{prompt:'前のダミー画像',action:'generate',confirmed:true},hold:350000},
  {id:randomUUID(),feature:'chat',input:{prompt:'前のダミー検索1',search:true},hold:50000},
  {id:randomUUID(),feature:'chat',input:{prompt:'前のダミー検索2',search:true},hold:50000},
 ];
 const acknowledgement=changeAck({sources:jobs.map(({id,hold})=>({id,hold})),expires:2000});
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yamadaya-resume-recovery-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const app=createApp({mode:'live',budgetUsd:10,directory,origin,now:()=>now,textKey:'fake-recovery-text',imageKey:'fake-recovery-image',searchEnabled:false,acknowledgement,provider:{async run(){calls++;if(failProvider)throw Error('dummy provider failure');return {result:{text:'新しい操作のダミー回答'},cost:.001};}}});
 t.after(()=>app.close());
 const session=await request(app),cookie=session.headers['set-cookie'].split(';')[0],owner=hash(cookie.split('=')[1]);
 // Recreate recorded unresolved operations without contacting any provider.
 const insert=app.ledger.db.prepare("INSERT INTO jobs VALUES(?,?,?,'unknown',?,NULL,?,NULL,?)");
 for(const j of jobs)insert.run(j.id,owner,j.feature,j.hold,now,hash(JSON.stringify({feature:j.feature,input:j.input})));
 return {app,jobs,headers:{cookie,'x-csrf-token':session.json.csrf},calls:()=>calls,setNow:value=>{now=value;}};
}
const snapshot=app=>app.ledger.db.prepare('SELECT * FROM jobs ORDER BY id').all();
const recover=(f,id=f.jobs[0].id)=>request(f.app,{url:`/api/jobs/${id}`,headers:f.headers});

test('owner recovery unlocks new operations only with the exact three acknowledged holds and changes no record',async t=>{
 const f=await fixture(t),before=snapshot(f.app),usageBefore=f.app.ledger.usage();
 assert.equal(usageBefore.uncertain,3);assert.equal(usageBefore.reserved,450000);
 for(const job of f.jobs){const r=await recover(f,job.id);assert.equal(r.statusCode,200);assert.equal(r.json.state,'unknown');assert.equal(r.json.result,null);assert.equal(r.json.canStartNewOperations,true);assert.equal(r.json.billing,'未確定');}
 assert.deepEqual(snapshot(f.app),before);assert.deepEqual(f.app.ledger.usage(),usageBefore);assert.equal(f.calls(),0);
});

for(const [name,changeAck] of [
 ['no acknowledgement',()=>null],
 ['expired acknowledgement',ack=>({...ack,expires:1000})],
 ['missing source',ack=>({...ack,sources:ack.sources.slice(0,2)})],
 ['extra source',ack=>({...ack,sources:[...ack.sources,{id:randomUUID(),hold:15000}]})],
 ['different hold',ack=>({...ack,sources:ack.sources.map((s,i)=>i===2?{...s,hold:49999}:s)})],
])test(`recovery cannot unlock an unknown operation with ${name}`,async t=>{
 const f=await fixture(t,{changeAck}),before=snapshot(f.app),r=await recover(f);
 assert.equal(r.statusCode,200);assert.equal(r.json.state,'unknown');assert.equal(r.json.canStartNewOperations,false);
 assert.deepEqual(snapshot(f.app),before);assert.equal(f.app.ledger.usage().reserved,450000);assert.equal(f.calls(),0);
});

test('recovery rechecks the acknowledgement deadline on each GET without releasing holds',async t=>{
 const f=await fixture(t),before=snapshot(f.app);
 assert.equal((await recover(f)).json.canStartNewOperations,true);
 f.setNow(2000);assert.equal((await recover(f)).json.canStartNewOperations,false);
 assert.deepEqual(snapshot(f.app),before);assert.equal(f.calls(),0);
});

test('sending operations and a sending source never receive a continuation flag',async t=>{
 const f=await fixture(t);
 f.app.ledger.db.prepare("UPDATE jobs SET state='sending' WHERE id=?").run(f.jobs[1].id);
 const before=snapshot(f.app);
 const unknown=await recover(f),sending=await recover(f,f.jobs[1].id);
 assert.equal(unknown.json.state,'unknown');assert.equal(unknown.json.canStartNewOperations,false);
 assert.equal(sending.json.state,'sending');assert.equal(sending.json.canStartNewOperations,false);
 assert.deepEqual(snapshot(f.app),before);assert.equal(f.calls(),0);
});

test('a new unresolved operation removes the recovery permission while preserving the original three holds',async t=>{
 const f=await fixture(t,{failProvider:true}),before=snapshot(f.app);
 assert.equal((await recover(f)).json.canStartNewOperations,true);
 const failed=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:{id:randomUUID(),feature:'chat',input:{prompt:'新しい別のダミー操作'}}});
 assert.equal(failed.statusCode,502);assert.equal(f.calls(),1);assert.equal(f.app.ledger.usage().uncertain,4);
 const r=await recover(f);assert.equal(r.json.canStartNewOperations,false);assert.equal(r.json.state,'unknown');
 for(const original of before)assert.deepEqual(f.app.ledger.db.prepare('SELECT * FROM jobs WHERE id=?').get(original.id),original);
 assert.equal(f.app.ledger.usage().reserved,465000);
 const blocked=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:{id:randomUUID(),feature:'chat',input:{prompt:'その次の別の操作'}}});
 assert.equal(blocked.json.code,'UNCERTAIN');assert.equal(f.calls(),1);
});

test('clearing a client recovery lock never permits a new ID to resend the same unresolved request',async t=>{
 const f=await fixture(t),before=snapshot(f.app);
 assert.equal((await recover(f)).json.canStartNewOperations,true);
 const old=f.jobs[0],response=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:{id:randomUUID(),feature:old.feature,input:old.input}});
 assert.equal(response.statusCode,409);assert.equal(response.json.code,'UNCERTAIN_DUPLICATE');assert.equal(response.json.notDispatched,true);
 assert.deepEqual(snapshot(f.app),before);assert.equal(f.calls(),0);
});

test('the recovery flag is owner-authorized and is absent from a duplicate POST response',async t=>{
 const f=await fixture(t),before=snapshot(f.app),other=await request(f.app),otherCookie=other.headers['set-cookie'].split(';')[0];
 const denied=await request(f.app,{url:`/api/jobs/${f.jobs[0].id}`,headers:{cookie:otherCookie}});
 assert.equal(denied.statusCode,404);assert.equal(denied.json.canStartNewOperations,undefined);
 const old=f.jobs[0],duplicate=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:{id:old.id,feature:old.feature,input:old.input}});
 assert.equal(duplicate.statusCode,200);assert.equal(duplicate.json.state,'unknown');assert.equal(duplicate.json.canStartNewOperations,undefined);
 assert.deepEqual(snapshot(f.app),before);assert.equal(f.calls(),0);
});

test('successful recovery still returns its saved output and does not use the unknown-operation flag',async t=>{
 const f=await fixture(t),id=randomUUID(),originals=snapshot(f.app);
 const sent=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:{id,feature:'chat',input:{prompt:'別の新しい操作'}}});
 assert.equal(sent.statusCode,200);assert.equal(sent.json.state,'succeeded');
 const r=await recover(f,id);assert.equal(r.statusCode,200);assert.equal(r.json.result.text,'新しい操作のダミー回答');assert.equal(r.json.canStartNewOperations,false);assert.equal(f.calls(),1);
 assert.equal(f.app.ledger.usage().uncertain,3);assert.equal(f.app.ledger.usage().reserved,451000);
 for(const original of originals)assert.deepEqual(f.app.ledger.db.prepare('SELECT * FROM jobs WHERE id=?').get(original.id),original);
});

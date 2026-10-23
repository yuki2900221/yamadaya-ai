import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Ledger} from '../server/ledger.mjs';

function fixture(t,budgetUsd=10){
 let now=1000;
 const db=new Ledger(':memory:',{budgetUsd,now:()=>now});
 t.after(()=>db.close());
 const image=randomUUID(),search=randomUUID();
 db.reserve(image,'previous','image',false,'unknown-image');
 db.finish(image,'unknown',null);
 const legacy={source:image,hold:350000,expires:2000};
 db.reserve(search,'previous','chat',true,'unknown-search',null,legacy);
 db.finish(search,'unknown',null);
 const sources=[{id:image,hold:350000},{id:search,hold:50000}];
 return {db,image,search,sources,ack:{sources,expires:2000},setNow:value=>{now=value;}};
}

test('multiple unknown holds require an explicit exact acknowledgement before distinct work',t=>{
 const {db,image,search,ack}=fixture(t);
 const before=[db.get(image,'previous'),db.get(search,'previous')];
 assert.equal(db.acknowledged(null),false);
 assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,'distinct'),e=>e.code==='UNCERTAIN');
 assert.equal(db.acknowledged(ack),true);
 assert.equal(db.acknowledged({...ack,sources:[...ack.sources].reverse()}),true);
 for(const hash of ['unknown-image','unknown-search'])assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,hash,null,ack),e=>e.code==='UNCERTAIN_DUPLICATE');
 const id=randomUUID();db.reserve(id,'next','chat',false,'distinct',null,ack);
 assert.equal(db.acknowledged(ack),false);
 db.finish(id,'succeeded',.0001);
 assert.equal(db.acknowledged(ack),true);
 assert.deepEqual([db.get(image,'previous'),db.get(search,'previous')],before);
 assert.equal(db.usage().reserved,400100);
 assert.equal(db.usage().uncertain,2);
});

const invalidSources={
 'missing all':()=>[],
 'missing one':sources=>sources.slice(0,1),
 'extra source':sources=>[...sources,{id:randomUUID(),hold:15000}],
 'wrong id':sources=>[sources[0],{...sources[1],id:randomUUID()}],
 'wrong hold':sources=>[sources[0],{...sources[1],hold:49999}],
 'repeated source':sources=>[sources[0],sources[0]],
 'string hold':sources=>[sources[0],{...sources[1],hold:'50000'}],
 'null source':sources=>[sources[0],null],
 'non-array source set':()=>({id:'invalid',hold:350000}),
};
for(const [name,invalid]of Object.entries(invalidSources))test(`multiple acknowledgement refuses ${name}`,t=>{
 const {db,sources,ack}=fixture(t);const invalidAck={...ack,sources:invalid(sources)};
 assert.equal(db.acknowledged(invalidAck),false);
 assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,'distinct',null,invalidAck),e=>e.code==='UNCERTAIN');
 assert.equal(db.usage().reserved,400000);assert.equal(db.usage().count,2);
});

test('multiple acknowledgement requires a finite future expiry and rejects ambiguous mixed forms',t=>{
 const {db,image,ack}=fixture(t);
 for(const expires of [undefined,null,999,1000,Infinity,NaN,'2000'])assert.equal(db.acknowledged({...ack,expires}),false);
 assert.equal(db.acknowledged({...ack,source:image,hold:350000}),false);
 assert.equal(db.acknowledged({...ack,sources:undefined}),false);
});

test('acknowledgement cannot include a sending or already resolved source',t=>{
 const {db,search,ack}=fixture(t);
 db.db.prepare("UPDATE jobs SET state='sending' WHERE id=?").run(search);assert.equal(db.acknowledged(ack),false);
 assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,'distinct',null,ack),e=>e.code==='UNCERTAIN');
 db.finish(search,'succeeded',.001);assert.equal(db.acknowledged(ack),false);
});

test('a third unknown immediately invalidates an acknowledgement without changing prior holds',t=>{
 const {db,image,search,ack}=fixture(t);
 const original=[db.get(image,'previous'),db.get(search,'previous')];
 const third=randomUUID();db.reserve(third,'next','chat',false,'new-failure',null,ack);db.finish(third,'unknown',null);
 assert.equal(db.acknowledged(ack),false);
 assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,'another',null,ack),e=>e.code==='UNCERTAIN');
 assert.deepEqual([db.get(image,'previous'),db.get(search,'previous')],original);
 assert.equal(db.usage().uncertain,3);assert.equal(db.usage().reserved,415000);
});

test('multiple acknowledgement retains unknown holds while releasing known success and enforcing the cap',t=>{
 const {db,image,search,ack,setNow}=fixture(t,.42);
 const id=randomUUID();db.reserve(id,'next','chat',false,'distinct',null,ack);db.finish(id,'succeeded',.0001);
 const second=randomUUID();db.reserve(second,'next','chat',false,'second',null,ack);db.finish(second,'succeeded',.015);
 assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,'over-budget',null,ack),e=>e.code==='BUDGET_LIMIT');
 setNow(2000);assert.equal(db.acknowledged(ack),false);
 assert.throws(()=>db.reserve(randomUUID(),'next','chat',false,'expired',null,ack),e=>e.code==='UNCERTAIN');
 assert.equal(db.get(image,'previous').hold,350000);assert.equal(db.get(search,'previous').hold,50000);
 assert.equal(db.get(image,'previous').state,'unknown');assert.equal(db.get(search,'previous').state,'unknown');
 assert.equal(db.usage().reserved,415100);
});

test('legacy single-image acknowledgement remains compatible and cannot cover an extra unknown',t=>{
 const db=new Ledger(':memory:',{budgetUsd:10,now:()=>1000});t.after(()=>db.close());
 const source=randomUUID();db.reserve(source,'previous','image',false,'original');db.finish(source,'unknown',null);
 const ack={source,hold:350000,expires:2000};assert.equal(db.acknowledged(ack),true);
 assert.equal(db.acknowledged({...ack,hold:50000}),false);
 const id=randomUUID();db.reserve(id,'next','chat',false,'distinct',null,ack);db.finish(id,'succeeded',.0001);
 assert.equal(db.acknowledged(ack),true);
 const extra=randomUUID();db.reserve(extra,'next','chat',false,'other',null,ack);db.finish(extra,'unknown',null);
 assert.equal(db.acknowledged(ack),false);
 assert.equal(db.get(source,'previous').state,'unknown');assert.equal(db.get(source,'previous').hold,350000);
});

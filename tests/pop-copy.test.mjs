import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {popCopyChoices,safePopCopy,sourceChoices,constrainedProposalSchema,reviewProposal,reviewProposalDraft,DESIGN_CHOICES,CONFIRMATION_CHOICES} from '../shared/proposal-policy.js';
import {validProposal} from '../shared/proposal-contract.js';
import {PAPERS,validateJob} from '../shared/contracts.mjs';
import {createProvider,requestFor} from '../server/provider.mjs';
import {createApp} from '../server/index.mjs';

const oldFallback='内容をご確認ください。';
const info='架空商品  りんご\r\nふんわりではない\n  甘さ控えめ・食感しっかり　 \r1袋398円（税込）';
const proposalInput={info,atmosphere:'',paper:'a4l',mood:'fresh'};
const rawProposal=copy=>({headlines:['架空商品  りんご','ふんわりではない','1袋398円（税込）'],catchphrase:copy,direction:DESIGN_CHOICES.fresh,confirmation_points:[CONFIRMATION_CHOICES[0]]});
const textUsage={input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens:100,total_tokens:200};
const imageResponse=()=>new Response(JSON.stringify({data:[{b64_json:Buffer.from([255,216,255,217]).toString('base64')}],usage:{input_tokens:1,input_tokens_details:{text_tokens:1,image_tokens:0},output_tokens:1,output_tokens_details:{image_tokens:1,text_tokens:0}}}));
const imageInput=extra=>({prompt:info,action:'pop',paper:'a4l',mood:'自然に',headline:'架空商品  りんご',direction:DESIGN_CHOICES.fresh,confirmed:true,...extra});

async function request(app,{url='/api/session',method='GET',body,headers={}}={}){
 const origin='http://127.0.0.1:4176';
 const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
 Object.assign(req,{url,method,headers:{host:'127.0.0.1:4176',...(method==='POST'?{origin,'content-type':'application/json'}:{}),...headers},socket:{remoteAddress:'127.0.0.1'}});
 const response={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(bytes){this.body=bytes==null?'':Buffer.from(bytes).toString('utf8');}};
 await app.handler(req,response);response.json=JSON.parse(response.body);return response;
}
async function httpFixture(t,provider){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yamadaya-pop-copy-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const app=createApp({mode:'live',budgetUsd:10,directory,provider,textKey:'fake-copy-test',imageKey:'fake-image-test'});
 t.after(()=>app.close());
 const session=await request(app);
 return {app,headers:{cookie:session.headers['set-cookie'].split(';')[0],'x-csrf-token':session.json.csrf}};
}

test('optional POP copy offers an empty value instead of an unsolicited confirmation phrase',()=>{
 const choices=sourceChoices(proposalInput);
 assert.equal(choices.catchphrases[0],'');assert.ok(!choices.catchphrases.includes(oldFallback));assert.ok(!choices.catchphrases.includes('入れない'));
 assert.deepEqual(constrainedProposalSchema(proposalInput).properties.catchphrase.enum,choices.catchphrases);
 assert.equal(validProposal(rawProposal('')),true);
 assert.equal(reviewProposal(proposalInput,rawProposal('')).proposal.catchphrase,'');
 for(const invalid of [null,12,'あ'.repeat(241)])assert.equal(validProposal(rawProposal(invalid)),false);
 assert.equal(validProposal({...rawProposal(''),headlines:['','','']}),false);
});

test('POP copy preserves exact source lines including negation, Japanese punctuation and spacing',()=>{
 const lines=['架空商品  りんご','ふんわりではない','  甘さ控えめ・食感しっかり　 ','1袋398円（税込）'];
 for(const copy of lines){
  assert.ok(popCopyChoices(info).includes(copy));assert.equal(safePopCopy(info,copy),copy);
  const reviewed=reviewProposal(proposalInput,rawProposal(copy));assert.equal(reviewed.proposal.catchphrase,copy);assert.equal(reviewed.paper.code,'a4l');
 }
 for(const copy of [oldFallback,'入れない','ふんわり','甘さ控えめ・食感しっかり','1袋298円（税込）',undefined,'  '])assert.equal(safePopCopy(info,copy),'');
});

test('unapproved provider copy and legacy draft selections become empty without altering source facts or paper',()=>{
 const raw=rawProposal(oldFallback),snapshot=structuredClone(raw);
 const reviewed=reviewProposal(proposalInput,raw);
 assert.equal(reviewed.proposal.catchphrase,'');assert.equal(reviewed.adjusted,true);assert.equal(reviewed.paper.code,'a4l');
 const draft={...proposalInput,headline:raw.headlines[0],catchphrase:oldFallback,direction:raw.direction};
 const restored=reviewProposalDraft(draft,raw);
 assert.equal(restored.draft.catchphrase,'');assert.equal(restored.draft.info,info);assert.equal(restored.draft.paper,'a4l');
 assert.deepEqual(raw,snapshot);assert.equal(draft.catchphrase,oldFallback);
});

test('deliberately supplied confirmation wording remains a valid source line rather than a banned phrase',()=>{
 const supplied=info+'\n'+oldFallback,input={...proposalInput,info:supplied};
 assert.ok(popCopyChoices(supplied).includes(oldFallback));assert.equal(safePopCopy(supplied,oldFallback),oldFallback);
 assert.equal(reviewProposal(input,rawProposal(oldFallback)).proposal.catchphrase,oldFallback);
 assert.ok(requestFor('pop',{prompt:supplied,paper:'a4l'}).text.format.schema.properties.copy.enum.includes(oldFallback));
});

test('the strict POP proposal schema restricts printed copy to empty or exact input lines for all four papers',()=>{
 for(const [paper,p] of Object.entries(PAPERS)){
  const requestBody=requestFor('pop',{prompt:info,paper});
  assert.equal(requestBody.store,false);assert.equal(requestBody.text.format.strict,true);assert.deepEqual(requestBody.tools,[]);
  assert.deepEqual(requestBody.text.format.schema.properties.copy.enum,['',...info.split(/\r\n|\n|\r/)]);
  assert.ok(requestBody.input[0].content.includes(p.label));assert.ok(!requestBody.text.format.schema.properties.copy.enum.includes(oldFallback));
 }
 // Choices are derived for each request, with no cross-product state leakage.
 assert.deepEqual(requestFor('pop',{prompt:'別の商品',paper:'a4p'}).text.format.schema.properties.copy.enum,['','別の商品']);
});

for(const copy of ['',oldFallback])test(`HTTP POP proposal with ${copy?'legacy fallback':'empty copy'} succeeds with its normal cost reservation`,async t=>{
 let calls=0;
 const provider=createProvider({textKey:'fake-copy-test',fetcher:async(url,init)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.ok(JSON.parse(init.body).text.format.schema.properties.copy.enum.includes(''));
  return new Response(JSON.stringify({model:'gpt-6-luna',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({headline:'架空商品  りんご',copy,direction:DESIGN_CHOICES.fresh,checks:[CONFIRMATION_CHOICES[0]]})}]}],usage:textUsage}));
 }});
 const f=await httpFixture(t,provider),id=randomUUID(),response=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body:{id,feature:'pop',input:{prompt:info,paper:'a4l',mood:'自然に'}}});
 assert.equal(response.statusCode,200);assert.equal(response.json.state,'succeeded');assert.equal(response.json.result.copy,'');assert.equal(response.json.result.paper,'a4l');assert.equal(calls,1);
 const row=f.app.ledger.db.prepare('SELECT state,cost,hold FROM jobs WHERE id=?').get(id);
 assert.equal(row.state,'succeeded');assert.equal(row.cost,60);assert.equal(row.hold,15000);assert.equal(f.app.ledger.usage().uncertain,0);
 const recovered=await request(f.app,{url:`/api/jobs/${id}`,headers:f.headers});assert.equal(recovered.json.result.copy,'');assert.equal(calls,1);
});

for(const reference of [false,true])test(`final POP ${reference?'photo edit FormData':'generation JSON'} omits stale or UI-only copy while preserving approved content and paper`,async()=>{
 let calls=0,expected;
 const provider=createProvider({imageKey:'fake-image-test',fetcher:async(url,init)=>{
  calls++;assert.equal(url,`https://api.openai.com/v1/images/${reference?'edits':'generations'}`);
  const payload=reference?Object.fromEntries(init.body):JSON.parse(init.body);
  if(reference){assert.ok(init.body instanceof FormData);assert.equal(init.body.get('image').type,'image/jpeg');}
  assert.equal(payload.model,'gpt-image-2.5-flare-2026-09-08');assert.equal(String(payload.n),'1');assert.equal(payload.quality,'medium');assert.equal(payload.output_format,'png');
  assert.equal(payload.size,PAPERS[expected.paper].width>PAPERS[expected.paper].height?'2032x1440':'1440x2032');
  assert.ok(payload.prompt.includes(`用紙${PAPERS[expected.paper].label}`));assert.ok(payload.prompt.includes(info));assert.ok(payload.prompt.includes(`利用者が確認した見出し：${expected.headline}`));
  if(expected.copy==='1袋398円（税込）')assert.ok(payload.prompt.includes('\n利用者が確認したコピー：1袋398円（税込）'));
  else{assert.ok(!payload.prompt.includes('利用者が確認したコピー：'));assert.ok(!payload.prompt.includes(oldFallback));assert.ok(!payload.prompt.includes('入れない'));}
  return imageResponse();
 }});
 for(const paper of Object.keys(PAPERS))for(const copy of ['',oldFallback,'入れない','1袋398円（税込）']){
  expected=imageInput({paper,copy,...(reference?{reference:'data:image/jpeg;base64,/9j/2Q=='}:{})});
  const r=await provider.run('image',expected);assert.equal(r.result.paper,paper);assert.equal(r.cost,.000035);
 }
 assert.equal(calls,16);
});

test('the image prompt retains confirmation wording only when the user included that exact line',async()=>{
 const prompt=info+'\n'+oldFallback;let calls=0;
 const provider=createProvider({imageKey:'fake-image-test',fetcher:async(_url,init)=>{calls++;const sent=JSON.parse(init.body).prompt;assert.ok(sent.includes(prompt));assert.ok(sent.includes('\n利用者が確認したコピー：'+oldFallback));return imageResponse();}});
 await provider.run('image',imageInput({prompt,copy:oldFallback}));assert.equal(calls,1);
});

test('an otherwise valid 4000-character POP image input does not become uncertain during copy sanitization',async t=>{
 const prompt='あ'.repeat(4000),id=randomUUID();let calls=0;
 const body={id,feature:'image',input:imageInput({prompt,copy:oldFallback,paper:'a3p'})};
 assert.equal(validateJob(body).input.prompt,prompt);
 const provider=createProvider({imageKey:'fake-image-test',fetcher:async(_url,init)=>{
  calls++;const sent=JSON.parse(init.body);assert.ok(sent.prompt.includes(prompt));assert.ok(!sent.prompt.includes(oldFallback));assert.equal(sent.size,'1440x2032');return imageResponse();
 }});
 const f=await httpFixture(t,provider),response=await request(f.app,{url:'/api/jobs',method:'POST',headers:f.headers,body});
 assert.equal(response.statusCode,200);assert.equal(response.json.state,'succeeded');assert.equal(response.json.result.paper,'a3p');assert.equal(calls,1);
 const row=f.app.ledger.db.prepare('SELECT state,cost,hold FROM jobs WHERE id=?').get(id);
 assert.equal(row.state,'succeeded');assert.equal(row.cost,35);assert.equal(row.hold,350000);assert.equal(f.app.ledger.usage().uncertain,0);
});

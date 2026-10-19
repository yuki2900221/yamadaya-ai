import test from 'node:test';
import assert from 'node:assert/strict';
import {createProvider,requestFor,textCost} from '../server/provider.mjs';

// Shape fixtures follow the official Responses/web-search schemas. No network or
// real provider credentials are used, and these are not recovered failed calls.
const usage={input_tokens:1000,input_tokens_details:{cached_tokens:300,cache_write_tokens:500},output_tokens:100,output_tokens_details:{reasoning_tokens:0},total_tokens:1100};
const message={type:'message',id:'msg_dummy',status:'completed',role:'assistant',content:[{type:'output_text',text:'公式サイトを確認したダミー回答。',annotations:[{type:'url_citation',start_index:0,end_index:6,title:'ダミー出典',url:'https://example.com/source'}],logprobs:[]}]};
const call=action=>({type:'web_search_call',id:'ws_dummy',status:'completed',...(action===undefined?{}:{action})});
const response=(extra={})=>({model:'gpt-6-luna',status:'completed',output:[call({type:'search',queries:['ダミー検索']}),structuredClone(message)],usage:structuredClone(usage),...extra});
function fixture(data){
 let count=0;
 const provider=createProvider({textKey:'fake-search-credential',searchEnabled:true,fetcher:async()=>{count++;return new Response(JSON.stringify(data));}});
 return {provider,count:()=>count};
}
const search=f=>f.provider.run('chat',{prompt:'ダミーの公開情報を検索',search:true});

test('checked search requires one nonparallel built-in call without changing model, storage or output bounds',()=>{
 const r=requestFor('chat',{prompt:'ダミー',search:true});
 assert.equal(r.model,'gpt-6-luna');assert.equal(r.store,false);assert.equal(r.background,false);assert.equal(r.stream,false);assert.equal(r.max_output_tokens,1200);
 assert.deepEqual(r.tools,[{type:'web_search'}]);assert.equal(r.tool_choice,'required');assert.equal(r.max_tool_calls,1);assert.equal(r.parallel_tool_calls,false);
 for(const feature of ['chat','writing','pop']){const ordinary=requestFor(feature,{prompt:'ダミー',search:false});assert.deepEqual(ordinary.tools,[]);assert.equal(ordinary.tool_choice,'none');assert.equal(ordinary.max_tool_calls,undefined);}
});

for(const [name,action] of [
 ['search queries and sources',{type:'search',queries:['ダミー検索1','ダミー検索2'],sources:[{type:'url',url:'https://example.com/source'}]}],
 ['legacy query metadata',{type:'search',query:'ダミー検索'}],
 ['open-page metadata',{type:'open_page',url:'https://example.com/source'}],
 ['find-in-page metadata',{type:'find_in_page',url:'https://example.com/source',pattern:'ダミー'}],
 ['omitted optional action',undefined],
])test(`one completed call accepts documented ${name} and keeps numeric usage and citations`,async()=>{
 const data=response({output:[{type:'reasoning',id:'rs_dummy',summary:[],encrypted_content:'dummy-private-reasoning'},call(action),structuredClone(message)],metadata:{not_logged:'dummy-private-metadata'}}),f=fixture(data),r=await search(f);
 assert.equal(f.count(),1);assert.equal(r.result.text,message.content[0].text);assert.deepEqual(r.result.sources,[{title:'ダミー出典',url:'https://example.com/source'}]);
 assert.deepEqual(r.usage,usage);assert.equal(r.cost,textCost(usage)+.01);assert.ok(r.cost<.05);
 assert.ok(!JSON.stringify(r.result).includes('dummy-private'));
});

test('unexpected output types are rejected with fixed structural buckets and known numeric usage only',async()=>{
 const secret='do-not-record-private-content',data=response();
 data.output.push({type:secret,id:secret,name:secret,arguments:secret,url:'https://example.com/private',content:secret});
 data.usage.private_content=secret;data.usage.arbitrary_numeric_metadata=111;
 data.usage.input_tokens_details.private_content=secret;data.usage.input_tokens_details.arbitrary_numeric_metadata=222;
 data.usage.output_tokens_details.private_content=secret;
 const f=fixture(data);
 await assert.rejects(search(f),e=>{
  assert.equal(e.code,'UNEXPECTED_TOOL');
  assert.deepEqual(e.diagnostic,{reason:'unexpected_output_type',outputTypeCounts:{message:1,reasoning:0,web_search_call:1,other:1},searchCallCount:1,searchActionCounts:{search:1,open_page:0,find_in_page:0,other:0},searchStatusCounts:{completed:1,failed:0,incomplete:0,in_progress:0,searching:0,other:0}});
  assert.deepEqual(e.usage,{input_tokens:1000,output_tokens:100,total_tokens:1100,input_tokens_details:{cached_tokens:300,cache_write_tokens:500},output_tokens_details:{reasoning_tokens:0}});
  const diagnostic=JSON.stringify({message:e.message,diagnostic:e.diagnostic,usage:e.usage});
  for(const forbidden of [secret,'https://','gpt-6-luna','ws_dummy','fake-search-credential','private_content','arbitrary_numeric_metadata'])assert.ok(!diagnostic.includes(forbidden));
  return true;
 });
 assert.equal(f.count(),1);
});

for(const secondStatus of ['completed','incomplete'])test(`two search-call items remain rejected when the second is ${secondStatus}; neither is silently ignored or retried`,async()=>{
 const second={...call({type:'search',queries:['別のダミー検索']}),id:'ws_second',status:secondStatus};
 const data=response();data.output.push(second);const f=fixture(data);
 await assert.rejects(search(f),e=>{assert.equal(e.code,'SEARCH_CALL_LIMIT');assert.equal(e.diagnostic.reason,'tool_call_limit');assert.equal(e.diagnostic.searchCallCount,2);assert.equal(e.diagnostic.outputTypeCounts.web_search_call,2);assert.deepEqual(e.usage.input_tokens_details,usage.input_tokens_details);return true;});
 assert.equal(f.count(),1);
});

for(const status of ['failed','incomplete','in_progress','searching'])test(`a ${status} search cannot be presented as a successful completed search`,async()=>{
 const data=response();data.output[0].status=status;const f=fixture(data);
 await assert.rejects(search(f),e=>{assert.equal(e.code,'SEARCH_INCOMPLETE');assert.equal(e.diagnostic.reason,'search_not_completed');assert.equal(e.diagnostic.searchStatusCounts[status],1);assert.equal(e.diagnostic.searchCallCount,1);return true;});
 assert.equal(f.count(),1);
});

test('unknown search actions are rejected without copying their name, query or URL into diagnostics',async()=>{
 const privateValue='private-unknown-action',data=response();data.output[0].action={type:privateValue,query:'private query',url:'https://example.com/private'};const f=fixture(data);
 await assert.rejects(search(f),e=>{assert.equal(e.code,'UNEXPECTED_SEARCH_ACTION');assert.equal(e.diagnostic.reason,'unexpected_search_action');assert.equal(e.diagnostic.searchActionCounts.other,1);assert.ok(!JSON.stringify(e.diagnostic).includes(privateValue));assert.ok(!JSON.stringify(e.diagnostic).includes('https://'));return true;});
 assert.equal(f.count(),1);
});

test('unrequested search calls remain forbidden even if harmless-looking text and citations are also returned',async()=>{
 const f=fixture(response());
 await assert.rejects(f.provider.run('chat',{prompt:'検索を指定しないダミー質問',search:false}),e=>{assert.equal(e.code,'UNREQUESTED_SEARCH');assert.equal(e.diagnostic.reason,'unrequested_search');assert.equal(e.diagnostic.searchCallCount,1);return true;});
 assert.equal(f.count(),1);
});

test('a response without a search call cannot silently pass as a checked web-search result',async()=>{
 const f=fixture(response({output:[structuredClone(message)]}));
 await assert.rejects(search(f),e=>{assert.equal(e.code,'SEARCH_NOT_PERFORMED');assert.equal(e.diagnostic.reason,'missing_search_call');assert.equal(e.diagnostic.searchCallCount,0);return true;});
 assert.equal(f.count(),1);
});

test('unsupported numeric usage still yields an unknown cost instead of zero or a guessed search price',async()=>{
 const data=response();data.usage.input_tokens_details.new_nonzero_meter=1;const f=fixture(data),r=await search(f);
 assert.equal(r.cost,null);assert.deepEqual(r.usage,data.usage);assert.equal(f.count(),1);
});

test('incomplete response diagnostics preserve counters before text validation, with no partial private text',async()=>{
 const f=fixture(response({status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:'partial-private-text'}]}]}));
 await assert.rejects(search(f),e=>{assert.equal(e.code,'INCOMPLETE');assert.equal(e.diagnostic.reason,'incomplete_response');assert.equal(e.diagnostic.outputTypeCounts.message,1);assert.equal(e.usage.total_tokens,1100);assert.ok(!JSON.stringify(e.diagnostic).includes('partial-private-text'));return true;});
 assert.equal(f.count(),1);
});

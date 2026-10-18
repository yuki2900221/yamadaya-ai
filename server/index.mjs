import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Ledger } from './ledger.mjs';
import { createProvider } from './provider.mjs';
import { createDemoProvider } from './demo.mjs';
import { FEATURES, validateJob, error } from './contracts.mjs';
import { reviewProposal } from '../shared/proposal-policy.js';
const root=path.resolve(import.meta.dirname,'..');
const hash=s=>createHash('sha256').update(s).digest('hex');
export function numericUsage(value,depth=0){
 if(Number.isSafeInteger(value)&&value>=0)return value;
 if(!value||typeof value!=='object'||Array.isArray(value)||depth>=3)return undefined;
 return Object.fromEntries(Object.entries(value).filter(([k])=>/^[a-z_]{1,60}$/.test(k)).map(([k,v])=>[k,numericUsage(v,depth+1)]).filter(([,v])=>v!==undefined));
}
const loopback=a=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(a);
const publicJob=(record,result)=>({id:record.id,state:record.state,result:record.state==='succeeded'?result||null:null,message:record.state==='unknown'?'結果または課金が未確定です。自動で再送しません。':record.state==='sending'?'作成しています。':'',billing:record.state==='succeeded'?'usage計算・請求未照合':'未確定'});
export function createApp({mode='unconfigured',budgetUsd=0,directory=path.join(root,'.runtime'),provider,origin='http://127.0.0.1:4176',allowedOrigins=[origin],sessionTtlMs=15*60*1000,now=()=>Date.now(),textKey='',imageKey='',project='',searchEnabled=false,continuation=null,acknowledgement=null}={}){
 if(!['demo','live','unconfigured'].includes(mode))throw Error('Invalid APP_MODE');
 const demo=mode==='demo', ledger=new Ledger(demo?':memory:':path.join(directory,'jobs.sqlite'),{budgetUsd:demo?10:budgetUsd,now});
 const ai=provider||(demo?createDemoProvider():createProvider({textKey,imageKey,project,searchEnabled}));
 const sessions=new Map(),results=new Map(); let running=0;
 const cookieName=`yamadaya_session_${hash(`${mode}:${origin}`).slice(0,16)}`;
 const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
 function expire(){for(const[id,s]of sessions)if(s.expires<now()){sessions.delete(id);for(const[k,r]of results)if(r.owner===s.owner)results.delete(k);}}
 const handler=async(req,res)=>{
  let dispatched=false;
  for(const[k,v]of Object.entries(security))res.setHeader(k,v);
  const json=(status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));};
  try{
   expire();
   const host=new URL(origin).host;
   if(!loopback(req.socket.remoteAddress)||!allowedOrigins.some(o=>new URL(o).host===req.headers.host))throw error(403,'このPCからの接続だけ利用できます。','DEVICE_REQUIRED');
   if(req.url.includes('..')||/%2e|%2f|%5c/i.test(req.url))throw error(403,'使用できないパスです。','INVALID_PATH');
   const url=new URL(req.url,origin),pathname=url.pathname;
   if(!pathname.startsWith('/api/')){
    if(!['GET','HEAD'].includes(req.method))throw error(405,'使用できない操作です。');
    if(pathname.includes('%')||!(pathname==='/'||pathname==='/mark.svg'||/^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname)))throw error(404,'見つかりません。');
    const file=pathname.startsWith('/assets/')?path.join(root,'dist',pathname):pathname==='/mark.svg'?path.join(root,'dist/mark.svg'):path.join(root,'dist/index.html');
    const bytes=await fs.readFile(file).catch(()=>{throw error(404,'画面が準備できていません。');});
    const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.html':'text/html; charset=utf-8'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(req.method==='HEAD'?undefined:bytes);return;
   }
   if(!['GET','POST'].includes(req.method))throw error(405,'使用できない操作です。');
   // Deny privileged APIs before any session or payload processing.
   if(!/^\/api\/(session|jobs(?:\/[0-9a-f-]+)?|end)$/.test(pathname))throw error(403,'共用PCではこの機能を利用できません。','FORBIDDEN');
   const reqOrigin=req.headers.origin;
   if(reqOrigin&&!allowedOrigins.includes(reqOrigin))throw error(403,'送信元を確認できません。','ORIGIN_REJECTED');
   if(req.method==='POST'&&!allowedOrigins.includes(reqOrigin))throw error(403,'送信元を確認できません。','ORIGIN_REQUIRED');
   const sid=(req.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${cookieName}=([a-f0-9]{64})(?:;|$)`))?.[1];
   let session=sessions.get(sid);
   if(pathname==='/api/session'&&req.method==='GET'){
    if(!session){const id=randomBytes(32).toString('hex');session={owner:hash(id),csrf:randomBytes(32).toString('hex'),expires:now()+sessionTtlMs};sessions.set(id,session);res.setHeader('Set-Cookie',`${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/`);}
    session.expires=now()+sessionTtlMs;
    const oneTestId=continuation&&continuation.expires>now()&&!ledger.db.prepare('SELECT id FROM jobs WHERE id=?').get(continuation.id)?continuation.id:null;
    json(200,{csrf:session.csrf,mode,capabilities:FEATURES,connected:mode==='live'&&!!textKey,imageConnected:mode==='live'&&!!imageKey,budgetRemainingUsd:demo?null:Math.max(0,(ledger.usage().limit-ledger.usage().reserved)/1e6),idleMinutes:sessionTtlMs/60000,searchEnabled:demo||searchEnabled,oneTestFeature:oneTestId?(continuation.feature||'image'):null,spendingPaused:!demo&&ledger.usage().uncertain>0&&!oneTestId&&!ledger.acknowledged(acknowledgement),oneTestId});return;
   }
   if(!session)throw error(401,'利用時間が終了しました。画面を更新して始めてください。','SESSION_EXPIRED');
   session.expires=now()+sessionTtlMs;
   if(req.method==='GET'&&pathname.startsWith('/api/jobs/')){const id=pathname.split('/').at(-1),j=ledger.get(id,session.owner);if(!j)throw error(404,'この操作は見つかりません。');return json(200,{...publicJob(j,results.get(id)?.value),canStartNewOperations:j.state==='unknown'&&ledger.acknowledged(acknowledgement)});}
   const csrf=String(req.headers['x-csrf-token']||'');
   if(csrf.length!==session.csrf.length||!timingSafeEqual(Buffer.from(csrf),Buffer.from(session.csrf)))throw error(403,'画面を更新してから操作してください。','CSRF_REJECTED');
   if(pathname==='/api/end'&&req.method==='POST'){sessions.delete(sid);for(const[k,r]of results)if(r.owner===session.owner)results.delete(k);res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);return json(200,{ended:true});}
   if(pathname!=='/api/jobs'||req.method!=='POST')throw error(405,'使用できない操作です。');
   if(!req.headers['content-type']?.startsWith('application/json'))throw error(415,'JSONで送信してください。');
   let count=0;const chunks=[];for await(const chunk of req){count+=chunk.length;if(count>9_000_000)throw error(413,'画像または入力が大きすぎます。');chunks.push(chunk);}
   let body;try{body=validateJob(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){throw e.status?e:error(400,'入力を読み取れません。');}
   if(!demo&&(mode!=='live'||(body.feature==='image'?!imageKey:!textKey)))throw error(503,'AIの接続準備中です。','NOT_CONFIGURED');
   if(body.input.search&&!demo&&!searchEnabled)throw error(403,'Web検索は費用の確認後に有効化します。','SEARCH_DISABLED');
   const requestHash=hash(JSON.stringify({feature:body.feature,input:body.input}));
   const old=ledger.get(body.id,session.owner);
   if(old&&old.request_hash!==requestHash)throw error(409,'同じ操作IDで内容を変更できません。');
   if(old)return json(200,publicJob(old,results.get(body.id)?.value));
   if(running>=1)throw error(429,'別の処理を作成中です。完了してから操作してください。','BUSY');
   const reserved=ledger.reserve(body.id,session.owner,body.feature,body.input.search===true,requestHash,continuation,acknowledgement);
   if(reserved.duplicate)return json(200,publicJob(reserved.record,results.get(body.id)?.value));
   running++;
   try{
    dispatched=true;const generated=await ai.run(body.feature,body.input);
    let value=generated.result;
    if(body.feature==='pop'){
     const safe=reviewProposal({info:body.input.prompt,atmosphere:'',paper:body.input.paper||'a4p',mood:({'明るく':'lively','自然に':'fresh','落ち着いて':'premium','やさしく':'friendly'})[body.input.mood||'明るく']},{headlines:[value.headline,value.headline,value.headline],catchphrase:value.copy,direction:value.direction,confirmation_points:value.checks.length?value.checks:['内容をご確認ください。']});
     value={headline:safe.proposal.headlines[0],headlines:[...new Set(safe.proposal.headlines)],copy:safe.proposal.catchphrase,direction:safe.proposal.direction,checks:safe.proposal.confirmation_points,paper:safe.paper.code,adjusted:safe.adjusted,demo};
    }
    const cost=generated.cost;
    await fs.mkdir(path.join(directory,'audit'),{recursive:true,mode:0o700});
    await fs.writeFile(path.join(directory,'audit',`${body.id}.json`),JSON.stringify({usage:numericUsage(generated.usage),calculatedUsd:Number.isFinite(cost)&&cost>=0?cost:null}),{mode:0o600});
    if(cost==null||!Number.isFinite(cost)||cost<0||cost>reserved.record.hold/1e6){ledger.finish(body.id,'unknown',cost!=null&&Number.isFinite(cost)&&cost>=0?cost:null);throw error(409,'費用の確認が必要です。管理PCで確認するまで新しい送信を停止します。','COST_UNCERTAIN');}
    ledger.finish(body.id,'succeeded',cost);
    // An API can finish after its user has ended or outlived the session.
    // Keep the cost audit, but never revive that user's output or return it.
    expire();
    if(sessions.get(sid)!==session)return json(401,{error:'利用時間が終了しました。処理費用の記録は保持し、結果は破棄しました。',code:'SESSION_EXPIRED',notDispatched:false});
    results.set(body.id,{owner:session.owner,value});
    return json(200,publicJob(ledger.get(body.id,session.owner),value));
   }catch(e){if(ledger.get(body.id,session.owner)?.state==='sending')ledger.finish(body.id,'unknown',null);
    const safeCode=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,50}$/.test(v)?v:null;
    await fs.mkdir(path.join(directory,'diagnostics'),{recursive:true,mode:0o700});
    await fs.writeFile(path.join(directory,'diagnostics',`${body.id}.json`),JSON.stringify({name:safeCode(e.name),code:safeCode(e.code),cause:safeCode(e.cause?.code),http_status:Number.isInteger(e.status)?e.status:null}),{mode:0o600});
    throw error(e.status||502,e.status?e.message:'通信または結果を確認できません。自動では再送しません。',e.code||'RESULT_UNCERTAIN');}
   finally{running--;}
  }catch(e){json(e.status||500,{error:e.status?e.message:'処理を完了できませんでした。',code:e.code||'INTERNAL_ERROR',notDispatched:!dispatched});}
 };
 return {handler,ledger,close(){ledger.close();},expire,get retainedResultCount(){return results.size;}};
}
export async function start({port=Number(process.env.PORT||4176),mode=process.env.APP_MODE||'unconfigured',origin=process.env.APP_ORIGIN||`http://127.0.0.1:${port}`,allowedOrigins=[origin],...options}={}){
 let continuation=null;try{const file=path.join(root,'.runtime/one-test.json');const stat=await fs.stat(file);if(!(stat.mode&0o077))continuation=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 let acknowledgement=null;try{const file=path.join(root,'.runtime/acknowledged-unknown.json');const stat=await fs.stat(file);if(!(stat.mode&0o077))acknowledgement=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const app=createApp({mode,origin,allowedOrigins,budgetUsd:Number(process.env.TRIAL_BUDGET_USD||0),textKey:process.env.OPENAI_TEXT_KEY||'',imageKey:process.env.OPENAI_IMAGE_KEY||'',project:process.env.OPENAI_PROJECT||'',searchEnabled:process.env.ENABLE_SEARCH==='true',continuation,acknowledgement,...options});
 const server=http.createServer(app.handler);server.requestTimeout=200000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 console.log(`やまだやAI: ${origin} (${mode})`);return {server,app};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await start();

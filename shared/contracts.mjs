export const FEATURES = Object.freeze(['chat','writing','pop','image']);
export const PAPERS = Object.freeze({a4p:{label:'A4 縦',width:210,height:297},a4l:{label:'A4 横',width:297,height:210},a3p:{label:'A3 縦',width:297,height:420},a3l:{label:'A3 横',width:420,height:297}});
export const RESERVES = Object.freeze({chat:0.015,writing:0.015,pop:0.015,image:0.35,chatSearch:0.05});
export const POP_DESIGN_NOTES_MAX = 500;
export const validPopDesignNotes = value => typeof value === 'string' && value.length <= POP_DESIGN_NOTES_MAX;
export const error = (status,message,code='INVALID_REQUEST') => Object.assign(new Error(message),{status,code});
const text = (v,max,optional=false) => typeof v==='string' && v.length<=max && (optional || v.trim().length>0);
export function validateJob(value) {
  if (!value || !FEATURES.includes(value.feature) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id||'')) throw error(400,'操作を確認してください。');
  const i=value.input;
  if (!i || Object.keys(i).some(k=>!['prompt','paper','mood','purpose','tone','history','reference','confirmed','headline','copy','direction','designNotes','action','search'].includes(k))) throw error(400,'使用できない入力項目があります。');
  if (!text(i.prompt,4000)) throw error(400,'内容を1〜4,000文字で入力してください。');
  if(value.feature==='pop'&&i.prompt.length>1500)throw error(400,'POPの商品情報は1,500文字以内で入力してください。');
  if (i.paper!==undefined && !Object.hasOwn(PAPERS,i.paper)) throw error(400,'用紙を選んでください。');
  if (i.mood!==undefined && !['明るく','自然に','落ち着いて','やさしく'].includes(i.mood)) throw error(400,'雰囲気を選んでください。');
  if (i.purpose!==undefined && !['お知らせ','接客・返信','商品紹介','文章を整える'].includes(i.purpose)) throw error(400,'文章の種類を選んでください。');
  if (i.tone!==undefined && !['丁寧','親しみやすく','簡潔'].includes(i.tone)) throw error(400,'文体を選んでください。');
  if (i.history!==undefined && (!Array.isArray(i.history)||i.history.length>8||i.history.some(m=>!['user','assistant'].includes(m.role)||!text(m.content,4000)))) throw error(400,'会話が長すぎます。新しく始めてください。');
  if (i.search!==undefined && typeof i.search!=='boolean') throw error(400,'検索設定を確認してください。');
  for(const k of ['headline','copy','direction']) if(i[k]!==undefined&&!text(i[k],600,true))throw error(400,'提案内容が長すぎます。');
  if(i.designNotes!==undefined&&(!validPopDesignNotes(i.designNotes)||value.feature!=='image'||i.action!=='pop'))throw error(400,'デザインの追加指定はPOP作成で500文字以内で入力してください。');
  if(i.action!==undefined&&!['generate','edit','pop'].includes(i.action))throw error(400,'画像の処理を選んでください。');
  if(value.feature==='image' && i.confirmed!==true)throw error(400,'送信内容と画像生成を確認してください。','CONFIRMATION_REQUIRED');
  if(i.reference!==undefined && (typeof i.reference!=='string'||i.reference.length>8_500_000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(i.reference)))throw error(400,'JPEG画像を選び直してください。');
  if(value.feature==='image'&&i.action==='edit'&&!i.reference)throw error(400,'修正元の画像を選んでください。');
  return {id:value.id,feature:value.feature,input:structuredClone(i)};
}
export function safeTextOutput(data) {
  if(data?.status!=='completed'||!Array.isArray(data.output))throw error(502,'回答が完了しませんでした。再送せず状態を確認します。','INCOMPLETE');
  const allowed=new Set(['message','reasoning','web_search_call']);
  if(data.output.some(x=>!allowed.has(x.type)))throw error(502,'使用できない処理が返されました。','UNEXPECTED_TOOL');
  const texts=[],sources=[];
  for(const o of data.output)if(o.type==='message')for(const c of o.content||[]){
    if(c.type==='refusal')throw error(422,'この内容への回答は作成できませんでした。','REFUSED');
    if(c.type!=='output_text'||typeof c.text!=='string')throw error(502,'回答形式を確認できません。');
    texts.push(c.text);
    for(const a of c.annotations||[])if(a.type==='url_citation'){try{const u=new URL(a.url);if(u.protocol==='https:')sources.push({title:String(a.title||u.hostname).slice(0,200),url:u.href});}catch{}}
  }
  const text=texts.join('\n');if(!text.trim()||text.length>16000)throw error(502,'回答が空か長すぎます。');
  return {text,sources:sources.slice(0,12)};
}

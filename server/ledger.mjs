import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { error, RESERVES } from './contracts.mjs';
export class Ledger {
 constructor(file,{budgetUsd=0,now=()=>Date.now()}={}) {
  if(!Number.isFinite(budgetUsd)||budgetUsd<0||budgetUsd>10)throw Error('Budget must be between 0 and the approved 10 USD.');
  if(file!==':memory:'){mkdirSync(path.dirname(file),{recursive:true,mode:0o700});}
  this.db=new DatabaseSync(file);this.now=now;this.limit=Math.round(budgetUsd*1e6);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,feature TEXT NOT NULL,state TEXT NOT NULL,hold INTEGER NOT NULL,cost INTEGER,created INTEGER NOT NULL,finished INTEGER,request_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS budget(id INTEGER PRIMARY KEY CHECK(id=1),limit_micros INTEGER NOT NULL);');
  const old=this.db.prepare('SELECT limit_micros FROM budget WHERE id=1').get();
  if(old && old.limit_micros!==this.limit)throw Error('Existing trial budget differs. Review ledger locally; do not reset it.');
  this.db.prepare('INSERT OR IGNORE INTO budget VALUES(1,?)').run(this.limit);
  this.db.prepare("UPDATE jobs SET state='unknown' WHERE state='sending'").run();
  if(file!==':memory:')chmodSync(file,0o600);
 }
 usage(){const r=this.db.prepare("SELECT COALESCE(SUM(CASE WHEN cost IS NULL THEN hold ELSE MAX(cost,hold) END),0) AS reserved,COALESCE(SUM(cost),0) AS calculated,COUNT(*) AS count,SUM(CASE WHEN state IN ('sending','unknown') THEN 1 ELSE 0 END) AS uncertain FROM jobs").get();return {...r,limit:this.limit};}
 acknowledged(ack){
  const rows=this.db.prepare("SELECT * FROM jobs WHERE state IN ('sending','unknown')").all();
  return rows.length===1&&rows[0].state==='unknown'&&rows[0].id===ack?.source&&rows[0].hold===350000&&ack.hold===350000&&Number.isFinite(ack.expires)&&ack.expires>this.now();
 }
 reserve(id,owner,feature,search=false,requestHash='',continuation=null,acknowledgement=null){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const old=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
   if(old){if(old.owner!==owner)throw error(404,'この操作は見つかりません。');if(old.request_hash!==requestHash)throw error(409,'同じ操作IDで内容を変更できません。');this.db.exec('COMMIT');return {record:old,duplicate:true};}
   const u=this.usage(),hold=Math.round(RESERVES[feature==='chat'&&search?'chatSearch':feature]*1e6);
   if(u.uncertain){
    const unknown=this.db.prepare("SELECT * FROM jobs WHERE state IN ('sending','unknown')").all();
    const sources=continuation?.sources||(continuation?.source?[{id:continuation.source,hold:350000}]:[]);
    const permitted=sources.length>0&&unknown.length===sources.length&&unknown.every(j=>j.state==='unknown'&&sources.some(s=>s.id===j.id&&s.hold===j.hold))&&continuation?.id===id&&continuation?.requestHash===requestHash&&feature===(continuation.feature||'image')&&search===(continuation.search??false)&&continuation.expires>this.now();
    if(unknown.some(j=>j.request_hash===requestHash))throw error(409,'未確定の操作と同じ内容は再送できません。','UNCERTAIN_DUPLICATE');
    if(!permitted&&!this.acknowledged(acknowledgement))throw error(409,'前の処理が未確定です。管理PCで確認するまで新しい送信を停止しています。','UNCERTAIN');
   }
   if(this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE owner=? AND created>?").get(owner,this.now()-60000).n>=6)throw error(429,'少し待ってから操作してください。','RATE_LIMIT');
   if(u.reserved+hold>this.limit)throw error(409,'試用の費用上限に達しました。','BUDGET_LIMIT');
   this.db.prepare("INSERT INTO jobs VALUES(?,?,?,'sending',?,NULL,?,NULL,?)").run(id,owner,feature,hold,this.now(),requestHash);
   const record=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);this.db.exec('COMMIT');return {record,duplicate:false};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 finish(id,state,cost){this.db.prepare('UPDATE jobs SET state=?,cost=?,finished=? WHERE id=?').run(state,cost==null?null:Math.ceil(cost*1e6),this.now(),id);}
 get(id,owner){return this.db.prepare('SELECT * FROM jobs WHERE id=? AND owner=?').get(id,owner);}
 close(){this.db.close();}
}

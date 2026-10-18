import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
const file=path.resolve(import.meta.dirname,'../.runtime/jobs.sqlite');
const db=new DatabaseSync(file,{readOnly:true});
const rows=db.prepare('SELECT id,feature,state,cost,hold,created,finished FROM jobs ORDER BY created').all();
console.log(JSON.stringify({jobs:rows.map(j=>({...j,calculatedUsd:j.cost==null?null:j.cost/1e6,reservedUsd:j.hold/1e6})),calculatedUsd:rows.reduce((s,j)=>s+(j.cost||0),0)/1e6,unconfirmedHoldsUsd:rows.filter(j=>j.cost==null).reduce((s,j)=>s+j.hold,0)/1e6},null,2));db.close();

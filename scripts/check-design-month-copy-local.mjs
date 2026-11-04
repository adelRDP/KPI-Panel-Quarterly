// Read-only production verification. No copy, approval, inference, uploads or raw document reads.
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const snapshot=process.argv[2]||'data/processed/kpi-panel/before-design-month-copy-20261007-01.sqlite',before=new DatabaseSync(snapshot,{readOnly:true}),after=new DatabaseSync('data/processed/kpi-panel/panel.sqlite',{readOnly:true});
const previous=before.prepare('SELECT * FROM records').all(),current=after.prepare('SELECT * FROM records').all(),map=new Map(current.map(r=>[r.id,r]));
for(const row of previous){assert.ok(map.has(row.id));assert.deepEqual(map.get(row.id),row);}assert.equal(current.length,previous.length);before.close();after.close();
const base='http://127.0.0.1:4273';let session=await(await fetch(base+'/api/session')).json();
const request=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'x-panel-token':session.token},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200);return r.json();};
const managers=[];for(const id of ['manager-ops','manager-finance']){
 session=await request('/api/session',{userId:id});const rows=await request('/api/org/designs');for(const row of rows.filter(d=>d.status==='published')){assert.equal(row.alignmentCurrent,true);assert.equal(row.copyNextMonth?.allowed,true);}managers.push({managerId:id,designs:rows.filter(d=>d.status!=='draft').map(d=>({status:d.status,period:d.period,alignmentCurrent:d.alignmentCurrent,copyAllowed:d.copyNextMonth?.allowed===true,targetPeriod:d.copyNextMonth?.targetPeriod||null,textDateCount:d.copyNextMonth?.textChangeCount||0,blockedReason:d.copyNextMonth?.reason||null}))});
}
const providers=await request('/api/providers');assert.equal(providers.defaultProvider,'codex');assert.equal(providers.automaticReview,true);
const assets=[];for(const path of ['src/lifecycle-ui.js','src/styles.css']){const r=await fetch(base+'/'+path);assert.equal(r.status,200);assert.equal(await r.text(),await readFile(path,'utf8'));assets.push({path,status:200,current:true});}
const report={snapshot,recordsBefore:previous.length,recordsAfter:current.length,allExistingRecordsIdentical:true,managers,assets,provider:providers.defaultProvider,codexReady:providers.providers.find(p=>p.provider==='codex')?.ready,automaticReview:providers.automaticReview,liveModelCalls:0,realCopiesCreatedByCheck:0};
await writeFile('outputs/design-month-copy-local-20261007.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

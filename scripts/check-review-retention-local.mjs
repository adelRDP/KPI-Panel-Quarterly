import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,basename,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve('data/processed/kpi-panel'),snapshot=resolve(process.argv[2]||'');
if(dirname(snapshot)!==root||!/^before-reviewed-evidence-.*\.sqlite$/.test(basename(snapshot)))throw Error('Pass the exact scoped cleanup snapshot within the main data directory.');
const activityId='0cc984c2-6de4-4e50-b168-d2a657da322d',reviewId='15241b2d-7707-4638-97ed-17144142620a',docIds=['87d45713-be02-41a9-87dd-66a93df0d5a3','db05fa0d-62b9-4d3c-ac33-1d220e020172'];
const before=new DatabaseSync(snapshot,{readOnly:true}),after=new DatabaseSync(join(root,'panel.sqlite'),{readOnly:true});
const rows=db=>db.prepare('SELECT * FROM records').all(),oldRows=rows(before),newRows=rows(after),current=new Map(newRows.map(r=>[r.id,r]));let untouched=0;
for(const row of oldRows){
 const found=current.get(row.id);assert.ok(found);assert.equal(found.kind,row.kind);assert.equal(found.parent,row.parent);
 const previous=JSON.parse(row.value),value=JSON.parse(found.value);
 if(docIds.includes(row.id)){
  assert.equal(value.archiveReason,'review_not_approved');assert.equal(value.archivedByReviewId,reviewId);
  for(const key of ['archivedAt','archivedBy','archiveReason','archivedByReviewId'])delete value[key];assert.deepEqual(value,previous);
  assert.equal(createHash('sha256').update(await readFile(previous.path)).digest('hex'),previous.sha256);
 }else if(row.id===reviewId){assert.equal(value.evidenceDisposition.archivedDocumentIds.length,2);delete value.evidenceDisposition;assert.deepEqual(value,previous);}
 else {assert.equal(found.value,row.value);untouched++;}
}
const oldIds=new Set(oldRows.map(r=>r.id)),added=newRows.filter(r=>!oldIds.has(r.id));assert.equal(added.length,1);assert.equal(added[0].kind,'audit-event');assert.equal(JSON.parse(added[0].value).action,'review.evidence-archived');
before.close();after.close();
const base='http://127.0.0.1:4273';let session=await(await fetch(base+'/api/session')).json();const request=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'x-panel-token':session.token},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200);return r.json();};
session=await request('/api/session',{userId:'employee-ops-4'});const data=await request('/api/activities/'+activityId),providers=await request('/api/providers');assert.equal(data.documents.length,0);assert.equal(data.reviews[0].result.decision,'insufficient');assert.equal(data.history.length,1);assert.equal(data.submissionQuota.used,1);assert.equal(data.submissionQuota.remaining,4);assert.equal(data.reviewMatchesCurrentEvidence,true);assert.equal(providers.defaultProvider,'codex');assert.equal(providers.automaticReview,true);
const report={snapshot,recordsBefore:oldRows.length,recordsAfter:newRows.length,unchangedExisting:untouched,changedOnly:['two-document-archive-metadata','one-review-disposition'],addedAuditEvents:1,rawFilesIntact:2,activeAttachments:0,historyEntries:data.history.length,decision:data.reviews[0].result.decision,quotaUsed:data.submissionQuota.used,quotaRemaining:data.submissionQuota.remaining,provider:providers.defaultProvider,codexReady:providers.providers.find(p=>p.provider==='codex')?.ready,automaticReview:providers.automaticReview,modelCalls:0,physicalDeletes:0};
await writeFile('outputs/review-retention-local-20261006.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

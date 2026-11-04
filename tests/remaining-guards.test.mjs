import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,quarterOf} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'kpi-remaining-')),store=openStore(root),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{runModel:async()=>{throw Error('No model');}});t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});return {store,workflow,org,id:'employee-mohammad',manager:workflow.user('manager-ops'),hr:workflow.user('hr-demo')};}
test('locked quarter rejects replacing synthetic exam and adding monthly results while preserving exact retries and other people',async t=>{
 const f=await fixture(t),period=f.workflow.currentPeriod,quarter=quarterOf(period),existing=f.store.list('exam-result',f.id).find(r=>r.period===quarter);assert.ok(existing);const locked=f.store.put('quarter-evaluation',{employeeId:f.id,quarter,status:'locked',lockedSnapshot:{marker:'unchanged'}},f.id),before=JSON.stringify(f.store.list('exam-result',f.id));
 assert.throws(()=>f.workflow.recordExamResult({employeeId:f.id,period:quarter,score:99,reference:'new-import'}),e=>e.status===409);
 assert.throws(()=>f.workflow.recordExamResult({employeeId:f.id,period,score:99,reference:'month-import'}),e=>e.status===409);
 assert.deepEqual(f.workflow.recordExamResult({employeeId:f.id,period:quarter,score:existing.score,reference:existing.reference}),existing);
 const batch=f.org.importExamBatch(f.hr,{quarter,batchKey:'locked-mixed',rows:[{employeeId:f.id,score:99},{employeeId:'employee-sara',score:97}]});assert.equal(batch.importedCount,1);assert.equal(batch.quarantined.length,1);assert.equal(JSON.stringify(f.store.list('exam-result',f.id)),before);assert.deepEqual(f.store.get(locked.id,'quarter-evaluation'),locked);
});
test('ordinary drafts require the version opened in the form and stale saves or publication preserve newer tasks',async t=>{
 const f=await fixture(t),task={category:'routine',title:'Synthetic task',description:'Synthetic description',criteria:['Evidence'],weightPoints:3,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'09:00'}},input={employeeId:f.id,period:f.workflow.currentPeriod,tasks:[task]},draft=f.org.saveDesignDraft(f.manager,input),newer=f.org.saveDesignDraft(f.manager,{...input,draftRevision:draft.draftRevision,tasks:[{...task,title:'Newer title'}]},draft.id),before=JSON.stringify(f.store.list('kpi-design'));
 for(const draftRevision of [undefined,draft.draftRevision])assert.throws(()=>f.org.saveDesignDraft(f.manager,{...input,draftRevision},draft.id),e=>e.status===409);
 await assert.rejects(f.org.publishDesignDraft(f.manager,draft.id,'codex',draft.draftRevision),e=>e.status===409);assert.equal(JSON.stringify(f.store.list('kpi-design')),before);assert.equal(f.store.list('ai-design-attempt').length,0);
 const appended=f.org.saveDesignDraft(f.manager,{...input,tasks:[{...task,title:'Append task'}]});assert.equal(appended.id,newer.id);assert.equal(appended.tasks.length,2);assert.equal(appended.tasks[0].title,'Newer title');
});

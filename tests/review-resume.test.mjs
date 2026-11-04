import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createPanelServer} from '../server.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,currentPeriod} from '../backend/personnel-workflow.mjs';
import {createAutomaticReview} from '../backend/automatic-review.mjs';
import {sha256} from '../backend/evaluation.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'kpi-resume-')),store=openStore(root),workflow=createWorkflow(store),actor=workflow.user('employee-mohammad'),path=join(root,'synthetic.txt'),raw='Synthetic source';await writeFile(path,raw);
 const a=store.put('activity',{kind:'routine',title:'Synthetic resume',description:'Synthetic task',period:currentPeriod(),ownerId:actor.id,unitId:actor.unitId,assignmentStatus:'approved',criteria:[{id:'C1',text:'Synthetic criterion'}]});
 const d=store.put('document',{name:'synthetic.txt',path,sha256:sha256(raw),createdAt:new Date().toISOString(),extraction:{status:'ready',chunks:Array.from({length:5},(_,i)=>({id:'PART_'+(i+1),label:'Synthetic part '+(i+1),text:'PART_'+(i+1)+' '+ 'x'.repeat(32000)})),warnings:[]}},a.id);
 let fail=true,closeExternal=async()=>{};const calls=[];
 const controller=createAutomaticReview(store,workflow,{enabled:false,archiveRejectedEvidence:true,uploadRoot:root,busy:new Set(),notifications:{publish(){}},runModel:async({prompt,timeoutMs})=>{
  assert.equal(timeoutMs,300000);const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]),id=prompt.startsWith('FINAL FILE REPORT')?'FINAL':e.chunks[0].id;calls.push(id);
  if(fail&&id==='PART_3')throw Error('Synthetic permanent provider failure');
  return {result:{summary:'Synthetic',criteria:[{id:'C1',status:'met',score:95,reason:'Synthetic',citations:[{chunkId:e.chunks[0].id,quote:e.chunks[0].text.slice(0,7)}]}]}};
 }});
 t.after(async()=>{controller.stop();await closeExternal();store.close();await rm(root,{recursive:true,force:true});});
 const first=await controller.queue(actor,a,'codex');await assert.rejects(controller.execute(first),/Synthetic permanent provider failure/);
 return {root,store,workflow,actor,a,d,controller,calls,first:store.get(first.id,'review'),allow(){fail=false;},beforeCleanup(fn){closeExternal=fn;}};
}

test('resume availability is a read-only owner check and never starts extraction or a model',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.store.list('review')),documents=JSON.stringify(f.store.list('document')),calls=f.calls.length;
 assert.equal(f.controller.canResume(f.actor,f.a,f.first.id),true);assert.equal(f.controller.canResume(f.workflow.user('hr-demo'),f.a,f.first.id),false);
 f.store.put('activity',{...f.a,title:'Changed definition'});assert.equal(f.controller.canResume(f.actor,f.a,f.first.id),false);
 assert.equal(JSON.stringify(f.store.list('review')),before);assert.equal(JSON.stringify(f.store.list('document')),documents);assert.equal(f.calls.length,calls);
});
test('resume restores the same archived files, reuses valid parts and leaves the failed result untouched',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.first);assert.equal(f.first.fileProcessing.readParts,2);assert.ok(f.store.get(f.d.id,'document').archivedAt);f.allow();
 const queued=await f.controller.resume(f.actor,f.a,f.first.id);assert.equal(queued.status,'queued');assert.equal(queued.modelTimeoutMs,300000);assert.equal(queued.resumeReadParts,2);assert.equal(queued.fileProcessing.resumeFromPart,3);assert.equal(queued.fingerprint,f.first.fingerprint);assert.equal(queued.submissionKey,f.first.submissionKey);assert.equal(f.store.get(f.d.id,'document').archivedAt,undefined);
 const done=await f.controller.execute(queued);assert.equal(done.status,'done');assert.equal(done.result.fileProcessing.reusedParts,2);assert.equal(done.result.fileProcessing.modelCalls,4);assert.deepEqual(f.calls,['PART_1','PART_2','PART_3','PART_3','PART_4','PART_5','FINAL']);assert.equal(JSON.stringify(f.store.get(f.first.id,'review')),before);assert.equal(f.store.list('audit-event').filter(r=>r.action==='review.resumed').length,1);
});

test('changed task, changed raw file, another actor and manual archival prevent resume without restoring documents',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.store.get(f.d.id,'document')),old=JSON.stringify(f.first);
 await assert.rejects(f.controller.resume(f.workflow.user('hr-demo'),f.a,f.first.id),e=>e.status===403);
 f.store.put('activity',{...f.a,title:'Changed'},f.a.id);await assert.rejects(f.controller.resume(f.actor,f.a,f.first.id),/تعریف شاخص/);f.store.put('activity',f.a,f.a.id);
 await writeFile(f.d.path,'Changed raw file');await assert.rejects(f.controller.resume(f.actor,f.a,f.first.id),/فایل اصلی تغییر/);await writeFile(f.d.path,'Synthetic source');
 const d=f.store.get(f.d.id,'document');f.store.put('document',{...d,archiveReason:'manual'},f.a.id);await assert.rejects(f.controller.resume(f.actor,f.a,f.first.id),/همان مستندات/);f.store.put('document',d,f.a.id);
 assert.equal(JSON.stringify(f.store.get(f.d.id,'document')),before);assert.equal(JSON.stringify(f.store.get(f.first.id,'review')),old);assert.equal(f.calls.length,3);
});

test('missing or invalid previous parts block resume and invalidation after queue never re-analyzes a saved part',async t=>{
 const f=await fixture(t),part=f.store.list('review-file-part',f.first.id).find(p=>p.index===1),before=JSON.stringify(f.store.get(f.d.id,'document'));
 f.store.remove(part.id,'review-file-part',f.first.id);await assert.rejects(f.controller.resume(f.actor,f.a,f.first.id),/موجود نیست/);f.store.put('review-file-part',part,f.first.id);
 const invalid={...part,result:{...part.result,criteria:part.result.criteria.map(c=>({...c,citations:[{chunkId:'PART_1',quote:'FABRICATED'}]}))}};f.store.put('review-file-part',invalid,f.first.id);await assert.rejects(f.controller.resume(f.actor,f.a,f.first.id),/ارجاع/);f.store.put('review-file-part',part,f.first.id);assert.equal(JSON.stringify(f.store.get(f.d.id,'document')),before);
 const queued=await f.controller.resume(f.actor,f.a,f.first.id);f.store.put('review-file-part',invalid,f.first.id);await assert.rejects(f.controller.execute(queued),/برای جلوگیری از تحلیل دوباره/);assert.equal(f.calls.length,3);assert.equal(f.store.get(queued.id,'review').result,undefined);
});

test('the owner resume endpoint returns a queued job without waiting for a long model call',async t=>{
 const f=await fixture(t),server=createPanelServer({dataRoot:f.root,uploadRoot:f.root,autoAssessment:false,runModel:async()=>{throw Error('Queued resume must not call the model in this request');}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 f.beforeCleanup(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 let session=await(await fetch(base+'/api/session')).json();session=await(await fetch(base+'/api/session',{method:'POST',headers:{'x-panel-token':session.token},body:JSON.stringify({userId:f.actor.id})})).json();
 const response=await fetch(base+'/api/activities/'+f.a.id+'/reviews',{method:'POST',headers:{'x-panel-token':session.token},body:JSON.stringify({resumeReviewId:f.first.id})}),queued=await response.json();assert.equal(response.status,200,JSON.stringify(queued));assert.equal(queued.status,'queued');assert.equal(queued.resumeReadParts,2);assert.equal(f.calls.length,3);assert.equal(f.store.get(f.first.id,'review').status,'failed');
});

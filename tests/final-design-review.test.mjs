import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createPanelServer} from '../server.mjs';
import {roleReply} from './ai-role-fixture.mjs';

async function fixture(t,rounds=4){
 const root=await mkdtemp(join(tmpdir(),'kpi-final-review-')),store=openStore(root),workflow=createWorkflow(store),cleanup=[];let calls=0;
 const model=async request=>{calls++;return roleReply(request,{mutate(result,envelope){if(envelope.stage!=='kpi-alignment-v4')return;const review=result.reviews[0];review.recommendation='needs_information';review.checks.find(c=>c.type==='target').status='unknown';review.missingInformation=['موعد خروجی ساختگی را روشن کنید.'];}});};
 const org=createOrganizationWorkflow(store,workflow,{runModel:model}),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo'),input={employeeId:'employee-mohammad',period:workflow.currentPeriod,tasks:[{category:'routine',title:'شاخص ساختگی پایان چرخه',description:'شرح ساختگی',criteria:['خروجی ساختگی'],frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'12:00'},weightPoints:3}]};
 let source=await org.analyzeDesign(manager,org.submitDesign(manager,input).id);for(let i=0;i<rounds;i++){org.managerReviewDesign(manager,source.id,{decision:'return',reason:'تکمیل اطلاعات ساختگی'});source=await org.analyzeDesign(manager,org.reviseDesign(manager,source.id,input).id);}
 t.after(async()=>{for(const close of cleanup)await close();store.close();await rm(root,{recursive:true,force:true});});
 return {root,store,workflow,org,manager,hr,input,source,model,cleanup,get calls(){return calls;}};
}
const frozen=f=>JSON.stringify(['kpi-design','audit-event','ai-role-run','ai-design-attempt','activity'].map(kind=>[kind,f.store.list(kind)]));
const blocked=error=>error.status===409&&/پنج بررسی/.test(error.message);
const reason='یافته‌های باقی‌مانده با شواهد کاری بررسی شد؛ تصمیم نهایی مستقل و مستند است.';

test('fifth-review lock blocks every correction entry point and new same-month plans without writes or model calls',async t=>{
 const f=await fixture(t),view=f.org.listDesigns(f.manager).find(d=>d.id===f.source.id),answers=view.tasks[0].clarifications.map(q=>({id:q.id,answer:'پاسخ ساختگی'})),before=frozen(f),count=f.calls;
 assert.equal(view.finalReviewOnly,true);assert.equal(view.finalReviewSourceId,f.source.id);assert.equal(view.canReanalyze,false);
 for(const action of [()=>f.org.openDesignCorrectionDraft(f.manager,f.source.id,{runId:f.source.aiReview.runId,proposalId:'T1',draftId:null}),()=>f.org.managerReviewDesign(f.manager,f.source.id,{decision:'return',reason}),()=>f.org.managerReviewDesign(f.manager,f.source.id,{decision:'reject',reason}),()=>f.org.saveDesignDraft(f.manager,f.input),()=>f.org.submitDesign(f.manager,{...f.input,finalReviewOnly:false}),()=>f.org.saveDesignDraft(f.manager,{...f.input,revises:f.source.id}),()=>f.org.reviseDesign(f.manager,f.source.id,f.input),()=>f.org.saveDesignClarifications(f.manager,f.source.id,{runId:f.source.aiReview.runId,proposalId:'T1',draftId:null,answers})])assert.throws(action,blocked);
 await assert.rejects(f.org.analyzeDesign(f.manager,f.source.id),blocked);assert.throws(()=>f.org.acceptDesignChange(f.manager,f.source.id,{all:true,reason}),e=>e.status===409);
 assert.equal(f.calls,count);assert.equal(frozen(f),before);
});

test('pre-existing drafts are preserved but cannot be edited published or consolidated past the terminal review',async t=>{
 const f=await fixture(t),drafts=[1,2].map(i=>f.store.put('kpi-design',{...f.source,id:'legacy-draft-'+i,aiReview:undefined,status:'draft',version:5+i,draftRevision:1,revises:f.source.id},f.source.employeeId)),before=frozen(f),count=f.calls;
 for(const draft of drafts){assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===draft.id).finalReviewOnly,true);assert.throws(()=>f.org.saveDesignDraft(f.manager,{tasks:draft.tasks,draftRevision:1},draft.id),blocked);await assert.rejects(f.org.publishDesignDraft(f.manager,draft.id,'codex',1),blocked);}
 assert.equal(f.org.consolidateDesignDrafts(f.manager).merged,0);assert.equal(f.calls,count);assert.equal(frozen(f),before);
});

test('archiving terminal and earlier versions stays available in every final-review stage without changing reports or approving anything',async t=>{
 for(const status of ['manager_review','hr_review','needs_revision']){
  const f=await fixture(t),id=f.source.id,count=f.calls;if(status!=='manager_review')f.org.managerReviewDesign(f.manager,id,{decision:'approve',reason,humanReviewAcknowledgment:true});if(status==='needs_revision')f.org.hrReviewDesign(f.hr,id,{decision:'return',reason});
  const before=structuredClone(f.store.get(id,'kpi-design')),runs=JSON.stringify(f.store.list('ai-role-run')),activities=JSON.stringify(f.store.list('activity'));
  for(const actor of [f.hr,f.workflow.user('employee-mohammad'),f.workflow.user('manager-finance')])assert.throws(()=>f.org.removeDesign(actor,id));
  const old=f.store.list('kpi-design').find(d=>d.id!==id&&d.status==='needs_revision');assert.ok(f.org.removeDesign(f.manager,old.id).removedAt);assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===id).finalReviewOnly,true);assert.throws(()=>f.org.saveDesignDraft(f.manager,f.input),blocked);
  const draft=f.store.put('kpi-design',{...f.source,id:'locked-draft-'+status,aiReview:undefined,status:'draft',version:99,draftRevision:1},f.source.employeeId);assert.ok(f.org.removeDesign(f.manager,draft.id).removedAt);
  const removed=f.org.removeDesign(f.manager,id);assert.ok(removed.removedAt);assert.equal(removed.removedBy,f.manager.id);assert.equal(removed.status,status);assert.deepEqual(removed.aiReview,before.aiReview);assert.deepEqual(removed.tasks,before.tasks);assert.deepEqual(removed.managerReview,before.managerReview);assert.deepEqual(removed.hrReview,before.hrReview);assert.equal(removed.events.at(-1).state,'removed');assert.ok(f.store.list('audit-event').some(e=>e.action==='kpi-design.removed'&&e.entityId===id));
  assert.equal(f.org.listDesigns(f.manager).some(d=>d.id===id),false);assert.equal(f.org.removeDesign(f.manager,id).removedAt,removed.removedAt);assert.equal(JSON.stringify(f.store.list('ai-role-run')),runs);assert.equal(JSON.stringify(f.store.list('activity')),activities);assert.equal(f.calls,count);await assert.rejects(f.org.analyzeDesign(f.manager,id),e=>e.status===404);
 }
});

test('only documented manager forwarding remains, including admin return without opening another draft cycle',async t=>{
 const f=await fixture(t),id=f.source.id,count=f.calls;assert.throws(()=>f.org.managerReviewDesign(f.manager,id,{decision:'approve'}),e=>e.status===409);
 f.org.managerReviewDesign(f.manager,id,{decision:'approve',reason,humanReviewAcknowledgment:true});assert.equal(f.store.get(id,'kpi-design').status,'hr_review');assert.equal(f.store.list('activity').filter(a=>a.designId===id).length,0);
 f.org.hrReviewDesign(f.hr,id,{decision:'return',reason:'دلیل مستند مدیر باید دقیق‌تر بررسی شود.'});assert.equal(f.store.get(id,'kpi-design').status,'needs_revision');assert.throws(()=>f.org.saveDesignDraft(f.manager,{...f.input,revises:id}),blocked);assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===id).finalReviewOnly,true);
 f.org.managerReviewDesign(f.manager,id,{decision:'approve',reason,humanReviewAcknowledgment:true});assert.throws(()=>f.org.hrReviewDesign(f.hr,id,{decision:'approve'}),e=>e.status===409);f.org.hrReviewDesign(f.hr,id,{decision:'approve',reason,humanReviewAcknowledgment:true});
 assert.equal(f.store.get(id,'kpi-design').status,'published');assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===id).finalReviewOnly,false);assert.equal(f.store.list('activity').filter(a=>a.designId===id).length,1);assert.equal(f.calls,count);
});

test('earlier rounds stay editable and other people/months are not frozen',async t=>{
 const early=await fixture(t,3);assert.equal(early.org.listDesigns(early.manager).find(d=>d.id===early.source.id).finalReviewOnly,false);early.org.managerReviewDesign(early.manager,early.source.id,{decision:'return',reason});assert.equal(early.org.saveDesignDraft(early.manager,{...early.input,revises:early.source.id}).status,'draft');
 const f=await fixture(t),[y,m]=f.input.period.split('-').map(Number),next=m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0');assert.equal(f.org.saveDesignDraft(f.manager,{...f.input,period:next}).status,'draft');
});

test('terminal review never bypasses current evidence role or acknowledgment gates',async t=>{
 const f=await fixture(t),id=f.source.id;for(const actor of [f.hr,f.workflow.user('employee-mohammad'),f.workflow.user('manager-finance')])assert.throws(()=>f.org.managerReviewDesign(actor,id,{decision:'approve',reason,humanReviewAcknowledgment:true}));
 const p=f.org.activePosition(f.source.employeeId);f.store.put('position-assignment',{...p,duties:p.duties+'\nتغییر ساختگی سمت'},p.employeeId);const before=frozen(f),count=f.calls;assert.throws(()=>f.org.managerReviewDesign(f.manager,id,{decision:'approve',reason,humanReviewAcknowledgment:true}),e=>e.status===409);assert.equal(frozen(f),before);assert.equal(f.calls,count);
});

test('HTTP requests cannot bypass the fifth-review lock with a forged flag or fresh draft',async t=>{
 const f=await fixture(t),server=createPanelServer({dataRoot:f.root,autoAssessment:false,runModel:f.model});server.listen(0,'127.0.0.1');await once(server,'listening');f.cleanup.push(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});const base='http://127.0.0.1:'+server.address().port;
 const initial=await(await fetch(base+'/api/session')).json(),login=await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json','x-panel-token':initial.token},body:JSON.stringify({userId:'manager-ops'})});assert.equal(login.status,200);const session=await login.json(),before=frozen(f),count=f.calls;
 for(const [path,body] of [['/api/org/designs',f.input],['/api/org/designs/drafts',{...f.input,finalReviewOnly:false}],['/api/org/designs/'+f.source.id+'/review',{decision:'return',reason}],['/api/org/designs/'+f.source.id+'/revision',f.input]]){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-panel-token':session.token},body:JSON.stringify(body)});assert.equal(r.status,409,path);}
 assert.equal(f.calls,count);assert.equal(frozen(f),before);
});

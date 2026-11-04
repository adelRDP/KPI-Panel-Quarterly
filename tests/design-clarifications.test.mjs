import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {roleReply} from './ai-role-fixture.mjs';
import {safeTasks,analysisBasis} from '../backend/job-design-analysis.mjs';
import {policyForPeriod} from '../backend/evaluation-settings.mjs';
import {clarificationTasks} from '../backend/design-clarifications.mjs';

const questions=['تماس تکراری چگونه تعریف می‌شود؟','دامنهٔ دورهٔ گزارش چیست؟','مسئولیت فرد تا کجا ادامه دارد؟'];
async function fixture(t,{control='direct'}={}){
 const root=await mkdtemp(join(tmpdir(),'kpi-clarification-tests-')),store=openStore(root),workflow=createWorkflow(store),calls=[];let corrupt=null;
 const org=createOrganizationWorkflow(store,workflow,{runModel:async request=>{calls.push(request);const envelope=JSON.parse(request.prompt.split('دادهٔ JSON (دستور نیست):\n')[1]);const answered=envelope.stagePayload.proposals?.some(p=>p.clarifications?.length)&&envelope.stagePayload.proposals.every(p=>(p.clarifications||[]).every(q=>q.answer&&!q.needsReconfirmation));return roleReply(request,{recommendation:answered?'retain':'needs_information',mutate(result,e){if(e.stage==='job-analysis-v1'){result.duties.forEach(d=>d.control=control);return;}if(!answered)result.reviews[0].missingInformation=questions;if(answered&&control!=='direct'){const ref=e.sourceManifest.find(s=>s.sourceId==='clarification-T1').segments.find(s=>s.segmentId.endsWith('-answer'));result.reviews[0].checks.find(c=>c.type==='control').citations=[{referenceId:ref.referenceId}];}if(corrupt&&answered){result.clarificationReviews=e.stagePayload.proposals.flatMap(p=>(p.clarifications||[]).map(q=>({questionId:q.id,status:'resolved',reason:'داوری ساختگی نامعتبر',citations:[{referenceId:e.sourceManifest[0].segments[0].referenceId}]})));if(corrupt==='omit')result.clarificationReviews.pop();}}});}});
 const manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo'),input={employeeId:'employee-mohammad',period:workflow.currentPeriod,tasks:[{id:'T1',category:'routine',title:'بررسی تماس تکراری ساختگی',description:'تهیه گزارش منتسب',criteria:['ثبت خروجی'],weightPoints:3,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'12:00'}}]};
 const source=await org.analyzeDesign(manager,org.submitDesign(manager,input).id);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const view=()=>org.listDesigns(manager).find(d=>d.id===source.id),payload=(answers)=>({runId:source.aiReview.runId,proposalId:'T1',draftId:view().clarificationDraft?.id||null,draftRevision:view().clarificationDraft?.draftRevision,answers:answers||view().tasks[0].clarifications.map((q,i)=>({id:q.id,answer:'پاسخ کاری ساختگی '+(i+1)+': تعریف و دامنه و مسئولیت روشن است.'}))});
 return {store,workflow,org,manager,hr,input,source,calls,view,payload,setCorrupt:value=>corrupt=value};
}

test('saving answers creates an audited revision draft without running a model or altering the original report, tasks or weights',async t=>{
 const f=await fixture(t),before=structuredClone(f.store.get(f.source.id,'kpi-design')),count=f.calls.length;assert.equal(f.view().tasks[0].clarifications.length,3);const draft=f.org.saveDesignClarifications(f.manager,f.source.id,f.payload());
 assert.equal(f.calls.length,count);assert.equal(draft.status,'draft');assert.equal(draft.revises,f.source.id);assert.equal(draft.tasks[0].clarifications.length,3);assert.equal(draft.tasks[0].weight,before.tasks[0].weight);assert.equal(draft.tasks[0].description,before.tasks[0].description);assert.equal(draft.aiReview,undefined);
 const after=f.store.get(f.source.id,'kpi-design');assert.deepEqual(after.aiReview,before.aiReview);assert.deepEqual(after.tasks,before.tasks);assert.equal(after.status,'needs_revision');assert.equal(after.revisedBy,draft.id);assert.ok(f.store.list('audit-event').some(r=>JSON.stringify(r).includes('kpi-design.clarifications-saved')));assert.ok(f.view().tasks[0].clarifications.every(q=>q.answer));
 const repeated=f.org.saveDesignClarifications(f.manager,f.source.id,f.payload());assert.equal(repeated.id,draft.id);assert.equal(repeated.draftRevision,draft.draftRevision+1);assert.equal(f.store.list('kpi-design').filter(d=>d.status==='draft').length,1);
});

test('opening manual correction creates or reuses one draft with every task and grounded question without model calls',async t=>{
 const f=await fixture(t),before=structuredClone(f.store.get(f.source.id,'kpi-design')),count=f.calls.length,input={runId:f.source.aiReview.runId,proposalId:'T1',draftId:null};
 const draft=f.org.openDesignCorrectionDraft(f.manager,f.source.id,input);assert.equal(draft.status,'draft');assert.equal(draft.revises,f.source.id);assert.equal(draft.tasks.length,before.tasks.length);assert.equal(draft.tasks[0].clarifications.length,3);assert.deepEqual(draft.tasks[0].criteria,before.tasks[0].criteria);assert.equal(f.calls.length,count);assert.deepEqual(f.store.get(f.source.id,'kpi-design').aiReview,before.aiReview);assert.equal(draft.aiReview,undefined);
 const updated=f.org.saveDesignDraft(f.manager,{tasks:draft.tasks.map(t=>({...t,description:t.description+' متن اصلاحی',clarifications:t.clarifications.map(q=>({id:q.id,answer:'اطلاعات جدید ساختگی'}))})),draftRevision:draft.draftRevision},draft.id),state=JSON.stringify(f.store.list('kpi-design'));
 const reused=f.org.openDesignCorrectionDraft(f.manager,f.source.id,{...input,draftId:updated.id,draftRevision:updated.draftRevision});assert.equal(reused.id,draft.id);assert.equal(reused.tasks[0].description,updated.tasks[0].description);assert.equal(JSON.stringify(f.store.list('kpi-design')),state);assert.equal(f.calls.length,count);assert.equal(f.store.list('kpi-design').filter(d=>d.status==='draft').length,1);
 for(const bad of [{...input,runId:'stale'},{...input,proposalId:'bad'},{...input,draftId:updated.id,draftRevision:1},{...input,tasks:[]}])assert.throws(()=>f.org.openDesignCorrectionDraft(f.manager,f.source.id,bad));for(const actor of [f.hr,f.workflow.user('employee-mohammad'),f.workflow.user('manager-finance')])assert.throws(()=>f.org.openDesignCorrectionDraft(actor,f.source.id,input));assert.equal(JSON.stringify(f.store.list('kpi-design')),state);
});

test('a missing question gets a bounded versioned response field from actual failed checks, not from arbitrary client text',async t=>{
 const f=await fixture(t),d=structuredClone(f.source);d.aiReview.result.reviews[0].missingInformation=[];const before=JSON.stringify(d),tasks=clarificationTasks(d,'context'),q=tasks[0].clarifications[0];assert.equal(q.origin,'analysis-findings');assert.match(q.question,/ایرادهای ثبت‌شده/);assert.equal(q.sourceRunId,d.aiReview.runId);assert.deepEqual(clarificationTasks(d,'context'),tasks);assert.equal(JSON.stringify(d),before);
 const changed=structuredClone(d);changed.aiReview.runId='new-run';assert.notEqual(clarificationTasks(changed,'context')[0].clarifications[0].id,q.id);const resolved=structuredClone(d);resolved.aiReview.result.reviews[0].checks.forEach(c=>{c.status='pass';c.severity='none';});assert.equal(clarificationTasks(resolved,'context')[0].clarifications,undefined);
 f.store.put('kpi-design',d,d.employeeId);const view=f.view(),question=view.tasks[0].clarifications[0];const draft=f.org.saveDesignClarifications(f.manager,d.id,{runId:d.aiReview.runId,proposalId:'T1',draftId:null,answers:[{id:question.id,answer:'پاسخ کاری متصل به ایراد واقعی'}]});assert.equal(draft.tasks[0].clarifications[0].answer,'پاسخ کاری متصل به ایراد واقعی');assert.equal(draft.tasks[0].clarifications[0].origin,'analysis-findings');
});

test('current answers reach v4 as separate grounded evidence and per-question outcomes without automatic publication',async t=>{
 const f=await fixture(t),draft=f.org.saveDesignClarifications(f.manager,f.source.id,f.payload()),reviewed=await f.org.publishDesignDraft(f.manager,draft.id,'codex',draft.draftRevision);
 assert.equal(reviewed.aiReview.contractVersion,'kpi-alignment-v4');assert.equal(reviewed.status,'manager_review');assert.equal(reviewed.aiReview.result.blockers.length,0);assert.equal(reviewed.aiReview.result.clarificationReviews.length,3);assert.ok(reviewed.aiReview.result.clarificationReviews.every(r=>r.status==='resolved'));
 const run=f.store.get(reviewed.aiReview.runId,'ai-role-run');assert.equal(run.inputs.stagePayload.clarificationContractVersion,'manager-clarifications-v1');assert.ok(run.inputs.sourceManifest.some(s=>s.sourceId==='clarification-T1'&&s.segments.some(s=>s.segmentId.endsWith('-answer'))));assert.ok(!JSON.stringify(run.inputs).includes(f.manager.name));assert.ok(!JSON.stringify(run.inputs).includes('answeredBy'));assert.ok(!JSON.stringify(safeTasks(draft.tasks)).includes('answeredAt'));assert.equal(f.store.list('activity').filter(a=>a.designId===draft.id).length,0);
 f.org.managerReviewDesign(f.manager,draft.id,{decision:'approve'});f.org.hrReviewDesign(f.hr,draft.id,{decision:'approve'});assert.equal(f.store.get(draft.id,'kpi-design').status,'published');assert.equal(f.store.list('activity').filter(a=>a.designId===draft.id).length,1);assert.match(f.org.listDesigns(f.manager).find(d=>d.id===draft.id).copyNextMonth.reason,/پاسخ‌های ابهام/);
});

test('answers are inherited by correction drafts and task changes require explicit reconfirmation before model calls',async t=>{
 const f=await fixture(t),draft=f.org.saveDesignClarifications(f.manager,f.source.id,f.payload()),reviewed=await f.org.publishDesignDraft(f.manager,draft.id,'codex',draft.draftRevision);f.org.managerReviewDesign(f.manager,reviewed.id,{decision:'return',reason:'اصلاح شرح شاخص برای آزمون'});
 const tasks=reviewed.tasks.map(({clarifications,...task})=>({...task,description:task.description+'؛ دامنهٔ تازه'})),next=f.org.saveDesignDraft(f.manager,{...f.input,tasks,revises:reviewed.id});assert.ok(next.tasks[0].clarifications.every(q=>q.answer&&q.needsReconfirmation));const count=f.calls.length;await assert.rejects(f.org.publishDesignDraft(f.manager,next.id,'codex',next.draftRevision),/بازبینی/);assert.equal(f.calls.length,count);
 const confirmed=f.org.saveDesignDraft(f.manager,{tasks:next.tasks.map(task=>({...task,clarifications:task.clarifications.map(q=>({id:q.id,answer:q.answer,reconfirmed:true}))})),draftRevision:next.draftRevision},next.id);assert.ok(confirmed.tasks[0].clarifications.every(q=>!q.needsReconfirmation));const final=await f.org.publishDesignDraft(f.manager,confirmed.id,'codex',confirmed.draftRevision);assert.equal(final.aiReview.result.clarificationReviews.length,3);
});

test('position context changes invalidate answers while answer edits change the analysis basis',async t=>{
 const f=await fixture(t),draft=f.org.saveDesignClarifications(f.manager,f.source.id,f.payload()),position=f.org.activePosition(draft.employeeId),policy=policyForPeriod(f.store,draft.period,null,position.unitId),basis=analysisBasis(position,draft,policy),changed=structuredClone(draft);changed.tasks[0].clarifications[0].answer+=' تغییر';assert.notEqual(analysisBasis(position,changed,policy),basis);
 f.store.put('position-assignment',{...position,duties:position.duties+'\nاطلاعات نقش تازه'},position.employeeId);const view=f.org.listDesigns(f.manager).find(d=>d.id===draft.id);assert.ok(view.tasks[0].clarifications.every(q=>q.needsReconfirmation));const count=f.calls.length;await assert.rejects(f.org.publishDesignDraft(f.manager,draft.id,'codex',draft.draftRevision),/بازبینی/);assert.equal(f.calls.length,count);
});

test('forged questions, duplicate IDs, oversized answers, stale revisions and unauthorized roles cannot save answers',async t=>{
 const f=await fixture(t),payload=f.payload();for(const bad of [{...payload,runId:'other'},{...payload,answers:[{id:'fake',answer:'ساختگی'}]},{...payload,answers:[payload.answers[0],payload.answers[0]]},{...payload,answers:[{id:payload.answers[0].id,answer:'x'.repeat(2001)}]}])assert.throws(()=>f.org.saveDesignClarifications(f.manager,f.source.id,bad));assert.equal(f.store.list('kpi-design').length,1);
 for(const actor of [f.hr,f.workflow.user('employee-mohammad'),f.workflow.user('manager-finance')])assert.throws(()=>f.org.saveDesignClarifications(actor,f.source.id,payload));const draft=f.org.saveDesignClarifications(f.manager,f.source.id,payload);assert.throws(()=>f.org.saveDesignClarifications(f.manager,f.source.id,payload),/تغییر کرده/);assert.throws(()=>f.org.saveDesignDraft(f.manager,{tasks:draft.tasks,draftRevision:0},draft.id),/تغییر کرده/);
 const arbitrary={...f.input,tasks:draft.tasks};assert.throws(()=>f.org.submitDesign(f.manager,arbitrary),/سؤال واقعی/);
});

for(const corruption of ['citation','omit'])test('invalid clarification '+corruption+' fails closed, retains original evidence and creates no assignments',async t=>{
 const f=await fixture(t),draft=f.org.saveDesignClarifications(f.manager,f.source.id,f.payload());f.setCorrupt(corruption);await assert.rejects(f.org.publishDesignDraft(f.manager,draft.id,'codex',draft.draftRevision));assert.equal(f.store.get(draft.id,'kpi-design').status,'ai_failed');assert.equal(f.store.list('activity').filter(a=>a.designId===draft.id).length,0);assert.equal(f.store.get(f.source.id,'kpi-design').aiReview.runId,f.source.aiReview.runId);
});

test('grounded manager answers can clarify unknown control without rewriting duties, but cannot override explicit external control',async t=>{
 const f=await fixture(t,{control:'unknown'}),draft=f.org.saveDesignClarifications(f.manager,f.source.id,f.payload()),before=f.org.activePosition(draft.employeeId).duties,reviewed=await f.org.publishDesignDraft(f.manager,draft.id,'codex',draft.draftRevision);assert.equal(reviewed.aiReview.result.reviews[0].recommendation,'retain');assert.equal(f.org.activePosition(draft.employeeId).duties,before);
 const g=await fixture(t,{control:'external'}),external=g.org.saveDesignClarifications(g.manager,g.source.id,g.payload());await assert.rejects(g.org.publishDesignDraft(g.manager,external.id,'codex',external.draftRevision),/خارج از کنترل/);assert.equal(g.store.list('activity').filter(a=>a.designId===external.id).length,0);
});

test('failed answer analysis preserves answers and permits a new editable draft without overwriting the failed version',async t=>{
 const f=await fixture(t),draft=f.org.saveDesignClarifications(f.manager,f.source.id,f.payload());f.setCorrupt('citation');await assert.rejects(f.org.publishDesignDraft(f.manager,draft.id,'codex',draft.draftRevision));const failed=f.store.get(draft.id,'kpi-design'),before=JSON.stringify(failed.tasks);
 const next=f.org.saveDesignDraft(f.manager,{...f.input,tasks:failed.tasks,revises:failed.id});assert.equal(next.status,'draft');assert.equal(next.revises,failed.id);assert.deepEqual(next.tasks[0].clarifications.map(q=>q.answer),failed.tasks[0].clarifications.map(q=>q.answer));assert.equal(JSON.stringify(f.store.get(failed.id,'kpi-design').tasks),before);f.setCorrupt(null);const good=await f.org.publishDesignDraft(f.manager,next.id,'codex',next.draftRevision);assert.equal(good.status,'manager_review');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createJobDesignAnalysis,resolveReferences,validateAlignment,safeTasks} from '../backend/job-design-analysis.mjs';
import {effectiveChanges} from '../backend/analysis-consistency.mjs';
import {stabilityHash} from '../backend/alignment-stability.mjs';
import {roleReply} from './ai-role-fixture.mjs';

async function fixture(t,failed=false,mode='single'){
 const root=await mkdtemp(join(tmpdir(),'kpi-noop-')),store=openStore(root),workflow=createWorkflow(store);let calls=0;
 const runModel=async request=>{calls++;return roleReply(request,{mutate(r,e){if(e.stage==='kpi-alignment-v4'){const v=r.reviews[0];v.recommendation='revise';v.checks.find(c=>c.type==='definition').status='fail';v.changes=[{field:'criteria',proposedValue:e.stagePayload.proposals[0].criteria,reason:'پیشنهاد آزمایشی تکراری',supportingReferences:v.citations}];}if(e.stage==='kpi-alignment-v4'&&mode==='mixed'){const v=r.reviews[1];v.recommendation='revise';v.checks.find(c=>c.type==='definition').status='fail';v.changes=[{field:'title',proposedValue:'عنوان تازه',reason:'اصلاح واقعی ساختگی',supportingReferences:v.citations}];}if(e.stage==='kpi-alignment-v4'&&mode==='conflict')r.planConflicts=[{proposalIds:['T1','T2'],severity:'blocking',reason:'تعارض ساختگی مستقل',citations:r.reviews[0].citations}];if(failed&&e.stage==='kpi-correction-validation-v1'){r.reviews[0].recommendation='needs_information';r.reviews[0].checks.find(c=>c.type==='target').status='unknown';r.reviews[0].missingInformation=['واقعیت نامعلوم ساختگی'];}}});};
 const org=createOrganizationWorkflow(store,workflow,{runModel}),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo'),input={employeeId:'employee-mohammad',period:workflow.currentPeriod,tasks:[{category:'routine',title:'گزارش ساختگی',description:'ثبت خروجی',criteria:['۱. ثبت محاسبات','۲. موارد باز'],weightPoints:3,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'09:30'}}]};
 if(mode!=='single')input.tasks.push({...input.tasks[0],title:'گزارش دوم'});
 const d=await org.analyzeDesign(manager,org.submitDesign(manager,input).id);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});return {store,workflow,org,manager,hr,input,d,get calls(){return calls;}};
}
function legacy(f,d){
 const run=f.store.get(d.aiReview.runId,'ai-role-run'),tasks=run.inputs.stagePayload.proposals,raw=validateAlignment(resolveReferences(run.rawResult,run.inputs.sourceManifest),d.aiReview.jobAnalysis.result,tasks,run.inputs.sourceManifest),q=f.store.get(d.aiReview.result.qualityRunId,'ai-role-run');
 raw.reviews[0].correctionValidation={status:'verified',runId:q.id,testedTaskHash:stabilityHash(tasks[0]),testedPlanHash:stabilityHash(tasks)};
 return {...d,aiReview:{...d.aiReview,result:{...d.aiReview.result,...raw,correctionRound:3,humanReviewRequired:false}}};
}

test('a verified unchanged correction resolves the contradiction in place without a new version or automatic approval',async t=>{
 const f=await fixture(t),r=f.d.aiReview.result;assert.equal(r.reviews[0].recommendation,'retain');assert.equal(r.reviews[0].changes.length,0);assert.equal(r.blockers.length,0);assert.ok(r.consistencyResolution);assert.equal(r.humanReviewRequired,false);assert.equal(f.store.list('kpi-design').length,1);assert.equal(f.store.list('activity').filter(a=>a.designId===f.d.id).length,0);
 assert.throws(()=>f.org.acceptDesignChange(f.manager,f.d.id,{all:true,reason:'بی‌تغییر'}));assert.equal(f.store.list('kpi-design').length,1);assert.equal(f.calls,3);
 const run=f.store.get(f.d.aiReview.runId,'ai-role-run');assert.equal(run.rawResult.reviews[0].recommendation,'revise');f.org.managerReviewDesign(f.manager,f.d.id,{decision:'approve'});assert.equal(f.store.get(f.d.id,'kpi-design').status,'hr_review');assert.equal(f.store.list('activity').filter(a=>a.designId===f.d.id).length,0);f.org.hrReviewDesign(f.hr,f.d.id,{decision:'approve'});assert.equal(f.store.get(f.d.id,'kpi-design').status,'published');assert.equal(f.calls,3);
});
test('an identical suggestion alone never clears an unknown fact or creates a correction draft',async t=>{
 const f=await fixture(t,true),r=f.d.aiReview.result;assert.equal(r.blockers.length,1);assert.equal(r.correctionQualityFailed,true);assert.equal(r.reviews[0].consistencyIssue.kind,'no_effective_change');assert.equal(r.consistencyResolution,undefined);assert.throws(()=>f.org.managerReviewDesign(f.manager,f.d.id,{decision:'approve'}));assert.throws(()=>f.org.acceptDesignChange(f.manager,f.d.id,{all:true,reason:'بی‌تغییر'}));assert.equal(f.store.list('kpi-design').length,1);
});
test('legacy accepted no-op quality proof survives a fifth-analysis contradiction and later source archival without rewriting history',async t=>{
 const f=await fixture(t),old=legacy(f,f.d);f.store.put('kpi-design',old,old.employeeId);const q=f.store.get(old.aiReview.result.qualityRunId,'ai-role-run');
 f.org.managerReviewDesign(f.manager,old.id,{decision:'return',reason:'آزمایش نسخه تاریخی'});let next=f.org.reviseDesign(f.manager,old.id,f.input);next=f.store.put('kpi-design',{...next,acceptedSuggestions:[{analysisRunId:old.aiReview.runId,proposalId:'T1',field:'criteria',oldValue:old.tasks[0].criteria,proposedValue:old.tasks[0].criteria}]},next.employeeId);next=await f.org.analyzeDesign(f.manager,next.id);assert.equal(next.aiReview.result.reviews[0].recommendation,'retain');
 const run=f.store.get(next.aiReview.runId,'ai-role-run'),raw=validateAlignment(resolveReferences(run.rawResult,run.inputs.sourceManifest),next.aiReview.jobAnalysis.result,run.inputs.stagePayload.proposals,run.inputs.sourceManifest);f.store.put('kpi-design',{...next,aiReview:{...next.aiReview,result:{...next.aiReview.result,...raw,consistencyResolution:undefined,correctionRound:4,humanReviewRequired:true,humanReviewTrigger:'round_limit'}}},next.employeeId);
 const source=f.store.get(old.id,'kpi-design');f.store.put('kpi-design',{...source,removedAt:'2099-01-01T00:00:00Z'},source.employeeId);const before=JSON.stringify(f.store.list('kpi-design')),count=f.calls;
 const effective=f.org.listDesigns(f.manager).find(d=>d.id===next.id);assert.equal(effective.aiReview.result.blockers.length,0);assert.equal(effective.aiReview.result.humanReviewRequired,false);assert.equal(effective.finalReviewOnly,false);assert.equal(effective.aiReview.result.reviews[0].lock.sourceRunId,q.id);assert.equal(JSON.stringify(f.store.list('kpi-design')),before);assert.equal(f.calls,count);
 f.org.managerReviewDesign(f.manager,next.id,{decision:'approve'});assert.equal(f.store.get(next.id,'kpi-design').aiReview.result.humanReviewRequired,true,'original historical report remains intact');assert.equal(f.store.get(next.id,'kpi-design').status,'hr_review');
});
test('manual drafts do not regenerate questions or forget a valid no-op resolution from their source',async t=>{
 const f=await fixture(t),old=legacy(f,f.d);f.store.put('kpi-design',old,old.employeeId);const draft=f.org.openDesignCorrectionDraft(f.manager,old.id,{runId:old.aiReview.runId,proposalId:'T1',draftId:null});assert.equal(draft.tasks[0].clarifications,undefined);const next=await f.org.publishDesignDraft(f.manager,draft.id);assert.equal(next.aiReview.result.blockers.length,0);assert.equal(next.aiReview.result.reviews[0].recommendation,'retain');assert.ok(next.aiReview.result.reviews[0].lock);assert.equal(next.aiReview.result.correctionRound,0);
});
test('changed plan context or invalid quality evidence cannot inherit an accepted no-op decision',async t=>{
 const f=await fixture(t),old=legacy(f,f.d);f.store.put('kpi-design',old,old.employeeId);const analysis=createJobDesignAnalysis({list:()=>[],get:(...a)=>f.store.get(...a),put:()=>{throw Error('Read-only');}}),before=JSON.stringify(old);
 assert.equal(analysis.projectConsistency(old).aiReview.result.blockers.length,0);assert.equal(JSON.stringify(old),before);
 for(const tamper of [d=>{d.tasks[0].title+=' تغییر';},d=>{d.aiReview.result.reviews[0].correctionValidation.testedPlanHash='wrong';},d=>{d.aiReview.result.stabilityContextHash='wrong';}]){const changed=structuredClone(old);tamper(changed);assert.equal(analysis.projectConsistency(changed).aiReview.result.blockers.length,1);}
 const q=f.store.get(old.aiReview.result.qualityRunId,'ai-role-run');f.store.put('ai-role-run',{...q,validationStatus:'invalid'},q.positionId);assert.equal(analysis.projectConsistency(old).aiReview.result.blockers.length,1);
 assert.deepEqual(analysis.projectConsistency({...old,status:'published'}),{...old,status:'published'});assert.deepEqual(analysis.projectConsistency({...old,status:'rejected'}),{...old,status:'rejected'});
});
test('a mixed verified batch applies only its real edit and keeps unchanged task approval in the next analysis',async t=>{
 const f=await fixture(t,false,'mixed'),draft=f.org.acceptDesignChange(f.manager,f.d.id,{all:true,reason:'اعمال اصلاح واقعی بدون تکرار'});assert.equal(draft.acceptedSuggestions.length,1);assert.equal(draft.acceptedSuggestions[0].proposalId,'T2');assert.deepEqual(draft.tasks[0].criteria,f.d.tasks[0].criteria);assert.equal(draft.tasks[1].title,'عنوان تازه');const next=await f.org.publishDesignDraft(f.manager,draft.id);assert.equal(next.aiReview.result.blockers.length,0);assert.equal(next.aiReview.result.reviews.find(r=>r.proposalId==='T1').recommendation,'retain');
});
test('resolving an unchanged individual proposal never clears a separate cross-task conflict',async t=>{
 const f=await fixture(t,false,'conflict'),r=f.d.aiReview.result;assert.ok(r.consistencyResolution);assert.equal(r.reviews.find(x=>x.proposalId==='T1').recommendation,'retain');assert.equal(r.blockers.length,1);assert.equal(r.blockers[0].planConflict,true);assert.throws(()=>f.org.managerReviewDesign(f.manager,f.d.id,{decision:'approve'}));
});
test('no-op comparison preserves substantive edits and ignores null-only timing serialization',()=>{
 assert.equal(effectiveChanges({},{changes:[{field:'documentFormat',proposedValue:'xlsx'}]}).length,1);
 assert.equal(effectiveChanges({criteria:['الف']},{changes:[{field:'criteria',proposedValue:['الف']}]}).length,0);assert.equal(effectiveChanges({criteria:['الف']},{changes:[{field:'criteria',proposedValue:['ب']}]}).length,1);assert.equal(effectiveChanges({timeLimit:{dayOfMonth:15,time:'09:30'}},{changes:[{field:'timeLimit',proposedValue:{dayOfMonth:15,dayOfWeek:null,time:'09:30'}}]}).length,0);
});

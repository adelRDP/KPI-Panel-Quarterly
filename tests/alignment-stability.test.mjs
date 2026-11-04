import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {normalizedDate,normalizedCriteria,taskFacts,normalizeStaticJudgments} from '../backend/alignment-stability.mjs';
import {roleReply} from './ai-role-fixture.mjs';

const tasks=(count=2)=>Array.from({length:count},(_,i)=>({id:'T'+(i+1),category:'routine',title:'گزارش '+i,description:'تهیه خروجی و ارسال به مدیر',criteria:['خروجی ثبت شود'],weightPoints:3,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'09:30'}}));
async function setup(t,mutate){const root=await mkdtemp(join(tmpdir(),'kpi-stability-')),store=openStore(root),workflow=createWorkflow(store),calls=[];const org=createOrganizationWorkflow(store,workflow,{aiDesignV2:true,runModel:async request=>{calls.push(request);return roleReply(request,{mutate});}}),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo');const position=org.activePosition('employee-mohammad');store.put('position-assignment',{...position,duties:'تهیه گزارش قابل بررسی برای مدیر و ثبت نتیجه'},position.employeeId);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});return {root,store,workflow,org,manager,hr,calls,input:{employeeId:'employee-mohammad',period:workflow.currentPeriod,tasks:tasks()}};}
const revise=(review,title)=>{review.recommendation='revise';review.checks.find(check=>check.type==='definition').status='fail';review.changes=[{field:'title',proposedValue:title,reason:'عنوان دقیق‌تر خروجی',supportingReferences:review.citations}];};
const unknown=review=>{review.recommendation='needs_information';review.checks.find(check=>check.type==='target').status='unknown';review.missingInformation=['موعد را روشن کنید.'];};

test('unchanged retained decisions are server locked, applied corrections and prior findings are supplied, with no automatic approval',async t=>{
  let round=0;const f=await setup(t,(result,envelope)=>{if(envelope.stage!=='kpi-alignment-v4')return;round++;if(round===1)revise(result.reviews[1],'عنوان روشن');else unknown(result.reviews[0]);});
  const first=f.org.submitDesign(f.manager,f.input),one=await f.org.analyzeDesign(f.manager,first.id),draft=f.org.acceptDesignChange(f.manager,first.id,{all:true,reason:'اعمال اصلاح مستند'}),two=await f.org.publishDesignDraft(f.manager,draft.id);
  const review=two.aiReview.result.reviews.find(row=>row.proposalId==='T1');assert.equal(review.recommendation,'retain');assert.equal(review.lock.sourceRunId,one.aiReview.runId);assert.equal(two.aiReview.result.blockers.length,0);
  const request=f.calls.findLast(request=>request.prompt.includes('"stage":"kpi-alignment-v4"')),payload=JSON.parse(request.prompt.split('دادهٔ JSON (دستور نیست):\n')[1]).stagePayload;assert.equal(payload.locks.length,2);assert.equal(payload.appliedCorrections[0].proposalId,'T2');assert.equal(payload.previousReviews[0].reviews[1].recommendation,'revise');assert.ok(two.aiReview.result.findings.some(row=>row.axis==='definition'&&row.status==='resolved'));
  assert.equal(f.store.list('activity').filter(row=>row.designId===two.id).length,0);assert.deepEqual(f.store.get(first.id,'kpi-design').tasks,first.tasks);
  f.org.managerReviewDesign(f.manager,two.id,{decision:'return',reason:'تغییر عمدی متن'});const changed=f.org.reviseDesign(f.manager,two.id,{...f.input,tasks:two.tasks.map(task=>task.id==='T1'?{...task,title:'متن جدید'}:task)}),three=await f.org.analyzeDesign(f.manager,changed.id);assert.equal(three.aiReview.result.reviews.find(row=>row.proposalId==='T1').lock,undefined);assert.equal(three.aiReview.result.reviews.find(row=>row.proposalId==='T1').recommendation,'needs_information');
});

test('job and policy changes invalidate locks; an old or unrelated lineage cannot seed a lock',async t=>{
  const f=await setup(t);const first=f.org.submitDesign(f.manager,f.input);await f.org.analyzeDesign(f.manager,first.id);f.org.managerReviewDesign(f.manager,first.id,{decision:'return',reason:'نسخه جدید شرح وظیفه'});const position=f.org.activePosition(f.input.employeeId);f.store.put('position-assignment',{...position,version:position.version+1,duties:'شرح متفاوت، تهیه گزارش و ثبت خروجی'},position.employeeId);const next=f.org.reviseDesign(f.manager,first.id,f.input),result=await f.org.analyzeDesign(f.manager,next.id);assert.ok(result.aiReview.result.reviews.every(row=>!row.lock));
  f.org.managerReviewDesign(f.manager,next.id,{decision:'return',reason:'تغییر نسخه مدل'});const policy=f.store.get('active-policy','workflow-policy');f.store.put('workflow-policy',{...policy,version:'new-policy'});const third=f.org.reviseDesign(f.manager,next.id,f.input),updated=await f.org.analyzeDesign(f.manager,third.id);assert.ok(updated.aiReview.result.reviews.every(row=>!row.lock));
  const separate=f.org.submitDesign(f.manager,f.input),standalone=await f.org.analyzeDesign(f.manager,separate.id);assert.ok(standalone.aiReview.result.reviews.every(row=>!row.lock));
});

test('a new cross-task conflict blocks the plan without reversing a retained locked decision',async t=>{
  let round=0;const f=await setup(t,(result,envelope)=>{if(envelope.stage!=='kpi-alignment-v4')return;if(++round===1)revise(result.reviews[1],'خروجی روشن');else result.planConflicts=[{proposalIds:['T1','T2'],severity:'blocking',reason:'دوباره‌شماری خروجی جدید بین دو شاخص',citations:result.reviews[1].citations}];});
  const first=f.org.submitDesign(f.manager,f.input);await f.org.analyzeDesign(f.manager,first.id);const draft=f.org.acceptDesignChange(f.manager,first.id,{all:true,reason:'اصلاح تعریف'}),second=await f.org.publishDesignDraft(f.manager,draft.id);assert.equal(second.aiReview.result.reviews.find(row=>row.proposalId==='T1').recommendation,'retain');assert.ok(second.aiReview.result.reviews.find(row=>row.proposalId==='T1').lock);assert.equal(second.aiReview.result.blockers[0].planConflict,true);assert.throws(()=>f.org.managerReviewDesign(f.manager,second.id,{decision:'approve'}),error=>error.status===409);
});

test('failed correction quality blocks unverified patches and early overrides while manual revisions continue until the fifth analysis',async t=>{
  const f=await setup(t,(result,envelope)=>{if(envelope.stage==='kpi-alignment-v4')revise(result.reviews[0],'اصلاح ناقص');if(envelope.stage==='kpi-correction-validation-v1')unknown(result.reviews[0]);}),input={...f.input,tasks:tasks(1)};let current=await f.org.analyzeDesign(f.manager,f.org.submitDesign(f.manager,input).id);const reason='معیارهای خروجی و موعد با مستندات بررسی شد؛ تصمیم انسانی مستقل ثبت می‌شود.';const activitiesBefore=JSON.stringify(f.store.list('activity'));
  for(let round=0;round<4;round++){
    assert.equal(current.aiReview.result.correctionRound,round);assert.equal(current.aiReview.result.correctionQualityFailed,true);assert.equal(current.aiReview.result.humanReviewRequired,false);assert.equal(current.aiReview.result.humanReviewTrigger,null);assert.equal(current.aiReview.result.reviews[0].correctionValidation.status,'needs_human_review');assert.ok(current.aiReview.result.qualityRunId);
    assert.throws(()=>f.org.acceptDesignChange(f.manager,current.id,{all:true,reason}),error=>error.status===409&&/کیفیت/.test(error.message));assert.throws(()=>f.org.managerReviewDesign(f.manager,current.id,{decision:'approve',humanReviewAcknowledgment:true,reason}),error=>error.status===409);assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===current.id).finalReviewOnly,false);
    f.org.managerReviewDesign(f.manager,current.id,{decision:'return',reason});current=await f.org.analyzeDesign(f.manager,f.org.reviseDesign(f.manager,current.id,input).id);
  }
  assert.equal(current.aiReview.result.correctionRound,4);assert.equal(current.aiReview.result.humanReviewRequired,true);assert.equal(current.aiReview.result.humanReviewTrigger,'round_limit');assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===current.id).finalReviewOnly,true);assert.equal(JSON.stringify(f.store.list('activity')),activitiesBefore);
  f.org.managerReviewDesign(f.manager,current.id,{decision:'approve',humanReviewAcknowledgment:true,reason});assert.throws(()=>f.org.hrReviewDesign(f.hr,current.id,{decision:'approve'}),error=>error.status===409);const published=f.org.hrReviewDesign(f.hr,current.id,{decision:'approve',humanReviewAcknowledgment:true,reason});assert.equal(published.managerReview.humanReviewAcknowledgment,true);assert.equal(f.store.list('activity').filter(row=>row.designId===current.id).length,1);
});

test('human review activates on the fifth analysis after four correction rounds, never the third or fourth',async t=>{
  const f=await setup(t,(result,envelope)=>{if(envelope.stage==='kpi-alignment-v4')unknown(result.reviews[0]);});const first=f.org.submitDesign(f.manager,{...f.input,tasks:tasks(1)});let current=await f.org.analyzeDesign(f.manager,first.id);
  const reason='مدیر موارد باقی‌مانده را با شواهد بررسی و تصمیم مستقل ثبت کرد.';
  for(let i=0;i<4;i++){
    assert.equal(current.aiReview.result.correctionRound,i);assert.equal(current.aiReview.result.humanReviewRequired,false);
    assert.throws(()=>f.org.managerReviewDesign(f.manager,current.id,{decision:'approve',humanReviewAcknowledgment:true,reason}),error=>error.status===409);
    f.org.managerReviewDesign(f.manager,current.id,{decision:'return',reason:'تکمیل اطلاعات درخواست‌شده'});const next=f.org.reviseDesign(f.manager,current.id,{...f.input,tasks:tasks(1)});current=await f.org.analyzeDesign(f.manager,next.id);
  }
  assert.equal(current.aiReview.result.correctionRound,4);assert.equal(current.aiReview.result.humanReviewRequired,true);assert.equal(current.aiReview.result.humanReviewTrigger,'round_limit');assert.equal(current.aiReview.result.maxCorrectionRounds,4);
  assert.equal(f.calls.filter(request=>request.prompt.includes('"stage":"kpi-correction-validation-v1"')).length,0);assert.throws(()=>f.org.acceptDesignChange(f.manager,current.id,{all:true,reason:'دور ششم'}),error=>error.status===409);
  f.org.managerReviewDesign(f.manager,current.id,{decision:'approve',humanReviewAcknowledgment:true,reason});assert.throws(()=>f.org.hrReviewDesign(f.hr,current.id,{decision:'approve'}),error=>error.status===409);f.org.hrReviewDesign(f.hr,current.id,{decision:'approve',humanReviewAcknowledgment:true,reason});assert.equal(f.store.get(current.id,'kpi-design').status,'published');
});

test('legacy third-review escalation is projected under the new policy without rewriting its report or permitting an early override',async t=>{
  const {currentHumanReviewDesign,currentHumanReviewResult}=await import('../backend/human-review-policy.mjs');
  const f=await setup(t,(result,envelope)=>{if(envelope.stage==='kpi-alignment-v4')unknown(result.reviews[0]);});const first=f.org.submitDesign(f.manager,{...f.input,tasks:tasks(1)}),design=await f.org.analyzeDesign(f.manager,first.id);
  const legacy=structuredClone(design);legacy.aiReview.result.correctionRound=2;legacy.aiReview.result.humanReviewRequired=true;delete legacy.aiReview.result.humanReviewTrigger;delete legacy.aiReview.result.maxCorrectionRounds;f.store.put('kpi-design',legacy,legacy.employeeId);
  const before=JSON.stringify(f.store.get(legacy.id,'kpi-design').aiReview);
  assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===legacy.id).aiReview.result.humanReviewRequired,false);assert.equal(f.org.listDesigns(f.hr).find(d=>d.id===legacy.id).aiReview.result.humanReviewRequired,false);
  assert.throws(()=>f.org.managerReviewDesign(f.manager,legacy.id,{decision:'approve',humanReviewAcknowledgment:true,reason:'تأیید زودهنگام نباید حتی با دلیل معتبر مجاز باشد.'}),error=>error.status===409);assert.equal(JSON.stringify(f.store.get(legacy.id,'kpi-design').aiReview),before);
  assert.equal(currentHumanReviewDesign({...legacy,status:'published'}).aiReview.result.humanReviewRequired,true);
  assert.equal(currentHumanReviewResult({...legacy.aiReview.result,correctionRound:0}).humanReviewRequired,false);
  assert.equal(currentHumanReviewResult({...legacy.aiReview.result,correctionRound:0}).correctionQualityFailed,true);
  assert.equal(currentHumanReviewResult({...legacy.aiReview.result,correctionRound:3,humanReviewTrigger:'quality_failed'}).humanReviewRequired,false);
  assert.equal(currentHumanReviewResult({...legacy.aiReview.result,correctionRound:4,humanReviewTrigger:'quality_failed'}).humanReviewRequired,true);
});

test('stored early quality-failure reports use the fifth-analysis policy without rewriting evidence or allowing manager and admin overrides',async t=>{
 const {currentHumanReviewDesign,currentHumanReviewResult}=await import('../backend/human-review-policy.mjs'),f=await setup(t,(r,e)=>{if(e.stage==='kpi-alignment-v4')revise(r.reviews[0],'اصلاح پیشنهادی');if(e.stage==='kpi-correction-validation-v1')unknown(r.reviews[0]);});const d=await f.org.analyzeDesign(f.manager,f.org.submitDesign(f.manager,{...f.input,tasks:tasks(1)}).id),legacy=structuredClone(d);legacy.aiReview.result.humanReviewRequired=true;legacy.aiReview.result.humanReviewTrigger='quality_failed';delete legacy.aiReview.result.correctionQualityFailed;f.store.put('kpi-design',legacy,legacy.employeeId);const before=JSON.stringify(f.store.get(d.id,'kpi-design'));
 const effective=f.org.listDesigns(f.manager).find(row=>row.id===d.id);assert.equal(effective.aiReview.result.humanReviewRequired,false);assert.equal(effective.aiReview.result.correctionQualityFailed,true);assert.equal(effective.aiReview.result.reviews[0].correctionValidation.status,'needs_human_review');assert.equal(effective.finalReviewOnly,false);assert.throws(()=>f.org.managerReviewDesign(f.manager,d.id,{decision:'approve',reason:'دلیل طولانی نباید شرط پنج بررسی را دور بزند.',humanReviewAcknowledgment:true}),e=>e.status===409);assert.equal(JSON.stringify(f.store.get(d.id,'kpi-design')),before);
 const queued={...legacy,status:'hr_review',managerReview:{humanReviewAcknowledgment:true,reason:'تصمیم ثبت‌شده قبل از تغییر سیاست'}};f.store.put('kpi-design',queued,queued.employeeId);assert.throws(()=>f.org.hrReviewDesign(f.hr,d.id,{decision:'approve',reason:'تصمیم ادمین هم نباید ارسال زودهنگام را منتشر کند.',humanReviewAcknowledgment:true}),e=>e.status===409);assert.deepEqual(currentHumanReviewDesign({...legacy,status:'published'}),{...legacy,status:'published'});assert.deepEqual(currentHumanReviewDesign({...legacy,status:'rejected'}),{...legacy,status:'rejected'});
 assert.equal(currentHumanReviewResult({...legacy.aiReview.result,blockers:[],correctionRound:4}).humanReviewRequired,true);assert.equal(currentHumanReviewResult({...legacy.aiReview.result,blockers:[],correctionRound:0}).humanReviewRequired,false);
});
test('calendar equivalence and list shape are deterministic facts; cosmetic advice is not an approval blocker',async t=>{
  assert.equal(normalizedDate('۱۴۰۵/۰۷/۳۰'),'2026-10-22');assert.equal(normalizedDate('2026-10-22'),'2026-10-22');assert.equal(normalizedDate('۱۴۰۵/۱۲/۳۰'),null);assert.equal(normalizedDate('2026-02-30'),null);assert.deepEqual(normalizedCriteria(['"بند اول','بند دوم"']),['بند اول','بند دوم']);assert.equal(taskFacts({id:'T1',criteria:['بند'],deadline:'2026-10-22'}).criteriaAreSeparateStrings,true);
  const f=await setup(t,(result,envelope)=>{if(envelope.stage!=='kpi-alignment-v4')return;const review=result.reviews[0],check=review.checks.find(check=>check.type==='definition');review.recommendation='revise';check.status='fail';check.ruleId='format_style';check.severity='advisory';check.reason='ویرایش نگارشی اختیاری';review.changes=[{field:'title',proposedValue:'پیشنهاد نگارشی',reason:'سلیقه نگارش',supportingReferences:review.citations}];});const first=f.org.submitDesign(f.manager,{...f.input,tasks:tasks(1)}),result=await f.org.analyzeDesign(f.manager,first.id);assert.equal(result.aiReview.result.blockers.length,0);assert.equal(result.aiReview.result.reviews[0].recommendation,'retain');assert.equal(result.aiReview.result.findings[0].severity,'advisory');assert.equal(result.aiReview.result.reviews[0].changes.length,0);
});

test('a correction batch cannot be partially applied or altered after independent validation',async t=>{
  const f=await setup(t,(result,envelope)=>{if(envelope.stage==='kpi-alignment-v4')for(const row of result.reviews)revise(row,'اصلاح '+row.proposalId);});
  const source=f.org.submitDesign(f.manager,f.input);await f.org.analyzeDesign(f.manager,source.id);
  assert.throws(()=>f.org.acceptDesignChange(f.manager,source.id,{proposalId:'T1',reason:'اصلاح جزئی'}),error=>error.status===409);
  const saved=f.store.get(source.id,'kpi-design');saved.aiReview.result.reviews[1].changes[0].proposedValue='تغییر پس از کنترل';f.store.put('kpi-design',saved,saved.employeeId);
  assert.throws(()=>f.org.acceptDesignChange(f.manager,source.id,{all:true,reason:'اصلاح همه'}),error=>error.status===409);
  assert.equal(f.store.list('kpi-design').filter(row=>row.status==='draft').length,0);
});

test('quality regressions against unchanged retained tasks prevent applying the whole batch without reversing retention',async t=>{
  const f=await setup(t,(result,envelope)=>{if(envelope.stage==='kpi-alignment-v4')revise(result.reviews[1],'خروجی روشن');if(envelope.stage==='kpi-correction-validation-v1')unknown(result.reviews[0]);});
  const source=f.org.submitDesign(f.manager,f.input),reviewed=await f.org.analyzeDesign(f.manager,source.id);
  assert.equal(reviewed.aiReview.result.reviews[0].recommendation,'retain');assert.equal(reviewed.aiReview.result.humanReviewRequired,false);assert.equal(reviewed.aiReview.result.correctionQualityFailed,true);
  assert.equal(reviewed.aiReview.result.reviews[1].correctionValidation.status,'needs_human_review');
  assert.throws(()=>f.org.acceptDesignChange(f.manager,source.id,{all:true,reason:'اعمال'}),error=>error.status===409);
});

test('a false full-date mismatch is cleared deterministically but a genuine mismatch or invalid date is not',()=>{
  const reply=quotes=>({reviews:[{recommendation:'revise',missingInformation:[],changes:[{field:'deadline'}],checks:[{type:'definition',ruleId:'date_consistency',status:'fail',severity:'blocking',citations:quotes.map(quote=>({quote}))}]}]});
  const equivalent=normalizeStaticJudgments(reply(['۱۴۰۵/۰۷/۳۰','2026-10-22']));assert.equal(equivalent.reviews[0].recommendation,'retain');assert.equal(equivalent.reviews[0].checks[0].status,'pass');assert.deepEqual(equivalent.reviews[0].changes,[]);
  for(const dates of [['۱۴۰۵/۰۷/۳۰','2026-10-23'],['۱۴۰۵/۱۲/۳۰','2027-03-21']])assert.equal(normalizeStaticJudgments(reply(dates)).reviews[0].recommendation,'revise');
});

test('an explicitly accepted verified correction inherits its quality retain decision even if the next model reply objects again',async t=>{
  let round=0;const f=await setup(t,(result,envelope)=>{if(envelope.stage==='kpi-alignment-v4'){round++;if(round===1)revise(result.reviews[1],'عنوان دقیق تأییدشده');else unknown(result.reviews[1]);}});
  const source=f.org.submitDesign(f.manager,f.input),first=await f.org.analyzeDesign(f.manager,source.id);
  const draft=f.org.acceptDesignChange(f.manager,source.id,{all:true,reason:'اعمال همان اصلاح معتبر'}),second=await f.org.publishDesignDraft(f.manager,draft.id);
  const corrected=second.aiReview.result.reviews.find(row=>row.proposalId==='T2');assert.equal(corrected.recommendation,'retain');assert.equal(corrected.lock.sourceRunId,first.aiReview.result.qualityRunId);assert.equal(second.aiReview.result.blockers.length,0);assert.equal(second.status,'manager_review');assert.equal(f.store.list('activity').filter(row=>row.designId===second.id).length,0);
});

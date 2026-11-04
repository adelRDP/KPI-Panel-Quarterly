import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,currentPeriod,quarterOf} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createPanelServer} from '../server.mjs';
import {seedPeerUnitModel} from './unit-model-fixture.mjs';
import {policyForPeriod} from '../backend/evaluation-settings.mjs';
import PerformanceModel from '../src/performance-model.js';
import {createScoreSettings,defaultScoreRules,scoreRulesAt,submissionRules,submissionKey,delayBreakdown,ruleDaysBetween,addRuleDays,tehranDay} from '../backend/score-rules.mjs';

async function fixture(t,clock=()=>new Date().toISOString()){
  const directory=await mkdtemp(join(tmpdir(),'kpi-score-rules-')),store=openStore(directory),workflow=createWorkflow(store),organization=createOrganizationWorkflow(store,workflow),settings=createScoreSettings(store,{now:clock}),hr=workflow.user('hr-demo');
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const input=(values={},other={})=>({effectiveDate:tehranDay(clock()),unitId:null,activityKind:'all',values:{...defaultScoreRules,...values},reason:'تغییر آزمایشی قواعد',...other});
  const publish=(values={},other={})=>{const draft=settings.save(hr,input(values,other)),preview=settings.preview(hr,draft);return settings.publish(hr,{...draft,previewHash:preview.previewHash});};
  return {store,workflow,organization,settings,hr,input,publish};
}

test('defaults preserve current scores; immutable history, preview, optimistic concurrency and role gates',async t=>{
  const {store,workflow,settings,hr,input,publish}=await fixture(t),actor=workflow.user('employee-mohammad');
  const before=workflow.snapshotForSystem(actor.id,currentPeriod());
  for(const method of ['state','save','preview','publish','discard'])assert.throws(()=>settings[method](actor,input()),e=>e.status===403);
  assert.throws(()=>settings.save(hr,input({unknown:'x'})),/ناشناخته/);
  assert.throws(()=>settings.save(hr,input({citations:'off'})),/معتبر/);
  assert.throws(()=>settings.save(hr,input({reminderDays:'5'})),/پیش از/);
  assert.throws(()=>settings.save(hr,input({surveyParticipation:'90'},{activityKind:'project'})),/عمومی/);
  const draft=settings.save(hr,input()),first=settings.preview(hr,draft);
  const edit=settings.save(hr,{...draft,reason:'دلیل جدید آزمایشی'});
  assert.throws(()=>settings.publish(hr,{...draft,previewHash:first.previewHash}),e=>e.status===409);
  assert.throws(()=>settings.publish(hr,edit),/پیش‌نمایش/);
  const preview=settings.preview(hr,edit);assert.equal(preview.changes.length,0);
  const version=settings.publish(hr,{...edit,previewHash:preview.previewHash});
  assert.deepEqual(workflow.snapshotForSystem(actor.id,currentPeriod()).components,before.components);
  assert.equal(workflow.snapshotForSystem(actor.id,currentPeriod()).earned,before.earned);
  assert.deepEqual(version.values,defaultScoreRules);
  const waiting=settings.save(hr,input({delayMode:'daily'})),waitingPreview=settings.preview(hr,waiting);
  publish({delayMode:'fixed'});
  assert.throws(()=>settings.publish(hr,{...waiting,previewHash:waitingPreview.previewHash}),/پیش‌نمایش/);
  assert.equal(store.get(version.id,'score-rule-version').values.delayMode,'off');
  settings.discard(hr,waiting);assert.equal(store.get(waiting.id,'score-rule-draft').status,'discarded');
  assert.ok(store.list('audit-event').some(e=>e.action==='score-rules.published'));
});

test('delivery cap defaults to five, supports old drafts, and follows published unit/type scope',async t=>{
 const {store,settings,hr,input,publish}=await fixture(t),legacy=input();delete legacy.values.maxUploads;const d=settings.save(hr,legacy);assert.equal(d.values.maxUploads,'5');
 const old=store.get(d.id,'score-rule-draft');delete old.values.maxUploads;store.put('score-rule-draft',old);const p=settings.preview(hr,old);const restored=settings.publish(hr,{...old,previewHash:p.previewHash});assert.equal(restored.values.maxUploads,'5');
 publish({maxUploads:'10'});publish({maxUploads:'3'},{unitId:'ops',activityKind:'routine'});assert.equal(scoreRulesAt(store,{unitId:'ops',kind:'routine'}).values.maxUploads,'3');assert.equal(scoreRulesAt(store,{unitId:'ops',kind:'project'}).values.maxUploads,'10');assert.equal(scoreRulesAt(store,{unitId:'finance',kind:'routine'}).values.maxUploads,'10');
});

test('effective date, publication instant and unit/type precedence never apply retroactively',async t=>{
  let time='2026-10-05T06:00:00Z';const {store,publish}=await fixture(t,()=>time);
  const global=publish({delayMode:'daily'}),unit=publish({delayMode:'fixed'},{unitId:'ops'}),project=publish({delayMode:'tiered'},{unitId:'ops',activityKind:'project'});
  assert.equal(scoreRulesAt(store,{unitId:'ops',kind:'project',at:'2026-10-05T05:59:59Z'}).version,'score-rules-legacy-v1');
  assert.equal(scoreRulesAt(store,{unitId:'finance',kind:'project',at:time}).version,global.id);
  assert.equal(scoreRulesAt(store,{unitId:'ops',kind:'routine',at:time}).version,unit.id);
  assert.equal(scoreRulesAt(store,{unitId:'ops',kind:'project',at:time}).version,project.id);
  const future=publish({delayMode:'off'},{unitId:'ops',activityKind:'project',effectiveDate:'2026-10-06'});
  assert.equal(scoreRulesAt(store,{unitId:'ops',kind:'project',at:time}).version,project.id);
  assert.equal(scoreRulesAt(store,{unitId:'ops',kind:'project',at:'2026-10-05T20:30:00Z'}).version,future.id);
});

test('late deduction, grace, calendar/business days, caps and null quality are deterministic',()=>{
  const policy=mode=>({version:'test',values:{...defaultScoreRules,delayMode:mode,delayAmount:'5',delayCap:'20'}});
  assert.equal(delayBreakdown(policy('off'),80,10).finalScore,80);
  assert.equal(delayBreakdown(policy('fixed'),80,10).deduction,5);
  assert.equal(delayBreakdown(policy('daily'),80,10).deduction,20);
  assert.equal(delayBreakdown(policy('tiered'),80,4).deduction,10);
  assert.equal(delayBreakdown(policy('daily'),3,10).finalScore,0);
  assert.equal(delayBreakdown(policy('daily'),null,10).finalScore,null);
  assert.equal(ruleDaysBetween('2026-10-01','2026-10-03','business'),1);
  assert.equal(addRuleDays('2026-10-01',1,'business'),'2026-10-03');
});

test('financial rules require a future quarter and consistently affect monthly estimates and quarterly payments',async t=>{
  const {store,settings,hr,input,publish}=await fixture(t,()=> '2026-10-05T06:00:00Z');
  assert.throws(()=>settings.save(hr,input({incentiveCap:'30'})),/فصل آینده/);
  assert.throws(()=>settings.save(hr,input({rounding:'1000'},{effectiveDate:'2026-12-23'})),/فصل آینده/);
  const version=publish({incentiveCap:'30',rounding:'1000',noProject:'pending'},{effectiveDate:'2026-12-22'});
  assert.equal(policyForPeriod(store,'1405-09',null,'ops').amountRules,undefined);
  const policy=policyForPeriod(store,'1405-10',null,'ops');assert.equal(policy.amountRules.version,version.id);assert.equal(policy.amountRules.monthlyRate,.3);
  const args={baseSalary:60000000,hasProjects:true,scores:{exam:73,manager:73,routine:73,project:73,peer:73},policy};
  const monthly=PerformanceModel.calculateMonthly(args);assert.equal(monthly.ceiling,18000000);assert.equal(monthly.earned,13140000);
  const quarter=PerformanceModel.calculateQuarter({...args,modelType:'unified',monthlyScores:[args.scores,args.scores,args.scores],examScore:73});assert.equal(quarter.ceiling,54000000);assert.equal(quarter.earned,39420000);
  const payment=PerformanceModel.calculateQuarterly({intervals:[{startDay:0,endDay:90,baseSalary:60000000,score:73,eligible:true}],totalDays:90,amountRules:policy.amountRules});assert.equal(payment.ceiling,quarter.ceiling);assert.equal(payment.earned,quarter.earned);
  assert.equal(PerformanceModel.calculateMonthly({...args,hasProjects:false}).complete,false);
  assert.equal(PerformanceModel.calculateMonthly({...args,hasProjects:false}).components.find(c=>c.id==='project').score,null);
  const rounded=PerformanceModel.calculateMonthly({...args,baseSalary:60000123});assert.ok(rounded.components.every(c=>c.earned===null||Number.isInteger(c.earned)&&c.earned<=c.ceiling));
});

test('revision limits count successful delivery sets, not files, retries or extraction failures',async t=>{
  const now='2026-10-05T10:00:00Z',{store,publish}=await fixture(t,()=>now);
  publish({maxRevisions:'1',delayMode:'daily',delayAmount:'5',graceDays:'1'});
  const activity={id:'test-activity',kind:'project',unitId:'ops',dueDate:'2026-10-01'},docs=[{id:'doc-a',sha256:'a',createdAt:now},{id:'doc-b',sha256:'b',createdAt:now}];
  let result=submissionRules(store,activity,docs,{now,review:true});assert.equal(result.lateDays,3);assert.equal(result.revision,0);
  store.put('review',{id:'first',status:'done',submissionKey:submissionKey(docs),finishedAt:now,result:{coverage:{incomplete:false}}},activity.id);
  assert.equal(submissionRules(store,activity,docs,{now,review:true}).revision,0);
  const revised=[...docs,{id:'doc-c',sha256:'c',createdAt:now}];
  store.put('review',{id:'failed',status:'failed',submissionKey:submissionKey(revised)},activity.id);
  store.put('review',{id:'extraction-failed',status:'done',submissionKey:submissionKey(revised),result:{coverage:{incomplete:true}}},activity.id);
  assert.equal(submissionRules(store,activity,revised,{now,review:true}).revision,1);
  store.put('review',{id:'second',status:'done',submissionKey:submissionKey(revised),finishedAt:now,result:{coverage:{incomplete:false}}},activity.id);
  assert.throws(()=>submissionRules(store,activity,[...revised,{id:'d',sha256:'d'}],{now,review:true}),/سهمیه/);
  assert.doesNotThrow(()=>submissionRules(store,activity,revised,{now,review:true}));
  publish({lateMode:'close'});assert.throws(()=>submissionRules(store,activity,docs,{now}),/مهلت/);
  assert.doesNotThrow(()=>submissionRules(store,{...activity,dueDate:null},docs,{now}));
});

test('quarter appeal settings are pinned at lock and required evidence is enforced before approval',async t=>{
  const {store,workflow,organization,publish}=await fixture(t),person=workflow.user('employee-mohammad'),manager=workflow.user('manager-ops'),quarter=quarterOf(currentPeriod());
  publish({quarterAppealCount:'1',appealEvidence:'required'});
  const snapshot=scoreRulesAt(store,{unitId:person.unitId});
  store.put('quarter-evaluation',{id:'locked-test',employeeId:person.id,quarter,status:'locked',lockedAt:new Date().toISOString(),scoreRulesSnapshot:snapshot,lockedSnapshot:{sentinel:'immutable'}},person.id);
  const serialized=JSON.stringify(store.get('locked-test','quarter-evaluation'));
  const appeal=organization.submitAppeal(person,{quarter,reason:'درخواست بررسی آزمایشی'});
  publish({quarterAppealCount:'5'});
  assert.throws(()=>organization.submitAppeal(person,{quarter,reason:'درخواست دوم'}),/سقف/);
  assert.throws(()=>organization.reviewAppeal(manager,appeal.id,{decision:'approve'}),/فایل/);
  store.put('quarter-appeal-file',{id:'file',appealId:appeal.id},appeal.id);
  assert.equal(organization.reviewAppeal(manager,appeal.id,{decision:'approve'}).status,'hr_review');
  assert.equal(JSON.stringify(store.get('locked-test','quarter-evaluation')),serialized);
});

test('survey defaults, response minimum and deadline are pinned to campaign, not later publications',async t=>{
  const {store,workflow,organization,hr,publish}=await fixture(t);seedPeerUnitModel(store);
  publish({surveyParticipation:'80',surveyResponses:'5',surveyDays:'10'});
  const campaign=organization.createServiceCampaign(hr,{employeeId:'employee-service-1',period:currentPeriod()});
  assert.equal(campaign.minParticipation,.8);assert.equal(campaign.scoreRulesSnapshot.values.surveyResponses,'5');
  publish({surveyParticipation:'30',surveyResponses:'3',surveyDays:'1'});
  organization.publishServiceCampaign(hr,campaign.id);
  const result=organization.serviceCampaigns(hr).find(c=>c.id===campaign.id);
  assert.equal(result.dueAt,campaign.dueAt);assert.equal(result.minParticipation,.8);
  assert.equal(result.requiredCount,Math.max(5,Math.ceil(result.population*.8)));
  const responder=workflow.user('employee-mohammad'),response=organization.submitServiceResponse(responder,campaign.id,{score:90});
  assert.equal(response.required,result.requiredCount);assert.equal(response.published,false);
});

test('HTTP settings permissions and real review use final score without mutating quality or replaying deductions',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-score-http-'));let calls=0;
  const server=createPanelServer({dataRoot:join(dir,'db'),autoAssessment:false,runModel:async({prompt})=>{calls++;const evidence=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]),chunk=evidence.chunks[0];return {result:{summary:'تأیید آزمایشی',criteria:[{id:'C1',status:'met',score:80,reason:'شاهد معتبر',citations:[{chunkId:chunk.id,quote:chunk.text}]}]}};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const store=openStore(join(dir,'db'));
  t.after(async()=>{store.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,initial=await(await fetch(base+'/api/session')).json();
  const request=(actor,path,body)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'x-panel-token':actor.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const hrInitial=await(await fetch(base+'/api/session')).json(),hr=await(await request(hrInitial,'/api/session',{userId:'hr-demo'})).json();
  for(const path of ['/api/org/score-settings','/api/org/score-settings/save'])assert.equal((await request(initial,path,path.endsWith('save')?{}:undefined)).status,403);
  const state=await(await request(hr,'/api/org/score-settings')).json();
  const draft=await(await request(hr,'/api/org/score-settings/save',{effectiveDate:state.today,unitId:null,activityKind:'all',reason:'آزمون واقعی اتصال قواعد',values:{...state.defaults,delayMode:'fixed',delayAmount:'5'}})).json();
  assert.equal((await request(hr,'/api/org/score-settings/publish',draft)).status,409);
  const preview=await(await request(hr,'/api/org/score-settings/preview',draft)).json();
  assert.equal((await request(hr,'/api/org/score-settings/publish',{...draft,previewHash:preview.previewHash})).status,200);
  const activity=await(await request(initial,'/api/activities',{kind:'project',title:'آزمون تأخیر',description:'گزارش نمونه',period:currentPeriod(),criteria:['خروجی مستند']})).json();
  store.put('activity',{...activity,dueDate:'2020-01-01',assignmentStatus:'approved'},activity.ownerId);
  const upload=await fetch(base+`/api/activities/${activity.id}/documents?name=report.txt`,{method:'POST',headers:{'x-panel-token':initial.token},body:'completed evidence'});assert.equal(upload.status,201);
  const response=await request(initial,`/api/activities/${activity.id}/reviews`,{});assert.equal(response.status,200);const review=await response.json();
  assert.equal(review.result.qualityScore,80);assert.equal(review.result.finalScore,75);assert.equal(review.result.scoreBreakdown.deduction,5);
  assert.equal((await(await request(initial,`/api/activities/${activity.id}/reviews`,{})).json()).cached,true);assert.equal(calls,1);
  const workflow=createWorkflow(store);assert.equal(workflow.snapshotForSystem(activity.ownerId,currentPeriod()).assignments.find(a=>a.id===activity.id).score,75);
});

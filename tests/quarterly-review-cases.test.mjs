import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFixture} from './quarterly-audit-fixture.mjs';
import {currentPeriod} from '../backend/quarterly-workflow.mjs';
import {createReviewCases} from '../backend/review-cases.mjs';
import {createApprovalSla} from '../backend/approval-sla.mjs';
import {submissionRules,addRuleDays} from '../backend/score-rules.mjs';
import {sha256} from '../backend/evaluation.mjs';
import {quarterlyResult} from '../backend/quarterly-results.mjs';
test('activity appeals keep the original AI result and apply only the authorized current-source score',async t=>{
 const f=await auditFixture(t,currentPeriod()),{store,workflow:w,org,employee,manager,hr,q}=f;store.put('workflow-policy',{id:'active-policy',version:'routine',weights:{exam:0,manager:0,routine:100,project:0,peer:0}});
 const a=store.put('activity',{ownerId:'e',positionId:'p',unitId:'u',period:q,kind:'routine',title:'گزارش آزمایشی',criteria:[{id:'C1',text:'ثبت گزارش'}],assignmentStatus:'approved'},'e'),extraction={status:'ready',chunks:[{id:'c',text:'گزارش'}]},d=store.put('document',{name:'test.txt',sha256:'x',extraction,createdAt:new Date().toISOString()},a.id),review=store.put('review',{status:'done',activitySnapshot:a,finishedAt:new Date().toISOString(),documentHashes:[{id:d.id,sha256:d.sha256,extractionHash:sha256(JSON.stringify(extraction))}],result:{finalForActivity:true,qualityScore:50,finalScore:50}},a.id),engine=createReviewCases(store,w,{audit:org.audit});
 const row=engine.create(employee,{type:'activity-appeal',activityId:a.id,reason:'شواهد درست تفسیر نشده است'});assert.throws(()=>engine.decide(hr,row.id,{revision:1,decision:'approve',reason:'تأیید زودهنگام'}),{status:403});const proposal=engine.decide(manager,row.id,{revision:1,decision:'approve',score:90,reason:'بازبینی مستند گزارش'});assert.equal(w.snapshotForSystem('e',q).assignments[0].score,50);engine.decide(hr,row.id,{revision:proposal.revision,decision:'approve',reason:'تصویب بازبینی مستند'});assert.equal(w.snapshotForSystem('e',q).assignments[0].score,90);assert.deepEqual(store.get(review.id,'review'),review);assert.throws(()=>engine.decide(hr,row.id,{revision:proposal.revision,decision:'approve',reason:'تصویب تکراری'}));
 store.put('document',{...d,sha256:'changed'},a.id);assert.equal(w.snapshotForSystem('e',q).assignments[0].score,null);
});
test('deadline extension requires both approvals and applies to new scoring without editing the activity',async t=>{
 const f=await auditFixture(t,currentPeriod()),{store,workflow:w,org,employee,manager,hr,q}=f,a=store.put('activity',{ownerId:'e',positionId:'p',unitId:'u',period:q,kind:'routine',assignmentStatus:'approved',title:'آزمون تمدید',dueDate:'2026-11-10'},'e'),engine=createReviewCases(store,w,{audit:org.audit});
 const row=engine.create(employee,{type:'extension',activityId:a.id,dueDate:'2026-11-13',category:'outage',reason:'قطعی مستند سامانهٔ کاری'});assert.equal(submissionRules(store,a,[]).dueDate,a.dueDate);const reviewed=engine.decide(manager,row.id,{revision:1,decision:'approve',reason:'تأیید وقوع قطعی کاری'});engine.decide(hr,row.id,{revision:reviewed.revision,decision:'approve',reason:'تصویب تمدید مهلت کاری'});assert.equal(submissionRules(store,a,[]).dueDate,'2026-11-13');assert.deepEqual(store.get(a.id,'activity'),a);assert.throws(()=>engine.create(w.user('n'),{type:'extension',activityId:a.id}),{status:403});
 store.put('quarter-evaluation',{employeeId:'e',quarter:q,status:'locked'},'e');assert.throws(()=>engine.create(employee,{type:'extension',activityId:a.id,dueDate:'2026-11-14',category:'other',reason:'درخواست بعد از قفل'}),{status:409});
});
test('seven-business-day SLA alerts once, resolves after a decision and never alters scores',async t=>{
 const f=await auditFixture(t),events=[],start='2026-11-01';let clock=start+'T09:00:00Z';const sla=createApprovalSla(f.store,f.workflow,{publish:e=>events.push(e)},{now:()=>clock}),row=f.store.put('review-case',{employeeId:'e',managerId:'m',unitId:'u',status:'manager_review',createdAt:clock,events:[{state:'manager_review',at:clock}]},'e');sla.observe('review-case',row.id);sla.scan();assert.equal(events.length,0);clock=addRuleDays(start,7,'business')+'T12:00:00Z';sla.scan();sla.scan();assert.equal(events.length,1);assert.ok(events[0].recipientIds.includes('m'));assert.ok(events[0].recipientIds.includes('a'));assert.equal(f.store.get(row.id,'review-case').status,'manager_review');f.store.put('review-case',{...row,status:'approved'},'e');sla.scan();assert.equal(sla.list(f.hr).length,0);
});

test('an unresolved case blocks finalization and owner withdrawal preserves history and releases the block',async t=>{
 const {store,workflow:w,org,employee,hr,q}=await auditFixture(t);w.recordExamResult({employeeId:'e',period:q,score:100,reference:'synthetic'});
 const a=store.put('activity',{ownerId:'e',positionId:'p',unitId:'u',period:q,kind:'routine',title:'گزارش',criteria:[],assignmentStatus:'approved',dueDate:'2025-10-01'},'e'),extraction={status:'ready',chunks:[{id:'c',text:'report'}]},d=store.put('document',{name:'test.txt',sha256:'hash',extraction},a.id);
 store.put('review',{status:'done',activitySnapshot:a,finishedAt:new Date().toISOString(),documentHashes:[{id:d.id,sha256:d.sha256,extractionHash:sha256(JSON.stringify(extraction))}],result:{finalForActivity:true,qualityScore:100,finalScore:100}},a.id);
 const engine=createReviewCases(store,w,{audit:org.audit}),row=engine.create(employee,{type:'extension',activityId:a.id,dueDate:'2025-10-03',category:'outage',reason:'قطعی مستند سامانه کاری'});
 assert.ok(quarterlyResult(store,w,hr,q,'e').blockers.some(x=>x.includes('تعیین تکلیف')));assert.throws(()=>engine.cancel(hr,row.id,{revision:1,reason:'لغو توسط غیرمالک'}),{status:403});assert.throws(()=>engine.cancel(employee,row.id,{revision:0,reason:'لغو نسخه قدیمی'}));
 const cancelled=engine.cancel(employee,row.id,{revision:1,reason:'انصراف از درخواست مستند'});assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.events.length,2);assert.equal(quarterlyResult(store,w,hr,q,'e').canFinalize,true);assert.equal(store.list('activity-deadline-extension').length,0);assert.deepEqual(store.get(a.id,'activity'),a);
});

test('SLA configuration applies to new stages while a running stage keeps its pinned business-day deadline',async t=>{
 const f=await auditFixture(t),clock='2026-11-01T09:00:00Z';f.store.put('score-rule-version',{id:'sla-ten',status:'published',effectiveDate:'2026-10-01',publishedAt:'2026-10-01T00:00:00Z',activityKind:'all',sequence:1,values:{approvalSlaDays:10}});
 const sla=createApprovalSla(f.store,f.workflow,null,{now:()=>clock}),row=f.store.put('review-case',{employeeId:'e',managerId:'m',status:'manager_review',createdAt:clock,events:[{state:'manager_review',at:clock}]},'e');sla.observe('review-case',row.id);const first=sla.list(f.hr)[0];assert.equal(first.days,10);assert.equal(first.dueDate,addRuleDays('2026-11-01',10,'business'));
 f.store.put('score-rule-version',{id:'sla-three',status:'published',effectiveDate:'2026-10-01',publishedAt:'2026-10-01T00:00:00Z',activityKind:'all',sequence:2,values:{approvalSlaDays:3}});sla.observe('review-case',row.id);assert.equal(sla.list(f.hr)[0].days,10);
 f.store.put('review-case',{...row,status:'hr_review',events:[...row.events,{state:'hr_review',at:clock}]},'e');sla.observe('review-case',row.id);sla.scan();assert.equal(sla.list(f.hr).length,1);assert.equal(sla.list(f.hr)[0].days,3);
});

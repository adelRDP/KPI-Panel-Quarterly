import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,periodBounds,quarterMonths,quarterOf} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {calculatePositionSlice,createPositionCloseout} from '../backend/position-closeout.mjs';
import Model from '../src/performance-model.js';

test('position slice counts split-month days and currency once, preserves component weights and pending scores',()=>{
 const bounds={start:'2026-09-23',end:'2026-10-23',totalDays:30},policy={...Model.demoPolicy,amountRules:{monthlyRate:.2,rounding:1}};
 const snapshot={baseSalary:60000001,hasProjects:true,policy,...Model.calculateMonthly({baseSalary:60000001,hasProjects:true,policy,scores:{exam:100,manager:100,routine:100,project:100}})};
 const a=calculatePositionSlice(snapshot,{bounds,start:bounds.start,end:'2026-10-03',positionId:'old'}),b=calculatePositionSlice(snapshot,{bounds,start:'2026-10-03',end:bounds.end,positionId:'new'});
 assert.equal(a.days,10);assert.equal(b.days,20);assert.equal(a.ceiling+b.ceiling,snapshot.ceiling);assert.equal(a.baseSalary+b.baseSalary,snapshot.baseSalary);assert.equal(a.earned+b.earned,snapshot.ceiling);assert.equal(a.lastDay,'2026-10-02');
 snapshot.components[0].score=null;const pending=calculatePositionSlice(snapshot,{bounds,start:bounds.start,end:bounds.end,positionId:'old'});assert.equal(pending.complete,false);assert.equal(pending.performance,null);
 assert.throws(()=>calculatePositionSlice(snapshot,{bounds,start:'2026-09-22',end:bounds.end}));
});

test('every boundary of 29, 30 and 31-day months conserves the cap, including large safe-integer salaries',()=>{
 for(const totalDays of [29,30,31])for(const salary of [60000001,9000000000000001]){
  const start='2026-01-01',at=n=>new Date(Date.parse(start+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),bounds={start,end:at(totalDays),totalDays},policy=Model.demoPolicy,snapshot={...Model.calculateMonthly({baseSalary:salary,policy,scores:{exam:100,manager:100,routine:100,project:100}}),hasProjects:true,policy};
  for(let n=1;n<totalDays;n++){const a=calculatePositionSlice(snapshot,{start,end:at(n),bounds}),b=calculatePositionSlice(snapshot,{start:at(n),end:bounds.end,bounds});assert.equal(a.baseSalary+b.baseSalary,salary);assert.equal(a.ceiling+b.ceiling,snapshot.ceiling);assert.equal(a.earned+b.earned,snapshot.ceiling);}
 }
});

async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'kpi-closeout-')),store=openStore(dir),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{runModel:async()=>{throw Error('No live model');}});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {store,workflow,org,hr:workflow.user('hr-demo')};}
test('preview requires every old score, uses the old position and never persists on read',async t=>{
 const {store,workflow}=await fixture(t),id='employee-sara',old=workflow.positionAt(id),period=workflow.currentPeriod,bounds=periodBounds(period),cutoff=new Date(Date.parse(bounds.start+'T00:00:00Z')+5*86400000).toISOString().slice(0,10);
 store.put('position-assignment',{...old,effectiveFrom:bounds.start,events:[{by:'test'}]},id);
 const service=createPositionCloseout(store,workflow,{periodBounds,today:()=>bounds.end,audit:()=>{}}),proposal={id:'transfer',employeeId:id,supersedes:old.id,effectiveFrom:cutoff};
 const before=store.list('position-closeout').length,result=service.preview(proposal);assert.equal(result.ready,true);assert.equal(result.months.length,1);assert.equal(result.months[0].days,5);assert.equal(store.list('position-closeout').length,before);
 for(const survey of store.list('manager-survey',id).filter(r=>r.period===period))store.remove(survey.id,'manager-survey',id);
 assert.equal(service.preview(proposal).ready,false);assert.throws(()=>service.lock({id:'hr'},proposal,{}),/تکمیل/);assert.equal(store.list('position-closeout').length,0);
});

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function transferFixture(t){const f=await fixture(t),id='employee-sara',old=f.workflow.positionAt(id),period=f.workflow.currentPeriod,bounds=periodBounds(period),cutoff=today();
 // An explicit one-month position keeps this fixture independent of demo history.
 f.store.put('position-assignment',{...old,effectiveFrom:new Date(Date.parse(bounds.start+'T00:00:00Z')-86400000).toISOString().slice(0,10),events:[{by:'test'}]},id);
 const proposal=f.org.proposePosition(f.hr,{employeeId:id,jobTitle:'سمت جدید',jobFamily:'مالی',jobLevel:'کارشناس',unitId:'finance',unitName:'مالی',managerId:'manager-finance',duties:'تحلیل و کنترل اطلاعات مالی جدید',hasProjects:false,baseSalary:90000000,transferDate:cutoff});
 f.org.reviewPosition(f.workflow.user('manager-finance'),proposal.id,{decision:'approve'});return {...f,id,old,period,bounds,cutoff,proposal};}
function approveTransfer(f){const preview=f.org.positionCloseoutPreview(f.hr,f.proposal.id);return f.org.approvePosition(f.hr,f.proposal.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});}
test('transfer is atomic, requires a fresh complete preview, freezes previous results and separates the new position',async t=>{
 const f=await transferFixture(t),{org,workflow,store,hr,id,old,proposal,period,cutoff}=f;
 // Complete the preceding month too if the start was the previous month's last day.
 const prior=new Date(Date.parse(f.bounds.start+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const {periodAtDate}=await import('../backend/position-closeout.mjs');const priorPeriod=periodAtDate(prior);
 store.put('manager-survey',{employeeId:id,period:priorPeriod,score:80},id);store.put('exam-result',{employeeId:id,period:quarterOf(priorPeriod),score:90},id);store.put('activity',{ownerId:id,kind:'routine',period:priorPeriod,assignmentStatus:'approved',sampleScore:80},id);
 const preview=org.positionCloseoutPreview(hr,proposal.id);assert.equal(preview.ready,true,preview.blockers.join('\n'));
 assert.throws(()=>org.approvePosition(hr,proposal.id,{decision:'approve'}),/پیش‌نمایش/);assert.equal(store.list('position-closeout').length,0);assert.equal(store.get(old.id,'position-assignment').effectiveTo,null);
 assert.throws(()=>org.approvePosition(hr,proposal.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:'stale'}),/پیش‌نمایش/);
 const published=approveTransfer(f);assert.equal(published.effectiveFrom,cutoff);assert.ok(published.previousCloseoutId);assert.equal(store.get(old.id,'position-assignment').effectiveTo,cutoff);
 const locked=org.closeoutHistory(hr,id)[0],oldMonth=locked.months.find(m=>m.period===period);if(oldMonth){assert.equal(oldMonth.end,cutoff);assert.ok(oldMonth.complete);}
 const current=workflow.snapshotForPosition(id,period,published.id);assert.equal(current.positionId,published.id);assert.equal(current.assignments.length,0);assert.equal(current.components.find(c=>c.id==='manager').score,null);
 const draft=org.saveDesignDraft(workflow.user('manager-finance'),{employeeId:id,period,tasks:[{id:'T1',category:'routine',title:'شاخص جدید',description:'شرح مستقل برای سمت جدید',criteria:['خروجی جدید کامل باشد'],weight:100,responsible:'نام ساختگی',frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش'}]});assert.equal(draft.positionId,published.id);
 workflow.saveSurvey(workflow.user('manager-finance'),{employeeId:id,period,score:95});assert.equal(workflow.snapshotForPosition(id,period,published.id).components.find(c=>c.id==='manager').score,95);
 const {assertPositionActivityWritable}=await import('../backend/position-closeout.mjs');for(const m of locked.months)for(const a of m.assignments)assert.throws(()=>assertPositionActivityWritable(store,a),/نهایی و بسته/);
 assert.deepEqual(org.closeoutHistory(workflow.user(id),id)[0],locked);assert.throws(()=>org.closeoutHistory(workflow.user('manager-finance'),id),e=>e.status===403);
 assert.deepEqual(store.get(locked.id,'position-closeout'),locked);assert.throws(()=>org.approvePosition(hr,proposal.id,{decision:'approve'}));
});

test('past-quarter totals combine locked and new-position slices once, with different salaries and protected manager amounts',async t=>{
 const {store,workflow,org,hr}=await fixture(t),id='employee-mohammad',old=workflow.positionAt(id),[y,m]=workflow.currentPeriod.split('-').map(Number),q=Math.ceil(m/3),quarter=q===1?`${y-1}-Q4`:`${y}-Q${q-1}`,months=quarterMonths(quarter),bounds=periodBounds(months[0]),cutoff=new Date(Date.parse(bounds.start+'T00:00:00Z')+10*86400000).toISOString().slice(0,10);
 store.put('position-assignment',{...old,effectiveFrom:bounds.start,baseSalary:60000000,events:[{by:'test'}]},id);
 const grade=(positionId,p,managerId)=>{store.put('manager-survey',{employeeId:id,positionId,managerId,period:p,score:100},id);for(const kind of ['routine','project'])store.put('activity',{ownerId:id,positionId,unitId:'ops',kind,period:p,assignmentStatus:'approved',sampleScore:100},id);};
 grade(old.id,months[0],'manager-ops');store.put('exam-result',{employeeId:id,period:quarter,score:100},id);
 const proposal=org.proposePosition(hr,{employeeId:id,jobTitle:'سمت دوم',jobFamily:'عملیات',jobLevel:'کارشناس',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',duties:'شرح جدید',baseSalary:90000000,hasProjects:true,transferDate:cutoff});org.reviewPosition(workflow.user('manager-ops'),proposal.id,{decision:'approve'});
 const preview=org.positionCloseoutPreview(hr,proposal.id);assert.equal(preview.ready,true,preview.blockers.join('\n'));
 const published=org.approvePosition(hr,proposal.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});for(const p of months)grade(published.id,p,'manager-ops');
 const frozen=org.closeoutHistory(hr,id)[0],first=workflow.snapshotForSystem(id,months[0]);assert.equal(first.segments.length,2);assert.equal(first.segments[0].end,first.segments[1].start);assert.equal(first.segments.reduce((n,s)=>n+s.days,0),bounds.totalDays);
 const expectedOld=Math.floor(12000000*10/bounds.totalDays),expectedNew=18000000-Math.floor(18000000*10/bounds.totalDays),result=org.quarterResult(hr,quarter,id);assert.equal(result.status,'ready',result.blockers.join('\n'));assert.equal(result.quarterPay.earned,expectedOld+expectedNew+36000000);assert.equal(result.calculation.performance,100);assert.equal(result.quarterPay.breakdown.reduce((n,b)=>n+b.earned,0)+result.quarterPay.oneTimeContribution.earned,result.quarterPay.earned);
 const manager=org.quarterResult(workflow.user('manager-ops'),quarter,id);assert.equal(manager.quarterPay.earned,undefined);assert.ok(manager.quarterPay.breakdown.every(b=>b.earned===undefined&&b.ceiling===undefined));const managerMonth=workflow.snapshot(workflow.user('manager-ops'),id,months[0]);assert.ok(managerMonth.segments.every(s=>s.earned===undefined&&s.baseSalary===undefined&&s.monthlyBaseSalary===undefined));
 // Even a direct source amendment cannot recompute the already locked side.
 for(const s of store.list('manager-survey',id).filter(s=>s.positionId===old.id))store.put('manager-survey',{...s,score:0},id);
 assert.deepEqual(org.closeoutHistory(hr,id)[0],frozen);assert.equal(workflow.snapshotForSystem(id,months[0]).segments[0].earned,expectedOld);
 const sent=org.submitQuarter(workflow.user('manager-ops'),quarter,id),locked=org.approveQuarter(hr,sent.id,{decision:'approve'});assert.equal(locked.lockedSnapshot.quarterPay.earned,result.quarterPay.earned);assert.equal(locked.lockedSnapshot.aggregationVersion,'position-closeout-v1');
 const restarted=createWorkflow(store);assert.equal(restarted.snapshotForSystem(id,months[0]).segments[0].earned,expectedOld);
});

test('future cutoff, missing exam, pending AI, changed source and already locked quarters refuse settlement without side effects',async t=>{
 const {store,workflow}=await fixture(t),id='employee-sara',old=workflow.positionAt(id),period=workflow.currentPeriod,bounds=periodBounds(period),cutoff=new Date(Date.parse(bounds.start+'T00:00:00Z')+4*86400000).toISOString().slice(0,10);
 store.put('position-assignment',{...old,effectiveFrom:bounds.start,events:[{by:'test'}]},id);
 const service=createPositionCloseout(store,workflow,{periodBounds,today:()=>cutoff,audit:()=>{}}),proposal={id:'transfer',employeeId:id,supersedes:old.id,effectiveFrom:cutoff},preview=service.preview(proposal);assert.equal(preview.ready,true);
 const uploadService=createPositionCloseout(store,workflow,{periodBounds,today:()=>cutoff,audit:()=>{},busy:new Set([preview.months[0].assignments[0].id])});assert.equal(uploadService.preview(proposal).ready,false);
 const run=store.put('review',{activityId:preview.months[0].assignments[0].id,status:'queued'});assert.equal(service.preview(proposal).ready,false);store.remove(run.id,'review',null);
 const s=store.list('manager-survey',id).find(s=>s.period===period);store.put('manager-survey',{...s,score:50},id);assert.throws(()=>service.lock({id:'hr'},proposal,{closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint}),/پیش‌نمایش/);
 const future={...proposal,effectiveFrom:bounds.end};assert.equal(service.preview(future).ready,false);
 for(const e of store.list('exam-result',id))store.remove(e.id,'exam-result',id);assert.equal(service.preview(proposal).ready,false);assert.equal(store.list('position-closeout').length,0);
 store.put('quarter-evaluation',{employeeId:id,quarter:quarterOf(period),status:'locked',lockedSnapshot:{earned:123}},id);assert.ok(service.preview(proposal).blockers.some(s=>s.includes('قفل شده')));assert.equal(store.list('quarter-evaluation',id)[0].lockedSnapshot.earned,123);
});

test('two transfers in one month stay independent across new models and never reuse a previous-position draft or correction quota',async t=>{
 const {store,workflow,org,hr}=await fixture(t),id='employee-mohammad',old=workflow.positionAt(id),period='1404-07',b=periodBounds(period),at=n=>new Date(Date.parse(b.start+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 store.put('position-assignment',{...old,effectiveFrom:b.start,baseSalary:60000000,events:[{by:'test'}]},id);
 store.put('exam-result',{employeeId:id,period:quarterOf(period),score:100},id);
 const grades=positionId=>{store.put('manager-survey',{employeeId:id,positionId,period,score:100},id);for(const kind of ['routine','project'])store.put('activity',{ownerId:id,positionId,kind,period,assignmentStatus:'approved',sampleScore:100},id);};grades(old.id);
 const input={employeeId:id,jobTitle:'سمت ساختگی',jobFamily:'عملیات',jobLevel:'کارشناس',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',duties:'شرح مستقل ساختگی',hasProjects:true};
 const transfer=(date,baseSalary)=>{const p=org.proposePosition(hr,{...input,transferDate:date,baseSalary});org.reviewPosition(workflow.user('manager-ops'),p.id,{decision:'approve'});const preview=org.positionCloseoutPreview(hr,p.id);assert.equal(preview.ready,true,preview.blockers.join('\n'));return org.approvePosition(hr,p.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});};
 const second=transfer(at(10),90000000);grades(second.id);const third=transfer(at(20),120000000);grades(third.id);
 const result=workflow.snapshotForSystem(id,period);assert.equal(result.segments.length,3);assert.deepEqual(result.segments.map(s=>s.days),[10,10,b.totalDays-20]);assert.equal(result.complete,true);assert.equal(result.assignments.length,6);assert.equal(result.segments.reduce((n,s)=>n+s.days,0),b.totalDays);assert.equal(org.closeoutHistory(hr,id).length,2);
 const previous=store.put('kpi-design',{employeeId:id,managerId:'manager-ops',positionId:second.id,period,status:'draft',version:1,tasks:[]},id);
 assert.throws(()=>org.saveDesignDraft(workflow.user('manager-ops'),{tasks:[]},previous.id),/نهایی‌شده/);
 store.put('evaluation-settings',{unitId:'ops',version:'new-model',status:'published',effectiveQuarter:quarterOf(period),weights:{exam:0,manager:100,routine:0,project:0,peer:0}});
 const changed=workflow.snapshotForSystem(id,period);assert.equal(changed.segments[0].policy.version,result.segments[0].policy.version);assert.equal(changed.segments[1].policy.version,result.segments[1].policy.version);assert.equal(changed.segments[2].policy.version,'new-model');assert.equal(changed.earned,result.earned);
});

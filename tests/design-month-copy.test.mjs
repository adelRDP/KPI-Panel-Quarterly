import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,periodBounds,currentPeriod} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {nextDesignMonth,copyTasksToNextMonth,copySourceFingerprint} from '../backend/design-month-copy.mjs';
import {roleReply} from './ai-role-fixture.mjs';

const task={category:'routine',title:'شاخص صرفاً ساختگی',description:'تهیه خروجی قابل انتساب',criteria:['ثبت خروجی'],weightPoints:3,frequency:'ماهانه',targetVolume:2,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'09:00'}};
async function fixture(t,{stage='published',period,modelMutate,tasks=[task]}={}){
 const root=await mkdtemp(join(tmpdir(),'kpi-month-copy-')),store=openStore(root),workflow=createWorkflow(store);let calls=0;
 const org=createOrganizationWorkflow(store,workflow,{aiDesignV2:true,runModel:async input=>{calls++;return roleReply(input,{mutate:modelMutate});}}),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo');
 const position=org.activePosition('employee-mohammad');store.put('position-assignment',{...position,duties:'تهیه و تحویل گزارش ساختگی\nکنترل خروجی و ثبت نتیجه'},position.employeeId);
 const saved=org.submitDesign(manager,{employeeId:'employee-mohammad',period:period||workflow.currentPeriod,tasks}),analyzed=await org.analyzeDesign(manager,saved.id);
 if(['hr_review','published'].includes(stage))org.managerReviewDesign(manager,saved.id,{decision:'approve'});if(stage==='published')org.hrReviewDesign(hr,saved.id,{decision:'approve'});
 t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const source=()=>store.get(saved.id,'kpi-design'),availability=id=>org.listDesigns(manager).find(d=>d.id===(id||saved.id)).copyNextMonth,copy=()=>org.copyDesignToNextMonth(manager,saved.id,{sourceFingerprint:copySourceFingerprint(source())});
 return {root,store,workflow,org,manager,hr,source,analyzed,availability,copy,get calls(){return calls;}};
}

for(const stage of ['manager_review','hr_review','published'])test('month copy retains '+stage+' approval stage and exact AI result with no model call',async t=>{
 const f=await fixture(t,{stage}),before=structuredClone(f.source()),runs=f.store.list('ai-role-run').length;assert.equal(f.availability().allowed,true);
 const copied=f.copy();assert.notEqual(copied.id,before.id);assert.equal(copied.period,nextDesignMonth(before.period));assert.equal(copied.status,stage);assert.deepEqual(copied.tasks,before.tasks);assert.deepEqual(copied.aiReview.result,before.aiReview.result);assert.equal(copied.aiReview.runId,before.aiReview.runId);assert.equal(copied.aiReview.inheritedFrom.modelCalls,0);assert.equal(f.calls,2);assert.equal(f.store.list('ai-role-run').length,runs);assert.deepEqual(f.source(),before);
 const state=f.org.listDesigns(f.manager).find(d=>d.id===copied.id);assert.equal(state.alignmentCurrent,true);
 if(stage==='published'){assert.equal(copied.hrReview.inheritedFromDesignId,before.id);assert.equal(copied.activityIds.length,1);assert.notEqual(copied.activityIds[0],before.activityIds[0]);assert.equal(f.store.list('document',copied.activityIds[0]).length,0);assert.equal(f.store.list('review',copied.activityIds[0]).length,0);assert.equal(f.workflow.snapshotForSystem(before.employeeId,copied.period).assignments.find(a=>a.id===copied.activityIds[0]).score,null);}
 else {assert.equal(copied.activityIds,undefined);if(stage==='manager_review')f.org.managerReviewDesign(f.manager,copied.id,{decision:'approve'});f.org.hrReviewDesign(f.hr,copied.id,{decision:'approve'});assert.equal(f.store.get(copied.id,'kpi-design').status,'published');assert.equal(f.calls,2);}
 const second=f.copy();assert.equal(second.id,copied.id);assert.equal(second.copyCached,true);assert.equal(f.store.list('audit-event').filter(e=>e.action==='kpi-design.month-copied').length,1);
});

test('repeated monthly copies have explicit provenance and no repeated AI cost',async t=>{
 const f=await fixture(t),a=f.copy(),b=f.org.copyDesignToNextMonth(f.manager,a.id,{sourceFingerprint:copySourceFingerprint(f.store.get(a.id,'kpi-design'))});assert.equal(b.period,nextDesignMonth(a.period));assert.equal(b.monthCopy.sourceDesignId,a.id);assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===b.id).alignmentCurrent,true);assert.equal(f.calls,2);
});

test('stale request, forbidden roles, extra fields and edited copied result cannot bypass controls',async t=>{
 const f=await fixture(t),fingerprint=copySourceFingerprint(f.source());assert.throws(()=>f.org.copyDesignToNextMonth(f.hr,f.source().id,{sourceFingerprint:fingerprint}),e=>e.status===403);
 assert.throws(()=>f.org.copyDesignToNextMonth(f.workflow.user('manager-finance'),f.source().id,{sourceFingerprint:fingerprint}),e=>e.status===403);
 assert.throws(()=>f.org.copyDesignToNextMonth(f.manager,f.source().id,{sourceFingerprint:fingerprint,status:'published'}),e=>e.status===400);
 assert.throws(()=>f.org.copyDesignToNextMonth(f.manager,f.source().id,{sourceFingerprint:'0'.repeat(64)}),e=>e.status===409);
 const copied=f.copy();f.store.put('kpi-design',{...copied,aiReview:{...copied.aiReview,result:{...copied.aiReview.result,summary:'tampered synthetic report'}}},copied.employeeId);assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===copied.id).alignmentCurrent,false);assert.throws(()=>f.copy(),e=>e.status===409);assert.equal(f.calls,2);
});

test('unknown AI findings and historical seven-axis mismatch block copying',async t=>{
 const f=await fixture(t,{stage:'manager_review',modelMutate:(result,envelope)=>{if(envelope.stage==='kpi-alignment-v4'){result.reviews[0].recommendation='needs_information';result.reviews[0].missingInformation=['synthetic unknown'];}}});assert.equal(f.availability().allowed,false);assert.throws(()=>f.copy(),e=>e.status===409);
 const source=f.source();f.store.put('kpi-design',{...source,aiReview:{...source.aiReview,contractVersion:'kpi-alignment-v2'}},source.employeeId);assert.equal(f.availability().allowed,false);
});

test('an independent quality failure blocks copying even when no primary blocker is listed',async t=>{
 const f=await fixture(t,{stage:'manager_review'}),source=f.source();source.aiReview.result.correctionQualityFailed=true;source.aiReview.result.humanReviewRequired=false;source.aiReview.result.humanReviewTrigger=null;f.store.put('kpi-design',source,source.employeeId);const before=JSON.stringify(f.store.list('kpi-design'));
 assert.equal(source.aiReview.result.blockers.length,0);assert.equal(f.availability().allowed,false);assert.throws(()=>f.copy(),e=>e.status===409);assert.equal(JSON.stringify(f.store.list('kpi-design')),before);assert.equal(f.calls,2);
});

test('future position, changed policy, locked target or existing target prevent writes',async t=>{
 const f=await fixture(t,{period:'1405-09'}),source=f.source(),target=nextDesignMonth(source.period),before=f.store.list('kpi-design').length,position=f.org.activePosition(source.employeeId);
 const lock=f.store.put('quarter-evaluation',{quarter:'1405-Q4',status:'locked',finalScore:80},source.employeeId);assert.throws(()=>f.copy(),e=>e.status===409);f.store.remove(lock.id,'quarter-evaluation',source.employeeId);
 const policy=f.store.put('evaluation-settings',{status:'published',version:'synthetic-v1',effectiveQuarter:'1405-Q4',unitId:'ops',weights:{exam:15,manager:15,routine:40,project:30,peer:0}});assert.throws(()=>f.copy(),e=>e.status===409);f.store.remove(policy.id,'evaluation-settings',null);
 const future=f.store.put('position-assignment',{...position,id:undefined,version:2,effectiveFrom:periodBounds(target).start},source.employeeId);assert.throws(()=>f.copy(),e=>e.status===409);f.store.remove(future.id,'position-assignment',source.employeeId);
 f.org.saveDesignDraft(f.manager,{employeeId:source.employeeId,period:target,tasks:[task]});assert.throws(()=>f.copy(),e=>e.status===409);assert.equal(f.store.list('kpi-design').length,before+1);assert.equal(f.calls,2);
});

test('project deadlines and milestones move by exact Persian calendar month; impossible days and date-bound text fail closed',()=>{
 const start=periodBounds('1405-07').start,target=periodBounds('1405-08').start,project={id:'T1',category:'project',title:'پروژه ساختگی',description:'تحویل خروجی',criteria:['ثبت خروجی'],deadline:start,milestones:[{name:'تحویل',dueDate:start}]};
 const moved=copyTasksToNextMonth([project],'1405-07');assert.equal(moved.tasks[0].deadline,target);assert.equal(moved.tasks[0].milestones[0].dueDate,target);assert.equal(moved.dateChanges.length,2);assert.equal(project.deadline,start);
 assert.throws(()=>copyTasksToNextMonth([{...task,timeLimit:{dayOfMonth:31,time:'09:00'}}],'1405-06'),/وجود ندارد/);
 assert.throws(()=>copyTasksToNextMonth([{...project,description:'تحویل در ۱۴۰۵/۰۷/۱۳'}],'1405-07'),/تاریخ متن/);
 assert.equal(nextDesignMonth('1405-12'),'1406-01');
});

test('numeric references to the declared deadline move consistently; unrelated dates and attached weekdays cannot be guessed',()=>{
 const day=periodBounds('1405-07').start,project={id:'T1',category:'project',title:'پروژه',description:'خروجی',criteria:['تحویل تا ۱۴۰۵/۰۷/۰۱ مطابق موعد','Delivery 2026-09-23'],deadline:day,milestones:[{name:'تحویل',dueDate:day}]};
 const copied=copyTasksToNextMonth([project],'1405-07');assert.deepEqual(copied.tasks[0].criteria,['تحویل تا ۱۴۰۵/۰۸/۰۱ مطابق موعد','Delivery 2026-10-23']);assert.equal(copied.textChanges.length,2);assert.equal(copied.textChanges[0].field,'criteria.0');assert.equal(project.criteria[0],'تحویل تا ۱۴۰۵/۰۷/۰۱ مطابق موعد');
 assert.throws(()=>copyTasksToNextMonth([{...project,criteria:['سیاست سازمانی ۱۴۰۴/۰۱/۰۱']}],'1405-07'),/متصل نیست/);
 assert.throws(()=>copyTasksToNextMonth([{...project,criteria:['طبق مصوبه ۱۴۰۵/۰۷/۰۱']}],'1405-07'),/سیاست خودکار/);
 assert.throws(()=>copyTasksToNextMonth([{...project,criteria:['چهارشنبه ۱۴۰۵/۰۷/۰۱']}],'1405-07'),/روز هفته/);
});

test('copying with inherited approvals cannot introduce new assignments into a past month',async t=>{
 const f=await fixture(t,{period:'1400-01'}),before=f.store.list('activity').length;assert.equal(f.availability().allowed,false);assert.throws(()=>f.copy(),e=>e.status===409&&/گذشته/.test(e.message));assert.equal(f.store.list('activity').length,before);assert.equal(f.calls,2);
});

test('published copy persists declared deadline text changes and revalidates the inherited proof without a new inference',async t=>{
 const period=currentPeriod(),day=periodBounds(period).start,oldReference=period.replace('-','/')+'/01',f=await fixture(t,{period,tasks:[{category:'project',title:'پروژه ساختگی',description:'تحویل خروجی',criteria:['تحویل تا '+oldReference],weightPoints:3,targetVolume:1,targetUnit:'گزارش',documentFormat:'pdf',deadline:day,milestones:[{name:'تحویل',dueDate:day}]}]}),before=structuredClone(f.source()),copied=f.copy(),newReference=nextDesignMonth(period).replace('-','/')+'/01';
 assert.deepEqual(copied.tasks[0].criteria,['تحویل تا '+newReference]);assert.equal(copied.monthCopy.textChanges.length,1);assert.equal(copied.monthCopy.textChanges[0].dates[0].before,oldReference);assert.equal(copied.monthCopy.textChanges[0].dates[0].after,newReference);assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===copied.id).alignmentCurrent,true);assert.equal(f.store.get(copied.activityIds[0],'activity').criteria[0].text,'تحویل تا '+newReference);assert.deepEqual(f.source(),before);assert.equal(f.calls,2);
});

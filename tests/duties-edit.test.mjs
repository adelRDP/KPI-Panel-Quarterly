import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {roleReply} from './ai-role-fixture.mjs';

test('HR duties correction is atomic, versioned, canonical and invalidates pending analysis without rewriting history',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-duties-edit-')),store=openStore(dir),workflow=createWorkflow(store);let calls=0;
  const org=createOrganizationWorkflow(store,workflow,{aiDesignV2:true,runModel:async request=>{calls++;return roleReply(request);}});
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const hr=workflow.user('hr-demo'),manager=workflow.user('manager-ops'),person=workflow.user('employee-mohammad'),position=org.activePosition(person.id);
  const design=org.submitDesign(manager,{employeeId:person.id,period:workflow.currentPeriod,tasks:[{category:'routine',title:'گزارش آزمایشی',description:'خروجی قابل بررسی',criteria:['ثبت مستند'],weightPoints:3,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'09:30'}}]});
  await org.analyzeDesign(manager,design.id,'codex');assert.equal(calls,2);
  const beforeDesign=store.get(design.id,'kpi-design'),beforeRuns=store.list('ai-role-run'),beforeJob=store.list('job-analysis');
  assert.ok(org.listDesigns(manager).find(d=>d.id===design.id).alignmentCurrent);
  const locked=store.put('quarter-evaluation',{employeeId:person.id,status:'locked',snapshot:{duties:position.duties,positionVersion:position.version},calculation:{performance:80}},person.id);
  const oldActivity=store.list('activity',person.id),oldUsers=store.list('workflow-user');
  for(const actor of [manager,person,null])assert.throws(()=>org.updatePositionDuties(actor,position.id,{duties:'ممنوع',expectedVersion:position.version}),e=>e.status===403);
  for(const input of [{duties:'',expectedVersion:position.version},{duties:'x'.repeat(6001),expectedVersion:position.version},{duties:'اصلاح',expectedVersion:position.version,baseSalary:1}])assert.throws(()=>org.updatePositionDuties(hr,position.id,input));
  const updated=org.updatePositionDuties(hr,position.id,{duties:'شرح وظیفهٔ اصلاح‌شده\nتهیهٔ گزارش با داده‌های معتبر؛ تصمیم مالی با مدیر است.',expectedVersion:position.version});
  assert.equal(updated.version,position.version+1);assert.equal(org.activePosition(person.id).duties,updated.duties);assert.equal(org.positionAt(person.id,position.effectiveFrom).duties,updated.duties);
  const revisions=store.list('position-duties-revision',position.id);assert.equal(revisions.length,1);assert.deepEqual(revisions[0].previous,position);assert.equal(revisions[0].editedBy,hr.id);
  for(const key of ['id','employeeId','managerId','effectiveFrom','effectiveTo','unitId','baseSalary','hasProjects','status'])assert.deepEqual(updated[key],position[key]);
  assert.deepEqual(store.list('workflow-user'),oldUsers);assert.deepEqual(store.list('activity',person.id),oldActivity);assert.deepEqual(store.get(locked.id,'quarter-evaluation'),locked);
  assert.deepEqual(store.get(design.id,'kpi-design'),beforeDesign);assert.deepEqual(store.list('ai-role-run'),beforeRuns);assert.deepEqual(store.list('job-analysis'),beforeJob);
  const stale=org.listDesigns(manager).find(d=>d.id===design.id);assert.equal(stale.alignmentCurrent,false);assert.equal(stale.canReanalyze,true);assert.equal(org.jobAnalysisState(hr,position.id).analysis,null);
  assert.throws(()=>org.managerReviewDesign(manager,design.id,{decision:'approve'}),e=>e.status===409);assert.equal(calls,2);
  assert.throws(()=>org.updatePositionDuties(hr,position.id,{duties:'ویرایش از پنجرهٔ قدیمی',expectedVersion:position.version}),e=>e.status===409);
  org.updatePositionDuties(hr,position.id,{duties:updated.duties,expectedVersion:updated.version});assert.equal(store.list('position-duties-revision',position.id).length,1);
  for(const [status,effectiveFrom,effectiveTo] of [['draft','2020-01-01',null],['published','2099-01-01',null],['published','2010-01-01','2015-01-01']]){
    const other=store.put('position-assignment',{...position,id:undefined,status,effectiveFrom,effectiveTo},person.id);
    assert.throws(()=>org.updatePositionDuties(hr,other.id,{duties:'نامعتبر',expectedVersion:other.version}),e=>e.status===409);
  }
});

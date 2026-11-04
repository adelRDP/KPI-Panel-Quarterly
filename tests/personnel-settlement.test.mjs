import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,periodBounds,quarterOf} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
const previousMonth=p=>{const [y,m]=p.split('-').map(Number);return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`;};
const nextMonth=p=>{const [y,m]=p.split('-').map(Number);return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'kpi-settlement-')),store=openStore(dir),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{runModel:async()=>{throw Error('No live model');}});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {store,workflow,org,hr:workflow.user('hr-demo'),manager:workflow.user('manager-ops')};}
test('settlement is HR-only, date-validated, immutable/idempotent and preserves personnel, pay, positions and locked history',async t=>{
 const {store,workflow,org,hr,manager}=await fixture(t),id='employee-mohammad',person=workflow.user(id),period=workflow.currentPeriod,prior=previousMonth(period),before=workflow.snapshot(hr,id,prior),pastQuarter=quarterOf(previousMonth(previousMonth(previousMonth(period)))),pastQuarterBefore=org.quarterResult(hr,pastQuarter,id),positions=store.list('position-assignment',id),rawPerson=store.get(id,'workflow-user');
 assert.throws(()=>org.settlementPeople(manager),e=>e.status===403);assert.throws(()=>org.registerSettlement(manager,{employeeId:id,settlementDate:today()}),e=>e.status===403);
 assert.throws(()=>org.registerSettlement(hr,{employeeId:id,settlementDate:'2026-02-30'}));assert.throws(()=>org.registerSettlement(hr,{employeeId:id,employeeCode:'wrong',settlementDate:today()}));assert.throws(()=>org.registerSettlement(hr,{employeeId:id,settlementDate:'2019-01-01'}));
 const locked=store.put('quarter-evaluation',{employeeId:id,quarter:quarterOf(period),status:'locked',lockedSnapshot:{employee:{id},quarter:quarterOf(period),calculation:{performance:77},quarterPay:{earned:123}}},id);
 const saved=org.registerSettlement(hr,{employeeId:id,employeeCode:person.employeeCode,settlementDate:today()}),audit=store.list('audit-event').length;
 assert.equal(org.registerSettlement(hr,{employeeId:id,settlementDate:today()}).id,saved.id);assert.equal(store.list('audit-event').length,audit);assert.throws(()=>org.registerSettlement(hr,{employeeId:id,settlementDate:'2030-01-01'}),e=>e.status===409);
 assert.equal(workflow.user(id).isSettled,true);assert.equal(workflow.user(id).isKpiEligible,false);assert.equal(workflow.user(id).role,'personnel');assert.equal(workflow.snapshot(hr,id,period).notApplicable,true);assert.equal(workflow.snapshot(hr,id,period).earned,null);
 assert.deepEqual(workflow.snapshot(hr,id,prior),before);assert.deepEqual(org.quarterResult(hr,pastQuarter,id),pastQuarterBefore);assert.deepEqual(store.get(id,'workflow-user'),rawPerson);assert.deepEqual(store.list('position-assignment',id),positions);assert.deepEqual(store.get(locked.id,'quarter-evaluation'),locked);assert.deepEqual(org.quarterTeam(hr,quarterOf(period)).find(r=>r.employee.id===id).calculation,locked.lockedSnapshot.calculation);
 assert.equal(workflow.team(manager,period).some(r=>r.employee.id===id),false);assert.equal(workflow.team(manager,prior).some(r=>r.employee.id===id),true);assert.equal(org.evaluationModels(hr,period).people.some(p=>p.id===id),false);
 assert.throws(()=>workflow.saveSurvey(manager,{employeeId:id,period:prior,score:80}),e=>e.status===409);assert.throws(()=>workflow.recordExamResult({employeeId:id,period,score:80,reference:'test'}),e=>e.status===409);
 assert.throws(()=>org.saveDesignDraft(manager,{employeeId:id,period,tasks:[]}),e=>e.status===409);assert.throws(()=>org.proposePosition(hr,{employeeId:id}),e=>e.status===409);
 const state=org.settlementPeople(hr);assert.equal(state.settlements[0].status,'effective');assert.ok(state.people.find(p=>p.id===id).settlementDate);assert.ok(state.people.every(p=>!Object.hasOwn(p,'baseSalary')&&!Object.hasOwn(p,'phone')));
});
test('future settlement is scheduled without excluding personnel early and excludes future periods after the cutoff',async t=>{
 const {workflow,org,hr,manager}=await fixture(t),id='employee-mohammad',period=workflow.currentPeriod,next=nextMonth(period),cutoff=periodBounds(next).start;
 org.registerSettlement(hr,{employeeId:id,settlementDate:cutoff});assert.equal(workflow.user(id).isSettled,undefined);assert.equal(workflow.userAt(id,period).isKpiEligible,true);assert.equal(workflow.userAt(id,next).isSettled,true);assert.equal(org.settlementPeople(hr).settlements[0].status,'scheduled');
 assert.equal(workflow.team(manager,period).some(r=>r.employee.id===id),true);assert.equal(workflow.team(manager,next).some(r=>r.employee.id===id),false);assert.throws(()=>org.saveDesignDraft(manager,{employeeId:id,period:next,tasks:[]}),e=>e.status===409);
});
test('settlement refuses active assessment and registration survives workflow bootstrap',async t=>{
 const {store,workflow,org,hr}=await fixture(t),id='employee-mohammad',position=store.list('position-assignment',id)[0],run=store.put('ai-role-run',{positionId:position.id,status:'running'},position.id);
 assert.throws(()=>org.registerSettlement(hr,{employeeId:id,settlementDate:today()}),e=>e.status===409);assert.equal(store.list('personnel-settlement').length,0);
 store.put('ai-role-run',{...run,status:'failed'},position.id);org.registerSettlement(hr,{employeeId:id,settlementDate:today()});const fresh=createWorkflow(store);createOrganizationWorkflow(store,fresh);assert.equal(fresh.user(id).isSettled,true);assert.equal(store.list('personnel-settlement').length,1);
});

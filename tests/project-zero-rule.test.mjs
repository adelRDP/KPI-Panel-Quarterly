import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Model from '../src/performance-model.js';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,quarterOf,quarterMonths} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createEvaluationSettings,policyForPeriod} from '../backend/evaluation-settings.mjs';
import {validateActivity} from '../backend/evaluation.mjs';

test('no-project calculations keep all published weights regardless of legacy exemption or redistribution flags',()=>{
  const weights={exam:10,manager:20,routine:25,project:35,peer:10},scores={exam:100,manager:100,routine:100,project:100,peer:100};
  for(const redistributeProjectWeight of [true,false,undefined])for(const approvedProjectExemption of [true,false]){
    const policy={version:'unit-test',modelType:'unified',weights,redistributeProjectWeight},input={baseSalary:1000000,bonusCeiling:200000,hasProjects:false,approvedProjectExemption,policy,scores},result=Model.calculate(input);
    assert.deepEqual(result.components.map(c=>c.weight),Object.values(weights));assert.equal(result.performance,65);assert.equal(result.earned,130000);assert.equal(result.ceiling,200000);assert.equal(result.complete,true);assert.equal(result.calculationVersion,'fixed-model-project-zero-v1');
    const project=result.components.find(c=>c.id==='project');assert.equal(project.score,0);assert.equal(project.ceiling,70000);assert.equal(project.earned,0);assert.equal(project.applicable,true);assert.equal(project.status,'scored');
    assert.deepEqual(weights,{exam:10,manager:20,routine:25,project:35,peer:10});assert.equal(scores.project,100,'Source scores must not be mutated');
    assert.equal(Model.calculate({...input,scores:{...scores,manager:null}}).performance,null,'Missing scores in other components must remain pending');
    const projectPending=Model.calculate({...input,hasProjects:true,scores:{...scores,project:null}});assert.equal(projectPending.complete,false);assert.equal(projectPending.components.find(c=>c.id==='project').score,null,'Having a project without a score is not equivalent to having no project');
  }
});

test('monthly and quarterly no-project results use zero without inflating weights or reducing the configured cap',()=>{
  const policy={...Model.demoPolicy,redistributeProjectWeight:true},scores={exam:100,manager:100,routine:100,project:null};
  const monthly=Model.calculateMonthly({baseSalary:1000000,policy,scores,hasProjects:false});assert.equal(monthly.performance,60);assert.equal(monthly.earned,120000);assert.equal(monthly.ceiling,200000);
  const quarterly=Model.calculateQuarter({baseSalary:1000000,policy,examScore:100,hasProjects:false,monthlyScores:[{manager:100,routine:100,project:null},{manager:100,routine:100,project:100},{manager:100,routine:100}]});
  assert.equal(quarterly.performance,60);assert.equal(quarterly.earned,360000);assert.equal(quarterly.ceiling,600000);assert.equal(quarterly.components.find(c=>c.id==='project').score,0);assert.deepEqual(quarterly.components.map(c=>c.weight),[15,15,30,40]);
  const onlyProject={version:'only-project',modelType:'unified',weights:{exam:0,manager:0,routine:0,project:100,peer:0}},zero=Model.calculate({baseSalary:1000000,bonusCeiling:200000,policy:onlyProject,hasProjects:false,scores:{}});
  assert.equal(zero.complete,true);assert.equal(zero.performance,0);assert.equal(zero.earned,0);assert.equal(zero.ceiling,200000);
  const noProjectShare={...onlyProject,weights:{exam:0,manager:100,routine:0,project:0,peer:0}},notApplicable=Model.calculate({baseSalary:1000000,bonusCeiling:200000,policy:noProjectShare,hasProjects:false,scores:{manager:80}});
  assert.equal(notApplicable.performance,80);assert.equal(notApplicable.components.find(c=>c.id==='project').status,'not_applicable');
});

test('published policies, draft previews and open quarter payment agree on the fixed project-zero rule without rewriting historical records',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'kpi-project-zero-')),store=openStore(directory),workflow=createWorkflow(store),organization=createOrganizationWorkflow(store,workflow),settings=createEvaluationSettings(store),hr=workflow.user('hr-demo'),employeeId='employee-sara',period=workflow.currentPeriod,quarter=quarterOf(period);
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const weights={exam:15,manager:15,routine:30,project:40,peer:0},draft=settings.saveDraft(hr,{effectiveQuarter:quarter,weights}),preview=settings.preview(hr,draft.id);
  assert.equal(preview.draft.withoutProject,51);assert.deepEqual(preview.draft.terms.withoutProject.map(c=>c.weight),[15,15,30,40]);assert.equal(preview.draft.terms.withoutProject.find(c=>c.id==='project').score,0);
  const published=settings.publish(hr,draft.id),policy=policyForPeriod(store,period,null,'ops');assert.equal(policy.redistributeProjectWeight,false);assert.deepEqual(policy.weights,weights);assert.equal(policy.version,published.version);
  const person=store.get(employeeId,'workflow-user'),position=organization.activePosition(employeeId),publishedBefore=JSON.stringify(store.get(published.id,'evaluation-settings'));
  store.put('workflow-user',{...person,approvedProjectExemption:false});store.put('position-assignment',{...position,hasProjects:false,approvedProjectExemption:false},employeeId);
  const positionBefore=JSON.stringify(store.get(position.id,'position-assignment'));
  store.put('exam-result',{employeeId,period:quarter,score:100,source:'test',reference:'test-project-zero'},employeeId);
  for(const month of quarterMonths(quarter)){
    store.put('manager-survey',{employeeId,period:month,score:100,managerId:person.managerId,source:'test'},employeeId);
    const activity=validateActivity({kind:'routine',title:'test routine',description:'test source',period:month,criteria:['evidence']});store.put('activity',{...activity,ownerId:employeeId,unitId:person.unitId,assignmentStatus:'approved',kpiWeight:1,sampleScore:100,source:'approved-design'},employeeId);
    const monthly=workflow.snapshotForSystem(employeeId,month);assert.equal(monthly.projectExemptionRequired,false);assert.equal(monthly.performance,60);assert.deepEqual(monthly.components.map(c=>c.weight),[15,15,30,40,0]);
  }
  const result=organization.quarterResult(hr,quarter,employeeId);assert.equal(result.calculation.performance,60);assert.equal(result.quarterPay.earned,Math.round(result.quarterPay.ceiling*.6));assert.equal(result.quarterPay.calculationVersion,Model.calculationVersion);assert.equal(result.blockers.some(reason=>/معافیت/.test(reason)),false);
  assert.equal(JSON.stringify(store.get(published.id,'evaluation-settings')),publishedBefore);assert.equal(JSON.stringify(store.get(position.id,'position-assignment')),positionBefore);
  const archived={id:'project-zero-locked-test',employeeId,quarter,status:'locked',lockedSnapshot:{calculation:{performance:88,components:[{id:'project',weight:0,score:null}]},quarterPay:{earned:12345,formulaVersion:'historical'}}};store.put('quarter-evaluation',archived,employeeId);
  const archivedBefore=JSON.stringify(store.get(archived.id,'quarter-evaluation'));organization.quarterResult(hr,quarter,employeeId);assert.equal(JSON.stringify(store.get(archived.id,'quarter-evaluation')),archivedBefore);const historical=organization.quarterTeam(workflow.user(employeeId),quarter)[0];assert.equal(historical.calculation.performance,88);assert.equal(historical.quarterPay.earned,12345,'Personnel must still receive the locked historical result, not a recalculation');
  const allProject=settings.saveDraft(hr,{effectiveQuarter:quarter,unitId:'ops',weights:{exam:0,manager:0,routine:0,project:100,peer:0}});assert.equal(settings.preview(hr,allProject.id).draft.withoutProject,0);
});

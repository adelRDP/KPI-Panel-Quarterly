import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,quarterOf,quarterMonths,periodBounds} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createEvaluationSettings,policyForPeriod} from '../backend/evaluation-settings.mjs';
import {createPanelServer} from '../server.mjs';
import {seedPeerUnitModel} from './unit-model-fixture.mjs';

const defaults={exam:15,manager:15,routine:30,project:40,peer:0};
const noProject={exam:25,manager:25,routine:50,project:0,peer:0};
const managerOnly={exam:0,manager:100,routine:0,project:0,peer:0};
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'kpi-unit-models-')),store=openStore(dir),workflow=createWorkflow(store),organization=createOrganizationWorkflow(store,workflow),settings=createEvaluationSettings(store),hr=workflow.user('hr-demo');
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  return {dir,store,workflow,organization,settings,hr,period:workflow.currentPeriod};
}
const publish=(settings,hr,period,unitId,weights)=>settings.publish(hr,settings.saveDraft(hr,{effectiveQuarter:quarterOf(period),unitId,weights}).id);
const previousMonth=period=>{const [year,month]=period.split('-').map(Number);return month===1?`${year-1}-12`:`${year}-${String(month-1).padStart(2,'0')}`;};

test('every unit falls back to one organization model and legacy person flags cannot choose a service model',async t=>{
  const {store,workflow,organization,settings,hr,period}=await fixture(t);
  assert.equal(store.get('active-services-policy','workflow-policy'),null);
  for(const unit of organization.units(hr))assert.deepEqual(settings.state(hr).defaults.byUnit[unit.id],defaults);
  for(const id of ['employee-mohammad','employee-service-1']){
    const person=store.get(id,'workflow-user'),position=organization.activePosition(id);
    store.put('workflow-user',{...person,modelType:'services'});store.put('position-assignment',{...position,modelType:'services'},id);
    const before=JSON.stringify(store.get(position.id,'position-assignment')),snapshot=workflow.snapshotForSystem(id,period);
    assert.deepEqual(snapshot.policy.weights,defaults);assert.equal(snapshot.policy.scope,'global');assert.equal(snapshot.modelType,'unified');
    assert.equal(Object.hasOwn(snapshot.employee,'modelType'),false);assert.equal(JSON.stringify(store.get(position.id,'position-assignment')),before);
  }
  const global=publish(settings,hr,period,null,noProject);
  for(const person of organization.evaluationModels(hr,period).people){const snapshot=workflow.snapshotForSystem(person.id,period);assert.equal(snapshot.policy.version,global.version);assert.deepEqual(snapshot.policy.weights,noProject);}
  assert.equal(workflow.snapshotForSystem('employee-service-1',period).components.find(c=>c.id==='peer').applicable,false);
  assert.throws(()=>organization.createServiceCampaign(hr,{employeeId:'employee-service-1',period}),/سهم نظرسنجی/);
});

test('dedicated unit policies override newer global publications and future versions do not leak into the current quarter',async t=>{
  const {workflow,organization,settings,hr,period}=await fixture(t),global=publish(settings,hr,period,null,noProject),unit=publish(settings,hr,period,'finance',managerOnly);
  const revised=publish(settings,hr,period,null,{exam:100,manager:0,routine:0,project:0,peer:0});
  for(const person of organization.evaluationModels(hr,period).people)assert.equal(person.policy.version,person.unitId==='finance'?unit.version:revised.version);
  assert.notEqual(global.version,revised.version);
  const [year,q]=quarterOf(period).split('-Q').map(Number),future=`${q===4?year+1:year}-Q${q===4?1:q+1}`,futureMonth=quarterMonths(future)[0];
  const draft=settings.saveDraft(hr,{unitId:'services',effectiveQuarter:future,weights:{exam:0,manager:40,routine:0,project:0,peer:60}}),published=settings.publish(hr,draft.id);
  assert.equal(workflow.snapshotForSystem('employee-service-1',period).policy.version,revised.version);
  assert.equal(workflow.snapshotForSystem('employee-service-1',futureMonth).policy.version,published.version);
  settings.deletePublished(hr,unit.id);assert.equal(workflow.snapshotForSystem('employee-maryam',period).policy.version,revised.version);
});

test('peer survey targets and respondent permissions come from unit weights, not unit names or old person flags',async t=>{
  const {store,workflow,organization,settings,hr,period}=await fixture(t);
  const model=publish(settings,hr,period,'ops',{exam:0,manager:40,routine:0,project:0,peer:60});
  const all=organization.createServiceCampaign(hr,{employeeId:'all',period,minParticipation:30});
  assert.equal(all.createdCount,6);assert.equal(all.campaigns.every(c=>c.unitId==='ops'&&c.policyVersion===model.version),true);
  const campaign=all.campaigns.find(c=>c.employeeId==='employee-mohammad');organization.publishServiceCampaign(hr,campaign.id);
  const respondent=workflow.user('employee-service-1'),target=workflow.user('employee-mohammad');
  assert.equal(organization.serviceCampaigns(respondent).find(c=>c.id===campaign.id).canRespond,true);
  assert.equal(organization.serviceCampaigns(target).find(c=>c.id===campaign.id).canRespond,false);
  assert.throws(()=>organization.submitServiceResponse(workflow.user('manager-ops'),campaign.id,{score:85}),/در دسترس/);
  assert.equal(organization.submitServiceResponse(respondent,campaign.id,{score:85}).saved,true);
  const pending=all.campaigns.find(c=>c.id!==campaign.id);
  publish(settings,hr,period,'ops',noProject);assert.throws(()=>organization.publishServiceCampaign(hr,pending.id),error=>error.status===409&&/سهم نظرسنجی/.test(error.message));
  assert.equal(store.get(pending.id,'service-survey-campaign').status,'draft');
});

test('KPI design allows both categories independently of model shares while manager surveys honor enabled components',async t=>{
  const {store,workflow,organization,settings,hr,period}=await fixture(t),manager=workflow.user('manager-services');
  const task={category:'routine',title:'کنترل ماهانه',description:'ثبت گزارش کنترل ماهانه',criteria:['گزارش ثبت شده باشد'],weight:100,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش'};
  publish(settings,hr,period,'services',noProject);
  const design=organization.submitDesign(manager,{employeeId:'employee-service-1',period,tasks:[task]});assert.equal(design.status,'ai_pending');assert.equal(design.unitId,'services');assert.ok(design.policyVersion);assert.equal(Object.hasOwn(design,'modelType'),false);
  seedPeerUnitModel(store,'services',quarterOf(period));
  // A later numeric publication wins over the dedicated test fixture.
  publish(settings,hr,period,'services',{exam:0,manager:40,routine:0,project:0,peer:60});
  assert.equal(organization.submitDesign(manager,{employeeId:'employee-service-1',period,tasks:[task]}).status,'ai_pending');
  publish(settings,hr,period,'services',{exam:100,manager:0,routine:0,project:0,peer:0});
  assert.throws(()=>workflow.saveSurvey(manager,{employeeId:'employee-service-1',period,score:80}),/نظر مدیر/);
  assert.throws(()=>workflow.submitProposal(manager,{employeeId:'employee-service-1',period,type:'task',category:'routine'}),/سهمی ندارد/);
});

test('no-project onboarding needs no exemption and model changes retain the published weights with a zero project score',async t=>{
  const {store,workflow,organization,settings,hr,period}=await fixture(t);
  const input={name:'نیروی آزمون',unitId:'services',unitName:'خدمات اجرایی',managerId:'manager-services',jobLevel:'کارشناس',jobTitle:'کارشناس',jobFamily:'خدمات',duties:'ثبت گزارش',baseSalary:60000000,hasProjects:false,modelType:'services',effectiveFrom:periodBounds(period).start};
  const created=organization.createPerson(hr,input),model=publish(settings,hr,period,'services',noProject);
  assert.equal(Object.hasOwn(store.get(created.employee.id,'workflow-user'),'modelType'),false);assert.equal(Object.hasOwn(created.position,'modelType'),false);
  assert.equal(created.position.approvedProjectExemption,false);
  createWorkflow(store);assert.equal(store.get(created.employee.id,'workflow-user').approvedProjectExemption,false,'Restart must not automatically grant an HR exemption');
  organization.reviewPosition(workflow.user('manager-services'),created.position.id,{decision:'approve'});organization.approvePosition(hr,created.position.id,{decision:'approve'});
  settings.deletePublished(hr,model.id);
  const snapshot=workflow.snapshotForSystem(created.employee.id,period);assert.equal(snapshot.projectExemptionRequired,false);assert.equal(snapshot.complete,false);
  assert.deepEqual(snapshot.components.map(c=>c.weight),[15,15,30,40,0]);assert.equal(snapshot.components.find(c=>c.id==='project').score,0);
  assert.equal(organization.quarterResult(hr,quarterOf(period),created.employee.id).blockers.some(reason=>/معافیت مصوب/.test(reason)),false);
});

test('registration and transfer forms without a project flag derive it from the destination unit and effective date',async t=>{
  const {store,workflow,organization,settings,hr,period}=await fixture(t),start=periodBounds(period).start;
  const original=JSON.stringify(organization.activePosition('employee-service-1'));
  publish(settings,hr,period,'services',noProject);
  const input={name:'نیروی مدل واحد',unitId:'services',unitName:'خدمات اجرایی',managerId:'manager-services',jobLevel:'کارشناس',jobTitle:'کارشناس',jobFamily:'خدمات',duties:'ثبت گزارش',baseSalary:60000000,effectiveFrom:start};
  const created=organization.createPerson(hr,input);assert.equal(created.position.hasProjects,false);assert.equal(store.get(created.employee.id,'workflow-user').hasProjects,false);
  const [year,quarter]=quarterOf(period).split('-Q').map(Number),nextQuarter=quarter===4?`${year+1}-Q1`:`${year}-Q${quarter+1}`;
  settings.publish(hr,settings.saveDraft(hr,{effectiveQuarter:nextQuarter,unitId:'services',weights:defaults}).id);
  const nextStart=periodBounds(quarterMonths(nextQuarter)[0]).start;
  const future=organization.createPerson(hr,{...input,name:'نیروی فصل آینده',effectiveFrom:nextStart});assert.equal(future.position.hasProjects,true);assert.equal(store.get(future.employee.id,'workflow-user').hasProjects,true);
  const transfer=organization.proposePosition(hr,{...input,employeeId:'employee-service-1',unitId:'ops',unitName:'عملیات',managerId:'manager-ops'});assert.equal(transfer.hasProjects,true,'Destination model must not inherit the old individual false flag');
  const manager=organization.proposePosition(hr,{...input,employeeId:'employee-service-1',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',isManager:true});assert.equal(manager.hasProjects,false);
  organization.reviewPosition(workflow.user('manager-ops'),transfer.id,{decision:'return',reason:'اصلاح شرح وظایف'});
  const revised=organization.revisePosition(hr,transfer.id,{...input,unitId:'services',unitName:'خدمات اجرایی',managerId:'manager-services'});assert.equal(revised.hasProjects,false);
  assert.equal(JSON.stringify(organization.activePosition('employee-service-1')),original,'Existing published results and assignments must remain unchanged');
});

test('month snapshots and model metadata use the employee unit at the selected period, including after a transfer',async t=>{
  const {store,workflow,organization,hr,period}=await fixture(t),id='employee-sara',old=organization.activePosition(id),previous=previousMonth(period),start=periodBounds(period).start;
  store.put('evaluation-settings',{id:'test-ops-model',version:'test-ops-model',status:'published',unitId:'ops',effectiveQuarter:'1400-Q1',weights:managerOnly});
  store.put('evaluation-settings',{id:'test-finance-model',version:'test-finance-model',status:'published',unitId:'finance',effectiveQuarter:'1400-Q1',weights:noProject});
  store.put('position-assignment',{...old,effectiveTo:start},id);
  store.put('position-assignment',{...old,id:'test-transferred-position',unitId:'finance',unitName:'مالی',managerId:'manager-finance',effectiveFrom:start,effectiveTo:null,version:2},id);
  const actor=workflow.user(id),historic=workflow.snapshot(actor,id,previous),system=workflow.snapshotForSystem(id,previous);
  assert.equal(actor.unitId,'finance');assert.equal(historic.employee.unitId,'ops');assert.equal(historic.policy.version,'test-ops-model');assert.deepEqual(historic.policy,system.policy);
  assert.equal(workflow.snapshot(actor,id,period).policy.version,'test-finance-model');
  assert.equal(organization.evaluationModels(hr,previous).people.find(p=>p.id===id).policy.version,'test-ops-model');
  assert.equal(organization.listPositions(hr).find(p=>p.id===old.id).policy.scope,'global','A 2020 position must not read a model effective in Persian year 1400');
});

test('model metadata API preserves self/team/HR scope and contains no compensation or exemption details',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-unit-api-')),server=createPanelServer({dataRoot:dir});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,request=(session,path,method='GET',data)=>fetch(base+path,{method,headers:{'X-Panel-Token':session.token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const initial=await(await fetch(base+'/api/session')).json(),path='/api/org/evaluation-models?period='+initial.period;
  assert.equal((await fetch(base+path)).status,403);
  for(const [id,count,unit] of [['employee-service-1',1,'services'],['manager-finance',4,'finance'],['hr-demo',15,null]]){
    const fresh=await(await fetch(base+'/api/session')).json(),session=await(await request(fresh,'/api/session','POST',{userId:id})).json(),response=await request(session,path);assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.people.length,count);if(unit)assert.ok(data.people.every(person=>person.unitId===unit));
    assert.equal(Object.hasOwn(data,'byUnit'),id==='hr-demo');
    for(const person of data.people){for(const field of ['baseSalary','bonusCeiling','approvedProjectExemption','projectExemptionRef','modelType'])assert.equal(Object.hasOwn(person,field),false);assert.equal(person.policy.scope,'global');}
    assert.equal((await request(session,'/api/org/evaluation-models?period=invalid')).status,400);
  }
});

test('a global model with peer weight supports cross-unit surveys even when all respondents also have peer weight',async t=>{
  const {workflow,organization,settings,hr,period}=await fixture(t);
  publish(settings,hr,period,null,{exam:0,manager:40,routine:0,project:0,peer:60});
  const all=organization.createServiceCampaign(hr,{employeeId:'all',period});assert.equal(all.createdCount,15);
  const target=all.campaigns.find(c=>c.employeeId==='employee-mohammad'),respondent=workflow.user('employee-service-1');
  const campaign=organization.publishServiceCampaign(hr,target.id);assert.ok(campaign.population>=3);
  assert.equal(organization.serviceCampaigns(respondent).find(c=>c.id===campaign.id).canRespond,true);
  assert.throws(()=>organization.submitServiceResponse(workflow.user('employee-sara'),campaign.id,{score:80}),/در دسترس/);
  assert.equal(organization.submitServiceResponse(respondent,campaign.id,{score:80}).saved,true);
});

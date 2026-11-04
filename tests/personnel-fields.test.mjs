import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createPanelServer} from '../server.mjs';

test('personnel creation and charts no longer use email, while historical records remain intact',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-personnel-fields-')),store=openStore(dir);
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const workflow=createWorkflow(store),organization=createOrganizationWorkflow(store,workflow),hr=workflow.user('hr-demo');
  assert.equal(store.list('workflow-user').some(person=>Object.hasOwn(person,'email')),false);
  const old=store.get('employee-mohammad','workflow-user');
  store.put('workflow-user',{...old,email:'legacy@example.org'});
  for(const actor of [hr,workflow.user('manager-ops'),workflow.user(old.id)]){
    assert.equal(organization.chart(actor).people.some(person=>Object.hasOwn(person,'email')),false);
  }
  assert.equal(store.get(old.id,'workflow-user').email,'legacy@example.org');
  const result=organization.createPerson(hr,{name:'بدون ایمیل',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',baseSalary:60000000,jobLevel:'کارشناس',jobTitle:'کارشناس',jobFamily:'عملیات',duties:'پیگیری عملیات',hasProjects:true,phone:'09123456789',employeeCode:'NO-EMAIL-1',email:'ignored invalid legacy field'});
  const created=store.get(result.employee.id,'workflow-user');
  assert.equal(Object.hasOwn(created,'email'),false);
  assert.equal(created.phone,'09123456789');
  assert.equal(typeof organization.createServiceCampaign,'function');
  assert.equal(organization.submitExperienceSurvey,undefined);
  assert.equal(organization.experienceSurveySummary,undefined);
});

test('sessions exclude legacy email and removed experience endpoints return 404 without deleting history',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-removed-experience-'));
  const seed=openStore(dir);createWorkflow(seed);
  for(const person of seed.list('workflow-user'))seed.put('workflow-user',{...person,email:'legacy@example.org'});
  const historical=seed.put('experience-survey-response',{period:'1405-07',clarity:85,reason:'historical record'});
  seed.close();
  const server=createPanelServer({dataRoot:dir});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const session=await (await fetch(base+'/api/session')).json();
  assert.equal(Object.hasOwn(session.user,'email'),false);
  assert.equal(session.accounts.some(person=>Object.hasOwn(person,'email')),false);
  const headers={'Content-Type':'application/json','X-Panel-Token':session.token,Origin:base};
  assert.equal((await fetch(base+'/api/org/surveys/experience',{method:'POST',headers,body:JSON.stringify({period:'1405-07',clarity:80})})).status,404);
  const hr=await (await fetch(base+'/api/session',{method:'POST',headers,body:JSON.stringify({userId:'hr-demo'})})).json();
  const hrHeaders={'X-Panel-Token':hr.token,Origin:base};
  assert.equal(Object.hasOwn(hr.user,'email'),false);
  const chart=await (await fetch(base+'/api/org/chart',{headers:hrHeaders})).json();
  assert.equal(chart.people.some(person=>Object.hasOwn(person,'email')),false);
  assert.equal((await fetch(base+'/api/org/surveys/experience/1405-07',{headers:hrHeaders})).status,404);
  const check=openStore(dir);
  try{assert.equal(check.get(historical.id,'experience-survey-response').clarity,85);assert.equal(check.list('experience-survey-response').length,1);}
  finally{check.close();}
});

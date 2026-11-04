import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createIncomingArchive} from '../backend/incoming-archive.mjs';
import {createPanelServer} from '../server.mjs';

async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'kpi-incoming-archive-')),store=openStore(dir),workflow=createWorkflow(store),archive=createIncomingArchive(store,workflow),hr=workflow.user('hr-demo');t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {dir,store,workflow,archive,hr};}
function approved(store,type,id,at='2026-10-04T10:00:00Z'){
  const kinds={position:'position-assignment',design:'kpi-design',quarter:'quarter-evaluation',appeal:'quarter-appeal'},actions={position:'position.published',design:'kpi-design.published',quarter:'quarter.locked',appeal:'quarter.appeal-hr-review'};
  const record=store.put(kinds[type],{id,employeeId:'employee-mohammad',status:type==='quarter'?'locked':type==='appeal'?'approved':'published',period:'1405-07',quarter:'1405-Q3',effectiveFrom:'2026-09-23',jobTitle:'سمت آزمایشی',version:2,tasks:[{id:'T1',title:'شاخص آزمایشی'}],duties:'متن کامل',reason:'دلیل کامل',events:[],secret:'DO_NOT_LEAK'},'employee-mohammad');
  store.put('audit-event',{action:actions[type],entityType:kinds[type],entityId:id,actorId:'hr-demo',createdAt:at,details:type==='appeal'?{decision:'approve'}:{}});return record;
}
test('archive indexes only final approval audits, all request types and latest approval once, without copying records',async t=>{
  const {store,archive,hr}=await fixture(t);assert.equal(archive.list(hr).total,0);
  for(const type of ['position','design','quarter','appeal'])approved(store,type,'archive-'+type);
  store.put('kpi-design',{id:'not-approved',employeeId:'employee-mohammad',status:'hr_review',tasks:[]});store.put('audit-event',{action:'kpi-design.manager-review',entityType:'kpi-design',entityId:'not-approved',actorId:'manager-ops',createdAt:'2026-10-04T11:00:00Z',details:{decision:'approve'}});
  store.put('quarter-appeal',{id:'rejected',status:'rejected',employeeId:'employee-mohammad'});store.put('audit-event',{action:'quarter.appeal-hr-review',entityType:'quarter-appeal',entityId:'rejected',createdAt:'2026-10-04T11:00:00Z',details:{decision:'reject'}});
  store.put('audit-event',{action:'kpi-design.published',entityType:'kpi-design',entityId:'archive-design',actorId:'hr-demo',createdAt:'2026-10-04T12:00:00Z',details:{}});
  const before=store.list('audit-event');const result=archive.list(hr);assert.equal(result.total,4);assert.equal(result.items[0].id,'archive-design');assert.equal(result.items[0].approvedAt,'2026-10-04T12:00:00Z');assert.equal(result.items[0].taskCount,1);assert.ok(result.items.every(row=>!('record' in row)));assert.equal(JSON.stringify(result).includes('DO_NOT_LEAK'),false);assert.deepEqual(store.list('audit-event'),before);
  assert.equal(archive.detail(hr,'design','archive-design').record.secret,undefined);assert.equal(archive.detail(hr,'design','archive-design').record.tasks[0].title,'شاخص آزمایشی');assert.throws(()=>archive.detail(hr,'design','not-approved'),error=>error.status===404);assert.throws(()=>archive.detail(hr,'appeal','rejected'),error=>error.status===404);
});
test('archive filters and paginates independently of the selected period and retains removed historical approvals',async t=>{
  const {store,workflow,archive,hr}=await fixture(t);for(let i=0;i<31;i++)approved(store,'design','design-'+i);
  assert.equal(archive.list(hr).items.length,25);assert.equal(archive.list(hr,{page:2}).items.length,6);assert.equal(archive.list(hr,{page:999}).page,2);assert.equal(archive.list(hr,{type:'position'}).total,0);
  assert.equal(archive.list(hr,{search:workflow.user('employee-mohammad').employeeCode.replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)])}).total,31);assert.equal(archive.list(hr,{search:'1405-07'}).total,31);assert.equal(archive.list(hr,{search:'نامی که وجود ندارد'}).total,0);
  const row=store.get('design-0','kpi-design');store.put('kpi-design',{...row,removedAt:'2026-10-04T13:00:00Z'},row.employeeId);assert.equal(archive.detail(hr,'design','design-0').removed,true);assert.equal(archive.list(hr).total,31);
  for(const query of [{type:'__proto__'},{page:0},{page:'abc'},{search:'x'.repeat(161)}])assert.throws(()=>archive.list(hr,query),error=>error.status===400);
});
test('archive list and detail enforce admin permissions and persist across a fresh service instance',async t=>{
  const {store,workflow,archive,hr}=await fixture(t);approved(store,'design','approved');for(const actor of [workflow.user('employee-mohammad'),workflow.user('manager-ops'),null]){assert.throws(()=>archive.list(actor),error=>error.status===403);assert.throws(()=>archive.detail(actor,'design','approved'),error=>error.status===403);}
  assert.equal(createIncomingArchive(store,workflow).detail(hr,'design','approved').id,'approved');assert.throws(()=>archive.detail(hr,'__proto__','approved'),error=>error.status===404);
});
test('archive HTTP routes are authenticated and read-only',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-incoming-http-')),server=createPanelServer({dataRoot:join(dir,'db'),runModel:()=>{throw new Error('No model expected');}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port;
  const store=openStore(join(dir,'db'));approved(store,'design','approved-http');store.close();
  assert.equal((await fetch(base+'/api/org/incoming/archive')).status,403);
  let initial=await(await fetch(base+'/api/session')).json();
  for(const userId of ['hr-demo','manager-ops','employee-mohammad']){
    const session=await(await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json','x-panel-token':initial.token},body:JSON.stringify({userId})})).json(),headers={'x-panel-token':session.token};
    assert.ok(session.token);initial=session;
    for(const path of ['/api/org/incoming/archive','/api/org/incoming/archive/design/approved-http'])assert.equal((await fetch(base+path,{headers})).status,userId==='hr-demo'?200:403);
    assert.equal((await fetch(base+'/api/org/incoming/archive',{method:'POST',headers})).status,404);
  }
});

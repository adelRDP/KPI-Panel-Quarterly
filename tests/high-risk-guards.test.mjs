import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,quarterMonths} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createPanelServer} from '../server.mjs';
import {validateActivity} from '../backend/evaluation.mjs';
import {roleReply} from './ai-role-fixture.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {assertActivityHumanWritable} from '../backend/activity-human-review.mjs';
import {copySourceFingerprint} from '../backend/design-month-copy.mjs';

const designTask={category:'routine',title:'شاخص ساختگی',description:'ثبت خروجی ساختگی',criteria:['خروجی ثبت شود'],weightPoints:3,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'09:00'}};
const designInput=(f,period)=>({employeeId:f.id,period,tasks:[designTask]});

async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'kpi-high-risk-')),store=openStore(dir),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{runModel:roleReply}),f={dir,store,workflow,org,hr:workflow.user('hr-demo'),manager:workflow.user('manager-ops'),id:'employee-mohammad'};t.after(async()=>{await f.stopServer?.();store.close();await rm(dir,{recursive:true,force:true});});return f;}
const personInput={role:'personnel',name:'کارشناس ساختگی کنترل دسترسی',employeeCode:'QA-PRIVATE',unitId:'ops',unitName:'عملیات',jobFamily:'عملیات',jobTitle:'کارشناس ساختگی',jobLevel:'کارشناس',managerId:'manager-ops',baseSalary:65432109,duties:'شرح مستقل ساختگی',effectiveFrom:'2026-10-01'};
async function http(t,f){const server=createPanelServer({dataRoot:f.dir,autoAssessment:false,runModel:roleReply});server.listen(0,'127.0.0.1');await once(server,'listening');f.stopServer=async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));};const base='http://127.0.0.1:'+server.address().port;return async id=>{let token=(await fetch(base+'/api/session').then(r=>r.json())).token;const request=async(path,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'x-panel-token':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(data.token)token=data.token;return {status:r.status,data};};assert.equal((await request('/api/session',{userId:id})).status,200);return request;};}

test('stage1 manager legacy lists and review decisions never disclose pay, preserve HR data and unit scope',async t=>{
 const f=await fixture(t),login=await http(t,f),hr=await login('hr-demo'),manager=await login('manager-ops'),other=await login('manager-finance'),owner=await login(f.id);
 for(const decision of ['approve','return']){const created=await hr('/api/org/people',{...personInput,employeeCode:'QA-PRIVATE-'+decision}),position=created.data.position;assert.equal(created.status,201);f.store.put('position-assignment',{...position,payrollSnapshot:{salary:65432109},bankAccount:'PRIVATE-BANK'},created.data.employee.id);
  const legacy=await manager('/api/org/positions/review'),row=legacy.data.find(r=>r.id===position.id);assert.ok(row);const response=await manager(`/api/org/positions/${position.id}/review`,{decision,reason:'توضیح بررسی ساختگی'});assert.equal(response.status,200);
  for(const data of [row,response.data,(await manager('/api/org/personnel-requests')).data.positions.find(r=>r.id===position.id)]){assert.equal(data.id,position.id);for(const key of ['baseSalary','bonusCeiling','payrollSnapshot','bankAccount'])assert.equal(Object.hasOwn(data,key),false,key);assert.ok(!JSON.stringify(data).includes('65432109'));}
  assert.equal(f.store.get(position.id,'position-assignment').baseSalary,65432109);assert.equal((await hr('/api/org/positions')).data.find(r=>r.id===position.id).baseSalary,65432109);
  assert.equal((await other('/api/org/positions/review')).data.some(r=>r.id===position.id),false);assert.equal((await owner('/api/org/positions/review')).status,403);
 }
});

function completeQuarter(f){const [y,m]=f.workflow.currentPeriod.split('-').map(Number),q=Math.ceil(m/3),quarter=q===1?`${y-1}-Q4`:`${y}-Q${q-1}`;f.store.put('exam-result',{employeeId:f.id,period:quarter,score:100,reference:'qa-import',source:'import'},f.id);for(const period of quarterMonths(quarter)){f.store.put('manager-survey',{employeeId:f.id,period,score:100,managerId:f.manager.id},f.id);for(const kind of ['routine','project'])f.store.put('activity',{...validateActivity({kind,title:'Synthetic '+kind,description:'Synthetic evidence',period,criteria:['Output']}),ownerId:f.id,unitId:'ops',assignmentStatus:'approved',kpiWeight:1,sampleScore:100,source:'test'},f.id);}return quarter;}

test('stage2 a locked quarter cannot be resubmitted or finalized twice and pending retries stay idempotent',async t=>{
 const f=await fixture(t),quarter=completeQuarter(f),login=await http(t,f),hr=await login('hr-demo'),manager=await login('manager-ops');const route=`/api/org/quarters/${quarter}/employees/${f.id}/submit`,sent=await manager(route,{});assert.equal(sent.status,201);assert.equal((await manager(route,{})).data.id,sent.data.id);
 const locked=await hr(`/api/org/evaluations/${sent.data.id}/approval`,{decision:'approve'});assert.equal(locked.status,200);const before=JSON.stringify(f.store.list('quarter-evaluation',f.id));assert.equal((await manager(route,{})).status,409);assert.equal((await hr(`/api/org/evaluations/${sent.data.id}/approval`,{decision:'approve'})).status,409);assert.equal(JSON.stringify(f.store.list('quarter-evaluation',f.id)),before);assert.equal(f.store.list('quarter-evaluation',f.id).filter(x=>x.status==='locked').length,1);
 const file=f.org.finalExcel(f.hr,quarter),sheet=strFromU8(unzipSync(file.data)['xl/worksheets/sheet1.xml']);assert.equal((sheet.match(new RegExp(f.id,'g'))||[]).length,1);
});

test('stage2 stale parallel approvals and historical duplicate exports fail safely without rewriting records',async t=>{
 const f=await fixture(t),quarter=completeQuarter(f),sent=f.org.submitQuarter(f.manager,quarter,f.id),rival=f.store.put('quarter-evaluation',{...sent,id:'qa-pending-rival'},f.id),locked=f.org.approveQuarter(f.hr,sent.id,{decision:'approve'}),before=JSON.stringify(f.store.list('quarter-evaluation',f.id));assert.throws(()=>f.org.approveQuarter(f.hr,rival.id,{decision:'approve'}),e=>e.status===409);assert.equal(JSON.stringify(f.store.list('quarter-evaluation',f.id)),before);
 f.store.put('quarter-evaluation',{...locked,id:'qa-legacy-conflicting-lock',lockedSnapshot:{...locked.lockedSnapshot,quarterPay:{...locked.lockedSnapshot.quarterPay,earned:1}}},f.id);const duplicates=JSON.stringify(f.store.list('quarter-evaluation',f.id));assert.throws(()=>f.org.finalExcel(f.hr,quarter),e=>e.status===409);assert.equal(JSON.stringify(f.store.list('quarter-evaluation',f.id)),duplicates);
});

test('stage2 final approval rolls back if audit notification delivery fails',async t=>{
 const f=await fixture(t),quarter=completeQuarter(f),sent=f.org.submitQuarter(f.manager,quarter,f.id),before=JSON.stringify(f.store.get(sent.id,'quarter-evaluation')),org=createOrganizationWorkflow(f.store,f.workflow,{notifications:{fromAudit(){throw Error('Synthetic audit failure');}}});assert.throws(()=>org.approveQuarter(f.hr,sent.id,{decision:'approve'}),/Synthetic audit failure/);assert.equal(JSON.stringify(f.store.get(sent.id,'quarter-evaluation')),before);assert.equal(f.store.list('quarter-evaluation',f.id).some(x=>x.status==='locked'),false);
});

test('stage3 locking freezes design writes, evidence writes and bootstrap consolidation but preserves reads and open periods',async t=>{
 const f=await fixture(t),quarter=completeQuarter(f),period=quarterMonths(quarter)[0],draft=f.org.saveDesignDraft(f.manager,designInput(f,period)),pending=f.org.submitDesign(f.manager,designInput(f,period));
 const analyzed=await f.org.analyzeDesign(f.manager,pending.id);f.org.managerReviewDesign(f.manager,pending.id,{decision:'approve'});const published=f.org.hrReviewDesign(f.hr,pending.id,{decision:'approve'});
 for(const id of published.activityIds){const a=f.store.get(id,'activity');f.store.put('activity',{...a,sampleScore:100},f.id);}
 const managerPending=f.store.put('kpi-design',{...analyzed,id:'qa-manager-pending'},f.id),hrPending=f.store.put('kpi-design',{...f.store.get(published.id,'kpi-design'),id:'qa-hr-pending',status:'hr_review'},f.id);
 f.store.put('kpi-design',{...draft,id:'qa-extra-draft'},f.id);
 const sent=f.org.submitQuarter(f.manager,quarter,f.id);f.org.approveQuarter(f.hr,sent.id,{decision:'approve'});const before=JSON.stringify(f.store.list('kpi-design')),snapshot=JSON.stringify(f.workflow.snapshotForSystem(f.id,period)),locked=JSON.stringify(f.store.list('quarter-evaluation',f.id));
 const attempts=[()=>f.org.saveDesignDraft(f.manager,designInput(f,period)),()=>f.org.saveDesignDraft(f.manager,designInput(f,period),draft.id),()=>f.org.submitDesign(f.manager,designInput(f,period)),()=>f.org.removeDesign(f.manager,published.id),()=>f.org.managerReviewDesign(f.manager,managerPending.id,{decision:'return',reason:'اصلاح ساختگی'}),()=>f.org.hrReviewDesign(f.hr,hrPending.id,{decision:'return',reason:'اصلاح ساختگی'}),()=>assertActivityHumanWritable(f.store,f.store.get(published.activityIds[0],'activity'))];
 for(const attempt of attempts)assert.throws(attempt,e=>e.status===409);
 await assert.rejects(f.org.publishDesignDraft(f.manager,draft.id),e=>e.status===409);await assert.rejects(f.org.analyzeDesign(f.manager,managerPending.id),e=>e.status===409);
 assert.equal(f.org.consolidateDesignDrafts().merged,0);assert.equal(JSON.stringify(f.store.list('kpi-design')),before);assert.equal(JSON.stringify(f.workflow.snapshotForSystem(f.id,period)),snapshot);assert.equal(JSON.stringify(f.store.list('quarter-evaluation',f.id)),locked);assert.ok(f.org.listDesigns(f.manager).some(d=>d.id===published.id));assert.ok(f.org.saveDesignDraft(f.manager,designInput(f,f.workflow.currentPeriod)).id);
});

test('stage3 a quarter locked during model work rejects late results without applying them',async t=>{
 const f=await fixture(t),quarter=completeQuarter(f),period=quarterMonths(quarter)[0];let release,entered;const start=new Promise(r=>entered=r),gate=new Promise(r=>release=r),org=createOrganizationWorkflow(f.store,f.workflow,{runModel:async input=>{entered();await gate;return roleReply(input);}}),d=org.submitDesign(f.manager,designInput(f,period)),running=org.analyzeDesign(f.manager,d.id);await start;
 const sent=f.org.submitQuarter(f.manager,quarter,f.id),lock=f.org.approveQuarter(f.hr,sent.id,{decision:'approve'}),activities=JSON.stringify(f.store.list('activity'));release();await assert.rejects(running);assert.equal(JSON.stringify(f.store.list('activity')),activities);assert.deepEqual(f.store.get(lock.id,'quarter-evaluation'),lock);assert.notEqual(f.store.get(d.id,'kpi-design').status,'manager_review');
});

test('stage3 locked activity HTTP mutations fail before writes, while history remains readable',async t=>{
 const f=await fixture(t),quarter=completeQuarter(f),period=quarterMonths(quarter)[0],a=f.store.list('activity').find(a=>a.ownerId===f.id&&a.period===period),sent=f.org.submitQuarter(f.manager,quarter,f.id);f.org.approveQuarter(f.hr,sent.id,{decision:'approve'});
 // Reconstruct a historical attachment only in the synthetic test store.
 const doc=f.store.put('document',{name:'qa.txt',sha256:'qa-hash',extraction:{status:'done',text:'QA'}},a.id);
 const login=await http(t,f),owner=await login(f.id),before=JSON.stringify(f.store.list('document',a.id));assert.equal((await owner(`/api/activities/${a.id}?summary=1`)).status,200);
 for(const path of [`/api/activities/${a.id}/documents?name=qa.txt`,`/api/activities/${a.id}/reviews`])assert.equal((await owner(path,{})).status,409);
 // Use a separate token to exercise DELETE rather than a synthetic direct function call.
 const server=createPanelServer({dataRoot:f.dir,autoAssessment:false,runModel:roleReply});server.listen(0,'127.0.0.1');await once(server,'listening');try{const base='http://127.0.0.1:'+server.address().port,initial=await fetch(base+'/api/session').then(r=>r.json()),session=await fetch(base+'/api/session',{method:'POST',headers:{'x-panel-token':initial.token,'Content-Type':'application/json'},body:JSON.stringify({userId:f.id})}).then(r=>r.json()),r=await fetch(base+`/api/activities/${a.id}/documents/${doc.id}`,{method:'DELETE',headers:{'x-panel-token':session.token}});assert.equal(r.status,409);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 assert.equal(JSON.stringify(f.store.list('document',a.id)),before);assert.equal(f.store.list('review',a.id).length,0);
 assert.throws(()=>f.workflow.submitProposal(f.manager,{employeeId:f.id,period,type:'task',category:'routine',title:'شاخص ساختگی',description:'توضیح ساختگی',criteria:'خروجی'}),e=>e.status===409);
});

test('stage4 only an authorized same-unit manager can be a new supervisor, with atomic rejection',async t=>{
 const f=await fixture(t),before=JSON.stringify([f.store.list('workflow-user'),f.store.list('position-assignment'),f.store.list('audit-event')]);
 for(const managerId of [f.id,'manager-finance']){
  assert.throws(()=>f.org.createPerson(f.hr,{...personInput,managerId}),e=>e.status===400);
  assert.throws(()=>f.org.proposePosition(f.hr,{...personInput,employeeId:f.id,managerId}),e=>e.status===400);
  assert.equal(JSON.stringify([f.store.list('workflow-user'),f.store.list('position-assignment'),f.store.list('audit-event')]),before);
 }
 const created=f.org.createPerson(f.hr,{...personInput,effectiveFrom:'2020-01-01'});f.org.reviewPosition(f.manager,created.position.id,{decision:'approve'});const approved=f.org.approvePosition(f.hr,created.position.id,{decision:'approve'});assert.equal(approved.managerId,f.manager.id);assert.equal(f.workflow.user(created.employee.id).managerId,f.manager.id);
 const s=f.workflow.saveSurvey(f.manager,{employeeId:created.employee.id,period:f.workflow.currentPeriod,score:85,note:'نظر ساختگی مدیر'});assert.equal(s.managerId,f.manager.id);
});

test('stage4 old invalid supervisor proposals can be returned but cannot be approved; published history is untouched',async t=>{
 const f=await fixture(t),created=f.org.createPerson(f.hr,{...personInput,effectiveFrom:'2020-01-01'}),invalid=f.store.put('position-assignment',{...created.position,managerId:f.id},created.employee.id),historical=f.org.activePosition(f.id),old=f.store.put('position-assignment',{...historical,managerId:'employee-maryam'},f.id),before=JSON.stringify(old);
 assert.throws(()=>f.org.reviewPosition(f.manager,invalid.id,{decision:'approve'}),e=>e.status===409);assert.equal(f.store.get(invalid.id,'position-assignment').status,'manager_review');
 f.store.put('position-assignment',{...invalid,status:'hr_approval'},invalid.employeeId);assert.throws(()=>f.org.approvePosition(f.hr,invalid.id,{decision:'approve'}),e=>e.status===409);assert.equal(f.store.get(invalid.id,'position-assignment').status,'hr_approval');
 const returned=f.org.approvePosition(f.hr,invalid.id,{decision:'return',reason:'اصلاح مافوق ساختگی'}),revised=f.org.revisePosition(f.hr,returned.id,{...personInput,effectiveFrom:'2020-01-01'});assert.equal(revised.managerId,f.manager.id);assert.equal(JSON.stringify(f.store.get(old.id,'position-assignment')),before);
});

test('stage3 lock during a streamed upload is rechecked before persisting the attachment',async t=>{
 const f=await fixture(t),quarter=completeQuarter(f),a=f.store.list('activity').find(a=>a.ownerId===f.id&&a.period===quarterMonths(quarter)[0]),server=createPanelServer({dataRoot:f.dir,autoAssessment:false,runModel:roleReply});server.listen(0,'127.0.0.1');await once(server,'listening');f.stopServer=async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));};const base='http://127.0.0.1:'+server.address().port,session=await fetch(base+'/api/session').then(r=>r.json()),owner=await fetch(base+'/api/session',{method:'POST',headers:{'x-panel-token':session.token,'Content-Type':'application/json'},body:JSON.stringify({userId:f.id})}).then(r=>r.json());
 let upload;const response=new Promise((resolve,reject)=>{upload=httpRequest(base+`/api/activities/${a.id}/documents?name=qa.txt&deferReview=1`,{method:'POST',headers:{'x-panel-token':owner.token,'Content-Type':'text/plain'}},r=>{let text='';r.on('data',s=>text+=s);r.on('end',()=>resolve({status:r.statusCode,data:JSON.parse(text)}));});upload.on('error',reject);upload.write('Synthetic partial upload');});
 for(let i=0;i<100&&!f.store.list('activity-history',a.id).length;i++)await new Promise(r=>setTimeout(r,10));assert.ok(f.store.list('activity-history',a.id).length);
 const sent=f.org.submitQuarter(f.manager,quarter,f.id),locked=f.org.approveQuarter(f.hr,sent.id,{decision:'approve'});upload.end(' completed');const r=await response;assert.equal(r.status,409);assert.equal(f.store.list('document',a.id).length,0);assert.deepEqual(f.store.get(locked.id,'quarter-evaluation'),locked);
});

test('stage3 a historical locked source can still be copied to an open future quarter without rewriting the source',async t=>{
 const f=await fixture(t),[year,month]=f.workflow.currentPeriod.split('-').map(Number),q=Math.ceil(month/3),period=`${year}-${String(q*3).padStart(2,'0')}`,quarter=`${year}-Q${q}`,d=f.org.submitDesign(f.manager,designInput(f,period));await f.org.analyzeDesign(f.manager,d.id);f.org.managerReviewDesign(f.manager,d.id,{decision:'approve'});const source=f.org.hrReviewDesign(f.hr,d.id,{decision:'approve'});
 f.store.put('quarter-evaluation',{employeeId:f.id,quarter,status:'locked'},f.id);const copied=f.org.copyDesignToNextMonth(f.manager,d.id,{sourceFingerprint:copySourceFingerprint(source)});assert.equal(copied.status,'published');assert.notEqual(copied.period,source.period);assert.deepEqual(f.store.get(d.id,'kpi-design'),source);assert.notDeepEqual(copied.activityIds,source.activityIds);
});

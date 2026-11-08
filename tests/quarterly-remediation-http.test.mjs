import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,periodBounds} from '../backend/quarterly-workflow.mjs';
import {createPanelServer} from '../server.mjs';

test('new remediation HTTP routes enforce owner, direct-manager, admin and version boundaries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'kpi-remediation-http-')),dataRoot=join(root,'db'),fixture=seedQuarterlyFixture(dataRoot),store=openStore(dataRoot),w=createWorkflow(store),q=fixture.period,bounds=periodBounds(q),due=new Date(Date.parse(bounds.end+'T12:00:00Z')-4*86400000).toISOString().slice(0,10),extended=new Date(Date.parse(bounds.end+'T12:00:00Z')-2*86400000).toISOString().slice(0,10);
 const activity=store.put('activity',{ownerId:'employee-0',positionId:'position-employee-0',unitId:'u',period:q,assignmentStatus:'approved',kind:'routine',title:'Synthetic',description:'Synthetic report',criteria:[],dueDate:due},'employee-0'),exam=w.recordExamResult({employeeId:'employee-0',period:q,score:10,reference:'synthetic'}),server=createPanelServer({dataRoot,uploadRoot:join(root,'uploads'),demoLogin:false,autoAssessment:false,runModel:()=>{throw Error('No live AI');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,tokens={};
 const call=async(actor,path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(tokens[actor]?{'x-panel-token':tokens[actor]}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 try{
  for(const id of ['admin','manager','other-manager','employee-0','employee-1']){const first=await call(null,'/api/session');tokens[id]=first.data.token;if(id!=='admin')tokens[id]=(await call(id,'/api/session',{userId:id})).data.token;}
  assert.equal((await call(null,'/api/review-cases')).status,403);
  const input={type:'extension',activityId:activity.id,dueDate:extended,category:'outage',reason:'قطعی مستند سامانه کاری'};
  assert.equal((await call('employee-1','/api/review-cases',input)).status,403);assert.equal((await call('manager','/api/review-cases',input)).status,403);
  const created=await call('employee-0','/api/review-cases',input);assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await call('other-manager','/api/review-cases')).data.length,0);
  assert.equal((await call('admin','/api/review-cases/'+id+'/decision',{revision:1,decision:'approve',reason:'تأیید زودهنگام'})).status,403);
  assert.equal((await call('manager','/api/review-cases/'+id+'/decision',{revision:1,decision:'approve',reason:'تأیید قطعی مستند'})).status,200);
  assert.ok((await call('admin','/api/notifications')).data.incomingRequestCount>=1);assert.ok((await call('admin','/api/approval-deadlines')).data.some(r=>r.entityId===id&&r.stage==='hr_review'&&r.days===7));
  assert.equal((await call('admin','/api/review-cases/'+id+'/decision',{revision:1,decision:'approve',reason:'نسخه قدیمی درخواست'})).status,409);
  assert.equal((await call('admin','/api/review-cases/'+id+'/decision',{revision:2,decision:'approve',reason:'تصویب تمدید مستند'})).status,200);
  const detail=await call('employee-0','/api/activities/'+activity.id+'?summary=1');assert.equal(detail.data.deadlineExtension.dueDate,extended);assert.equal(detail.data.deadlineExtension.definitionHash,undefined);assert.equal(detail.data.activity.dueDate,due);
  for(const actor of ['employee-0','manager','other-manager']){assert.equal((await call(actor,'/api/org/exams/results?period='+q)).status,403);assert.equal((await call(actor,'/api/org/exams/results/'+exam.id+'/correction',{revision:1,score:90,reason:'اصلاح مستند آزمون'})).status,403);}
  assert.equal((await call('admin','/api/org/exams/results/'+exam.id+'/correction',{revision:1,score:90,reason:'اصلاح مستند آزمون'})).status,200);assert.equal((await call('admin','/api/org/exams/results/'+exam.id+'/correction',{revision:1,score:95,reason:'نسخه قدیمی آزمون'})).status,409);assert.equal(store.list('exam-result-revision').length,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('kpi-remediation-http-'));await rm(root,{recursive:true,force:true});}
});

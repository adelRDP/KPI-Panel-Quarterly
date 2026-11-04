import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createPanelServer} from '../server.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,currentPeriod,quarterOf} from '../backend/personnel-workflow.mjs';
import {sha256} from '../backend/evaluation.mjs';
import {defaultScoreRules,submissionQuota} from '../backend/score-rules.mjs';
import {activityHumanFinal,createActivityHumanReview} from '../backend/activity-human-review.mjs';

async function setup(t,count=5){
 const root=await mkdtemp(join(tmpdir(),'kpi-human-review-')),server=createPanelServer({dataRoot:root,autoAssessment:false,runModel:async()=>{throw Error('No model calls allowed');}}),store=openStore(root),workflow=createWorkflow(store);
 const owner=workflow.user('employee-mohammad'),manager=workflow.user(owner.managerId),admin=workflow.accounts().find(p=>p.role==='hr'),period=currentPeriod();
 const a=store.put('activity',{kind:'routine',title:'شاخص ساختگی',description:'خروجی ساختگی',criteria:[{id:'C1',text:'ثبت خروجی'}],period,ownerId:owner.id,unitId:owner.unitId,assignmentStatus:'approved',kpiWeight:100,source:'approved-design'});
 for(let i=0;i<count;i++){
  const content='synthetic evidence '+i,path=join(root,'evidence-'+i);await writeFile(path,content);
  const d=store.put('document',{name:'evidence-'+i+'.txt',path,size:content.length,sha256:sha256(content),extraction:{status:'ready',chunks:[{id:'chunk'+i,text:content}]},createdAt:'2026-01-01T00:00:00Z'},a.id);
  const r=store.put('review',{status:'done',activitySnapshot:a,actorId:owner.id,createdAt:'2026-01-01T01:00:00Z',finishedAt:'2026-01-01T02:00:00Z',documentHashes:[{id:d.id,sha256:d.sha256,extractionHash:sha256(JSON.stringify(d.extraction))}],submissionKey:'delivery-'+i,lateDays:2,scoreRulesSnapshot:{version:'synthetic-delay',values:{...defaultScoreRules,delayMode:'daily',delayAmount:3,delayCap:20}},result:{decision:'insufficient',summary:'شاهد ناکافی ساختگی',criteria:[{id:'C1',status:'insufficient',score:null,reason:'شاهد ناکافی',citations:[]}],qualityScore:null,finalForActivity:false,coverage:{incomplete:false}}},a.id);
  store.put('document',{...d,archivedAt:'2026-01-01T03:00:00Z',archiveReason:'review_not_approved',archivedByReviewId:r.id},a.id);
 }
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;let session=await(await fetch(base+'/api/session')).json();
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();await rm(root,{recursive:true,force:true,maxRetries:3});});
 const request=async(path,input,method=input===undefined?'GET':'POST')=>{const r=await fetch(base+path,{method,headers:{'x-panel-token':session.token},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,data:await r.json()};};
 const login=async id=>{session=(await request('/api/session',{userId:id})).data;};await login(owner.id);
 const prefix='/api/activities/'+a.id;
 const submit=async(explanation='توضیحات نهایی ساختگی')=>request(prefix+'/human-review/submit',{explanation,revision:store.list('activity-human-review',a.id)[0]?.revision});
 const decide=async(decision='approve',extra={})=>{const row=store.list('activity-human-review',a.id)[0];return request(prefix+'/human-review/decision',{requestId:row.id,revision:row.revision,decision,reason:'دلیل بررسی ساختگی',...extra});};
 return {root,store,workflow,a,owner,manager,admin,request,login,prefix,submit,decide,base,get token(){return session.token;}};
}

test('five completed deliveries enable personnel → manager → admin; only admin applies grade and existing delay, with immutable AI history',async t=>{
 const f=await setup(t),original=JSON.stringify(f.store.list('review',f.a.id)),before=submissionQuota(f.store,f.a);
 assert.equal((await f.request(f.prefix)).data.humanReview.canSubmit,true);
 assert.equal((await f.submit()).status,200);assert.equal(activityHumanFinal(f.store,f.a),null);
 assert.equal((await f.submit()).status,409);
 assert.equal((await f.decide('approve',{qualityScore:90})).status,403);
 await f.login(f.admin.id);assert.equal((await f.decide()).status,403);
 await f.login(f.manager.id);assert.ok((await f.request('/api/activity-human-reviews')).data.some(r=>r.activityId===f.a.id));
 const file=f.store.list('document',f.a.id)[0],download=await fetch(f.base+f.prefix+'/human-review/documents/'+file.id,{headers:{'x-panel-token':f.token}});assert.equal(download.status,200);assert.match(await download.text(),/synthetic evidence/);
 assert.equal((await f.decide('approve',{qualityScore:101})).status,400);assert.equal((await f.decide('approve',{qualityScore:''})).status,400);
 const approval=await f.decide('approve',{qualityScore:90});assert.equal(approval.status,200);assert.equal(approval.data.status,'hr_review');assert.equal(activityHumanFinal(f.store,f.a),null);
 assert.equal(f.workflow.snapshotForSystem(f.owner.id,f.a.period).assignments.find(a=>a.id===f.a.id).score,null);
 await f.login(f.admin.id);assert.equal((await f.decide()).status,200);assert.equal((await f.decide()).status,403);
 const final=activityHumanFinal(f.store,f.a);assert.equal(final.result.finalScore,84);assert.equal(final.result.deduction,6);
 assert.equal(f.workflow.snapshotForSystem(f.owner.id,f.a.period).assignments.find(a=>a.id===f.a.id).score,84);
 assert.equal(JSON.stringify(f.store.list('review',f.a.id)),original);assert.deepEqual(submissionQuota(f.store,f.a),before);
 await f.login(f.owner.id);assert.equal((await f.request(f.prefix)).data.humanFinal.finalScore,84);
 assert.equal((await f.request(f.prefix+'/reviews',{})).status,409);
 assert.equal((await f.request(f.prefix+'/documents/'+file.id,undefined,'DELETE')).status,409);
 assert.ok(f.store.list('notification',f.owner.id).some(n=>n.title.includes('نهایی')));
});

test('technical failures, duplicate deliveries, pending review, and four deliveries do not activate human submission',async t=>{
 const f=await setup(t,4);assert.equal((await f.submit()).status,409);
 const latest=f.store.list('review',f.a.id)[0];f.store.put('review',{...latest,id:undefined,status:'failed',submissionKey:'failure'},f.a.id);assert.equal((await f.submit()).status,409);
 f.store.put('review',{...latest,id:undefined},f.a.id);assert.equal((await f.submit()).status,409);
 const fifth=f.store.put('review',{...latest,id:undefined,submissionKey:'fifth'},f.a.id);
 const pending=f.store.put('review',{...latest,id:undefined,status:'running',submissionKey:'pending'},f.a.id);assert.equal((await f.submit()).status,409);
 f.store.remove(pending.id,'review',f.a.id);assert.equal((await f.submit()).status,200);assert.ok(fifth);
});

test('manager return and admin return preserve history, require explanations and renewed manager approval',async t=>{
 const f=await setup(t);assert.equal((await f.submit('')).status,400);const first=(await f.submit()).data;
 await f.login(f.manager.id);assert.equal((await f.decide('return')).data.status,'needs_revision');
 await f.login(f.owner.id);const second=(await f.submit('توضیحات تکمیل‌شده ساختگی')).data;assert.equal(second.supersedes,first.id);assert.equal(f.store.list('activity-human-review',f.a.id).length,2);
 await f.login(f.manager.id);await f.decide('approve',{qualityScore:80});await f.login(f.admin.id);assert.equal((await f.decide('return')).data.status,'manager_review');assert.equal((await f.decide()).status,403);
 await f.login(f.manager.id);assert.equal((await f.decide('approve',{qualityScore:85})).status,200);await f.login(f.admin.id);assert.equal((await f.decide()).status,200);assert.equal(activityHumanFinal(f.store,f.a).result.finalScore,79);
});

test('out-of-scope actors, stale revisions, altered evidence, settled personnel and locked quarters cannot approve',async t=>{
 const f=await setup(t);await f.submit();await f.login('manager-finance');assert.equal((await f.request(f.prefix+'/human-review')).status,403);assert.equal((await f.request('/api/activity-human-reviews')).data.some(r=>r.activityId===f.a.id),false);
 await f.login(f.manager.id);const row=f.store.list('activity-human-review',f.a.id)[0];assert.equal((await f.request(f.prefix+'/human-review/decision',{requestId:row.id,revision:99,decision:'approve',reason:'توضیح کافی',qualityScore:70})).status,409);
 const d=f.store.list('document',f.a.id)[0];f.store.put('document',{...d,sha256:'changed'},f.a.id);assert.equal((await f.decide('approve',{qualityScore:70})).status,403);f.store.put('document',d,f.a.id);
 const q=f.store.put('quarter-evaluation',{status:'locked',quarter:quarterOf(f.a.period)},f.owner.id);assert.equal((await f.decide('approve',{qualityScore:70})).status,403);f.store.remove(q.id,'quarter-evaluation',f.owner.id);
 const exit=f.store.put('personnel-settlement',{status:'registered',employeeId:f.owner.id,settlementDate:'2020-01-01'},f.owner.id);assert.equal((await f.decide('approve',{qualityScore:70})).status,403);f.store.remove(exit.id,'personnel-settlement',f.owner.id);
 assert.equal((await f.decide('approve',{qualityScore:70})).status,200);await f.login(f.admin.id);await f.decide();assert.ok(activityHumanFinal(f.store,f.a));f.store.put('activity',{...f.a,title:'تعریف تغییرکرده'});assert.equal(activityHumanFinal(f.store,f.store.get(f.a.id,'activity')),null);
});

test('direct manager and completed AI result restrictions; busy upload blocks transition',async t=>{
 const f=await setup(t),busy=new Set([f.a.id]),service=createActivityHumanReview(f.store,f.workflow,{busy});assert.equal(service.state(f.owner,f.a).canSubmit,false);busy.clear();
 const latest=f.store.list('review',f.a.id)[0];f.store.put('review',{...latest,result:{...latest.result,decision:'completed'}},f.a.id);assert.equal((await f.submit()).status,409);f.store.put('review',latest,f.a.id);await f.submit();
 const other=f.store.put('workflow-user',{...f.manager,id:'other-manager',name:'مدیر هم‌واحد ساختگی'});assert.equal(service.state(other,f.a).canManagerReview,false);
});

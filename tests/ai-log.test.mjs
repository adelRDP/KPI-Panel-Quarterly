import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {Script} from 'node:vm';
import {JSDOM} from 'jsdom';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createAiLog} from '../backend/ai-log.mjs';
import {createPanelServer} from '../server.mjs';
import {roleReply} from './ai-role-fixture.mjs';

async function fixture(t,runModel){const dir=await mkdtemp(join(tmpdir(),'kpi-ai-log-')),store=openStore(dir),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{runModel}),log=createAiLog(store,workflow);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {dir,store,workflow,org,log,hr:workflow.user('hr-demo')};}
test('saved-only drafts are absent from AI logs and removed sent designs retain clearly archived history',async t=>{
 const {store,workflow,org,log,hr}=await fixture(t,roleReply),manager=workflow.user('manager-ops'),draft=org.saveDesignDraft(manager,{employeeId:'employee-mohammad',period:workflow.currentPeriod,tasks:[{category:'routine',title:'پیش‌نویس',description:'ثبت خروجی',criteria:['مدرک'],weightPoints:1,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'09:30'}}]});
 assert.ok(!log.list(hr).items.some(row=>row.sourceId===draft.id));await org.publishDesignDraft(manager,draft.id);org.managerReviewDesign(manager,draft.id,{decision:'approve'});org.hrReviewDesign(hr,draft.id,{decision:'approve'});const activity=store.list('activity').find(row=>row.designId===draft.id);
 store.put('document',{name:'pending.txt',sha256:'test',extraction:{status:'ready',chunks:[{id:'C1',text:'ثبت خروجی'}]}},activity.id);assert.ok(log.list(hr).items.some(row=>row.id==='activity:'+activity.id));org.removeDesign(manager,draft.id);assert.ok(!log.list(hr).items.some(row=>row.id==='activity:'+activity.id));const detail=log.detail(hr,'design:'+draft.id);assert.match(detail.stage,/بایگانی‌شده/);assert.equal(detail.attempts.length,1);assert.equal(detail.result.summary,store.get(draft.id,'kpi-design').aiReview.result.summary);
});
function design(store,workflow,id='log-design'){const position=store.list('position-assignment','employee-mohammad')[0];return store.put('kpi-design',{id,employeeId:'employee-mohammad',managerId:'manager-ops',unitId:'ops',period:workflow.currentPeriod,positionId:position.id,positionVersion:position.version,status:'ai_pending',version:1,createdAt:'2026-10-01T00:00:00Z',events:[{state:'ai_pending',by:'manager-ops',at:'2026-10-01T00:00:00Z'}],tasks:[{id:'T1',category:'routine',title:'پیگیری عملیات',description:'بررسی خروجی',criteria:['مدرک'],weight:100}]},'employee-mohammad');}

test('AI log period scopes filter rows counters and pagination without changing history or HR permissions',async t=>{
 const {store,workflow,log,hr}=await fixture(t),p=workflow.currentPeriod,next=p.slice(0,4)+'-'+String(Number(p.slice(5))+1).padStart(2,'0');
 const a=design(store,workflow,'period-current'),b=design(store,workflow,'period-next');store.put('kpi-design',{...b,period:next,status:'ai_failed'},b.employeeId);
 const position=store.list('position-assignment','employee-mohammad')[0];store.put('ai-role-run',{id:'periodless-job',positionId:position.id,employeeId:'employee-mohammad',stage:'job-analysis-v1',status:'failed',startedAt:'2026-10-01T00:00:00Z'},position.id);
 const before=JSON.stringify(store.list('kpi-design')),month=log.list(hr,{period:p});assert.equal(month.period,p);assert.equal(month.total,1);assert.equal(month.counts.total,1);assert.equal(month.counts.queued,1);assert.equal(month.counts.failed,0);assert.equal(month.items[0].sourceId,a.id);
 assert.equal(log.list(hr,{period:next}).items[0].sourceId,b.id);assert.equal(log.list(hr,{period:'none'}).total,1);assert.equal(log.list(hr,{period:'all'}).total,3);assert.equal(log.list(hr).total,3);assert.equal(log.list(hr,{period:p,offset:1,limit:1}).total,1);assert.equal(log.list(hr,{period:p,offset:1,limit:1}).items.length,0);
 log.setArchived(hr,'design:'+a.id,{archived:true,logRevision:log.detail(hr,'design:'+a.id).logRevision});assert.equal(log.list(hr,{period:p}).total,0);assert.equal(log.list(hr,{period:p,archive:'archived'}).items[0].sourceId,a.id);assert.equal(log.list(hr,{period:next,archive:'archived'}).total,0);assert.equal(JSON.stringify(store.list('kpi-design')),before);
 for(const period of ['1405-13','1405-00','1405-Q3','bad','__proto__',''])assert.throws(()=>log.list(hr,{period}),/دوره/);for(const id of ['manager-ops','employee-mohammad'])assert.throws(()=>log.list(workflow.user(id),{period:p}),/ادمین|دسترسی/);
});
test('AI log merges historical workflows with bounded related data and excludes secrets, raw records and pay',async t=>{
 const {store,workflow,log,hr}=await fixture(t);design(store,workflow);
 const activity=store.list('activity').find(a=>a.ownerId==='employee-mohammad');
 store.put('review',{id:'log-review',status:'done',provider:'codex',model:'test',startedAt:'2026-10-01T01:00:00Z',finishedAt:'2026-10-01T02:00:00Z',activitySnapshot:{...activity,baseSalary:'DO_NOT_LEAK'},prompt:'DO_NOT_LEAK',threadId:'DO_NOT_LEAK',documentHashes:[{id:'doc1',name:'سند.txt',status:'ready',path:'DO_NOT_LEAK'}],evidenceSnapshot:{chunks:[{id:'E1',text:'x'.repeat(50000)}]},usage:{input_tokens:10,api_key:'DO_NOT_LEAK'},result:{summary:'نتیجه معتبر',decision:'completed',qualityScore:90,criteria:[],finalForActivity:true,apiKey:'DO_NOT_LEAK'}},activity.id);
 store.put('document',{id:'log-document',name:'image.png',path:'DO_NOT_LEAK',createdAt:'2026-10-01T03:00:00Z',extraction:{status:'needs_conversion',conversionFailed:true,conversion:{status:'disabled',key:'DO_NOT_LEAK'},chunks:[],warnings:['خوانش غیرفعال است']}},activity.id);
 store.put('kpi-proposal',{id:'log-proposal',employeeId:'employee-mohammad',unitId:'ops',period:workflow.currentPeriod,status:'pending',title:'پیشنهاد قدیمی',description:'خروجی',criteria:'سند',createdAt:'2026-10-01T04:00:00Z',secret:'DO_NOT_LEAK'},'employee-mohammad');
 const rows=log.list(hr);assert.equal(rows.total,5);assert.equal(rows.counts.queued,1);assert.equal(rows.counts.blocked,3);assert.equal(rows.counts.done,1);
 assert.deepEqual(new Set(rows.items.map(row=>row.type)),new Set(['design','review','preprocess','proposal']));assert.ok(rows.items.every(row=>!Object.hasOwn(row,'record')));
 for(const row of rows.items)assert.equal(JSON.stringify(log.detail(hr,row.id)).includes('DO_NOT_LEAK'),false);
 const detail=log.detail(hr,'review:log-review');assert.equal(detail.inputs.evidence.truncated,true);assert.equal(detail.inputs.evidence.chunks[0].text.length,24000);assert.equal(detail.result.qualityScore,90);
 assert.equal(log.list(hr,{state:'blocked'}).total,3);assert.equal(log.list(hr,{search:'image.png'}).total,1);assert.equal(log.list(hr,{limit:1,offset:1}).items.length,1);
 for(const query of [{limit:1000},{offset:-1},{type:'private'},{type:'__proto__'},{state:'constructor'},{state:'private'},{search:'a'.repeat(161)}])assert.throws(()=>log.list(hr,query),/فیلتر/);
 assert.throws(()=>log.detail(hr,'missing'),error=>error.status===404);
});

test('design attempts are visible while running, prevent duplicate calls and preserve successful/human-review stages',async t=>{
 let complete,calls=0;const {store,workflow,org,log,hr}=await fixture(t,async request=>{calls++;if(calls===1)await new Promise(resolve=>complete=resolve);return roleReply(request);});const row=design(store,workflow);
 const running=org.analyzeDesign(hr,row.id);assert.equal(log.list(hr).items[0].state,'running');assert.equal(log.detail(hr,'design:'+row.id).attempts[0].status,'running');
 await assert.rejects(org.analyzeDesign(hr,row.id),error=>error.status===409);assert.equal(calls,1);
 complete();await running;
 let detail=log.detail(hr,'design:'+row.id);assert.equal(detail.state,'waiting_human');assert.equal(detail.attempts[0].status,'done');assert.equal(detail.result.summary,store.get(row.id,'kpi-design').aiReview.result.summary);assert.ok(detail.attempts[0].inputs.position.duties);
 org.managerReviewDesign(workflow.user('manager-ops'),row.id,{decision:'approve'});detail=log.detail(hr,'design:'+row.id);assert.match(detail.stage,/HR/);assert.equal(detail.metadata.managerReview.decision,'approve');
});

test('failed and interrupted design attempts are safely retained and never invent an AI result',async t=>{
 const {store,workflow,org,log,hr}=await fixture(t,async()=>{throw new Error('DO_NOT_LEAK');});const row=design(store,workflow);
 await assert.rejects(org.analyzeDesign(hr,row.id));const detail=log.detail(hr,'design:'+row.id);assert.equal(detail.state,'failed');assert.equal(detail.result,null);assert.equal(detail.attempts.length,1);assert.equal(JSON.stringify(detail).includes('DO_NOT_LEAK'),false);
 const pending=design(store,workflow,'interrupted');store.put('ai-design-attempt',{id:'interrupted-attempt',designId:pending.id,status:'running',startedAt:'2026-10-01T00:00:00Z'},pending.id);
 createOrganizationWorkflow(store,workflow);assert.equal(store.get(pending.id,'kpi-design').status,'ai_failed');assert.equal(store.get('interrupted-attempt','ai-design-attempt').status,'failed');
});

test('preprocessing logs retain each attempt, including running/disabled results, without exposing local paths',async t=>{
 const {store,workflow,log,hr}=await fixture(t),activity=store.list('activity')[0],base={activitySnapshot:activity,documentId:'file-1',document:{id:'file-1',name:'report.png',size:200,path:'DO_NOT_LEAK'},startedAt:'2026-10-01T00:00:00Z'};
 store.put('ai-preprocess-attempt',{...base,id:'running-vision',stage:'visual_transcribe',status:'running',provider:'openai'},activity.id);
 store.put('ai-preprocess-attempt',{...base,id:'blocked-vision',stage:'local_extract',status:'blocked',extraction:{status:'needs_conversion',conversion:{status:'disabled'},chunks:[]}},activity.id);
 store.put('ai-preprocess-attempt',{...base,id:'local-only',stage:'local_extract',status:'done',extraction:{status:'ready',chunks:[]}},activity.id);
 const rows=log.list(hr);assert.equal(rows.total,2);assert.equal(rows.counts.running,1);assert.equal(rows.counts.blocked,1);assert.ok(rows.items.every(row=>row.type==='preprocess'));
 assert.equal(JSON.stringify(log.detail(hr,'preprocess-run:running-vision')).includes('DO_NOT_LEAK'),false);
});

test('unreviewed and changed evidence is queued explicitly without presenting an automatic model execution',async t=>{
 const {store,workflow,log,hr}=await fixture(t),activity=store.list('activity').find(row=>row.ownerId==='employee-mohammad');
 const extraction={status:'ready',chunks:[{id:'C1',text:'شاهد فعلی'}]},document=store.put('document',{id:'queued-document',name:'current.txt',sha256:'sample',extraction,createdAt:'2026-10-01T00:00:00Z'},activity.id);
 let row=log.list(hr).items.find(row=>row.id==='activity:'+activity.id);assert.equal(row.state,'queued');assert.match(row.stage,/درخواست اجرا ثبت نشده/);assert.equal(log.detail(hr,row.id).result,null);
 const {sha256}=await import('../backend/evaluation.mjs');store.put('review',{id:'evidence-review',status:'done',activitySnapshot:activity,documentHashes:[{id:document.id,sha256:document.sha256,extractionHash:sha256(JSON.stringify(extraction))}],result:{summary:'نتیجه قبلی',criteria:[]}},activity.id);
 assert.equal(log.list(hr).items.some(row=>row.id==='activity:'+activity.id),false);
 store.put('document',{...document,extraction:{status:'ready',chunks:[{id:'C1',text:'شاهد تغییر کرده'}]}},activity.id);
 assert.equal(log.list(hr).items.some(row=>row.id==='activity:'+activity.id&&row.state==='queued'),true);assert.equal(log.detail(hr,'review:evidence-review').result.summary,'نتیجه قبلی');
});

test('AI log HTTP endpoints are HR-only and read-only',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kpi-ai-http-')),server=createPanelServer({dataRoot:dir});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`,request=(path,session,method='GET',data)=>fetch(base+path,{method,headers:{...(session?{'X-Panel-Token':session.token}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 assert.equal((await request('/api/org/ai-log')).status,403);
 for(const [id,status] of [['employee-mohammad',403],['manager-ops',403],['hr-demo',200]]){
  const initial=await(await request('/api/session')).json(),session=await(await request('/api/session',initial,'POST',{userId:id})).json();
  assert.equal((await request('/api/org/ai-log',session)).status,status);assert.equal((await request('/api/org/ai-log/missing',session)).status,status===200?404:403);
  assert.equal((await request('/api/org/ai-log?archive=archived',session)).status,status);
  assert.equal((await request('/api/org/ai-log/design%3Amissing/archive',session,'POST',{archived:true,logRevision:'missing'})).status,status===200?404:403);
  if(status===200){
   assert.equal((await request('/api/org/ai-log?limit=999',session)).status,400);assert.equal((await request('/api/org/ai-log',session,'POST',{})).status,404);
   const store=openStore(dir),workflow=createWorkflow(store);design(store,workflow);store.close();
   const rows=await(await request('/api/org/ai-log',session)).json(),row=rows.items.find(row=>row.id==='design:log-design'),archivePath='/api/org/ai-log/'+encodeURIComponent(row.id)+'/archive';
   assert.equal((await request(archivePath,session,'POST',{archived:true,logRevision:row.logRevision,actorId:'employee-mohammad'})).status,200);
   assert.equal((await(await request('/api/org/ai-log?archive=archived',session)).json()).total,1);assert.equal((await(await request('/api/org/ai-log',session)).json()).total,0);
   assert.equal((await request(archivePath,session,'POST',{archived:false,logRevision:row.logRevision})).status,200);assert.equal((await(await request('/api/org/ai-log',session)).json()).total,1);
  }
 }
});

test('AI log status tones reserve green for approvals, yellow for every pending stage and red for failure/rejection',async t=>{
 const {store,workflow,log,hr}=await fixture(t),row=design(store,workflow);
 for(const [status,tone] of [['ai_pending','pending'],['ai_failed','error'],['manager_review','pending'],['hr_review','pending'],['needs_revision','pending'],['rejected','error'],['published','approved']]){store.put('kpi-design',{...row,status},row.employeeId);assert.equal(log.detail(hr,'design:'+row.id).statusTone,tone);}
 const position=store.list('position-assignment','employee-mohammad')[0];
 store.put('ai-role-run',{id:'job-done',positionId:position.id,employeeId:row.employeeId,stage:'job-analysis-v1',status:'succeeded',validationStatus:'valid',startedAt:'2026-10-01',result:{summary:'تحلیل تکمیل‌شده، نه تصویب'}},position.id);
 assert.equal(log.detail(hr,'job_analysis:job-done').statusTone,'neutral');
 const activity=store.list('activity')[0];store.put('review',{id:'review-approved',status:'done',activitySnapshot:activity,result:{decision:'completed',finalForActivity:true}},activity.id);assert.equal(log.detail(hr,'review:review-approved').statusTone,'approved');
 store.put('review',{id:'review-incomplete',status:'done',activitySnapshot:activity,result:{decision:'insufficient',finalForActivity:false}},activity.id);assert.equal(log.detail(hr,'review:review-incomplete').statusTone,'neutral');
});

test('archive is persistent, reversible, idempotent, HR-only and does not alter sources or hide changed/running logs',async t=>{
 const {dir,store,workflow,log,hr}=await fixture(t),source=design(store,workflow),id='design:'+source.id,before=JSON.stringify(store.get(source.id,'kpi-design'));
 for(const userId of ['manager-ops','employee-mohammad'])assert.throws(()=>log.setArchived(workflow.user(userId),id,{archived:true,logRevision:log.detail(hr,id).logRevision}),error=>error.status===403);
 for(const input of [{archived:'true',logRevision:'test'},{archived:true}])assert.throws(()=>log.setArchived(hr,id,input),error=>error.status===400);
 const input={archived:true,logRevision:log.detail(hr,id).logRevision};log.setArchived(hr,id,input);log.setArchived(hr,id,input);
 assert.equal(log.list(hr).total,0);assert.equal(log.list(hr,{archive:'archived'}).total,1);assert.equal(log.list(hr,{archive:'archived',search:'پیگیری عملیات'}).total,0);assert.equal(log.detail(hr,id).archived,true);assert.equal(log.detail(hr,id).result,null);assert.equal(store.list('ai-log-archive').length,1);assert.equal(store.list('audit-event').filter(r=>r.action==='ai-log.archived').length,1);assert.equal(JSON.stringify(store.get(source.id,'kpi-design')),before);
 const reopened=openStore(dir);try{assert.equal(createAiLog(reopened,workflow).list(hr,{archive:'archived'}).total,1);}finally{reopened.close();}
 log.setArchived(hr,id,{...input,archived:false});assert.equal(log.list(hr).total,1);assert.equal(log.list(hr,{archive:'archived'}).total,0);
 log.setArchived(hr,id,input);store.put('kpi-design',{...source,status:'ai_failed',events:[...source.events,{state:'ai_failed',at:'2026-10-02T00:00:00Z'}]},source.employeeId);assert.equal(log.list(hr).total,1);assert.equal(log.list(hr,{archive:'archived'}).total,0);assert.throws(()=>log.setArchived(hr,id,input),error=>error.status===409);
 store.put('ai-design-attempt',{id:'running-archive',designId:source.id,status:'running',startedAt:'2026-10-02T01:00:00Z'},source.id);assert.throws(()=>log.setArchived(hr,id,{archived:true,logRevision:log.detail(hr,id).logRevision}),error=>error.status===409);
 assert.throws(()=>log.list(hr,{archive:'everything'}),error=>error.status===400);
});

test('actual AI admin UI filters safely, shows related detail, and clears data on role switch without calling models',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kpi-ai-ui-'));let modelCalls=0;const server=createPanelServer({dataRoot:dir,runModel:async()=>{modelCalls++;throw new Error('not called');}});server.listen(0,'127.0.0.1');await once(server,'listening');
 const store=openStore(dir),workflow=createWorkflow(store);createOrganizationWorkflow(store,workflow);const row=design(store,workflow);row.tasks[0].title='<img src=x onerror=alert(1)>';store.put('kpi-design',row,row.employeeId);store.close();
 const base=`http://127.0.0.1:${server.address().port}`,dom=new JSDOM(await readFile('index.html','utf8'),{url:base,runScripts:'outside-only'}),{window}=dom,doc=window.document;
 t.after(async()=>{window.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 let archiveWrites=0;window.indexedDB={open:()=>({})};window.scrollTo=()=>{};window.fetch=(path,options)=>{if(String(path).endsWith('/archive')&&options?.method==='POST')archiveWrites++;return fetch(base+path,options);};
for(const path of ['src/kpi-dashboard.js','src/app.js','src/workflow-ui.js','src/persian-money.js','src/persian-date-picker.js','src/lifecycle-ui.js','src/ai-log-ui.js'])new Script(await readFile(path,'utf8'),{filename:path}).runInContext(dom.getInternalVMContext());
 const until=async check=>{for(let i=0;i<500;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('UI did not settle');};
 await until(()=>window.PanelWorkflow?.user&&!doc.querySelector('#demoAccount').disabled);assert.equal(doc.querySelector('[data-view="ai"]').hidden,true);assert.equal(window.PanelWorkflow.canView('ai'),false);
 async function account(id,role){doc.querySelector('#demoRole').value=role;const field=doc.querySelector('#demoAccount');field.innerHTML=`<option value="${id}">${id}</option>`;field.value=id;await field.onchange({target:field});}
 await account('hr-demo','hr');assert.equal(doc.querySelector('[data-view="ai"]').hidden,false);doc.querySelector('[data-view="ai"]').click();await until(()=>doc.querySelector('[data-ai-log-detail]'));
 assert.match(doc.querySelector('#aiLogList').textContent,/در انتظار AI/);doc.querySelector('[data-ai-log-detail]').click();await until(()=>!doc.querySelector('#aiLogDetail').hidden);
 assert.match(doc.querySelector('#aiLogDetail').textContent,/<img src=x onerror=alert\(1\)>/);assert.equal(doc.querySelector('#aiLogDetail img'),null);assert.match(doc.querySelector('#aiLogDetail').textContent,/شرح وظایف/);
 assert.equal(doc.querySelector('#aiLogList .ai-log-state').dataset.tone,'pending');assert.equal(doc.querySelector('#aiLogDetail .ai-log-state').dataset.tone,'pending');
 const countTones={total:'neutral',queued:'pending',running:'pending',waiting_human:'pending',failed:'error',blocked:'pending'};
 function checkCountTones(id){assert.equal(doc.querySelectorAll(`#${id} .ai-log-count`).length,6);for(const [key,tone] of Object.entries(countTones))assert.equal(doc.querySelector(`#${id} [data-count="${key}"]`).dataset.tone,tone);}
 checkCountTones('aiLogCounts');
 const archiveButton=doc.querySelector('#aiLogList [data-ai-log-archive]');archiveButton.click();archiveButton.click();await until(()=>doc.querySelector('#aiLogList').textContent.includes('لاگی مطابق'));assert.equal(archiveWrites,1);assert.equal(doc.querySelector('#aiLogDetail').hidden,true);
 const group=doc.querySelector('[data-nav-group="ai"]');assert.equal(group.hidden,false);doc.querySelector('[data-view="ai-archive"]').click();await until(()=>doc.querySelector('#aiArchiveList [data-ai-log-detail]'));assert.equal(group.querySelector('.nav-group-toggle').getAttribute('aria-expanded'),'true');assert.match(doc.querySelector('#aiArchiveList').textContent,/آرشیو:/);doc.querySelector('#aiArchiveList [data-ai-log-detail]').click();await until(()=>!doc.querySelector('#aiArchiveDetail').hidden);assert.equal(doc.querySelector('#aiArchiveDetail img'),null);
 checkCountTones('aiArchiveCounts');
 const restoreButton=doc.querySelector('#aiArchiveList [data-ai-log-archive]');assert.equal(restoreButton.textContent,'بازگرداندن');restoreButton.click();restoreButton.click();await until(()=>doc.querySelector('#aiArchiveList').textContent.includes('لاگی مطابق'));assert.equal(archiveWrites,2);doc.querySelector('[data-view="ai"]').click();await until(()=>doc.querySelector('#aiLogList [data-ai-log-detail]'));
 const filter=doc.querySelector('#aiLogFilters');filter.elements.state.value='done';filter.elements.state.dispatchEvent(new window.Event('change'));await until(()=>doc.querySelector('#aiLogList').textContent.includes('لاگی مطابق'));
 await account('manager-ops','manager');assert.equal(doc.querySelector('[data-view="ai"]').hidden,true);assert.equal(doc.querySelector('#aiLogList').textContent,'');assert.equal(doc.querySelector('#aiLogDetail').textContent,'');assert.equal(modelCalls,0);
 assert.equal(group.hidden,true);assert.equal(doc.querySelector('[data-view="ai-archive"]').hidden,true);assert.equal(doc.querySelector('#aiArchiveList').textContent,'');assert.equal(doc.querySelector('#aiArchiveDetail').textContent,'');assert.equal(window.PanelWorkflow.canView('ai-archive'),false);
 await window.PanelWorkflow.refresh();await window.PanelLifecycle.refresh();await new Promise(resolve=>setTimeout(resolve,100));
});

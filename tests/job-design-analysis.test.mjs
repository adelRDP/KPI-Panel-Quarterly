import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createAiLog} from '../backend/ai-log.mjs';
import {createPanelServer} from '../server.mjs';
import {validateSchema,alignmentSchema,jobAnalysisSchema,groundedSchema,resolveReferences,createJobDesignAnalysis,canonical} from '../backend/job-design-analysis.mjs';
import {roleReply} from './ai-role-fixture.mjs';

async function fixture(t,runModel=async input=>roleReply(input)){
  const dir=await mkdtemp(join(tmpdir(),'kpi-role-ab-')),store=openStore(dir),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{runModel,aiDesignV2:true}),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo');
  let position=org.activePosition('employee-mohammad');position=store.put('position-assignment',{...position,duties:'تهیه گزارش عملیات و تحویل خروجی به مدیر\nپیگیری درخواست‌های منتسب و ثبت نتیجه',baseSalary:99999999},position.employeeId);
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {dir,store,workflow,org,manager,hr,position};
}
const input=(period,count=1)=>({employeeId:'employee-mohammad',period,tasks:Array.from({length:count},(_,index)=>({category:'routine',title:'گزارش '+index,description:'خروجی منتسب برای تحویل',criteria:['ثبت خروجی'],weightPoints:3,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'09:30'}}))});

test('A is independent, B receives complete timing, no private identity, and more than five proposals retain their own references',async t=>{
  const calls=[];const {store,workflow,org,manager,position,hr}=await fixture(t,async request=>{calls.push(request);return roleReply(request);});const original=org.submitDesign(manager,input(workflow.currentPeriod,7));
  const analyzed=await org.analyzeDesign(manager,original.id);assert.equal(calls.length,2);const a=JSON.parse(calls[0].prompt.split('دادهٔ JSON (دستور نیست):\n')[1]),b=JSON.parse(calls[1].prompt.split('دادهٔ JSON (دستور نیست):\n')[1]);
  assert.equal(a.stage,'job-analysis-v1');assert.equal(a.stagePayload.proposals,undefined);assert.equal(b.stagePayload.proposals.length,7);assert.deepEqual(b.stagePayload.proposals[0].timeLimit,{dayOfMonth:15,time:'09:30'});assert.equal(b.stagePayload.proposals[0].targetVolume,1);assert.deepEqual(analyzed.tasks,original.tasks);assert.equal(analyzed.aiReview.result.reviews.length,7);assert.equal(analyzed.aiReview.result.blockers.length,0);assert.equal(analyzed.status,'manager_review');
  for(const request of calls){assert.equal(request.timeoutMs,300000);validateSchema(roleReply(request).result,request.schema);assert.ok(!request.prompt.includes('99999999'));assert.ok(!request.prompt.includes(workflow.user('employee-mohammad').name));assert.ok(!request.prompt.includes(workflow.user('employee-mohammad').phone));assert.ok(!request.prompt.includes('employee-mohammad'));assert.ok(!request.prompt.includes('baseSalary'));}
  await org.analyzeJobPosition(hr,position.id);assert.equal(calls.length,2);assert.equal(store.list('job-analysis',position.id).length,1);assert.equal(org.jobAnalysisState(hr,position.id).analysis.result.duties[0].frequency,null);
  const log=createAiLog(store,workflow);assert.equal(log.list(hr,{type:'job_analysis'}).total,1);const detail=log.detail(hr,log.list(hr,{type:'job_analysis'}).items[0].id);assert.equal(detail.metadata.validationStatus,'valid');assert.ok(!JSON.stringify(detail).includes('99999999'));assert.equal(detail.inputs.sourceManifest,undefined);
  org.managerReviewDesign(manager,original.id,{decision:'approve'});assert.equal(store.get(original.id,'kpi-design').status,'hr_review');assert.equal(store.list('activity').filter(row=>row.designId===original.id).length,0);org.hrReviewDesign(hr,original.id,{decision:'approve'});assert.equal(store.list('activity').filter(row=>row.designId===original.id).length,7);
});

test('unknown target blocks approval without rejecting the job or changing weights; accepting a suggestion creates a fresh unanalyzed draft',async t=>{
  let recommendation='needs_information';const {workflow,org,manager,hr,store}=await fixture(t,async request=>roleReply(request,{recommendation}));const row=org.submitDesign(manager,input(workflow.currentPeriod));const reviewed=await org.analyzeDesign(manager,row.id);
  assert.equal(reviewed.aiReview.result.reviews[0].recommendation,'needs_information');assert.equal(reviewed.tasks[0].weightPoints,3);assert.throws(()=>org.managerReviewDesign(manager,row.id,{decision:'approve'}),error=>error.status===409);org.managerReviewDesign(manager,row.id,{decision:'return',reason:'تکمیل اطلاعات'});
  recommendation='revise';const next=org.reviseDesign(manager,row.id,input(workflow.currentPeriod));await org.analyzeDesign(manager,next.id);
  assert.throws(()=>org.acceptDesignChange(hr,next.id,{proposalId:'T1',field:'title',reason:'آزمون'}),error=>error.status===403);
  assert.throws(()=>org.acceptDesignChange(manager,next.id,{proposalId:'T1',field:'baseSalary',reason:'آزمون'}),error=>error.status===404);
  const draft=org.acceptDesignChange(manager,next.id,{proposalId:'T1',field:'title',reason:'پذیرش عنوان دقیق‌تر'});assert.notEqual(draft.id,next.id);assert.equal(draft.status,'draft');assert.equal(draft.aiReview,undefined);assert.equal(draft.tasks[0].title,'عنوان اصلاح‌شده');assert.equal(store.get(next.id,'kpi-design').tasks[0].title,'گزارش 0');assert.equal(draft.revises,next.id);assert.equal(draft.acceptedSuggestion.oldValue,'گزارش 0');assert.equal(store.get(next.id,'kpi-design').revisedBy,draft.id);
});

test('v4 excludes source and coverage from generation and rejects vague revise recommendations',async t=>{
  let invalid=false;const calls=[];const {org,workflow,manager,store}=await fixture(t,async request=>{calls.push(request);return roleReply(request,{recommendation:invalid?'revise':'retain',mutate(result,envelope){if(invalid&&envelope.stage==='kpi-alignment-v4')result.reviews[0].changes=[];}});});
  const first=org.submitDesign(manager,input(workflow.currentPeriod));const analyzed=await org.analyzeDesign(manager,first.id),result=analyzed.aiReview.result;
  assert.equal(analyzed.aiReview.contractVersion,'kpi-alignment-v4');assert.equal(result.coverage,undefined);
  assert.deepEqual(result.reviews[0].checks.map(check=>check.type),['relevance','control','definition','target','measurability','overlap','gaming']);
  assert.match(calls[1].prompt,/منبع داده و پوشش مسئولیت‌ها محور بررسی این مرحله نیستند/);assert.match(calls[1].prompt,/تغییر دقیق، کامل و قابل اعمال/);
  for(const type of ['source','coverage']){const raw=structuredClone(roleReply(calls[1]).result);raw.reviews[0].checks[0].type=type;assert.throws(()=>validateSchema(raw,calls[1].schema));}
  const raw=roleReply(calls[1]).result;assert.throws(()=>validateSchema({...raw,coverage:[]},calls[1].schema));
  invalid=true;const next=org.submitDesign(manager,input(workflow.currentPeriod));await assert.rejects(org.analyzeDesign(manager,next.id),/تغییر مشخص و قابل اعمال/);assert.equal(store.get(next.id,'kpi-design').status,'ai_failed');assert.deepEqual(store.get(next.id,'kpi-design').tasks,next.tasks);
});

test('accept all applies only stored corrections atomically and requires a fresh AI review and both human approvals',async t=>{
  let calls=0;const {org,workflow,manager,hr,store}=await fixture(t,async request=>{
    calls++;return roleReply(request,{mutate(result,envelope){
      if(envelope.stage!=='kpi-alignment-v4')return;
      for(const [index,review] of result.reviews.entries()){
        if(envelope.stagePayload.proposals[index].title==='عنوان دقیق '+index)continue;
        review.recommendation='revise';review.changes=[{field:'title',proposedValue:'عنوان دقیق '+index,reason:'تعریف روشن',supportingReferences:review.citations},{field:'criteria',proposedValue:['خروجی مشخص و قابل بررسی'],reason:'معیار روشن',supportingReferences:review.citations}];
      }
    }});
  });
  const first=org.submitDesign(manager,input(workflow.currentPeriod,2));await org.analyzeDesign(manager,first.id);assert.equal(calls,3);
  assert.throws(()=>org.acceptDesignChange(hr,first.id,{all:true,reason:'تکمیل'}),error=>error.status===403);
  const draft=org.acceptDesignChange(manager,first.id,{all:true,reason:'پذیرش اصلاحات مستند',proposedValue:'متن جعلی از مرورگر'});
  assert.equal(calls,3);assert.equal(draft.status,'draft');assert.equal(draft.aiReview,undefined);assert.equal(draft.acceptedSuggestions.length,4);assert.deepEqual(draft.tasks.map(task=>task.title),['عنوان دقیق 0','عنوان دقیق 1']);assert.ok(draft.tasks.every(task=>task.criteria[0]==='خروجی مشخص و قابل بررسی'));assert.deepEqual(store.get(first.id,'kpi-design').tasks,first.tasks);
  assert.throws(()=>org.acceptDesignChange(manager,first.id,{all:true,reason:'تکرار'}),error=>error.status===409);
  const reviewed=await org.publishDesignDraft(manager,draft.id);assert.equal(calls,4);assert.equal(reviewed.aiReview.result.blockers.length,0);assert.equal(reviewed.status,'manager_review');assert.equal(store.list('activity').filter(row=>row.designId===draft.id).length,0);
  org.managerReviewDesign(manager,draft.id,{decision:'approve'});org.hrReviewDesign(hr,draft.id,{decision:'approve'});assert.equal(store.list('activity').filter(row=>row.designId===draft.id).length,2);
});

test('legacy nine-axis reports remain historical and cannot approve or accept changes before explicit seven-axis reanalysis',async t=>{
  let calls=0;const {org,workflow,manager,hr,store}=await fixture(t,async request=>{calls++;return roleReply(request);});
  const first=org.submitDesign(manager,input(workflow.currentPeriod));const current=await org.analyzeDesign(manager,first.id),legacy=structuredClone(current.aiReview);
  legacy.contractVersion='kpi-alignment-v2';legacy.result.reviews[0].checks.push(...['source','coverage'].map(type=>({type,status:'pass',reason:'گزارش قبلی',citations:legacy.result.reviews[0].citations})));legacy.result.coverage=[];
  const oldRun=store.get(legacy.runId,'ai-role-run');store.put('ai-role-run',{...oldRun,stage:'kpi-alignment-v2',result:legacy.result},oldRun.positionId);store.put('kpi-design',{...current,aiReview:legacy},current.employeeId);
  const oldSnapshot=structuredClone(store.get(legacy.runId,'ai-role-run'));assert.equal(org.listDesigns(manager).find(row=>row.id===first.id).canReanalyze,true);assert.equal(org.listDesigns(hr).find(row=>row.id===first.id).alignmentCurrent,false);
  assert.throws(()=>org.managerReviewDesign(manager,first.id,{decision:'approve'}),error=>error.status===409);assert.throws(()=>org.acceptDesignChange(manager,first.id,{all:true,reason:'پذیرش'}),error=>error.status===409);
  const revised=await org.analyzeDesign(manager,first.id);assert.equal(calls,3);assert.equal(revised.aiReview.contractVersion,'kpi-alignment-v4');assert.equal(revised.aiReview.result.reviews[0].checks.length,7);assert.deepEqual(revised.tasks,first.tasks);assert.deepEqual(store.get(legacy.runId,'ai-role-run'),oldSnapshot);
  assert.equal(org.listDesigns(manager).find(row=>row.id===first.id).canReanalyze,false);
});

test('invalid stored batch corrections roll back the draft and source status together',async t=>{
  const {org,workflow,manager,store}=await fixture(t,async request=>roleReply(request,{recommendation:'revise'}));
  const first=org.submitDesign(manager,input(workflow.currentPeriod));const current=await org.analyzeDesign(manager,first.id);current.aiReview.result.reviews[0].changes[0].proposedValue='';store.put('kpi-design',current,current.employeeId);
  const before=store.list('kpi-design');assert.throws(()=>org.acceptDesignChange(manager,first.id,{all:true,reason:'تکمیل'}));assert.deepEqual(store.list('kpi-design'),before);
});

test('fabricated references, silently omitted duties, extra keys, bad checks, duplicate proposals and cyclic merges fail closed',async t=>{
  for(const kind of ['forged','omitted','extra','duplicate','checks','cyclic']){
    const {workflow,org,store,manager}=await fixture(t,async request=>roleReply(request,{mutate:(result,envelope)=>{
      if(envelope.stage==='job-analysis-v1'){if(kind==='forged')result.duties[0].citations[0].quote='نقل‌قول ساختگی';if(kind==='omitted')result.duties.pop();if(kind==='extra')result.pay=10;}
      else {if(kind==='duplicate')result.reviews[1]=structuredClone(result.reviews[0]);if(kind==='checks')result.reviews[0].checks.pop();if(kind==='cyclic')for(const [index,row] of result.reviews.entries()){row.recommendation='merge';row.relatedProposalIds=[result.reviews[1-index].proposalId];}}
    }}));const row=org.submitDesign(manager,input(workflow.currentPeriod,2));await assert.rejects(org.analyzeDesign(manager,row.id));assert.equal(store.get(row.id,'kpi-design').status,'ai_failed');assert.equal(store.get(row.id,'kpi-design').aiReview,undefined);assert.equal(store.list('activity').filter(row=>row.designId===row.id&&row.source==='approved-design').length,0);
  }
  assert.throws(()=>validateSchema({summary:'test',duties:[],issues:[],suggestedClarifications:[],published:true},jobAnalysisSchema));assert.throws(()=>validateSchema({summary:'test',reviews:[],coverage:[],candidates:[],weight:1},alignmentSchema));
});

test('running analysis is idempotent, stale replies stay historical, and old managers cannot read after relationship changes',async t=>{
  let release;const {workflow,org,store,manager,position,hr}=await fixture(t,request=>new Promise(resolve=>release=()=>resolve(roleReply(request))));const running=org.analyzeJobPosition(manager,position.id);await assert.rejects(org.analyzeJobPosition(manager,position.id),error=>error.status===409);
  store.put('position-assignment',{...position,managerId:'manager-finance'},position.employeeId);release();await assert.rejects(running,error=>error.status===409);assert.equal(store.list('ai-role-run')[0].validationStatus,'stale');assert.equal(store.list('job-analysis').length,0);assert.throws(()=>org.jobAnalysisState(manager,position.id),error=>error.status===404);assert.equal(org.jobAnalysisState(hr,position.id).analysis,null);
});

test('late B cannot replace a changed task, policy or removed design; approvals recheck the position version',async t=>{
  for(const kind of ['task','policy','removed']){
    let release;const {workflow,org,store,manager}=await fixture(t,async request=>request.prompt.includes('"stage":"kpi-alignment-v4"')?new Promise(resolve=>release=()=>resolve(roleReply(request))):roleReply(request));const row=org.submitDesign(manager,input(workflow.currentPeriod)),pending=org.analyzeDesign(manager,row.id);while(!release)await new Promise(resolve=>setTimeout(resolve,2));
    if(kind==='task')store.put('kpi-design',{...row,tasks:row.tasks.map(task=>({...task,title:'نسخه تازه'}))},row.employeeId);
    if(kind==='policy'){const policy=store.get('active-policy','workflow-policy');store.put('workflow-policy',{...policy,version:'changed-model'});}
    if(kind==='removed')store.put('kpi-design',{...row,removedAt:new Date().toISOString()},row.employeeId);
    release();await assert.rejects(pending,error=>error.status===409);assert.notEqual(store.get(row.id,'kpi-design').status,'manager_review');assert.equal(store.list('ai-role-run').find(run=>run.stage==='kpi-alignment-v4').validationStatus,'stale');if(kind==='task')assert.equal(store.get(row.id,'kpi-design').tasks[0].title,'نسخه تازه');
  }
  const {workflow,org,store,manager,position}=await fixture(t);const row=org.submitDesign(manager,input(workflow.currentPeriod));await org.analyzeDesign(manager,row.id);store.put('position-assignment',{...position,version:2},position.employeeId);assert.throws(()=>org.managerReviewDesign(manager,row.id,{decision:'approve'}),error=>error.status===409);
});

test('failed calls retry at most three times per input and restart preserves snapshots while releasing interrupted locks',async t=>{
  let calls=0;const {org,store,workflow,manager,position}=await fixture(t,async()=>{calls++;throw new Error('Private technical detail');});for(let i=0;i<3;i++)await assert.rejects(org.analyzeJobPosition(manager,position.id));await assert.rejects(org.analyzeJobPosition(manager,position.id),error=>error.status===409);assert.equal(calls,3);assert.ok(!JSON.stringify(org.jobAnalysisState(manager,position.id)).includes('Private technical detail'));
  store.put('ai-role-run',{stage:'job-analysis-v1',positionId:position.id,status:'running',fingerprint:'restart'},position.id);createOrganizationWorkflow(store,workflow,{aiDesignV2:true});assert.equal(store.list('ai-role-run',position.id)[0].status,'failed');assert.equal(store.get(position.id,'position-assignment').duties,position.duties);
});

test('v4 stages are always available, model changes invalidate the cache, and a mid-month transfer cannot publish an undivided assignment',async t=>{
  let calls=0;const {org,workflow,store,manager,hr,position}=await fixture(t,async request=>{calls++;return roleReply(request);});const defaultOrg=createOrganizationWorkflow(store,workflow);assert.equal(defaultOrg.aiCapabilities(hr).jobAnalysis,true);assert.equal(defaultOrg.jobAnalysisState(hr,position.id).status,'not_started');
  await org.analyzeJobPosition(hr,position.id);const originalModel=process.env.CODEX_MODEL;try{process.env.CODEX_MODEL='test-model-version';assert.equal(org.jobAnalysisState(hr,position.id).analysis,null);await org.analyzeJobPosition(hr,position.id);assert.equal(calls,2);}finally{if(originalModel===undefined)delete process.env.CODEX_MODEL;else process.env.CODEX_MODEL=originalModel;}
  const row=org.submitDesign(manager,input(workflow.currentPeriod));await org.analyzeDesign(manager,row.id);const {periodBounds}=await import('../backend/personnel-workflow.mjs'),bounds=periodBounds(workflow.currentPeriod),cut=new Date(Date.parse(bounds.start+'T00:00:00Z')+5*86400000).toISOString().slice(0,10);
  store.put('position-assignment',{...position,effectiveTo:cut},position.employeeId);store.put('position-assignment',{...position,id:undefined,version:2,effectiveFrom:cut,effectiveTo:null},position.employeeId);assert.throws(()=>org.managerReviewDesign(manager,row.id,{decision:'approve'}),error=>error.status===409);
});

test('v4 routes are authenticated, role scoped and never call the model on reads',async t=>{
  let calls=0;const dir=await mkdtemp(join(tmpdir(),'kpi-role-http-')),server=createPanelServer({dataRoot:dir,aiDesignV2:true,runModel:async request=>{calls++;return roleReply(request);}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const request=(path,token,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{'x-panel-token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const login=async userId=>{const initial=await (await request('/api/session')).json();return userId===initial.user.id?initial.token:(await (await request('/api/session',initial.token,{userId})).json()).token;};
  const hr=await login('hr-demo'),manager=await login('manager-finance'),person=await login('employee-mohammad');assert.equal((await request('/api/org/ai-capabilities')).status,403);assert.equal((await request('/api/org/ai-capabilities',person)).status,403);assert.equal((await (await request('/api/org/ai-capabilities',hr)).json()).evidenceReviewV3,false);
  const positions=await (await request('/api/org/positions',hr)).json(),position=positions.find(row=>row.employeeId==='employee-mohammad');assert.equal((await request(`/api/org/positions/${position.id}/analysis`,manager)).status,404);assert.equal((await request(`/api/org/positions/${position.id}/analysis`,person,{actorId:'hr-demo'})).status,403);assert.equal(calls,0);
  const response=await request(`/api/org/positions/${position.id}/analysis`,hr,{provider:'codex'});assert.equal(response.status,200);assert.equal(calls,1);const data=await response.json();assert.equal(data.analysis.result.duties.length,1);assert.equal(JSON.stringify(data).includes('rawResult'),false);await request(`/api/org/positions/${position.id}/analysis`,hr);assert.equal(calls,1);
});

test('prompt and provider implementation changes cannot expose or approve cached analyses',async t=>{
  const {org,workflow,store,manager,hr,position}=await fixture(t);
  const row=org.submitDesign(manager,input(workflow.currentPeriod));await org.analyzeDesign(manager,row.id);
  const job=store.list('job-analysis',position.id)[0],jobRun=store.get(job.runId,'ai-role-run');
  store.put('ai-role-run',{...jobRun,promptHash:'previous-contract'},position.id);
  assert.equal(org.jobAnalysisState(hr,position.id).analysis,null);assert.equal(org.jobAnalysisState(hr,position.id).status,'stale');
  const review=store.get(row.id,'kpi-design').aiReview,run=store.get(review.runId,'ai-role-run');
  store.put('ai-role-run',{...run,providerImplementationHash:'previous-provider'},position.id);
  assert.throws(()=>org.managerReviewDesign(manager,row.id,{decision:'approve'}),error=>error.status===409);
});

test('generation contract binds exact quotations to their source and types changes by field',()=>{
  const manifest=[{sourceId:'position-test',sourceVersion:'2',segments:[{segmentId:'D1',text:'پس از تصویب، نسخه برنامه را ابلاغ کند. سابقه نسخه‌ها را حفظ کند.'},{segmentId:'D2',text:'گزارش هفتگی تهیه کند.'}]}];
  const schema=groundedSchema(alignmentSchema,manifest),ref={referenceId:'R1'};
  const refs=schema.properties.reviews.items.properties.citations;
  validateSchema([ref],refs);
  assert.deepEqual(resolveReferences([ref],manifest),[{sourceId:'position-test',sourceVersion:'2',segmentId:'D1',quote:manifest[0].segments[0].text}]);
  assert.throws(()=>validateSchema([{referenceId:'R3'}],refs));assert.throws(()=>resolveReferences([{referenceId:'R3'}],manifest));
  for(const changed of [{quote:'ابلاغ نسخه برنامه'},{sourceVersion:'1'},{segmentId:'D2'},{quote:'پس از تصویب ... حفظ کند.'}])assert.throws(()=>validateSchema([{...ref,...changed}],refs));
  const changes=schema.properties.reviews.items.properties.changes;
  validateSchema([{field:'criteria',proposedValue:['ثبت نسخه'],reason:'شفاف‌سازی',supportingReferences:[ref]}],changes);
  assert.throws(()=>validateSchema([{field:'criteria',proposedValue:'ثبت نسخه',reason:'شفاف‌سازی',supportingReferences:[ref]}],changes));
  assert.throws(()=>validateSchema([{field:'weightPoints',proposedValue:2.5,reason:'نامعتبر',supportingReferences:[ref]}],changes));
});

test('failures identify the stage and validation cause without leaking provider errors',async t=>{
  const {org,store,workflow,hr,manager,position}=await fixture(t,async()=>{throw new Error('secret provider response');});
  await assert.rejects(org.analyzeJobPosition(manager,position.id),error=>error.publicMessage.includes('تحلیل شرح وظایف ناموفق')&&!error.publicMessage.includes('secret'));
  const run=store.list('ai-role-run')[0];assert.equal(run.failurePhase,'provider');assert.ok(!run.error.includes('secret'));
  const detail=createAiLog(store,workflow).detail(hr,'job_analysis:'+run.id);assert.equal(detail.metadata.failurePhase,'provider');assert.match(detail.metadata.error,/تحلیل شرح وظایف ناموفق/);assert.ok(!JSON.stringify(detail).includes('secret'));
  const invalid=await fixture(t,async request=>roleReply(request,{mutate:result=>result.duties.pop()}));
  await assert.rejects(invalid.org.analyzeJobPosition(invalid.manager,invalid.position.id),error=>error.publicMessage.includes('D2'));
  assert.equal(invalid.store.list('ai-role-run')[0].failurePhase,'validation');
});

test('exact previous two-round policy hashes remain valid without accepting any changed v4 instruction or model',async t=>{
 const f=await fixture(t),design=f.org.submitDesign(f.manager,input(f.workflow.currentPeriod)),reviewed=await f.org.analyzeDesign(f.manager,design.id),run=f.store.get(reviewed.aiReview.runId,'ai-role-run');
 const source=await readFile('backend/job-design-analysis.mjs','utf8'),declarations=source.slice(source.indexOf('const commonPrompt='),source.indexOf('export function buildAnalysisPrompt'));
 const {commonPrompt,stagePrompt}=new Function(declarations+';return {commonPrompt,stagePrompt:stagePrompts["kpi-alignment-v4"]};')();
 const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex'),oldStability=(await readFile('backend/alignment-stability.mjs','utf8')).replace('export const maxCorrectionRounds=4;','export const maxCorrectionRounds=2;').replace(/\r\n/g,'\n');
 const instructionsHash=hash((await readFile('backend/reviewer-instructions.md','utf8')).replace(/\r\n/g,'\n')),inputEncodingHash=hash((await readFile('backend/analysis-input.mjs','utf8')).replace(/\r\n/g,'\n'));
 for(const stabilityImplementationHash of [hash(oldStability),hash(oldStability.replace(/\n/g,'\r\n'))]){
   const promptHash=hash({commonPrompt,stagePrompt,schema:alignmentSchema,citationContract:'source-bound-handles-v1',instructionsHash,stabilityImplementationHash,inputEncodingHash});assert.notEqual(promptHash,run.promptHash);
   f.store.put('ai-role-run',{...run,promptHash},run.positionId);assert.equal(f.org.listDesigns(f.manager).find(d=>d.id===design.id).alignmentCurrent,true);
   assert.equal(createJobDesignAnalysis(f.store).isCurrentRun({...run,promptHash:hash({commonPrompt,stagePrompt:stagePrompt+' changed',schema:alignmentSchema,citationContract:'source-bound-handles-v1',instructionsHash,stabilityImplementationHash,inputEncodingHash})}),false);
 }
 f.org.managerReviewDesign(f.manager,design.id,{decision:'approve'});assert.equal(f.store.get(design.id,'kpi-design').status,'hr_review');
});

test('LF/CRLF-only implementation differences retain valid historical runs and cache without allowing real changes',async t=>{
 let calls=0;const f=await fixture(t,async input=>{calls++;return roleReply(input);});await f.org.analyzeJobPosition(f.manager,f.position.id);assert.equal(calls,1);
 const run=f.store.list('ai-role-run')[0],providerText=(await readFile('backend/providers.mjs','utf8')).replace(/\r\n/g,'\n'),hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex'),crlfHash=hash(providerText.replace(/\n/g,'\r\n'));
 assert.notEqual(crlfHash,hash(providerText));
 const payload={sourceManifest:run.inputs.sourceManifest.map(source=>({...source,segments:source.segments.map(({referenceId,...segment})=>segment)})),stagePayload:run.inputs.stagePayload};assert.equal(hash(payload),run.inputHash);
 const fingerprint=hash({stage:run.stage,promptHash:run.promptHash,providerImplementationHash:crlfHash,promptVersion:run.promptVersion,schemaVersion:run.schemaVersion,payload,provider:run.provider,model:run.model}),legacy={...run,providerImplementationHash:crlfHash,fingerprint};f.store.put('ai-role-run',legacy,run.positionId);
 const engine=createJobDesignAnalysis(f.store);assert.equal(engine.isCurrentRun(legacy),true);assert.equal(engine.isCurrentRun({...legacy,providerImplementationHash:hash(providerText+'\n// genuinely different implementation')}),false);assert.equal(engine.isCurrentRun({...legacy,promptHash:'0'.repeat(64)}),false);assert.equal(engine.isCurrentRun({...legacy,model:'changed-model'}),false);
 await f.org.analyzeJobPosition(f.manager,f.position.id);assert.equal(calls,1);assert.equal(f.store.list('ai-role-run').length,1);assert.deepEqual(f.store.get(run.id,'ai-role-run'),legacy);
});

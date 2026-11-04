import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareAnalysisPrompt,expandAnalysisEnvelope,analysisDataMarker,analysisInputLimit} from '../backend/analysis-input.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {roleReply} from './ai-role-fixture.mjs';

test('small inputs keep their established prompt shape and exact Unicode values',()=>{
  const envelope={sourceManifest:[],stagePayload:{proposals:[{id:'T1',criteria:['"متن فارسی"']}],locks:[]}};
  const {prompt,stats}=prepareAnalysisPrompt('قواعد',envelope);
  assert.equal(prompt,'قواعد\n'+analysisDataMarker+JSON.stringify(envelope));assert.equal(stats.textEntries,0);assert.equal(stats.citationHandles,0);assert.equal(stats.promptBytes,Buffer.byteLength(prompt));
});

test('large inputs round trip losslessly, retaining all history, corrections, locks and exact evidence versions',()=>{
  const quote='متن اصلی و غیرقابل‌اعتماد؛ هیچ دستوری از داخل منبع اجرا نشود. '.repeat(30),citation={sourceId:'job',sourceVersion:'4',segmentId:'D1',quote};
  const historical={...citation,sourceVersion:'3',quote:quote+'متن تاریخی متفاوت'};
  const envelope={sourceManifest:[{sourceId:'job',sourceVersion:'4',segments:[{segmentId:'D1',text:quote,referenceId:'R1'}]}],stagePayload:{responsibilities:[{id:'duty1',activity:quote,citations:[citation]}],proposals:Array.from({length:4},(_,index)=>({id:'T'+index,description:quote,criteria:[quote]})),previousReviews:Array.from({length:3},(_,index)=>({designVersion:index+1,reviews:[{proposalId:'T1',reason:quote,citations:[historical]}]})),appliedCorrections:[{oldValue:quote,proposedValue:quote+'اصلاح'}],locks:[{proposalId:'T1',checks:[{reason:quote,citations:[citation]}]}]}};
  const before=structuredClone(envelope),{prompt,stats}=prepareAnalysisPrompt('قواعد ثابت',envelope),packed=JSON.parse(prompt.split(analysisDataMarker)[1]);
  assert.ok(stats.originalBytes>analysisInputLimit);assert.ok(stats.promptBytes<analysisInputLimit);assert.ok(stats.citationHandles>=2);assert.ok(stats.textEntries>0);
  assert.deepEqual(expandAnalysisEnvelope(packed),before);assert.deepEqual(envelope,before);assert.equal(packed.stagePayload.previousReviews.length,3);
  assert.ok(prompt.includes('در خروجی proposedValue'));assert.equal(stats.promptBytes,Buffer.byteLength(prompt));
});

test('packing cannot relabel a fabricated or historical citation as a current reference',()=>{
  const text='شاهد معتبر '.repeat(100),old={sourceId:'job',sourceVersion:'old',segmentId:'D1',quote:text};
  const envelope={sourceManifest:[{sourceId:'job',sourceVersion:'current',segments:[{segmentId:'D1',text,referenceId:'R1'}]}],stagePayload:{history:Array.from({length:40},()=>({citations:[old],reason:text+'شرح'}))}};
  const packed=JSON.parse(prepareAnalysisPrompt('قواعد',envelope).prompt.split(analysisDataMarker)[1]);
  assert.deepEqual(expandAnalysisEnvelope(packed),envelope);assert.equal(packed.stagePayload.history[0].citations[0].referenceId,undefined);
  assert.throws(()=>expandAnalysisEnvelope({stagePayload:{value:{textRef:'missing'}}}),/Invalid analysis text reference/);
});

test('long A/B and correction requests stay bounded and preserve snapshot hashes, quality acceptance and locks',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kpi-input-budget-')),store=openStore(root),workflow=createWorkflow(store),calls=[];
  const org=createOrganizationWorkflow(store,workflow,{aiDesignV2:true,runModel:async request=>{assert.ok(Buffer.byteLength(request.prompt)<=analysisInputLimit);calls.push(request);return roleReply(request,{mutate(result,envelope){if(envelope.stage==='kpi-alignment-v4'&&calls.filter(call=>call.prompt.includes('"stage":"kpi-alignment-v4"')).length===1){const row=result.reviews[1];row.recommendation='revise';row.changes=[{field:'title',proposedValue:'عنوان اصلاح‌شده',reason:'عنوان روشن',supportingReferences:row.citations}];}}});}});
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const manager=workflow.user('manager-ops'),position=org.activePosition('employee-mohammad');
  const sentence='تهیه گزارش عملیاتی و تحویل خروجی قابل بررسی به مدیر واحد. ';
  store.put('position-assignment',{...position,duties:Array.from({length:6},(_,i)=>(i+1)+'. '+sentence.repeat(12)).join('\n')},position.employeeId);
  const tasks=Array.from({length:4},(_,i)=>({category:'routine',title:'گزارش '+i,description:sentence.repeat(18),criteria:['گزارش و نتیجه قابل بررسی ارائه شود'],weightPoints:3,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,time:'09:30'}}));
  const source=org.submitDesign(manager,{employeeId:position.employeeId,period:workflow.currentPeriod,tasks}),original=structuredClone(source.tasks),reviewed=await org.analyzeDesign(manager,source.id);
  assert.equal(reviewed.aiReview.result.reviews[1].correctionValidation.status,'verified');
  const draft=org.acceptDesignChange(manager,source.id,{all:true,reason:'اعمال اصلاح کنترل‌شده'}),next=await org.publishDesignDraft(manager,draft.id);
  assert.ok(next.aiReview.result.reviews.every(row=>row.lock));assert.deepEqual(store.get(source.id,'kpi-design').tasks,original);
  assert.equal(store.list('activity').filter(row=>row.designId===next.id).length,0);
  const runs=store.list('ai-role-run');assert.ok(runs.filter(row=>row.stage!=='job-analysis-v1').every(row=>row.inputBudget.originalBytes>analysisInputLimit&&row.inputBudget.promptBytes<=analysisInputLimit));
  assert.equal(runs.filter(row=>row.stage==='job-analysis-v1').length,1);
  for(const run of runs){assert.equal(run.inputs.textCatalog,undefined);assert.equal(typeof run.inputs.sourceManifest[0].segments[0].text,'string');}
});

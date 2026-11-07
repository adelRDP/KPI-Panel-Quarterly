import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFileSynthesis,FILE_SYNTHESIS_VERSION,SYNTHESIS_PROMPT_BYTES} from '../backend/file-synthesis.mjs';
import {assessFullFile,planFileParts} from '../backend/file-assessment.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/quarterly-workflow.mjs';
import {createAutomaticReview} from '../backend/automatic-review.mjs';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';
const activity={id:'synthetic',kind:'routine',period:'1405-Q3',title:'کنترل گزارش',description:'ساختار و تطابق ردیف‌ها بررسی شود.',criteria:[{id:'C1',text:'هر ردیف شامل عنوان، موعد، زمان ارسال و وضعیت منطبق باشد.'}]};
const criterion=(status='met',quote='HEADER')=>({id:'C1',status,score:status==='insufficient'?null:status==='met'?100:40,reason:status==='insufficient'?'این بخش شامل سرستون‌ها نیست؛ نقص کل فایل اثبات نشده.':'سرستون‌ها و تطابق ردیف‌ها در این بخش کنترل شدند.',citations:quote?[{chunkId:'main',quote}]:[]});
function fixture(){
 const chunks=[{id:'main',documentId:'d',text:'HEADER | title | deadline | sent | status\nROW_1 | 10:00 | 09:45 | on-time\nROW_2 | 12:00 | 12:35 | late\nSYNTHETIC ONLY\n'+'x'.repeat(25000)},{id:'logs',documentId:'d',text:'LOG source receipts, synthetic only\n'+'y'.repeat(25000)}];
 return {chunks,documents:[{id:'d',name:'synthetic.xlsx',status:'ready',warnings:['Synthetic data is not proof of actual work.']}],totalChunks:2,omittedChunks:0,incomplete:false,bytes:50180};
}
const findings=[{part:1,sourceChunkIds:['main'],summary:'Structure and rows verified',criteria:[criterion()]},{part:2,sourceChunkIds:['logs'],summary:'Only logs in this part, no main headers here',criteria:[criterion('insufficient',null)]}];

test('synthesis restores original headers, uncited rows and synthetic warnings instead of bare short quotations',()=>{
 const evidence=fixture(),before=JSON.stringify(evidence),{prompt,packet}=buildFileSynthesis({activity,evidence,findings});
 assert.ok(Buffer.byteLength(prompt)<=SYNTHESIS_PROMPT_BYTES);
 assert.equal(packet.chunks.find(c=>c.id==='main').text,evidence.chunks[0].text);
 assert.ok(prompt.includes('ROW_2 | 12:00 | 12:35 | late'));
 assert.ok(prompt.includes('Synthetic data is not proof of actual work.'));
 assert.match(prompt,/local insufficient finding/);assert.match(prompt,/cannot prove actual execution/);
 assert.deepEqual(packet.sourceContext.fullChunkIds,['main']);assert.equal(packet.sourceContext.notRepeatedChunks,1);
 assert.equal(JSON.stringify(evidence),before);
});

test('group enrichment cannot include unrelated groups and preserves honest partial-extraction status',()=>{
 const evidence={...fixture(),incomplete:true},{packet}=buildFileSynthesis({activity,evidence,findings:[findings[1]],intermediate:true});
 assert.equal(packet.completeFileRead,false);assert.equal(packet.incomplete,true);assert.deepEqual(packet.chunks.map(c=>c.id),['logs']);
});

test('shared multi-part pipeline reuses all reading checkpoints and can cite restored rows in final reporting',async()=>{
 const evidence=fixture(),before=JSON.stringify(evidence),parts=planFileParts(activity,evidence,null);let calls=0,reused=0;
 assert.equal(parts.length,2);
 const {result}=await assessFullFile({activity,evidence,context:null,provider:'codex',assertCurrent:async()=>{},requiredCachedParts:2,
  partCache:async({index})=>({result:{summary:findings[index].summary,criteria:findings[index].criteria}}),onProgress:async p=>{if(p.phase==='read'&&p.cached)reused++;},
  runModel:async({prompt})=>{calls++;assert.ok(prompt.startsWith('FINAL FILE REPORT'));const packet=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]);assert.ok(packet.chunks[0].text.includes('ROW_2'));return {result:{summary:'Internal consistency only; synthetic evidence.',criteria:[criterion('met','ROW_2 | 12:00 | 12:35 | late')]}};}});
 assert.equal(calls,1);assert.equal(reused,2);assert.equal(result.fileProcessing.synthesisVersion,FILE_SYNTHESIS_VERSION);assert.equal(result.decision,'completed');assert.equal(JSON.stringify(evidence),before);
});

test('real missing evidence and contradictions still remain insufficient or unmet; scores are never forced',async()=>{
 for(const status of ['insufficient','unmet']){
  const evidence=fixture(),{result}=await assessFullFile({activity,evidence,context:null,provider:'codex',assertCurrent:async()=>{},partCache:async({index})=>({result:{summary:findings[index].summary,criteria:findings[index].criteria}}),runModel:async()=>({result:{summary:'Genuine gap remains',criteria:[criterion(status,status==='unmet'?'ROW_2':null)]}})});
  assert.equal(result.criteria[0].status,status);assert.equal(result.decision,status==='unmet'?'needs_revision':'insufficient');if(status==='insufficient')assert.equal(result.qualityScore,null);
 }
});

test('an explicit new review does not return an obsolete synthesis, while current results are cached and history is immutable',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quarter-synthesis-cache-')),{period}=seedQuarterlyFixture(root),store=openStore(root),workflow=createWorkflow(store);
 const actor=workflow.user('employee-0'),activity=store.put('activity',{id:'test-task',kind:'routine',title:'Synthetic task',description:'Synthetic report',period,ownerId:actor.id,unitId:actor.unitId,assignmentStatus:'approved',criteria:[{id:'C1',text:'Synthetic report provided'}]});
 store.put('document',{id:'doc',name:'synthetic.txt',createdAt:new Date().toISOString(),extraction:{status:'ready',chunks:[{id:'c',text:'Synthetic report provided'}],warnings:[]}},activity.id);
 const controller=createAutomaticReview(store,workflow,{enabled:false,busy:new Set(),runModel:()=>{throw Error('No model call allowed');}});
 try{
  const first=await controller.queue(actor,activity,'codex'),old=store.put('review',{...first,status:'done',result:{decision:'insufficient',fileProcessing:{version:'full-file-review-v1'}}},activity.id),snapshot=JSON.stringify(old);
  const fresh=await controller.queue(actor,activity,'codex');assert.notEqual(fresh.id,old.id);assert.equal(fresh.fingerprint,old.fingerprint);assert.equal(fresh.synthesisVersion,FILE_SYNTHESIS_VERSION);assert.equal(JSON.stringify(store.get(old.id,'review')),snapshot);
  store.put('review',{...fresh,status:'done',result:{decision:'completed',fileProcessing:{synthesisVersion:FILE_SYNTHESIS_VERSION}}},activity.id);
  const cached=await controller.queue(actor,activity,'codex');assert.equal(cached.id,fresh.id);assert.equal(cached.cached,true);assert.equal(store.list('review',activity.id).length,2);
 }finally{controller.stop();store.close();rmSync(root,{recursive:true,force:true});}
});

test('joining two excerpts cannot manufacture an original source quotation during synthesis',async()=>{
 const left='A'.repeat(7000),right='B'.repeat(7000),chunks=Array.from({length:2},(_,i)=>({id:'c'+i,text:left+' GAP '+'x'.repeat(17000)+right})),evidence={chunks,documents:[],totalChunks:2,omittedChunks:0,incomplete:false,bytes:62000};let calls=0;
 await assert.rejects(assessFullFile({activity,evidence,context:null,provider:'codex',assertCurrent:async()=>{},partCache:async({evidence:part})=>({result:{summary:'Local source read',criteria:[{id:'C1',status:'met',score:100,reason:'Local evidence',citations:[{chunkId:part.chunks[0].id,quote:left},{chunkId:part.chunks[0].id,quote:right}]}]}}),
 runModel:async({prompt})=>{calls++;const packet=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]),excerpt=packet.chunks.find(c=>!c.text.includes(' GAP '));assert.ok(excerpt);return {result:{summary:'Invalid joined quote',criteria:[{id:'C1',status:'met',score:100,reason:'Must be rejected',citations:[{chunkId:excerpt.id,quote:'AAA\nBBB'}]}]}};}}),error=>error.code==='invalid_citation'&&error.fileReviewDiagnostic.stage==='reporting');
 assert.equal(calls,3);
});

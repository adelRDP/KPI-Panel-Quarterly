import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFullFile,loadFullFileEvidence,planFileParts} from '../backend/file-assessment.mjs';
import {MAX_FULL_FILE_EVIDENCE_BYTES} from '../backend/evidence-limits.mjs';
const activity={id:'quarter-task',period:'1405-Q3',kind:'routine',title:'گزارش فصل',description:'بررسی کل گزارش فصل',criteria:[{id:'C1',text:'تمام خروجی‌ها ثبت شده باشد'}]};
test('quarterly evidence resumes after part 66 without repeating verified parts and reaches the final report',async()=>{
 const chunks=Array.from({length:70},(_,i)=>({id:'part-'+(i+1),documentId:'d',text:'SOURCE_'+(i+1)+' '+'x'.repeat(32000)})),evidence=await loadFullFileEvidence([{id:'d',name:'quarter.txt',extraction:{status:'ready',chunks,warnings:[]}}]),cache=new Map(),reads=new Map();let failed=false;
 assert.equal(planFileParts(activity,evidence,null).length,70);
 const args={activity,evidence,context:null,provider:'codex',assertCurrent:async()=>{},partCache:async({inputHash})=>cache.get(inputHash),onProgress:async p=>{if(p.phase==='read')cache.set(p.inputHash,{result:p.result});},runModel:async({prompt})=>{const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]),id=e.chunks[0].id,final=prompt.startsWith('FINAL FILE REPORT');if(!final){reads.set(id,(reads.get(id)||0)+1);if(id==='part-67'&&!failed){failed=true;throw Error('Synthetic interrupted provider');}}return {result:{summary:'نتیجهٔ ساختگی',criteria:[{id:'C1',status:'met',score:90,reason:'ارجاع ساختگی آزمون',citations:[{chunkId:id,quote:e.chunks[0].text.slice(0,8)}]}]}};}};
 await assert.rejects(assessFullFile(args));assert.equal(cache.size,66);const done=await assessFullFile({...args,resilientResume:true,requiredCachedParts:66});assert.equal(done.result.fileProcessing.complete,true);assert.equal(done.result.fileProcessing.readParts,70);assert.equal(done.result.fileProcessing.reusedParts,66);for(let i=1;i<=66;i++)assert.equal(reads.get('part-'+i),1);assert.equal(done.result.finalForActivity,true);
});
test('evidence capacity remains five MB; oversized files cannot be silently truncated',async()=>{
 assert.equal(MAX_FULL_FILE_EVIDENCE_BYTES,5_000_000);
 await assert.rejects(loadFullFileEvidence([{id:'d',name:'oversize.txt',extraction:{status:'ready',chunks:[{id:'c',text:'x'.repeat(MAX_FULL_FILE_EVIDENCE_BYTES+1)}]}}]));
});

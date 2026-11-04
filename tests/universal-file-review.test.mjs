import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,currentPeriod} from '../backend/personnel-workflow.mjs';
import {createAutomaticReview} from '../backend/automatic-review.mjs';
import {extractDocument} from '../backend/extract.mjs';
import {loadFullFileEvidence} from '../backend/file-assessment.mjs';
import {sha256} from '../backend/evaluation.mjs';
const XLSX=createRequire(import.meta.url)('../src/vendor/xlsx.full.min.js');

test('new reviews for different people, indicator kinds and file formats use full evidence and retry the current part',async t=>{
 const root=await mkdtemp(join(tmpdir(),'kpi-universal-review-')),store=openStore(root),workflow=createWorkflow(store);let stage;
 const controller=createAutomaticReview(store,workflow,{enabled:false,busy:new Set(),uploadRoot:root,archiveRejectedEvidence:false,notifications:{publish(){}},runModel:async({prompt,timeoutMs})=>{
  assert.equal(timeoutMs,300000);assert.equal(store.list('review',stage.activity.id)[0].result,undefined);
  if(!stage.timedOut){stage.timedOut=true;throw Error('مهلت پاسخ مدل تمام شد؛ نتیجه نهایی ثبت نشد.');}
  const evidence=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]),report=prompt.startsWith('FINAL FILE REPORT'),signature=evidence.chunks.map(c=>c.id).join('|');
  if(!report){assert.ok(!stage.successful.has(signature),'A valid part was re-analyzed');stage.successful.add(signature);for(const c of evidence.chunks)stage.seen.add(c.id);}
  const chunk=evidence.chunks.find(c=>c.text.includes('LAST_ROW_EVIDENCE'))||evidence.chunks[0],quote=chunk.text.includes('LAST_ROW_EVIDENCE')?'LAST_ROW_EVIDENCE':chunk.text.slice(0,10);
  return {result:{summary:'Synthetic complete evidence',criteria:[{id:'C1',status:'met',score:95,reason:'Synthetic structural check',citations:[{chunkId:chunk.id,quote}]}]}};
 }});
 t.after(async()=>{controller.stop();store.close();await rm(root,{recursive:true,force:true});});
 for(const ownerId of ['employee-mohammad','employee-sara'])for(const kind of ['routine','project'])for(const format of ['txt','xlsx']){
  const actor=workflow.user(ownerId),activity=store.put('activity',{kind,title:'Synthetic '+kind,description:'Synthetic input',period:currentPeriod(),ownerId,unitId:actor.unitId,assignmentStatus:'approved',criteria:[{id:'C1',text:'Synthetic supplied work product'}]});
  let bytes;if(format==='txt')bytes=Buffer.from('x'.repeat(220000)+' LAST_ROW_EVIDENCE');else{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Ordinal','Evidence'],...Array.from({length:300},(_,i)=>[i,i===299?'LAST_ROW_EVIDENCE':'Synthetic '+ 'x'.repeat(80)])]),'Synthetic');bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});}
  const path=join(root,activity.id),id='doc-'+activity.id;await writeFile(path,bytes);const extraction=await extractDocument(path,format,id);assert.equal(extraction.status,'ready');
  store.put('document',{id,path,name:'synthetic.'+format,sha256:sha256(bytes),createdAt:new Date().toISOString(),extraction},activity.id);stage={activity,timedOut:false,successful:new Set(),seen:new Set()};
  const queued=await controller.queue(actor,activity,'codex',{automatic:true}),row=store.get(queued.id,'review');assert.equal(row.processingPolicy,'complete-file-resilient-v1');assert.equal(row.resilientProcessing,true);assert.equal(row.evidenceSnapshot.omittedChunks,0);
  const done=await controller.execute(row);assert.equal(done.status,'done');assert.equal(done.result.fileProcessing.complete,true);assert.equal(done.result.fileProcessing.resilientProcessing,true);assert.equal(done.result.fileProcessing.automaticRetries.length,1);assert.equal(stage.seen.size,extraction.chunks.length);assert.equal(done.result.criteria[0].citations[0].quote,'LAST_ROW_EVIDENCE');
 }
});

test('long UTF-8 text is read beyond 200k characters; old truncated records are reread without being overwritten',async t=>{
 const root=await mkdtemp(join(tmpdir(),'kpi-long-text-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'source'),text='متن ساختگی '.repeat(23000)+'LAST_ROW_EVIDENCE',bytes=Buffer.from(text),id='long-text';await writeFile(path,bytes);
 const full=await extractDocument(path,'txt',id);assert.equal(full.status,'ready');assert.equal(full.version,'extract-v4-full-text');assert.equal(full.chunks.map(c=>c.text).join(''),text);assert.ok(full.chunks.at(-1).text.includes('LAST_ROW_EVIDENCE'));
 const original={status:'partial',version:'extract-v2',warnings:['متن استخراج‌شده به ۲۰۰ هزار نویسه محدود شد.'],chunks:[{id:id+':1',label:'Legacy',text:text.slice(0,200000)}]},before=JSON.stringify(original),doc={id,path,name:'synthetic.txt',sha256:sha256(bytes),extraction:original};
 const evidence=await loadFullFileEvidence([doc],root);assert.equal(evidence.incomplete,false);assert.equal(evidence.omittedChunks,0);assert.ok(evidence.chunks.at(-1).text.includes('LAST_ROW_EVIDENCE'));assert.equal(JSON.stringify(doc.extraction),before);assert.equal(evidence.documents[0].extractionHash,sha256(before));assert.notEqual(evidence.documents[0].processingHash,evidence.documents[0].extractionHash);
 await writeFile(path,'x'.repeat(5_000_001));const oversized=await extractDocument(path,'txt','oversized');assert.equal(oversized.status,'failed');assert.equal(oversized.chunks.length,0);assert.match(oversized.warnings.join(' '),/ظرفیت خواندن کامل/);
});

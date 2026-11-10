import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createRequire} from 'node:module';import {once} from 'node:events';
import {extractDocument} from '../backend/extract.mjs';import {preprocessWorkbook} from '../backend/workbook-harness.mjs';import {loadFullFileEvidence,assessFullFile,planFileParts} from '../backend/file-assessment.mjs';import {sha256,POLICY_VERSION} from '../backend/evaluation.mjs';import {createPanelServer} from '../server.mjs';import {openStore} from '../backend/store.mjs';
import {LEGACY_WORKBOOK_EVIDENCE_VERSION,MAX_FULL_FILE_EVIDENCE_BYTES,WORKBOOK_EVIDENCE_VERSION} from '../backend/evidence-limits.mjs';
const XLSX=createRequire(import.meta.url)('../src/vendor/xlsx.full.min.js');
const activity={id:'test-activity',kind:'routine',title:'بررسی گزارشهای فرد',description:'ردیف‌های فرد و بازهٔ زمانی گزارش را بررسی کن.',period:'1405-07',criteria:[{id:'C1',text:'گزارش مربوط به فرد با موعد مشخص ارائه شود.'}]},context={version:'task-evidence-context-v2',subject:{id:'synthetic-person',name:'فرد ساختگی'}};
function bookBytes(count=900){const b=XLSX.utils.book_new();for(const name of ['گزارشها','اطلاعات تکمیلی']){const rows=[['مسئول','موعد','زمان ارسال','شرح'],...Array.from({length:count},(_,i)=>['فرد ساختگی','15:00','15:03',i===count-1?'LAST_ROW_EVIDENCE':'ردیف ساختگی '+i])];XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet(rows),name);}return XLSX.write(b,{type:'buffer',bookType:'xlsx'});}
async function fixture(t,count){const root=await mkdtemp(join(tmpdir(),'kpi-full-file-')),path=join(root,'source'),bytes=bookBytes(count);await writeFile(path,bytes);t.after(()=>rm(root,{recursive:true,force:true}));const doc={id:'source-document',path,name:'work.xlsx',sha256:sha256(bytes),createdAt:'2026-10-10T12:00:00Z',extraction:await extractDocument(path,'xlsx','source-document')};return {root,path,bytes,doc};}
const reply=evidence=>{const c=evidence.chunks.find(c=>c.text.includes('LAST_ROW_EVIDENCE'))||evidence.chunks[0];return {result:{summary:'خلاصهٔ ساختگی آزمون خوانش',criteria:[{id:'C1',status:'met',score:95,reason:'صرفاً آزمون ساختار و ارجاع',citations:[{chunkId:c.id,quote:c.text.includes('LAST_ROW_EVIDENCE')?'LAST_ROW_EVIDENCE':c.text.slice(0,15)}]}]},usage:{input_tokens:10,output_tokens:10}};};

const eightParts=()=>({chunks:Array.from({length:8},(_,i)=>({id:'P'+(i+1),documentId:'D1',label:'Synthetic part '+(i+1),text:'PART_'+(i+1)+' '+ 'x'.repeat(32000)})),documents:[{id:'D1',name:'synthetic.txt',status:'ready'}],bytes:256100,totalChunks:8,omittedChunks:0,incomplete:false});

test('large findings are merged in bounded groups covering every part before final reporting',async()=>{
 const evidence={...eightParts(),chunks:Array.from({length:50},(_,i)=>({id:'P'+(i+1),documentId:'D1',text:'SOURCE_'+(i+1)+' '+ 'x'.repeat(32000)})),totalChunks:50,bytes:1_601_000},seen=new Set(),grouped=new Set();let calls=0,merges=0,finals=0;
 const output=await assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel:async({prompt})=>{
  calls++;assert.ok(Buffer.byteLength(prompt)<=50000);const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]);const merge=prompt.startsWith('FILE REPORT MERGE'),final=prompt.startsWith('FINAL FILE REPORT');
  if(merge||final){const findings=JSON.parse(prompt.split('VERIFIED PART FINDINGS:\n')[1].split('\nYou assess')[0]);for(const f of findings)for(const index of f.parts||[f.part])grouped.add(index);if(merge)merges++;else{finals++;assert.equal(grouped.size,50);}}else for(const c of e.chunks){assert.ok(!seen.has(c.id));seen.add(c.id);}
  const quote=e.chunks[0].text.slice(0,8);return {result:{summary:merge||final?'Synthetic merged': 's'.repeat(800),criteria:[{id:'C1',status:'met',score:95,reason:merge||final?'Synthetic merged':'r'.repeat(800),citations:[{chunkId:e.chunks[0].id,quote}]}]}};
 }});assert.equal(seen.size,50);assert.ok(merges>1);assert.equal(finals,1);assert.equal(output.result.fileProcessing.synthesisCalls,merges+1);assert.equal(output.result.fileProcessing.modelCalls,calls);assert.equal(output.result.fileProcessing.complete,true);
});

test('failed grouped synthesis cannot become a final score',async()=>{
 const evidence={...eightParts(),chunks:Array.from({length:50},(_,i)=>({id:'P'+i,text:'SOURCE '+ 'x'.repeat(32000)})),totalChunks:50,bytes:1_601_000};let finals=0;
 await assert.rejects(assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel:async({prompt})=>{if(prompt.startsWith('FILE REPORT MERGE'))throw Error('Synthetic merge failure');if(prompt.startsWith('FINAL FILE REPORT'))finals++;const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]);return {result:{summary:'s'.repeat(800),criteria:[{id:'C1',status:'met',score:95,reason:'r'.repeat(800),citations:[{chunkId:e.chunks[0].id,quote:'SOURCE'}]}]}};}}),e=>e.fileReviewDiagnostic.stage==='reporting'&&e.fileReviewDiagnostic.code==='provider_failure');assert.equal(finals,0);
});

test('the full evidence budget accepts exactly 5 MB and rejects one byte over without truncation',async()=>{
 const chunk={id:'boundary:1',label:'Synthetic boundary',text:''},document={id:'boundary',name:'synthetic.txt',extraction:{status:'ready',chunks:[chunk],warnings:[]}};
 const overhead=Buffer.byteLength(JSON.stringify({...chunk,documentId:document.id}));chunk.text='x'.repeat(MAX_FULL_FILE_EVIDENCE_BYTES-overhead);
 const before=sha256(JSON.stringify(document)),evidence=await loadFullFileEvidence([document]);assert.equal(evidence.bytes,5_000_000);assert.equal(evidence.chunks[0].text.length,chunk.text.length);assert.equal(evidence.omittedChunks,0);assert.equal(evidence.incomplete,false);assert.equal(sha256(JSON.stringify(document)),before);
 chunk.text+='x';await assert.rejects(loadFullFileEvidence([document]),e=>e.status===413&&e.message.includes('۵ مگابایت'));assert.equal(chunk.text.length,MAX_FULL_FILE_EVIDENCE_BYTES-overhead+1);
});

test('evidence above 2 MB and 48 parts reaches every reading request and final synthesis',async()=>{
 const chunks=Array.from({length:100},(_,i)=>({id:'large:'+i,label:'Synthetic part '+i,text:'PART_'+i+' '+ 'x'.repeat(40000)+(i===99?' LAST_ROW_EVIDENCE':'')})),document={id:'large',name:'synthetic.txt',extraction:{status:'ready',chunks,warnings:[]}},evidence=await loadFullFileEvidence([document]),parts=planFileParts(activity,evidence,context),seen=new Set();let calls=0;
 assert.ok(evidence.bytes>2_000_000&&evidence.bytes<5_000_000);assert.ok(parts.length>48);assert.equal(parts.flatMap(p=>p.chunks).length,chunks.length);
 const output=await assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel:async({prompt})=>{calls++;assert.ok(Buffer.byteLength(prompt)<=50000);const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]);if(!prompt.startsWith('FINAL FILE REPORT'))for(const c of e.chunks)seen.add(c.id);const c=e.chunks.find(c=>c.text.includes('LAST_ROW_EVIDENCE'))||e.chunks[0];return {result:{summary:'Synthetic',criteria:[{id:'C1',status:'met',score:95,reason:'Synthetic',citations:[{chunkId:c.id,quote:c.text.includes('LAST_ROW_EVIDENCE')?'LAST_ROW_EVIDENCE':c.text.slice(0,8)}]}]}};}});
 assert.equal(seen.size,chunks.length);assert.equal(calls,parts.length+1);assert.equal(output.result.fileProcessing.readParts,parts.length);assert.equal(output.result.fileProcessing.complete,true);assert.equal(output.result.criteria[0].citations[0].quote,'LAST_ROW_EVIDENCE');
});

test('an invalid sixth-part quotation is repaired locally without replaying five valid parts or changing evidence',async()=>{
 const evidence=eightParts(),before=JSON.stringify(evidence),calls=new Map(),progress=[],cache=new Map();assert.equal(planFileParts(activity,evidence,context).length,8);
 const runModel=async({prompt})=>{assert.ok(Buffer.byteLength(prompt)<=50000);assert.ok(!prompt.includes('UNTRUSTED_REJECTED_OUTPUT'));const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]),synthesis=prompt.includes('FINAL FILE REPORT:'),key=synthesis?'final':e.chunks[0].id,n=(calls.get(key)||0)+1;calls.set(key,n);const r=reply(e);if(key==='P6'&&n===1){r.result.summary='UNTRUSTED_REJECTED_OUTPUT';r.result.criteria[0].citations[0].quote='FABRICATED_QUOTE';}if(key==='P6'&&n===2)assert.match(prompt,/MODEL OUTPUT VALIDATION REPAIR 1\/2/);return r;};
 const args={activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel,partCache:async({inputHash})=>cache.get(inputHash)||null,onProgress:async p=>{progress.push(p);if(p.phase==='read')cache.set(p.inputHash,{result:p.result});}};
 const output=await assessFullFile(args);assert.equal(output.result.fileProcessing.modelCalls,10);assert.equal(output.result.fileProcessing.readParts,8);assert.equal(output.result.fileProcessing.validationRetries.length,1);assert.equal(output.result.fileProcessing.validationRetries[0].code,'invalid_citation');assert.equal(output.result.fileProcessing.validationRetries[0].part,6);assert.equal(calls.get('P6'),2);for(const id of ['P1','P2','P3','P4','P5','P7','P8'])assert.equal(calls.get(id),1);assert.deepEqual(progress.filter(p=>p.phase==='read').map(p=>p.index),[1,2,3,4,5,6,7,8]);const retry=progress.find(p=>p.phase==='repairing');assert.equal(retry.index,5);assert.equal(retry.diagnostic.part,6);assert.equal(output.result.qualityScore,95);assert.equal(JSON.stringify(evidence),before);
 const again=await assessFullFile(args);assert.equal(again.result.fileProcessing.reusedParts,8);assert.equal(again.result.fileProcessing.modelCalls,1);assert.equal(calls.get('P6'),2);
});

test('repeated invalid sixth-part responses stop after two repairs with exact diagnostic and no accepted partial grade',async()=>{
 const progress=[],calls=[];let failure;try{await assessFullFile({activity,evidence:eightParts(),context,provider:'codex',assertCurrent:async()=>{},onProgress:async p=>progress.push(p),runModel:async({prompt})=>{const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]);calls.push(e.chunks[0].id);const r=reply(e);if(e.chunks[0].id==='P6')r.result.criteria[0].citations[0].quote='FABRICATED_QUOTE';return r;}});}catch(error){failure=error;}
 assert.ok(failure);assert.equal(failure.code,'invalid_citation');assert.equal(failure.status,422);assert.equal(failure.fileReviewDiagnostic.part,6);assert.equal(failure.fileReviewDiagnostic.readParts,5);assert.equal(failure.fileReviewDiagnostic.totalParts,8);assert.equal(failure.fileReviewDiagnostic.attempt,3);assert.equal(failure.fileReviewDiagnostic.validationRetries.length,3);assert.equal(calls.filter(id=>id==='P6').length,3);assert.equal(calls.length,8);assert.deepEqual(progress.filter(p=>p.phase==='read').map(p=>p.index),[1,2,3,4,5]);assert.equal(failure.fileReviewUsage.input_tokens,80);
});

test('final synthesis has the same bounded grounding repair and cannot claim completion after repeated invalid output',async()=>{
 let finalCalls=0;const progress=[];await assert.rejects(assessFullFile({activity,evidence:eightParts(),context,provider:'codex',assertCurrent:async()=>{},onProgress:async p=>progress.push(p),runModel:async({prompt})=>{const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]),r=reply(e);if(prompt.includes('FINAL FILE REPORT:')){finalCalls++;r.result.criteria[0].citations[0].quote='FABRICATED_FINAL';}return r;}}),error=>error.code==='invalid_citation'&&error.fileReviewDiagnostic.stage==='reporting'&&error.fileReviewDiagnostic.readParts===8&&error.fileReviewDiagnostic.part===null);assert.equal(finalCalls,3);assert.equal(progress.filter(p=>p.phase==='read').length,8);
});

test('invalid cached quotations are not trusted and a changed file blocks the next repair model call',async()=>{
 const evidence=eightParts();let calls=0;const output=await assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{},partCache:async({evidence})=>{const r=reply(evidence);r.result.criteria[0].citations[0].quote='BAD_CACHE';return r;},runModel:async({prompt})=>{calls++;return reply(JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]));}});assert.equal(output.result.fileProcessing.reusedParts,0);assert.equal(calls,9);
 let changed=false,repairCalls=0;await assert.rejects(assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{if(changed)throw Error('Changed while repairing');},onProgress:async p=>{if(p.phase==='repairing')changed=true;},runModel:async({prompt})=>{repairCalls++;const r=reply(JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]));r.result.criteria[0].citations[0].quote='INVALID';return r;}}),/Changed while repairing/);assert.equal(repairCalls,1);
});

test('a repaired insufficient response stays unknown and provider failures never trigger validation retries',async()=>{
 const evidence={...eightParts(),chunks:[{id:'P1',text:'SYNTHETIC literal evidence'}],totalChunks:1,bytes:100};let calls=0;const output=await assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel:async()=>{calls++;return calls===1?{result:{summary:'Bad',criteria:[]}}:{result:{summary:'Unknown',criteria:[{id:'C1',status:'insufficient',score:null,reason:'No sufficient evidence',citations:[]}]}};}});assert.equal(calls,2);assert.equal(output.result.qualityScore,null);assert.equal(output.result.finalForActivity,false);
 calls=0;await assert.rejects(assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel:async()=>{calls++;throw Error('PRIVATE_PROVIDER_PAYLOAD');}}),error=>error.fileReviewDiagnostic.code==='provider_failure'&&!error.fileReviewDiagnostic.message.includes('PRIVATE_PROVIDER_PAYLOAD'));assert.equal(calls,1);
});
test('full workbook evidence preserves all sheets and cells beyond 100, never silently samples rows',async t=>{
 const {root,doc}=await fixture(t,160),evidence=await loadFullFileEvidence([doc],root);assert.equal(doc.extraction.status,'ready');assert.equal(doc.extraction.workbook.totalSheets,2);assert.equal(doc.extraction.workbook.totalCells,1288);assert.equal(evidence.omittedChunks,0);assert.equal(evidence.incomplete,false);
 const cells=doc.extraction.chunks.flatMap(c=>JSON.parse(c.text).cells);assert.equal(cells.length,1288);assert.equal(cells.filter(c=>c.value==='LAST_ROW_EVIDENCE').length,2);assert.ok(doc.extraction.chunks.every(c=>c.label.includes('شیت')&&c.label.includes('سلول')));
});
test('every original file chunk reaches the model before synthesis and all citations are grounded',async t=>{
 const {root,doc}=await fixture(t,400),evidence=await loadFullFileEvidence([doc],root),parts=planFileParts(activity,evidence,context);assert.ok(parts.length>1);const seen=new Set();let calls=0;
 const output=await assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel:async({prompt,schema})=>{calls++;assert.ok(Buffer.byteLength(prompt)<=50000);assert.ok(schema.properties.criteria);const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]);if(!prompt.startsWith('FINAL FILE REPORT'))for(const c of e.chunks)seen.add(c.id);return reply(e);}});
 assert.equal(seen.size,evidence.totalChunks);assert.equal(calls,parts.length+1);assert.equal(output.result.finalForActivity,true);assert.equal(output.result.policyVersion,POLICY_VERSION);assert.equal(output.result.fileProcessing.complete,true);assert.equal(output.result.fileProcessing.documents[0].cells,3208);assert.equal(output.result.criteria[0].citations[0].quote,'LAST_ROW_EVIDENCE');
});
test('failed file part never becomes a score, changed context aborts and invalid citations cannot pass',async t=>{
 const {root,doc}=await fixture(t,400),evidence=await loadFullFileEvidence([doc],root);let calls=0;await assert.rejects(assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel:async({prompt})=>{if(++calls===2)throw Error('Synthetic part failure');return reply(JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]));}}),/Synthetic part failure/);
 let checks=0;await assert.rejects(assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{if(++checks===2)throw Error('Changed file');},runModel:async({prompt})=>reply(JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]))}),/Changed file/);
 await assert.rejects(assessFullFile({activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel:async({prompt})=>{const r=reply(JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]));r.result.criteria[0].citations[0].quote='FABRICATED_QUOTE';return r;}}),/ارجاع/);
});
test('legacy discovery is reread from the original file without overwriting the original extraction or score',async t=>{
 const {root,path,doc,bytes}=await fixture(t,160),discovery=preprocessWorkbook(bytes,'xlsx');const legacy={...doc,extraction:{status:'partial',warnings:discovery.warnings,chunks:[{id:doc.id+':1',label:'ساختار و آمار اکسل',text:discovery.context}]}};const before=JSON.stringify(legacy.extraction),evidence=await loadFullFileEvidence([legacy],root);assert.equal(evidence.incomplete,false);assert.equal(evidence.documents[0].workbook.totalCells,1288);assert.equal(evidence.documents[0].extractionHash,sha256(before));assert.notEqual(evidence.documents[0].processingHash,sha256(before));assert.equal(JSON.stringify(legacy.extraction),before);await writeFile(path,'changed');await assert.rejects(loadFullFileEvidence([legacy],root),/فایل اصلی تغییر/);
});
test('new reviews upgrade stored workbook evidence while a resumed review retains its original format',async t=>{
 const {root,path,doc}=await fixture(t,10);
 const extraction=await extractDocument(path,'xlsx',doc.id,{workbookEvidenceVersion:LEGACY_WORKBOOK_EVIDENCE_VERSION});
 const legacy={...doc,extraction};
 const oldMetadata={documents:[{id:doc.id,workbook:extraction.workbook}]};
 const resumed=await loadFullFileEvidence([legacy],root,{previousEvidence:oldMetadata});
 assert.deepEqual(resumed.chunks,extraction.chunks.map(chunk=>({...chunk,documentId:doc.id})));
 assert.equal(resumed.documents[0].processingHash,sha256(JSON.stringify(extraction)));
 const current=await loadFullFileEvidence([legacy],root);
 assert.equal(current.documents[0].workbook.version,WORKBOOK_EVIDENCE_VERSION);
 assert.equal(current.documents[0].workbook.totalCells,extraction.workbook.totalCells);
 assert.equal(legacy.extraction.workbook.version,LEGACY_WORKBOOK_EVIDENCE_VERSION);
 const reread=await loadFullFileEvidence([doc],root,{previousEvidence:oldMetadata});
 assert.deepEqual(reread.chunks,resumed.chunks);
});
test('incomplete reading cannot produce a final score, and retry only reuses exact grounded file parts',async t=>{
 const {root,doc}=await fixture(t,400),evidence=await loadFullFileEvidence([doc],root),cache=new Map();let calls=0;
 const args={activity,evidence,context,provider:'codex',assertCurrent:async()=>{},runModel:async({prompt})=>{calls++;return reply(JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]));},partCache:async({inputHash})=>cache.has(inputHash)?{result:cache.get(inputHash)}:null,onProgress:async p=>{if(p.phase==='read')cache.set(p.inputHash,p.result);}};
 const first=await assessFullFile(args),prior=calls,second=await assessFullFile(args);assert.equal(calls-prior,1);assert.equal(second.result.fileProcessing.reusedParts,first.result.fileProcessing.totalParts);assert.equal(second.result.criteria[0].citations[0].quote,'LAST_ROW_EVIDENCE');
 const partial=await assessFullFile({...args,evidence:{...evidence,incomplete:true},partCache:undefined});assert.equal(partial.result.finalForActivity,false);assert.equal(partial.result.qualityScore,null);assert.equal(partial.result.fileProcessing.complete,false);
});
test('contact/payroll workbooks stay blocked before model calls and raw files outside the upload root cannot be read',async t=>{
 const {root,doc}=await fixture(t,2),b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['موبایل'],['09123456789']]),'private');const bytes=XLSX.write(b,{type:'buffer',bookType:'xlsx'});await writeFile(doc.path,bytes);doc.sha256=sha256(bytes);doc.extraction=await extractDocument(doc.path,'xlsx',doc.id);await assert.rejects(loadFullFileEvidence([doc],root),e=>e.status===422);const other=await mkdtemp(join(tmpdir(),'kpi-other-root-'));t.after(()=>rm(other,{recursive:true,force:true}));await assert.rejects(loadFullFileEvidence([doc],other),e=>e.status===403);
});
test('HTTP upload queues full-file evidence, reports actual reading coverage and never changes task scoring rules',async t=>{
 const root=await mkdtemp(join(tmpdir(),'kpi-file-http-')),server=createPanelServer({dataRoot:root,archiveRejectedEvidence:false,runModel:async({prompt})=>reply(JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]))});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,session=await(await fetch(base+'/api/session')).json(),store=openStore(root);t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();await rm(root,{recursive:true,force:true});});
 const a=store.put('activity',{...activity,id:undefined,ownerId:session.user.id,unitId:'ops',assignmentStatus:'approved'}),response=await fetch(base+'/api/activities/'+a.id+'/documents?name=work.xlsx&workEvidence=true',{method:'POST',headers:{'x-panel-token':session.token},body:bookBytes(160)});assert.equal(response.status,201);const d=await response.json();assert.equal(d.extraction.workbook.totalCells,1288);
 let r;for(let i=0;i<100;i++){r=store.list('review',a.id)[0];if(r&&['done','failed'].includes(r.status))break;await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(r.status,'done',r.error);assert.equal(r.evidenceSnapshot.omittedChunks,0);assert.equal(r.result.fileProcessing.complete,true);assert.equal(r.result.fileProcessing.documents[0].sheets,2);assert.equal(r.result.criteria[0].citations[0].quote,'LAST_ROW_EVIDENCE');assert.ok(store.list('review-file-part',r.id).length);assert.equal(store.get(a.id,'activity').criteria[0].text,activity.criteria[0].text);
});

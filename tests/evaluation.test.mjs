import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {request} from 'node:http';
import {createRequire} from 'node:module';
import {zipSync,strToU8} from 'fflate';
import {validateActivity,selectEvidence,finalizeReview} from '../backend/evaluation.mjs';
import {extractDocument} from '../backend/extract.mjs';
import {MAX_FULL_FILE_EVIDENCE_BYTES} from '../backend/evidence-limits.mjs';
import {createPanelServer} from '../server.mjs';
import {openStore} from '../backend/store.mjs';
import {createCanvas} from '@napi-rs/canvas';
const require=createRequire(import.meta.url), XLSX=require('../src/vendor/xlsx.full.min.js');
const input={kind:'task',title:'Report',description:'Status report',period:'',criteria:['Include completion date']};
const activity=validateActivity(input);
const document={id:'doc1',name:'report.txt',sha256:'hash',extraction:{status:'ready',warnings:[],chunks:[{id:'doc1:1',label:'text',text:'Completed on 2026-09-19.'}]}};
const valid=()=>({summary:'Verified',criteria:[{id:'C1',status:'met',score:90,reason:'Date present',citations:[{chunkId:'doc1:1',quote:'2026-09-19'}]}]});
test('rubric and evidence validation, insufficient coverage, no arbitrary model fields',()=>{
  assert.throws(()=>validateActivity(null));
  assert.throws(()=>validateActivity({...input,kind:'routine'}));
  const evidence=selectEvidence(activity,[document]);
  assert.equal(finalizeReview({...valid(),unexpected:true},activity,evidence).unexpected,undefined);
  assert.equal(finalizeReview(valid(),activity,evidence).decision,'completed');
  assert.equal(finalizeReview(valid(),activity,{...evidence,incomplete:true}).qualityScore,null);
  for(const mutate of [r=>r.criteria[0].citations[0].quote='invented',r=>r.criteria[0].id='C9',r=>r.criteria[0].score=101,r=>r.criteria[0].citations=[],r=>r.criteria=[null]]) {
    const raw=valid();mutate(raw);assert.throws(()=>finalizeReview(raw,activity,evidence));
  }
  const raw=valid();raw.criteria[0].status='insufficient';raw.criteria[0].score=null;raw.criteria[0].citations=[];
  assert.equal(finalizeReview(raw,activity,evidence).finalForActivity,false);
  assert.equal(selectEvidence(activity,[document],1).incomplete,true);
});
test('real text, spreadsheet and Office extraction, corruption and size guards',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-extract-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let n=0;
  const extract=async(bytes,ext)=>{const path=join(dir,String(++n));await writeFile(path,bytes);return extractDocument(path,ext,'doc');};
  assert.equal((await extract('گزارش تکمیل شد','txt')).status,'ready');
  assert.ok((await extract('وضعیت\nتکمیل شد','csv')).chunks.some(c=>c.text.includes('تکمیل شد')));
  assert.equal((await extract(Buffer.from([0xff,0xfe]),'txt')).status,'failed');
  assert.equal((await extract('not a spreadsheet','xlsx')).status,'failed');
  assert.equal((await extract('unknown','xyz')).status,'unsupported');
  assert.equal((await extract('x'.repeat(200001),'txt')).status,'ready');
  const oversized=await extract('x'.repeat(MAX_FULL_FILE_EVIDENCE_BYTES+1),'txt');assert.equal(oversized.status,'failed');assert.equal(oversized.chunks.length,0);
  const workbook=rows=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Data');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});};
  const small=await extract(workbook([['Status'],['Complete']]),'xlsx');
  assert.equal(small.status,'ready');assert.ok(small.chunks.some(c=>c.text.includes('Complete')));
  const large=await extract(workbook([['Status'],...Array.from({length:101},()=>['SECRET_ROW'])]),'xlsx');
  assert.equal(large.status,'ready');assert.ok(large.chunks.some(c=>c.text.includes('SECRET_ROW')));assert.equal(large.workbook.totalCells,102);assert.equal(large.workbook.version,'workbook-cells-v2');
  const docx=zipSync({
    '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Completed on 2026-09-19.</w:t></w:r></w:p></w:body></w:document>')
  });
  const word=await extract(docx,'docx');assert.equal(word.status,'ready');assert.match(word.chunks[0].text,/Completed/);
  const ppt=await extract(zipSync({'ppt/slides/slide1.xml':strToU8('<p:sld><a:t>Completed report</a:t></p:sld>')}),'pptx');
  assert.equal(ppt.status,'ready');assert.match(ppt.chunks[0].text,/Completed report/);
  assert.equal((await extract(zipSync({'word/bomb':new Uint8Array(41*1024*1024)}),'docx')).status,'failed');
});
// Small standards-conforming PDF, generated without external services or sensitive fixtures.
export function textPdf(text='Completed on 2026-09-19.') {
  const stream=`BT /F1 12 Tf 30 150 Td (${text}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n', offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const start=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return pdf;
}
test('real PDF text is extracted with page citations',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-pdf-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'sample.pdf');await writeFile(path,textPdf());
  const result=await extractDocument(path,'pdf','pdf1');assert.equal(result.status,'ready',JSON.stringify(result));assert.match(result.chunks[0].text,/2026-09-19/);assert.match(result.chunks[0].label,/1/);
  await writeFile(path,textPdf(''));
  const blank=await extractDocument(path,'pdf','pdf1',{convert:async({images})=>{assert.equal(images.length,1);return {result:{pages:[{index:1,text:'Blank page; no evidence.',complete:false}]}};}});
  assert.equal(blank.status,'partial');assert.equal(blank.chunks.length,1);
});
test('image preprocessing is bounded, validates model OCR, and fails closed',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-image-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const canvas=createCanvas(400,100);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,100);ctx.fillStyle='black';ctx.font='24px sans-serif';ctx.fillText('Completed 2026-09-19',10,50);
  const path=join(dir,'source.png');await writeFile(path,canvas.toBuffer('image/png'));
  let called=0;
  const converted=await extractDocument(path,'png','image',{provider:'codex',convert:async args=>{called++;assert.equal(args.images.length,1);assert.ok(args.schema);return {result:{pages:[{index:1,text:'Completed 2026-09-19',complete:true}]},usage:{input_tokens:20}};}});
  assert.equal(called,1);assert.equal(converted.status,'ready');assert.equal(converted.visuals,undefined);assert.equal(converted.conversion.usage.input_tokens,20);assert.match(converted.chunks[0].id,/visual-1/);
  const failed=await extractDocument(path,'png','image',{convert:async()=>({result:{pages:[]}})});assert.equal(failed.status,'failed');assert.equal(failed.chunks.length,0);
});
test('HTTP end-to-end: isolation, upload, cache, audit, locking and restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-http-test-'));
  let calls=0, release, entered;
  const model=async({prompt})=>{
    calls++;if(entered){entered();await new Promise(r=>release=r);}
    const evidence=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]);const chunk=evidence.chunks[0];
    return {result:{summary:'Verified',criteria:[{id:'C1',status:'met',score:95,reason:'Date present',citations:[{chunkId:chunk.id,quote:'2026-09-19'}]}]},usage:{input_tokens:123}};
  };
  let server=createPanelServer({dataRoot:dir,runModel:model});
  const listen=async()=>{server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;};
  let base=await listen(),token=(await(await fetch(base+'/api/session')).json()).token;
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const api=(path,options={})=>fetch(base+path,{...options,headers:{'x-panel-token':token,...options.headers}});
  const post=(path,data)=>api(path,{method:'POST',body:JSON.stringify(data)});
  assert.equal((await fetch(base+'/api/activities')).status,403);
  assert.equal((await fetch(base+'/api/session',{headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await fetch(base+'/api/session',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  for(const path of ['/.env','/backend/providers.mjs','/data/local/panel.sqlite','/.git/config'])assert.equal((await api(path)).status,404);
  const first=await(await post('/api/activities',input)).json();
  const second=await(await post('/api/activities',{...input,kind:'project'})).json();
  const route=`/api/activities/${first.id}`;
  const upload=()=>api(route+'/documents?name=report.txt',{method:'POST',body:'Completed on 2026-09-19.'});
  const doc=await(await upload()).json();assert.equal(doc.extraction.status,'ready');assert.equal(doc.path,undefined);
  assert.equal((await upload()).status,200);
  assert.equal((await(await api(`/api/activities/${second.id}`)).json()).documents.length,0);
  assert.equal((await post(route+'/reviews',{provider:'invalid'})).status,400);
  const review=await(await post(route+'/reviews',{provider:'codex'})).json();assert.equal(review.result.decision,'completed');assert.ok(review.evidenceSnapshot);assert.equal(calls,1);
  assert.equal((await(await post(route+'/reviews',{provider:'codex'})).json()).cached,true);assert.equal(calls,1);
  await api(route+'/documents?name=extra.txt',{method:'POST',body:'Additional result 2026-09-19.'});
  const started=new Promise(r=>entered=r);
  const running=post(route+'/reviews',{provider:'codex'});await started;
  assert.equal((await post(route+'/reviews',{provider:'codex'})).status,409);
  assert.equal((await upload()).status,409);release();assert.equal((await running).status,200);entered=null;
  // A slow body must hold the lock before parsing, not just during the model call.
  const req=request(base+route+'/reviews',{method:'POST',headers:{'x-panel-token':token,'Content-Type':'application/json'}},res=>res.resume());
  req.write('{');await new Promise(r=>setTimeout(r,50));
  assert.equal((await post(route+'/reviews',{provider:'codex'})).status,409);
  req.end('"provider":"codex"}');await once(req,'close');
  await new Promise(r=>server.close(r));
  const store=openStore(dir);store.put('review',{status:'running',activitySnapshot:first},first.id);store.close();
  server=createPanelServer({dataRoot:dir,runModel:model});base=await listen();token=(await(await fetch(base+'/api/session')).json()).token;
  const restored=await(await api(route)).json();assert.equal(restored.documents.length,2);assert.ok(restored.reviews.some(r=>r.status==='failed'));assert.ok(!restored.reviews.some(r=>r.status==='running'));
  assert.equal((await api(`/api/activities/${second.id}/documents/${doc.id}`,{method:'DELETE'})).status,404);
  assert.equal((await api(route+'/documents/'+doc.id,{method:'DELETE'})).status,200);
  const archived=await(await api(route)).json();assert.equal(archived.documents.length,1);assert.ok(archived.reviews.some(r=>r.evidenceSnapshot?.chunks.some(c=>c.documentId===doc.id)));
});
test('invalid model output records failure and releases the review lock',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-failure-test-'));let fail=true;
  const server=createPanelServer({dataRoot:dir,runModel:async()=>{if(fail)throw new Error('Private internal failure');return {result:{summary:'Unclear',criteria:[{id:'C1',status:'insufficient',score:null,reason:'Needs independent evidence',citations:[]}]}};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const {token}=await(await fetch(base+'/api/session')).json();
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'x-panel-token':token},body});
  const a=await(await post('/api/activities',JSON.stringify(input))).json();const route=`/api/activities/${a.id}`;
  await post(route+'/documents?name=report.txt','2026-09-19');
  const failure=await post(route+'/reviews','{}');assert.equal(failure.status,400);assert.ok(!(await failure.text()).includes('Private internal failure'));
  fail=false;await post(route+'/documents?name=report.txt','2026-09-19');const retry=await(await post(route+'/reviews','{}')).json();assert.equal(retry.status,'done');assert.equal(retry.result.finalForActivity,false);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createPanelServer} from '../server.mjs';
import {currentPeriod,periodBounds} from '../backend/personnel-workflow.mjs';
import {requireWorkEvidence} from '../backend/evidence-privacy.mjs';
import {createScoreSettings} from '../backend/score-rules.mjs';
import {randomUUID} from 'node:crypto';
import {createReviewRetention,reviewEvidenceMatches} from '../backend/review-retention.mjs';
import {createCanvas} from '@napi-rs/canvas';

async function setup(t,extra={}){
 const root=await mkdtemp(join(tmpdir(),'kpi-auto-review-'));let calls=0,lastPrompt,release;
 // Legacy cache/retry tests can isolate retention; all lifecycle tests below exercise production defaults.
 let server=createPanelServer({dataRoot:root,...(extra.archive===undefined?{archiveRejectedEvidence:false}:{}),runModel:async({prompt})=>{calls++;lastPrompt=prompt;if(extra.hold)await new Promise(r=>release=r);if(extra.fail)throw Error('Synthetic model failure');const evidence=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]),chunk=evidence.chunks[0];const output={result:{summary:'نتیجه صرفاً ساختگی آزمون',criteria:[{id:'C1',status:extra.approved?'met':extra.insufficient?'insufficient':'unmet',score:extra.insufficient?null:65,reason:'بخشی از خروجی در شاهد ساختگی ثبت شده است',citations:extra.insufficient?[]:[{chunkId:chunk.id,quote:chunk.text.slice(0,10)}]}]}};if(extra.invalidCitation&&(extra.alwaysInvalid||calls===1))output.result.criteria[0].citations[0].quote='FABRICATED_CITATION';return output;}});
 const store=openStore(root),owner=store.get('employee-mohammad','workflow-user');
 const baseline=store.list('position-assignment',owner.id).find(p=>p.status==='published');
 const position=store.put('position-assignment',{...baseline,employeeId:owner.id,status:'published',version:9,jobTitle:'سمت آزمون',duties:'TEST_DUTIES_ONLY',baseSalary:987654321,phone:'SECRET_CONTACT'} ,owner.id);
 const activity=store.put('activity',{kind:'routine',title:'تسک ساختگی',description:'شرح دقیق تسک ساختگی',period:currentPeriod(),criteria:[{id:'C1',text:'خروجی مشخص ارائه شود'}],ownerId:owner.id,unitId:owner.unitId,assignmentStatus:'approved',positionId:position.id,positionVersion:9,kpiWeight:100});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;let session=await(await fetch(base+'/api/session')).json();
 t.after(async()=>{release?.();server.closeAllConnections();await new Promise(r=>server.close(r));store.close();await rm(root,{recursive:true,force:true,maxRetries:3});});
 const request=async(path,body)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'x-panel-token':session.token},body});const data=await response.json();return {status:response.status,data};};
 session=(await request('/api/session',JSON.stringify({userId:owner.id}))).data;
 const upload=(text,query='')=>request('/api/activities/'+activity.id+'/documents?name=synthetic.txt&workEvidence=true'+query,text);
 const wait=async()=>{for(let i=0;i<(extra.alwaysInvalid?1000:150);i++){const rows=store.list('review',activity.id);if(rows[0]&&['done','failed'].includes(rows[0].status))return rows[0];await new Promise(r=>setTimeout(r,30));}throw Error('Worker did not finish');};
 return {root,store,activity,request,upload,wait,get calls(){return calls;},get prompt(){return lastPrompt;},release(){release?.();}};
}
test('a new-position assessment carries its exact interval into the model and cached review without compensation data',async t=>{
 const f=await setup(t,{approved:true}),bounds=periodBounds(f.activity.period),assessmentStart=new Date(Date.parse(bounds.start+'T00:00:00Z')+10*86400000).toISOString().slice(0,10);
 f.store.put('activity',{...f.activity,assessmentStart,assessmentEnd:bounds.end},f.activity.ownerId);
 await f.upload('SYNTHETIC new position evidence');const result=await f.wait();assert.equal(result.status,'done');assert.equal(result.activitySnapshot.assessmentStart,assessmentStart);assert.equal(result.activitySnapshot.assessmentEnd,bounds.end);assert.ok(f.prompt.includes('POSITION ASSESSMENT INTERVAL'));assert.ok(f.prompt.includes(assessmentStart));assert.ok(f.prompt.includes('end exclusive'));assert.ok(!f.prompt.includes('987654321'));
 const calls=f.calls;await f.upload('SYNTHETIC new position evidence');assert.equal(f.calls,calls);
});

test('settled personnel cannot upload or queue new evidence and a dated exit during inference never applies a score',async t=>{
 const f=await setup(t,{hold:true});assert.equal((await f.upload('SYNTHETIC evidenced partial output')).status,201);
 for(let i=0;i<100&&!f.calls;i++)await new Promise(r=>setTimeout(r,30));assert.equal(f.calls,1);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 // Simulates the clock reaching an already scheduled exit while the model runs.
 f.store.put('personnel-settlement',{employeeId:f.activity.ownerId,status:'registered',settlementDate:date},f.activity.ownerId);f.release();const result=await f.wait();assert.equal(result.status,'failed');assert.equal(result.result,undefined);
 const before=f.store.list('document',f.activity.id);assert.equal((await f.upload('SYNTHETIC new evidence after exit')).status,403);assert.deepEqual(f.store.list('document',f.activity.id),before);assert.equal(f.calls,1);
});

test('published task upload automatically evaluates with original criteria/duties, no contract, and repeat upload is cached',async t=>{
 const f=await setup(t),r=await f.upload('SYNTHETIC evidenced partial output');assert.equal(r.status,201);assert.equal(r.data.autoReview.status,'queued');
 const completed=await f.wait();assert.equal(completed.result.attainmentScore,65);assert.equal(completed.result.finalScore,65);assert.equal(f.calls,1);
 assert.match(f.prompt,/TEST_DUTIES_ONLY/);assert.match(f.prompt,/شرح دقیق تسک ساختگی/);assert.doesNotMatch(f.prompt,/987654321|SECRET_CONTACT|baseSalary/);
 assert.equal(f.store.list('metric-contract').length,0);assert.equal(f.store.list('contract-proposal').length,0);
 const cached=await f.upload('SYNTHETIC evidenced partial output');assert.equal(cached.data.autoReview.cached,true);assert.equal(f.calls,1);
 const legacyEndpoint=await f.request('/api/activities/'+f.activity.id+'/reviews','{}');assert.equal(legacyEndpoint.data.cached,true);assert.equal(f.calls,1);
});

test('a multi-file report queues once after its final upload, not once per file',async t=>{
 const f=await setup(t);const first=await f.upload('SYNTHETIC first file','&deferReview=1');assert.equal(first.data.autoReview,null);await new Promise(r=>setTimeout(r,600));assert.equal(f.calls,0);
 await f.upload('SYNTHETIC second file');const done=await f.wait();assert.equal(done.documentHashes.length,2);assert.equal(f.calls,1);
});

test('sensitive records and uploads without work-evidence confirmation stay local and never call a model',async t=>{
 const f=await setup(t);const protectedDoc=await f.upload('فیش حقوق کارکنان؛ مبلغ حقوق پایه: 90000000');assert.equal(protectedDoc.status,201);assert.equal(protectedDoc.data.autoReview.status,'blocked');assert.match(protectedDoc.data.autoReview.error,/ارسال به مدل متوقف/);
 const manual=await f.request('/api/activities/'+f.activity.id+'/reviews','{}');assert.equal(manual.status,422);
 await new Promise(r=>setTimeout(r,600));assert.equal(f.calls,0);assert.equal(f.store.list('review',f.activity.id).length,0);
 for(const text of ['api_key=TEST_CREDENTIAL_VALUE','baseSalary: 99000000','private chat export','-----BEGIN RSA PRIVATE KEY-----'])assert.throws(()=>requireWorkEvidence(text));
 assert.throws(()=>requireWorkEvidence({chunks:[{text:'{"api_key":"TEST_CREDENTIAL_VALUE"}'}]}));assert.throws(()=>requireWorkEvidence({baseSalary:99000000}));
 requireWorkEvidence('شرح وظیفه: کنترل پرداخت‌ها و تهیه گزارش عملیاتی؛ فاقد اطلاعات حساس.');
 requireWorkEvidence('شرح وظیفه: کنترل فیش حقوق کارکنان.',{referenceOnly:true});assert.throws(()=>requireWorkEvidence('حقوق پایه: 99000000',{referenceOnly:true}));
});

test('changed evidence during inference invalidates the response and keeps scores unknown',async t=>{
 const f=await setup(t,{hold:true});await f.upload('SYNTHETIC initial evidence');for(let i=0;i<100&&!f.calls;i++)await new Promise(r=>setTimeout(r,20));assert.equal(f.calls,1);
 const doc=f.store.list('document',f.activity.id)[0];f.store.put('document',{...doc,sha256:'changed-synthetic-hash'},f.activity.id);f.release();const result=await f.wait();assert.equal(result.status,'failed');assert.equal(result.result,undefined);
});

test('locked quarters block uploads before mutation and preserve their snapshot',async t=>{
 const f=await setup(t),period=f.activity.period,row={id:'locked-test',quarter:`${period.slice(0,4)}-Q${Math.ceil(Number(period.slice(5))/3)}`,status:'locked',finalScore:73};f.store.put('quarter-evaluation',row,f.activity.ownerId);
 const before=JSON.stringify(f.store.list('document',f.activity.id)),r=await f.upload('SYNTHETIC new evidence');assert.equal(r.status,409);assert.match(r.data.error,/قفل/);assert.equal(JSON.stringify(f.store.list('document',f.activity.id)),before);assert.equal(f.calls,0);assert.deepEqual(f.store.get(row.id,'quarter-evaluation'),row);
});

test('upload rounds retain grouped files and every explicit analysis/cache action without inventing old upload events',async t=>{
 const f=await setup(t),batch='synthetic-batch-01';await f.upload('SYNTHETIC first','&deferReview=1&batchId='+batch);await f.upload('SYNTHETIC second','&batchId='+batch);await f.wait();
 let data=(await f.request('/api/activities/'+f.activity.id)).data;assert.equal(data.history.length,1);assert.equal(data.history[0].kind,'upload');assert.equal(data.history[0].files.length,2);assert.equal(data.history[0].finalScore,65);assert.equal(data.history[0].status,'needs_revision');assert.equal(data.submissionQuota.used,1);assert.equal(data.submissionQuota.limit,5);assert.equal(data.submissionQuota.remaining,4);
 await f.request('/api/activities/'+f.activity.id+'/reviews','{}');data=(await f.request('/api/activities/'+f.activity.id)).data;assert.equal(data.history.length,2);assert.ok(data.history.some(e=>e.kind==='analysis'&&e.cached));assert.equal(f.calls,1);
 await f.upload('SYNTHETIC second');data=(await f.request('/api/activities/'+f.activity.id)).data;assert.equal(data.history.length,3);assert.equal(data.submissionQuota.used,1);assert.equal(f.calls,1);assert.equal(JSON.stringify(data.history).includes(f.root),false);
});

test('reusing a legacy analysis preserves its original log before the new cached request',async t=>{
 const f=await setup(t);await f.upload('SYNTHETIC legacy history source');await f.wait();const event=f.store.list('activity-history',f.activity.id)[0];f.store.remove(event.id,'activity-history',f.activity.id);
 const before=(await f.request('/api/activities/'+f.activity.id)).data.history;assert.equal(before.length,1);assert.equal(before[0].legacy,true);
 await f.request('/api/activities/'+f.activity.id+'/reviews','{}');const after=(await f.request('/api/activities/'+f.activity.id)).data.history;assert.equal(after.length,2);assert.ok(after.some(e=>e.id===before[0].id));assert.ok(after.some(e=>e.cached));assert.equal(f.calls,1);
});

test('five successful unique deliveries are enforced before file mutation, and published admin changes apply immediately',async t=>{
 const f=await setup(t);for(let i=0;i<5;i++){assert.equal((await f.upload('SYNTHETIC revision '+i)).status,201);await f.wait();}
 let q=(await f.request('/api/activities/'+f.activity.id+'/quota')).data;assert.equal(q.used,5);assert.equal(q.remaining,0);assert.equal(q.canUpload,false);
 const before=f.store.list('document',f.activity.id).length,denied=await f.upload('SYNTHETIC blocked sixth');assert.equal(denied.status,409);assert.equal(f.store.list('document',f.activity.id).length,before);assert.equal(f.calls,5);
 const settings=createScoreSettings(f.store),hr=f.store.get('hr-demo','workflow-user'),state=settings.state(hr),draft=settings.save(hr,{effectiveDate:state.today,unitId:null,activityKind:'all',reason:'افزایش سقف در تست ساختگی',values:{...state.defaults,maxUploads:'10'}}),preview=settings.preview(hr,draft),saved=f.store.list('review',f.activity.id).map(r=>JSON.stringify(r));settings.publish(hr,{...draft,previewHash:preview.previewHash});
 q=(await f.request('/api/activities/'+f.activity.id+'/quota')).data;assert.equal(q.limit,10);assert.equal(q.remaining,5);assert.equal(q.canUpload,true);assert.deepEqual(f.store.list('review',f.activity.id).map(r=>JSON.stringify(r)),saved);
 assert.equal((await f.upload('SYNTHETIC allowed sixth')).status,201);await f.wait();assert.equal((await f.request('/api/activities/'+f.activity.id+'/quota')).data.used,6);
});

test('grounding repair succeeds in one delivery and preserves the valid cache and task scoring contract',async t=>{
 const f=await setup(t,{invalidCitation:true});const before=JSON.stringify(f.store.get(f.activity.id,'activity'));await f.upload('SYNTHETIC grounding repair');const r=await f.wait();assert.equal(r.status,'done',r.error);assert.equal(f.calls,2);assert.equal(r.result.fileProcessing.validationRetries.length,1);assert.equal(r.result.fileProcessing.modelCalls,2);assert.deepEqual(r.usage,{});assert.equal(r.result.finalScore,65);const part=f.store.list('review-file-part',r.id)[0];assert.equal(part.repairAttempts,1);assert.equal(part.validationRetries[0].code,'invalid_citation');assert.match(part.effectivePromptHash,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(f.store.get(f.activity.id,'activity')),before);const q=(await f.request('/api/activities/'+f.activity.id+'/quota')).data;assert.equal(q.used,1);assert.equal(q.pending,0);assert.equal((await f.request('/api/activities/'+f.activity.id)).data.history.length,1);await f.request('/api/activities/'+f.activity.id+'/reviews','{}');assert.equal(f.calls,2);
});

test('exhausted invalid output retains a typed part error, no score or valid cache, and retry never rewrites the failed history',async t=>{
 const flags={invalidCitation:true,alwaysInvalid:true},f=await setup(t,flags);await f.upload('SYNTHETIC invalid quotation');const r=await f.wait();assert.equal(r.status,'failed');assert.equal(f.calls,5);assert.equal(r.result,undefined);assert.equal(f.store.list('review-file-part',r.id).length,0);assert.equal(r.fileProcessing.diagnostic.code,'invalid_citation');assert.equal(r.fileProcessing.diagnostic.attempt,5);assert.equal(r.fileProcessing.validationRetries.length,5);assert.equal(r.fileProcessing.diagnostic.readParts,0);assert.equal(r.fileProcessing.diagnostic.part,1);assert.match(r.error,/ارجاع مدل/);assert.match(r.error,/پس از چهار تلاش اصلاحی/);const q=(await f.request('/api/activities/'+f.activity.id+'/quota')).data;assert.equal(q.used,0);assert.equal(q.pending,0);const old=JSON.stringify(f.store.get(r.id,'review'));flags.invalidCitation=false;const retried=await f.request('/api/activities/'+f.activity.id+'/reviews',JSON.stringify({retry:true}));assert.equal(retried.status,200);assert.equal(retried.data.status,'done');assert.equal(f.calls,6);assert.equal(JSON.stringify(f.store.get(r.id,'review')),old);
});

test('failed AI releases reservations and consumes no delivery while its failed backlog record is retained',async t=>{
 const flags={fail:true},f=await setup(t,flags);await f.upload('SYNTHETIC retry source');await f.wait();let q=(await f.request('/api/activities/'+f.activity.id+'/quota')).data;assert.equal(q.used,0);assert.equal(q.pending,0);assert.equal(q.remaining,5);
 assert.equal((await f.request('/api/activities/'+f.activity.id)).data.history[0].status,'failed');flags.fail=false;await f.request('/api/activities/'+f.activity.id+'/reviews','{}');q=(await f.request('/api/activities/'+f.activity.id+'/quota')).data;assert.equal(q.used,1);assert.equal(f.calls,2);
});

test('batch ids cannot overwrite completed history or move evidence between activities',async t=>{
 const f=await setup(t),batch='synthetic-bound-batch';await f.upload('SYNTHETIC first','&deferReview=1&batchId='+batch);
 const foreign=f.store.put('activity',{...f.activity,id:randomUUID()});const denied=await f.request('/api/activities/'+foreign.id+'/documents?name=other.txt&workEvidence=true&batchId='+batch,'SYNTHETIC other');assert.equal(denied.status,409);assert.equal(f.store.list('document',foreign.id).length,0);
 await f.upload('SYNTHETIC last','&batchId='+batch);await f.wait();const history=JSON.stringify(f.store.get('upload:'+batch,'activity-history')),count=f.store.list('document',f.activity.id).length;
 assert.equal((await f.upload('SYNTHETIC overwrite','&batchId='+batch)).status,409);assert.equal(f.store.list('document',f.activity.id).length,count);assert.equal(JSON.stringify(f.store.get('upload:'+batch,'activity-history')),history);
});

test('a pending fifth review reserves its slot, and another upload cannot bypass the limit',async t=>{
 const flags={hold:false},f=await setup(t,flags);for(let i=0;i<4;i++){await f.upload('SYNTHETIC reserved '+i);await f.wait();}flags.hold=true;await f.upload('SYNTHETIC reserved fifth');
 const q=(await f.request('/api/activities/'+f.activity.id+'/quota')).data;assert.equal(q.used,4);assert.equal(q.pending,1);assert.equal(q.remaining,0);assert.equal(q.canUpload,false);
 const count=f.store.list('document',f.activity.id).length;assert.equal((await f.upload('SYNTHETIC bypass reservation')).status,409);assert.equal(f.store.list('document',f.activity.id).length,count);
 for(let i=0;i<100&&f.calls<5;i++)await new Promise(r=>setTimeout(r,20));assert.equal(f.calls,5);f.release();await f.wait();assert.equal((await f.request('/api/activities/'+f.activity.id+'/quota')).data.used,5);
});

for(const insufficient of [false,true])test('terminal '+(insufficient?'insufficient':'revision')+' evidence is archived, with history, raw file and quota retained',async t=>{
 const f=await setup(t,{archive:true,insufficient}),text='SYNTHETIC retention evidence';await f.upload(text);const review=await f.wait();
 const data=(await f.request('/api/activities/'+f.activity.id)).data,doc=f.store.list('document',f.activity.id)[0];
 assert.equal(data.documents.length,0);assert.ok(doc.archivedAt);assert.equal(doc.archivedByReviewId,review.id);assert.equal(await readFile(doc.path,'utf8'),text);
 assert.equal(review.evidenceDisposition.archivedDocumentIds.length,1);assert.equal(data.reviewMatchesCurrentEvidence,true);assert.equal(data.history[0].files.length,1);assert.equal(data.history[0].finalScore,insufficient?null:65);
 assert.equal(data.submissionQuota.used,1);assert.equal(data.submissionQuota.remaining,4);assert.equal(f.store.list('audit-event').filter(r=>r.action==='review.evidence-archived').length,1);
 const snapshot=(await f.request('/api/workflow/me?period='+f.activity.period)).data;assert.equal(snapshot.assignments.find(a=>a.id===f.activity.id).score,insufficient?null:65);
 const again=createReviewRetention(f.store).cleanup(review);assert.deepEqual(again.archivedDocumentIds,[]);assert.equal(f.store.list('audit-event').filter(r=>r.action==='review.evidence-archived').length,1);
});

test('approved files remain active and repeat upload uses the existing result',async t=>{
 const f=await setup(t,{archive:true,approved:true});await f.upload('SYNTHETIC accepted output');const review=await f.wait();assert.equal(review.result.decision,'completed');assert.equal(review.evidenceDisposition,undefined);
 const data=(await f.request('/api/activities/'+f.activity.id)).data;assert.equal(data.documents.length,1);assert.equal(data.reviewMatchesCurrentEvidence,true);
 assert.equal((await f.upload('SYNTHETIC accepted output')).data.autoReview.cached,true);assert.equal(f.calls,1);
});

test('queued and running evidence remains available until its result completes',async t=>{
 const f=await setup(t,{archive:true,hold:true});await f.upload('SYNTHETIC pending output');assert.equal((await f.request('/api/activities/'+f.activity.id)).data.documents.length,1);
 for(let i=0;i<100&&!f.calls;i++)await new Promise(r=>setTimeout(r,20));assert.equal(f.calls,1);assert.equal(f.store.list('review',f.activity.id)[0].status,'running');assert.equal((await f.request('/api/activities/'+f.activity.id)).data.documents.length,1);
 f.release();await f.wait();assert.equal((await f.request('/api/activities/'+f.activity.id)).data.documents.length,0);
});

test('failed processing removes active files without consuming quota and reupload can retry',async t=>{
 const flags={archive:true,fail:true},f=await setup(t,flags);await f.upload('SYNTHETIC technical failure');const first=await f.wait();assert.equal(first.status,'failed');assert.ok(first.evidenceDisposition);
 let data=(await f.request('/api/activities/'+f.activity.id)).data;assert.equal(data.documents.length,0);assert.equal(data.submissionQuota.used,0);assert.equal(data.history[0].files.length,1);
 flags.fail=false;flags.approved=true;await f.upload('SYNTHETIC technical failure');await f.wait();data=(await f.request('/api/activities/'+f.activity.id)).data;assert.equal(data.documents.length,1);assert.equal(data.history.length,2);assert.equal(data.submissionQuota.used,1);assert.equal(f.calls,2);
});

test('precheck-blocked upload is archived without losing its original file receipt or sending sensitive data',async t=>{
 const f=await setup(t,{archive:true});const result=await f.upload('baseSalary: 99000000');assert.equal(result.data.autoReview.status,'blocked');assert.ok(result.data.autoReview.evidenceDisposition.archivedDocumentIds.length);
 const data=(await f.request('/api/activities/'+f.activity.id)).data;assert.equal(data.documents.length,0);assert.equal(data.history.length,1);assert.equal(data.history[0].files.length,1);assert.equal(data.history[0].status,'blocked');assert.ok(data.history[0].evidenceDisposition);assert.equal(f.calls,0);
});

test('previously approved evidence is protected while only the newly rejected file is archived',async t=>{
 const flags={archive:true,approved:true},f=await setup(t,flags);await f.upload('SYNTHETIC accepted first');const accepted=await f.wait(),doc=f.store.list('document',f.activity.id)[0];flags.approved=false;await f.upload('SYNTHETIC rejected second');const second=await f.wait();assert.equal(second.result.decision,'needs_revision');
 const data=(await f.request('/api/activities/'+f.activity.id)).data;assert.equal(data.documents.length,1);assert.equal(data.documents[0].id,doc.id);assert.equal(f.store.get(doc.id,'document').archivedAt,undefined);assert.equal(second.evidenceDisposition.archivedDocumentIds.length,1);assert.equal(reviewEvidenceMatches(f.store,f.activity,accepted),false);assert.equal(data.submissionQuota.used,2);
});

test('retention preserves changed document revisions, other pending jobs and locked quarters',async t=>{
 const f=await setup(t,{archive:true,hold:true});await f.upload('SYNTHETIC protected revision');for(let i=0;i<100&&!f.calls;i++)await new Promise(r=>setTimeout(r,20));
 const doc=f.store.list('document',f.activity.id)[0];f.store.put('document',{...doc,sha256:'new-synthetic-revision'},f.activity.id);f.release();const stale=await f.wait();assert.equal(stale.status,'failed');assert.equal(f.store.get(doc.id,'document').archivedAt,undefined);
 const retention=createReviewRetention(f.store),row={...stale,id:randomUUID(),documentHashes:[{id:doc.id,sha256:'new-synthetic-revision'}]};
 const pending=f.store.put('review',{...row,status:'queued'},f.activity.id);assert.deepEqual(retention.cleanup({...row,id:randomUUID()}).archivedDocumentIds,[]);f.store.put('review',{...pending,status:'failed'},f.activity.id);
 const q={id:'synthetic-retention-lock',status:'locked',quarter:f.activity.period.slice(0,4)+'-Q'+Math.ceil(Number(f.activity.period.slice(5))/3)};f.store.put('quarter-evaluation',q,f.activity.ownerId);assert.equal(retention.cleanup(row).skipped,'locked_or_missing');assert.equal(f.store.get(doc.id,'document').archivedAt,undefined);assert.deepEqual(f.store.get(q.id,'quarter-evaluation'),q);
});

test('manual removal and a new submission still invalidate old evidence despite automatic archival',async t=>{
 const f=await setup(t,{archive:true});await f.upload('SYNTHETIC partial evidence');const review=await f.wait(),doc=f.store.list('document',f.activity.id)[0];assert.equal(reviewEvidenceMatches(f.store,f.activity,review),true);
 f.store.put('document',{...doc,archiveReason:'manual',archivedByReviewId:null},f.activity.id);assert.equal(reviewEvidenceMatches(f.store,f.activity,review),false);
 f.store.put('document',doc,f.activity.id);await f.upload('SYNTHETIC new version','&deferReview=1');assert.equal(reviewEvidenceMatches(f.store,f.activity,review),false);assert.equal((await f.request('/api/activities/'+f.activity.id)).data.reviewMatchesCurrentEvidence,false);
});

test('manual precheck uses the same archival rule and retains the rejected evidence receipt',async t=>{
 const f=await setup(t,{archive:true});await f.upload('baseSalary: 99000000','&deferReview=1');assert.equal((await f.request('/api/activities/'+f.activity.id)).data.documents.length,1);
 const rejected=await f.request('/api/activities/'+f.activity.id+'/reviews','{}');assert.equal(rejected.status,422);
 const data=(await f.request('/api/activities/'+f.activity.id)).data;assert.equal(data.documents.length,0);assert.equal(data.history.length,2);const log=data.history.find(r=>r.kind==='analysis');assert.equal(log.status,'blocked');assert.equal(log.files.length,1);assert.ok(log.evidenceDisposition);assert.equal(data.submissionQuota.used,0);assert.equal(f.calls,0);
});

test('unreadable evidence and missing consent are archived without model calls',async t=>{
 const f=await setup(t,{archive:true});let r=await f.request('/api/activities/'+f.activity.id+'/documents?name=synthetic.txt','SYNTHETIC unconfirmed document');assert.equal(r.data.autoReview.status,'blocked');assert.equal((await f.request('/api/activities/'+f.activity.id)).data.documents.length,0);
 r=await f.request('/api/activities/'+f.activity.id+'/documents?name=synthetic.png&workEvidence=true',createCanvas(10,10).toBuffer('image/png'));assert.equal(r.status,201);assert.equal(r.data.autoReview.status,'blocked');assert.ok(r.data.autoReview.evidenceDisposition.archivedDocumentIds.length);assert.equal(f.calls,0);assert.equal((await f.request('/api/activities/'+f.activity.id)).data.documents.length,0);
 r=await f.request('/api/activities/'+f.activity.id+'/documents?name=truncated-synthetic.png&workEvidence=true',Buffer.from([0,1,2,3]));assert.equal(r.status,201);assert.equal(r.data.extraction.status,'failed');assert.equal(r.data.autoReview.status,'blocked');assert.ok(r.data.autoReview.evidenceDisposition.archivedDocumentIds.length);assert.equal(f.calls,0);assert.equal((await f.request('/api/activities/'+f.activity.id)).data.documents.length,0);
});

test('archiving a newer failed upload does not resurrect a previous partial grade',async t=>{
 const flags={archive:true},f=await setup(t,flags);await f.upload('SYNTHETIC partial older delivery');const older=await f.wait();assert.equal(reviewEvidenceMatches(f.store,f.activity,older),true);
 flags.fail=true;await f.upload('SYNTHETIC newer failed delivery');assert.equal((await f.wait()).status,'failed');assert.equal((await f.request('/api/activities/'+f.activity.id)).data.documents.length,0);assert.equal(reviewEvidenceMatches(f.store,f.activity,older),false);
 const snapshot=(await f.request('/api/workflow/me?period='+f.activity.period)).data;assert.equal(snapshot.assignments.find(a=>a.id===f.activity.id).score,null);
});

import {quarterlyEvidenceWindow,QUARTER_EVIDENCE_POLICY} from './quarterly-evidence-window.mjs';
import {providerConfig} from './providers.mjs';
import {sha256,POLICY_VERSION,finalizeReview} from './evaluation.mjs';
import {loadFullFileEvidence,assertRawFiles,planFileParts,assessFullFile,FILE_REVIEW_VERSION,fileReviewFailureMessage,fileReadingPrompt,FILE_MODEL_TIMEOUT_MS} from './file-assessment.mjs';
import {submissionRules,delayBreakdown} from './score-rules.mjs';
import {requireWorkEvidence} from './evidence-privacy.mjs';
import {createReviewRetention,reviewEvidenceMatches} from './review-retention.mjs';
import {assertActivityHumanWritable} from './activity-human-review.mjs';
import {closedActivity} from './position-closeout.mjs';
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const taskKeys=['id','kind','title','description','period','criteria','ownerId','unitId','assignmentStatus','positionId','positionVersion','designId','designVersion','dueDate','timeLimit','frequency','targetVolume','targetUnit','documentFormat','deliverable','assessmentStart','assessmentEnd'];
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const now=()=>new Date().toISOString();

// Original review records and scorer; no separate contract or approval stage.
export function createAutomaticReview(store,workflow,{runModel,notifications,busy,uploadRoot,enabled=true,archiveRejectedEvidence=true}){
 let stopped=false,ticking=false;
 const retention=createReviewRetention(store);
 const docs=a=>store.list('document',a.id).filter(d=>!d.archivedAt);
 const task=a=>{
  const snapshot=pick(a,taskKeys),position=a.positionId?store.get(a.positionId,'position-assignment'):null;
  if(/^14\d{2}-Q[1-4]$/.test(a.period||''))snapshot.evidenceWindowPolicy=QUARTER_EVIDENCE_POLICY;
  if(/^14\d{2}-Q[1-4]$/.test(a.period||'')&&position?.status==='published'&&position.employeeId===a.ownerId){
   const window=quarterlyEvidenceWindow(store,position,a.period);
   if(window.importedQuarter){snapshot.assessmentStart=window.start;snapshot.assessmentEnd=window.end;}
  }
  return snapshot;
 };
 const context=a=>{
  const position=a.positionId?store.get(a.positionId,'position-assignment'):null;
  const person=workflow.user(a.ownerId);
  return {version:'task-evidence-context-v2',subject:person?pick(person,['id','name','employeeCode']):null,jobDuties:position?.status==='published'&&position.employeeId===a.ownerId?pick(position,['id','version','jobTitle','duties']):null};
 };
 const sourceHash=(a,documents=docs(a))=>sha256(JSON.stringify({task:task(a),context:context(a),documents:documents.map(d=>[d.id,d.sha256,sha256(JSON.stringify(d.extraction))]).sort((x,y)=>x[0].localeCompare(y[0]))}));
 const locked=a=>closedActivity(store,a)||store.list('quarter-evaluation',a.ownerId).some(q=>q.status==='locked'&&q.quarter===a.period);
 async function prepare(actor,a,provider,automatic=false,documentSource=()=>docs(a)){
  assertActivityHumanWritable(store,a);
  if(workflow.user(a.ownerId)?.role==='personnel'&&(workflow.user(a.ownerId)?.isSettled||(/^14\d{2}-Q[1-4]$/.test(a.period)?workflow.userAt(a.ownerId,a.period):workflow.user(a.ownerId))?.isKpiEligible===false))fail('این فرد خارج از فرایند KPI است.',403);
  if(actor?.id!==a.ownerId)fail('بررسی فقط برای شاخص خود فرد مجاز است.',403);
  if(automatic&&(actor.role!=='personnel'||a.assignmentStatus!=='approved'))fail('ارزیابی خودکار فقط برای شاخص منتشرشده پرسنل فعال است.');
  if(locked(a))fail('نتیجه فصل قفل‌شده است؛ بررسی تازه از مسیر جاری مجاز نیست.');
  const documents=documentSource();if(!documents.length)fail('ابتدا مستند بارگذاری کنید.',400);
  const initialHash=sourceHash(a,documents),evidence=await loadFullFileEvidence(documents,uploadRoot),rules=submissionRules(store,a,documents,{review:true}),config=providerConfig(provider),evaluationContext=context(a);
  const fresh=store.get(a.id,'activity');if(!fresh||fresh.removedAt||sourceHash(fresh,documentSource())!==initialHash||workflow.user(a.ownerId)?.isSettled||locked(fresh))fail('شاخص یا شواهد هنگام خواندن فایل تغییر کرده است.');
  if(!evidence.chunks.length)fail('هیچ متن قابل ارزیابی استخراج نشده است؛ فایل ذخیره شد اما خوانش یا تبدیل مستند باید تکمیل شود.',400);
  const snapshot=task(a);requireWorkEvidence({task:snapshot,context:evaluationContext},{referenceOnly:true});
  const parts=planFileParts(snapshot,evidence,evaluationContext),fingerprint=sha256(JSON.stringify({activity:snapshot,evidence,config,policy:POLICY_VERSION,context:evaluationContext,scoreRules:rules.policy}));
  return {fingerprint,provider,model:config.model,processingPolicy:'complete-file-resilient-v1',modelTimeoutMs:FILE_MODEL_TIMEOUT_MS,resilientProcessing:true,automatic,actorId:actor.id,inputsVersion:evaluationContext.version,status:'queued',createdAt:now(),policyVersion:POLICY_VERSION,activitySnapshot:snapshot,contextSnapshot:evaluationContext,sourceHash:initialHash,documentHashes:evidence.documents,evidenceSnapshot:evidence,promptHash:sha256(JSON.stringify({version:FILE_REVIEW_VERSION,fingerprint})),fileProcessing:{version:FILE_REVIEW_VERSION,phase:'queued',readParts:0,totalParts:parts.length},scoreRulesSnapshot:rules.policy,submissionKey:rules.submissionKey,submissionRevision:rules.revision,submittedAt:rules.submittedAt,submissionDueDate:rules.dueDate,lateDays:rules.lateDays};
 }
 async function queue(actor,a,provider,{automatic=false,retry=false}={}){
  let candidate;
  try{candidate=await prepare(actor,a,provider,automatic);}catch(error){
   if(archiveRejectedEvidence&&actor?.id===a.ownerId&&(error.status===422||error.status===400&&error.message.startsWith('هیچ متن قابل ارزیابی')))error.evidenceDisposition=retention.blocked(actor,a,docs(a));
   throw error;
  }
  return store.transaction(()=>{
   const matching=store.list('review',a.id).filter(r=>r.fingerprint===candidate.fingerprint),previous=matching.find(r=>['queued','running','done'].includes(r.status));
   if(previous)return {...previous,cached:previous.status==='done'};
   if(retry&&matching.length>=3)fail('سقف سه تلاش برای همین نسخه تکمیل شده است؛ علت خطا را رفع کنید.');
   if(matching.length&&!retry)return {...matching[0],cached:true};
   return store.put('review',candidate,a.id);
  });
 }
 function resumeDocuments(actor,a,reviewId){
  const row=store.get(reviewId,'review'),fresh=store.get(a.id,'activity');
  if(!row||!fresh||fresh.removedAt||row.activitySnapshot?.id!==a.id||actor?.id!==fresh.ownerId||row.actorId!==actor.id)fail('ادامهٔ این بررسی برای حساب یا شاخص جاری مجاز نیست.',403);
  if(store.list('review',a.id)[0]?.id!==row.id||row.status!=='failed'||row.inputsVersion!=='task-evidence-context-v2'||row.policyVersion!==POLICY_VERSION||!(row.fileProcessing?.readParts>0)||!reviewEvidenceMatches(store,fresh,row))fail('ادامه فقط برای آخرین بررسی ناموفق با همان مستندات مجاز است.');
  if(sha256(JSON.stringify(task(fresh)))!==sha256(JSON.stringify(row.activitySnapshot))||sha256(JSON.stringify(context(fresh)))!==sha256(JSON.stringify(row.contextSnapshot))||providerConfig(row.provider).model!==row.model)fail('تعریف شاخص، شرح وظایف یا مدل تغییر کرده است؛ ادامهٔ نتیجهٔ قبلی مجاز نیست.');
  return row.documentHashes.map(ref=>store.get(ref.id,'document'));
 }
 function canResume(actor,a,reviewId){
  try{
   const documents=resumeDocuments(actor,a,reviewId),row=store.get(reviewId,'review');assertActivityHumanWritable(store,a);
   return !busy.size&&!locked(a)&&!workflow.user(a.ownerId)?.isSettled&&documents.length>0&&store.list('review',a.id).filter(r=>r.fingerprint===row.fingerprint).length<3;
  }catch{return false;}
 }
 async function resume(actor,a,reviewId,{dryRun=false}={}){
  const documentSource=()=>resumeDocuments(actor,a,reviewId),original=store.get(reviewId,'review');
  documentSource();
  const candidate=await prepare(actor,a,original.provider,original.automatic,documentSource);
  if(candidate.fingerprint!==original.fingerprint||candidate.sourceHash!==original.sourceHash)fail('قواعد یا شواهد این بررسی تغییر کرده است؛ بخش‌های قبلی قابل بازاستفاده نیستند.');
  const parts=planFileParts(candidate.activitySnapshot,candidate.evidenceSnapshot,candidate.contextSnapshot),read=original.fileProcessing.readParts,savedParts=store.list('review-file-part',reviewId);
  if(read>parts.length)fail('پیشرفت قبلی با فایل جاری مطابقت ندارد.');
  for(let index=0;index<read;index++){
   const prompt=fileReadingPrompt(candidate.activitySnapshot,parts[index],candidate.contextSnapshot,parts.length),inputHash=sha256(JSON.stringify({prompt,provider:candidate.provider,policy:POLICY_VERSION})),saved=savedParts.find(p=>p.status==='done'&&p.index===index+1&&p.inputHash===inputHash&&p.reviewFingerprint===candidate.fingerprint&&p.policyVersion===POLICY_VERSION);
   if(!saved)fail('یکی از بخش‌های خوانده‌شدهٔ قبلی موجود نیست؛ ادامه بدون تحلیل مجدد امکان‌پذیر نیست.');
   finalizeReview(saved.result,candidate.activitySnapshot,parts[index]);
  }
  if(dryRun)return {reviewId,readParts:read,totalParts:parts.length,resumeFromPart:read+1,modelTimeoutMs:FILE_MODEL_TIMEOUT_MS};
  return store.transaction(()=>{
   const documents=documentSource(),fresh=store.get(a.id,'activity');
   if(sourceHash(fresh,documents)!==candidate.sourceHash||locked(fresh)||workflow.user(a.ownerId)?.isSettled)fail('شاخص یا شواهد پیش از ادامه تغییر کرده است.');
   if(store.list('review',a.id).filter(r=>r.fingerprint===candidate.fingerprint).length>=3)fail('سقف سه تلاش برای همین نسخه تکمیل شده است؛ علت خطا را رفع کنید.');
   for(const d of documents)if(d.archivedAt){const restored={...d};for(const key of ['archivedAt','archivedBy','archiveReason','archivedByReviewId'])delete restored[key];store.put('document',restored,a.id);}
   const row=store.put('review',{...candidate,modelTimeoutMs:FILE_MODEL_TIMEOUT_MS,resilientResume:true,resumedFromReviewId:reviewId,resumeReadParts:read,fileProcessing:{...candidate.fileProcessing,readParts:read,resumeFromPart:read+1}},a.id);
   store.put('audit-event',{actorId:actor.id,action:'review.resumed',entityType:'activity',entityId:a.id,details:{reviewId:row.id,previousReviewId:reviewId,reusedParts:read,documentIds:documents.map(d=>d.id),modelTimeoutMs:FILE_MODEL_TIMEOUT_MS},createdAt:now()});
   return row;
  });
 }
 async function execute(row){
  if(stopped)return row;const id=row.activitySnapshot.id;
  if(row.policyVersion!==POLICY_VERSION||row.inputsVersion!=='task-evidence-context-v2')fail('این درخواست با روش قدیمی ساخته شده است؛ بررسی کامل فایل را دوباره درخواست کنید.');
  let claimed=false;
  row=store.transaction(()=>{const fresh=store.get(row.id,'review');if(fresh?.status!=='queued')return fresh;claimed=true;return store.put('review',{...fresh,status:'running',startedAt:now()},id);});
  if(!claimed)return row;
  let output;
  try{
   const a=store.get(id,'activity'),actor=workflow.user(row.actorId);
   if(!a||a.removedAt||actor?.id!==a.ownerId||workflow.user(a.ownerId)?.isSettled||row.automatic&&actor.role!=='personnel'||sourceHash(a)!==row.sourceHash||locked(a))fail('شاخص، شواهد یا وضعیت همکاری تغییر کرده است؛ نسخه جاری را دوباره ارسال کنید.');
   requireWorkEvidence({task:row.activitySnapshot,context:row.contextSnapshot},{referenceOnly:true});requireWorkEvidence(row.evidenceSnapshot);
   const assertCurrent=async()=>{if(stopped)fail('بررسی متوقف شده است.');const fresh=store.get(id,'activity'),owner=fresh&&workflow.user(fresh.ownerId),periodOwner=fresh&&(/^14\d{2}-Q[1-4]$/.test(fresh.period)?workflow.userAt(fresh.ownerId,fresh.period):owner);if(!fresh||fresh.removedAt||owner?.isSettled||row.automatic&&owner?.role!=='personnel'||owner?.role==='personnel'&&periodOwner?.isKpiEligible===false||sourceHash(fresh)!==row.sourceHash||locked(fresh))fail('شاخص، فایل یا وضعیت همکاری تغییر کرده است؛ نمره اعمال نشد.');await assertRawFiles(docs(fresh),uploadRoot);};
   output=await assessFullFile({activity:row.activitySnapshot,evidence:row.evidenceSnapshot,context:row.contextSnapshot,provider:row.provider,runModel,assertCurrent,requiredCachedParts:row.resumeReadParts||0,resilientResume:row.resilientResume===true,resilientProcessing:true,
    partCache:async({inputHash})=>{const previous=store.list('review-file-part').find(p=>p.status==='done'&&p.inputHash===inputHash&&p.reviewFingerprint===row.fingerprint&&p.policyVersion===POLICY_VERSION);return previous?{result:previous.result}:null;},
    onProgress:async progress=>{const fresh=store.get(row.id,'review');if(fresh?.status!=='running')fail('نسخهٔ بررسی تغییر کرده است.');store.put('review',{...fresh,fileProcessing:{version:FILE_REVIEW_VERSION,phase:progress.phase,readParts:progress.index,totalParts:progress.total,synthesis:progress.synthesis||null,automaticRetry:progress.automaticRetry||null,validationRetries:progress.validationRetries||progress.diagnostic?.validationRetries||fresh.fileProcessing?.validationRetries||[],diagnostic:progress.diagnostic||null}},id);if(progress.phase==='read')store.put('review-file-part',{reviewId:row.id,reviewFingerprint:row.fingerprint,inputHash:progress.inputHash,index:progress.index,status:'done',policyVersion:POLICY_VERSION,result:progress.result,usage:progress.usage||{},cached:progress.cached,effectivePromptHash:progress.effectivePromptHash,repairAttempts:progress.repairAttempts||0,validationRetries:(progress.validationRetries||[]).filter(item=>item.stage==='reading'&&item.part===progress.index),createdAt:now()},row.id);}});
   if(stopped)return row;
   const fresh=store.get(id,'activity');
   if(!fresh||workflow.user(fresh.ownerId)?.isSettled||sourceHash(fresh)!==row.sourceHash||locked(fresh))fail('پاسخ مدل مربوط به نسخه قدیمی یا پرسنل تسویه‌شده است؛ نمره اعمال نشد.');
   const result=output.result;
   result.attainmentScore=result.qualityScore;
   result.scoreBreakdown=delayBreakdown(row.scoreRulesSnapshot,result.qualityScore,row.lateDays);result.finalScore=result.scoreBreakdown.finalScore;
   const done=store.put('review',{...store.get(row.id,'review'),status:'done',fileProcessing:{...result.fileProcessing,phase:'done'},result,usage:output.usage||null,threadId:output.threadId||null,finishedAt:now()},id);
   if(archiveRejectedEvidence)retention.cleanup(done);
   notifications.publish({eventKey:'review-done:'+row.id,recipientIds:[a.ownerId],kind:'info',title:result.finalForActivity?'گزارش ارزیابی مستندات آماده شد':'بررسی انجام شد؛ شواهد کافی نیست',description:result.finalForActivity?'نتیجهٔ معیارها، شواهد و نمره آماده مشاهده است.':'نمرهٔ قطعی ثبت نشده است؛ موارد ناقص گزارش را بررسی کنید.',view:'assignments',entityId:id});
   notifications.publish({eventKey:'review-done-manager:'+row.id,recipientIds:[workflow.user(a.ownerId)?.managerId],kind:'info',title:'بررسی مستندات پرسنل کامل شد',description:'نتیجه بررسی شاخص ثبت شد.',view:'team',entityId:id});
   return store.get(done.id,'review');
  }catch(error){
   if(!stopped){const current=store.get(row.id,'review'),failed=store.put('review',{...current,status:'failed',fileProcessing:{...current.fileProcessing,phase:'failed',validationRetries:error.fileReviewDiagnostic?.validationRetries||current.fileProcessing?.validationRetries||[],diagnostic:error.fileReviewDiagnostic||null},error:fileReviewFailureMessage(error)||([400,409,413,422].includes(error.status)?error.message:'خواندن یا ارزیابی کامل فایل انجام نشد؛ نتیجه نهایی ثبت نشد.'),usage:error.fileReviewUsage||output?.usage||null,finishedAt:now()},id);if(archiveRejectedEvidence)retention.cleanup(failed);notifications.publish({eventKey:'review-failed:'+row.id,recipientIds:[row.actorId],kind:'action',title:'بررسی مستندات کامل نشد',description:'وضعیت شواهد یا اتصال مدل را بررسی کنید.',view:'assignments',entityId:id});}
   throw error;
  }
 }
 async function afterUpload(actor,a,provider,{privacyConfirmed=false}={}){
  if(!enabled||actor.id!==a.ownerId||actor.role!=='personnel'||a.assignmentStatus!=='approved')return null;
  if(!privacyConfirmed)return {status:'blocked',error:'پیش از ارسال به مدل، نبود حقوق، کلید و گفتگوی شخصی در مستندات انتخاب‌شده را تأیید کنید.',...(archiveRejectedEvidence?{evidenceDisposition:retention.blocked(actor,a,docs(a))}:{})};
  try{const row=await queue(actor,a,provider,{automatic:true});if(archiveRejectedEvidence)retention.cleanup(row);return {id:row.id,status:row.status,cached:row.cached===true,error:row.error||null};}catch(error){return {status:'blocked',error:error.status?error.message:'ثبت ارزیابی خودکار کامل نشد؛ وضعیت قوانین و شواهد را بررسی کنید.',...(archiveRejectedEvidence?{evidenceDisposition:error.evidenceDisposition||retention.blocked(actor,a,docs(a))}:{})};}
 }
 async function tick(){
  if(stopped||ticking||!enabled||busy.size)return;ticking=true;
  try{const row=store.nextQueuedReview?store.nextQueuedReview('task-evidence-context-v2',POLICY_VERSION):store.list('review').reverse().find(r=>r.status==='queued'&&r.inputsVersion==='task-evidence-context-v2'&&r.policyVersion===POLICY_VERSION);if(!row)return;busy.add(row.activitySnapshot.id);try{await execute(row);}catch{}finally{busy.delete(row.activitySnapshot.id);}}finally{ticking=false;}
 }
 const timer=setInterval(tick,500);timer.unref();
 return {afterUpload,queue,resume,canResume,execute,tick,stop(){stopped=true;clearInterval(timer);}};
}

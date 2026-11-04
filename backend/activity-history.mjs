import {randomUUID} from 'node:crypto';
const files=documents=>documents.map(d=>({id:d.id,name:d.name||null,sha256:d.sha256,status:d.extraction?.status||d.status||null}));
const now=()=>new Date().toISOString();
export function createActivityHistory(store){
 function validateBatch(actor,activity,batchId){
  if(!batchId)return;
  if(!/^[a-zA-Z0-9-]{8,100}$/.test(batchId))throw Object.assign(Error('شناسه نوبت ارسال معتبر نیست.'),{status:400});
  const previous=store.get('upload:'+batchId,'activity-history');
  if(previous&&(previous.activityId!==activity.id||previous.actorId!==actor.id||previous.status!=='uploading'))throw Object.assign(Error('نوبت ارسال بسته شده یا متعلق به شاخص دیگری است.'),{status:409});
 }
 function start(actor,activity,batchId){
  return store.transaction(()=>{validateBatch(actor,activity,batchId);const id='upload:'+batchId;return store.get(id,'activity-history')||store.put('activity-history',{id,kind:'upload',activityId:activity.id,actorId:actor.id,createdAt:now(),updatedAt:now(),status:'uploading',files:[],uploadedFiles:[]},activity.id);});
 }
 function failed(activity,batchId,message){const row=store.get('upload:'+batchId,'activity-history');if(row?.activityId===activity.id&&row.status==='uploading')store.put('activity-history',{...row,status:'failed',error:message,updatedAt:now()},activity.id);}
 function upload(actor,activity,{batchId,document,deferred,review,error,documents:submittedDocuments}){
  if(batchId&&!/^[a-zA-Z0-9-]{8,100}$/.test(batchId))throw Object.assign(Error('شناسه نوبت ارسال معتبر نیست.'),{status:400});
  const id=batchId?'upload:'+batchId:'upload:'+randomUUID(),previous=store.get(id,'activity-history');
  if(previous&&(previous.activityId!==activity.id||previous.actorId!==actor.id||previous.status!=='uploading'))throw Object.assign(Error('نوبت ارسال بسته شده یا متعلق به شاخص دیگری است.'),{status:409});
  const documents=submittedDocuments||store.list('document',activity.id).filter(d=>!d.archivedAt);
  return store.put('activity-history',{id,activityId:activity.id,actorId:actor.id,kind:'upload',createdAt:previous?.createdAt||now(),updatedAt:now(),uploadedAt:now(),files:files(documents),uploadedFiles:[...new Set([...(previous?.uploadedFiles||[]),document?.id].filter(Boolean))],reviewId:review?.id||previous?.reviewId||null,cached:review?.cached===true,status:error?'blocked':deferred?'uploading':review?.status||'uploaded',error:error||review?.error||null,...(review?.evidenceDisposition?{evidenceDisposition:review.evidenceDisposition}:{})},activity.id);
 }
 function analysis(actor,activity,review){return store.put('activity-history',{kind:'analysis',activityId:activity.id,actorId:actor.id,createdAt:now(),updatedAt:now(),reviewId:review.id,status:review.status,cached:review.cached===true,files:files(review.documentHashes||[])},activity.id);}
 function blockedAnalysis(actor,activity,documents,error){return store.put('activity-history',{kind:'analysis',activityId:activity.id,actorId:actor.id,createdAt:now(),updatedAt:now(),status:'blocked',files:files(documents),error:error.message,evidenceDisposition:error.evidenceDisposition},activity.id);}
 function list(activity){
  const events=store.list('activity-history',activity.id),linked=new Set(events.filter(e=>!e.cached).map(e=>e.reviewId).filter(Boolean)),reviews=store.list('review',activity.id);
  const legacy=reviews.filter(r=>!linked.has(r.id)).map(r=>({id:'legacy:'+r.id,kind:'analysis',createdAt:r.startedAt||r.createdAt||r.finishedAt||null,reviewId:r.id,status:r.status,legacy:true,files:files(r.documentHashes||[])}));
  return [...events,...legacy].map(e=>{const review=e.reviewId?store.get(e.reviewId,'review'):null;return {...e,status:review?.status==='done'?review.result?.decision||'done':review?.status||e.status,finalScore:review?.result?.finalScore??review?.result?.qualityScore??null,finishedAt:review?.finishedAt||null,error:e.error||review?.error||null};}).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
 }
 return {upload,analysis,blockedAnalysis,list,validateBatch,start,failed};
}

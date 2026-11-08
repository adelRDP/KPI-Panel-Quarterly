import {assertQuarterWritable} from './quarter-lock.mjs';
import {closedActivity} from './position-closeout.mjs';
import {scoreRulesAt,ruleDaysBetween,tehranDay} from './score-rules.mjs';
import {quarterBounds} from './quarterly-calculation.mjs';
import {reviewEvidenceMatches} from './review-retention.mjs';
import {activityHumanFinal} from './activity-human-review.mjs';
import {activityDefinitionHash,activityReviewBasis,approvedActivityDeadline,approvedActivityScore} from './activity-exceptions.mjs';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status,publicMessage:message});};
const reason=v=>{if(typeof v!=='string'||v.trim().length<5||v.length>2000)fail('دلیل مستند را با حداقل پنج نویسه بنویسید.',400);return v.trim();};
export function createReviewCases(store,workflow,{audit,notifications,busy=new Set(),now=()=>new Date().toISOString()}={}){
 const manager=(actor,id)=>actor?.role==='manager'&&workflow.user(id)?.managerId===actor.id&&workflow.manages(actor,workflow.user(id));
 const canRead=(actor,row)=>actor?.role==='hr'||actor?.role==='personnel'&&actor.id===row.employeeId||manager(actor,row.employeeId);
 function activity(id){const a=store.get(id,'activity');if(!a||a.removedAt||a.assignmentStatus!=='approved')fail('شاخص مصوب پیدا نشد.',404);return a;}
 function writable(a){assertQuarterWritable(store,a.ownerId,a.period);if(closedActivity(store,a)||workflow.user(a.ownerId)?.isSettled)fail('بازهٔ شاخص بسته است؛ اعتراض به نتیجهٔ فصل را ثبت کنید.');if(busy.has(a.id)||store.list('review',a.id).some(r=>['queued','running'].includes(r.status))||store.list('activity-human-review',a.id).some(r=>['manager_review','hr_review'].includes(r.status)))fail('بررسی شاخص هنوز پایان نیافته است.');}
 const basis=a=>({sourceHash:activityReviewBasis(store,a),extensionId:approvedActivityDeadline(store,a)?.id||null,scoreId:approvedActivityScore(store,a)?.id||null});
 const filesFor=id=>store.list('review-case-file',id).map(({path,...file})=>file);
 function list(actor){return store.list('review-case').filter(r=>canRead(actor,r)).map(row=>({...row,files:filesFor(row.id),employeeName:workflow.user(row.employeeId)?.name||row.employeeId,activityTitle:store.get(row.activityId,'activity')?.title||row.activityTitle}));}
 function authorizeSubmission(actor,input){if(actor?.role!=='personnel')fail('ثبت درخواست فقط برای صاحب شاخص مجاز است.',403);const a=activity(input?.activityId);if(actor.id!==a.ownerId)fail('این شاخص متعلق به شما نیست.',403);writable(a);return a;}
 function file(actor,id,fileId){const row=store.get(id,'review-case'),found=store.get(fileId,'review-case-file',id);if(!row||!canRead(actor,row)||!found)fail('فایل پیدا نشد.',404);return found;}
 function create(actor,input,files=[]){return store.transaction(()=>{const a=authorizeSubmission(actor,input);if(!['activity-appeal','extension'].includes(input.type))fail('نوع درخواست معتبر نیست.',400);
  const directManager=workflow.user(workflow.user(a.ownerId)?.managerId);if(directManager?.role!=='manager'||directManager.unitId!==workflow.user(a.ownerId)?.unitId)fail('ابتدا مدیر مستقیمِ مجاز همان واحد باید تعیین شود.');
  const rules=scoreRulesAt(store,{unitId:a.unitId,kind:a.kind,at:now()}),previous=store.list('review-case').filter(r=>r.activityId===a.id&&r.type===input.type);
  if(previous.some(r=>['manager_review','hr_review'].includes(r.status)))fail('ابتدا درخواست باز قبلی را تکمیل کنید.');
  let details={};
  if(input.type==='activity-appeal'){
   if(previous.length>=Number(rules.values.activityAppealCount||3))fail('سهمیهٔ اعتراض به این شاخص پایان یافته است.');
   const human=activityHumanFinal(store,a),review=store.list('review',a.id).find(r=>r.status==='done'&&r.result?.finalForActivity&&reviewEvidenceMatches(store,a,r));if(!human&&!review)fail('ابتدا نتیجهٔ معتبر شاخص باید ثبت شود.');
   const timestamp=human?.adminReview?.at||human?.createdAt||review.finishedAt||review.createdAt;if(!timestamp||ruleDaysBetween(tehranDay(timestamp),tehranDay(now()),'business')>Number(rules.values.activityAppealDays||7))fail('مهلت اعتراض به نتیجهٔ شاخص پایان یافته است.');
   details={sourceReviewId:human?.id||review.id,originalScore:approvedActivityScore(store,a)?.score??human?.result?.finalScore??review.result.finalScore??review.result.qualityScore};
  }else{
   const due=input.dueDate,old=approvedActivityDeadline(store,a)?.dueDate||a.dueDate,end=a.assessmentEnd||quarterBounds(a.period).end;
   if(typeof due!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(due)||new Date(due+'T12:00:00Z').toISOString().slice(0,10)!==due||!old||due<=old||due>=end||ruleDaysBetween(old,due)>Number(rules.values.extensionMaxDays||30))fail('موعد جدید باید پس از موعد فعلی و در بازهٔ همین شاخص باشد.',400);
   if(!['leave','outage','dependency','duties','other'].includes(input.category))fail('دلیل شرایط استثنایی را انتخاب کنید.',400);details={dueDate:due,previousDueDate:old,category:input.category};
  }
  const at=now(),row=store.put('review-case',{type:input.type,activityId:a.id,activityTitle:a.title,employeeId:a.ownerId,managerId:workflow.user(a.ownerId)?.managerId,unitId:a.unitId,period:a.period,status:'manager_review',revision:1,reason:reason(input.reason),basis:basis(a),scoreRulesSnapshot:rules,...details,createdAt:at,events:[{state:'manager_review',at,by:actor.id}]},a.ownerId);for(const file of files)store.put('review-case-file',{...file,caseId:row.id,employeeId:row.employeeId,uploadedBy:actor.id,createdAt:at},row.id);audit?.(actor,'review-case.created','review-case',row.id);notifications?.publish({recipientIds:[row.managerId],actorId:actor.id,kind:'action',title:'درخواست بازبینی تازه ثبت شد',description:'درخواست مستند پرسنل در انتظار بررسی شماست.',view:'case-review',entityId:row.id});return {...row,files:filesFor(row.id)};
 });}
 function decide(actor,id,input){return store.transaction(()=>{const row=store.get(id,'review-case');if(!row||!canRead(actor,row))fail('درخواست پیدا نشد.',404);if(input?.revision!==row.revision)fail('درخواست تغییر کرده است؛ دوباره دریافت کنید.');
  const nextStage=actor.role==='manager'&&manager(actor,row.employeeId)&&row.status==='manager_review'?'hr_review':actor.role==='hr'&&row.status==='hr_review'?'approved':null;if(!nextStage)fail('درخواست در مرحلهٔ بررسی شما نیست.',403);if(!['approve','return','reject'].includes(input.decision))fail('تصمیم معتبر نیست.',400);
  const note=reason(input.reason),a=input.decision==='approve'?activity(row.activityId):store.get(row.activityId,'activity');if(input.decision==='approve'){writable(a);if(JSON.stringify(basis(a))!==JSON.stringify(row.basis))fail('تعریف، شواهد یا نتیجهٔ شاخص تغییر کرده است؛ درخواست تازه لازم است.');}
  let proposedScore=row.proposedScore;if(input.decision==='approve'&&row.type==='activity-appeal'&&actor.role==='manager'){if(!Number.isFinite(input.score)||input.score<0||input.score>100)fail('نمرهٔ نهایی پیشنهادی معتبر نیست.',400);proposedScore=input.score;}
  const status=input.decision==='approve'?nextStage:input.decision==='return'?'needs_revision':'rejected',at=now();
  if(status==='approved'){
   if(row.type==='extension')store.put('activity-deadline-extension',{caseId:id,activityId:a.id,definitionHash:activityDefinitionHash(a),dueDate:row.dueDate,previousDueDate:row.previousDueDate,reason:row.reason,approvedBy:actor.id,approvedAt:at},a.id);
   else store.put('activity-score-amendment',{caseId:id,activityId:a.id,sourceHash:row.basis.sourceHash,score:proposedScore,originalScore:row.originalScore,reason:row.reason,approvedBy:actor.id,approvedAt:at},a.id);
  }
  const updated=store.put('review-case',{...row,status,revision:row.revision+1,proposedScore,events:[...row.events,{state:status,at,by:actor.id,reason:note}]},row.employeeId);audit?.(actor,'review-case.decided','review-case',id,{status});notifications?.publish({recipientIds:status==='hr_review'?store.list('workflow-user').filter(p=>p.role==='hr').map(p=>p.id):[row.employeeId,row.managerId],actorId:actor.id,kind:'action',title:'وضعیت درخواست بازبینی تغییر کرد',description:'درخواست در بخش بازبینی و تمدید مهلت قابل پیگیری است.',view:'case-review',entityId:id});return updated;
 });}
 function resubmit(actor,id,input){return store.transaction(()=>{const row=store.get(id,'review-case');if(actor?.role!=='personnel'||row?.employeeId!==actor.id)fail('درخواست متعلق به شما نیست.',403);if(row.status!=='needs_revision'||row.revision!==input?.revision)fail('نسخهٔ قابل اصلاح پیدا نشد.');const a=activity(row.activityId);writable(a);if(JSON.stringify(basis(a))!==JSON.stringify(row.basis))fail('مبنای درخواست تغییر کرده است؛ درخواست تازه ثبت کنید.');const at=now(),updated=store.put('review-case',{...row,reason:reason(input.reason),status:'manager_review',revision:row.revision+1,events:[...row.events,{state:'manager_review',at,by:actor.id}]},row.employeeId);audit?.(actor,'review-case.resubmitted','review-case',id);return updated;});}
 function cancel(actor,id,input){return store.transaction(()=>{const row=store.get(id,'review-case');if(actor?.role!=='personnel'||row?.employeeId!==actor.id)fail('درخواست متعلق به شما نیست.',403);if(!['manager_review','hr_review','needs_revision'].includes(row.status)||row.revision!==input?.revision)fail('نسخهٔ باز درخواست پیدا نشد.');const at=now(),updated=store.put('review-case',{...row,status:'cancelled',revision:row.revision+1,events:[...row.events,{state:'cancelled',at,by:actor.id,reason:reason(input.reason)}]},row.employeeId);audit?.(actor,'review-case.cancelled','review-case',id);return updated;});}
 return {list,create,decide,resubmit,cancel,authorizeSubmission,file};
}

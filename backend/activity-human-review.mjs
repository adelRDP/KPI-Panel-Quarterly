import {createApprovalSla} from './approval-sla.mjs';
import {sha256} from './evaluation.mjs';
import {submissionQuota,scoreRulesAt,delayBreakdown} from './score-rules.mjs';
import {assertPositionActivityWritable,closedActivity} from './position-closeout.mjs';
import {assertQuarterWritable} from './quarter-lock.mjs';

export const ACTIVITY_HUMAN_POLICY='activity-human-after-five-v1';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const stamp=()=>new Date().toISOString();
const taskKeys=['id','ownerId','unitId','kind','period','title','description','criteria','assignmentStatus','positionId','positionVersion','designId','designVersion','dueDate','timeLimit','frequency','targetVolume','targetUnit','documentFormat','deliverable','removedAt','assessmentStart','assessmentEnd'];
const task=a=>Object.fromEntries(taskKeys.filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
const fingerprint=(store,a)=>sha256(JSON.stringify({task:task(a),documents:store.list('document',a.id).map(d=>[d.id,d.sha256,sha256(JSON.stringify(d.extraction)),d.archivedAt||null,d.archiveReason||null]).sort((x,y)=>x[0].localeCompare(y[0])),reviews:store.list('review',a.id).map(r=>[r.id,r.status,r.finishedAt,r.result]).sort((x,y)=>x[0].localeCompare(y[0]))}));
const locked=(store,a)=>store.list('quarter-evaluation',a.ownerId).some(q=>q.status==='locked'&&q.quarter===a.period);
export const activityHumanReviewRow=(store,a)=>store.list('activity-human-review',a.id)[0]||null;
export function activityHumanFinal(store,a){
 const row=activityHumanReviewRow(store,a);
 return row?.status==='approved'&&row.managerReview?.decision==='approve'&&row.adminReview?.decision==='approve'&&row.sourceHash===fingerprint(store,a)?row:null;
}
export function assertActivityHumanWritable(store,a){
 assertPositionActivityWritable(store,a);
 assertQuarterWritable(store,a.ownerId,a.period);
 const row=activityHumanReviewRow(store,a);
 if(row&&['manager_review','hr_review','approved'].includes(row.status))fail('این شاخص در گردش تأیید انسانی یا نهایی‌شده است؛ تغییر مستندات و اجرای AI مجاز نیست.');
}
export function createActivityHumanReview(store,workflow,{notifications,busy=new Set()}={}){
 const approvalSla=createApprovalSla(store,workflow,notifications);
 const manager=(actor,a)=>actor?.role==='manager'&&workflow.user(a.ownerId)?.managerId===actor.id&&workflow.manages(actor,workflow.user(a.ownerId));
 const readable=(actor,a)=>workflow.canRead(actor,a.ownerId);
 const current=id=>{const a=store.get(id,'activity');if(!a||a.removedAt)fail('شاخص پیدا نشد.',404);return a;};
 function baseReason(a){
  if(closedActivity(store,a))return 'بازهٔ سمت این شاخص نهایی و بسته شده است.';
  const person=workflow.user(a.ownerId);
  if(a.assignmentStatus!=='approved'||!/^14\d{2}-Q[1-4]$/.test(a.period))return 'تأیید انسانی فقط برای شاخص تخصیص‌یافته در دوره معتبر فعال است.';
  if(!person||person.role!=='personnel'||person.isSettled||workflow.userAt(person.id,a.period)?.isKpiEligible===false)return 'این فرد خارج از فرایند KPI است.';
  if(locked(store,a))return 'نتیجه فصل قفل‌شده است؛ تغییر نتیجه مجاز نیست.';
  if(busy.has(a.id)||store.list('review',a.id).some(r=>['queued','running'].includes(r.status)))return 'بررسی جاری باید ابتدا پایان یابد.';
  return null;
 }
 function eligibleReason(a,reason=baseReason(a)){
  if(reason)return reason;
  const q=submissionQuota(store,a),latest=store.list('review',a.id)[0];
  if(q.used<5||q.remaining!==0||q.pending)return 'پس از تکمیل پنج تحویل و اتمام سهمیه، توضیحات نهایی قابل ارسال است.';
  if(latest?.status!=='done'||latest.result?.coverage?.incomplete)return 'آخرین بررسی باید بدون خطای فنی و با خوانش کامل تمام شده باشد.';
  if(latest.result?.decision==='completed')return 'آخرین ارزیابی تأیید شده و به تأیید انسانی نیاز ندارد.';
  const leader=workflow.user(workflow.user(a.ownerId)?.managerId);
  if(leader?.role!=='manager'||!workflow.manages(leader,workflow.user(a.ownerId)))return 'مدیر مستقیم معتبر برای این فرد تعیین نشده است.';
  return null;
 }
 function state(actor,a){
  if(!readable(actor,a))fail('دسترسی به تأیید انسانی این شاخص مجاز نیست.',403);
  const row=activityHumanReviewRow(store,a),stale=!!row&&(row.sourceHash!==fingerprint(store,a)||row.status!=='approved'&&row.managerId!==workflow.user(a.ownerId)?.managerId),reason=baseReason(a),eligible=eligibleReason(a,reason),owner=actor?.role==='personnel'&&actor.id===a.ownerId;
  return {policyVersion:ACTIVITY_HUMAN_POLICY,row,stale,blockedReason:reason||eligible,
   canSubmit:owner&&!eligible&&(!row||row.status==='needs_revision'||stale&&row.status!=='approved'),
   canManagerReview:!reason&&!stale&&row?.status==='manager_review'&&manager(actor,a),
   canAdminReview:!reason&&!stale&&row?.status==='hr_review'&&actor?.role==='hr'};
 }
 const note=value=>{if(typeof value!=='string'||value.trim().length<5||value.length>10000)fail('توضیحات لازم را بین ۵ تا ۱۰٬۰۰۰ نویسه بنویسید.',400);return value.trim();};
 function audit(actor,a,row,action){approvalSla.observe('activity-human-review',store.list('activity-human-review',a.id)[0]?.id);store.put('audit-event',{actorId:actor.id,action:'activity-human.'+action,entityType:'activity',entityId:a.id,details:{requestId:row.id,revision:row.revision,status:row.status,policyVersion:ACTIVITY_HUMAN_POLICY},createdAt:stamp()});}
 function notify(actor,a,row,recipientIds,title,view){notifications?.publish({eventKey:`activity-human:${row.id}:${row.revision}`,recipientIds,actorId:actor.id,kind:'info',title,description:a.title,view,entityId:a.id});}
 function submit(actor,id,input){return store.transaction(()=>{
  const a=current(id),s=state(actor,a);if(!s.canSubmit)fail(s.blockedReason||'ارسال توضیحات در این مرحله مجاز نیست.',actor.id===a.ownerId?409:403);
  const explanation=note(input.explanation),latest=store.list('review',a.id)[0],at=stamp(),previous=s.row;
  if(previous&&input.revision!==previous.revision)fail('درخواست تغییر کرده است؛ صفحه را تازه کنید.');
  const documents=store.list('document',a.id),row=store.put('activity-human-review',{policyVersion:ACTIVITY_HUMAN_POLICY,activityId:a.id,employeeId:a.ownerId,managerId:workflow.user(a.ownerId).managerId,period:a.period,title:a.title,status:'manager_review',revision:1,explanation,createdAt:at,updatedAt:at,sourceHash:fingerprint(store,a),activitySnapshot:task(a),sourceReviewId:latest.id,scoreRulesSnapshot:latest.scoreRulesSnapshot||scoreRulesAt(store,{unitId:a.unitId,kind:a.kind}),lateDays:latest.lateDays||0,quotaSnapshot:submissionQuota(store,a),documents:documents.map(d=>({id:d.id,name:d.name,size:d.size,sha256:d.sha256})),supersedes:previous?.id||null,events:[{status:'manager_review',actorId:actor.id,at,note:explanation}]},a.id);
  audit(actor,a,row,'submitted');notify(actor,a,row,[row.managerId],'توضیحات نهایی شاخص برای بررسی مدیر','position-review');return row;
 });}
 function decide(actor,id,input){return store.transaction(()=>{
  const a=current(id),s=state(actor,a),row=s.row;
  if(!row||input.requestId!==row.id||input.revision!==row.revision)fail('درخواست تغییر کرده است؛ صفحه را تازه کنید.');
  if(!s.canManagerReview&&!s.canAdminReview)fail(s.stale?'تعریف یا شواهد تغییر کرده است؛ توضیحات نهایی باید دوباره ارسال شود.':s.blockedReason||'این مرحله در اختیار شما نیست.',403);
  if(!['approve','return'].includes(input.decision))fail('تصمیم معتبر نیست.',400);
  const reason=note(input.reason),at=stamp(),isManager=s.canManagerReview;
  const review={actorId:actor.id,decision:input.decision,reason,at};
  let patch;
  if(isManager){
   if(input.decision==='approve'&&(typeof input.qualityScore!=='number'||!Number.isFinite(input.qualityScore)||input.qualityScore<0||input.qualityScore>100))fail('امتیاز پیشنهادی مدیر باید عددی از صفر تا صد باشد.',400);
   patch={status:input.decision==='approve'?'hr_review':'needs_revision',managerReview:{...review,...(input.decision==='approve'?{qualityScore:input.qualityScore}: {})},adminReview:null};
  }else{
   if(row.managerReview?.decision!=='approve'||!Number.isFinite(row.managerReview.qualityScore))fail('تأیید و امتیاز مدیر ثبت نشده است.');
   patch={status:input.decision==='approve'?'approved':'manager_review',adminReview:review};
   if(input.decision==='approve')patch.result={...delayBreakdown(row.scoreRulesSnapshot,row.managerReview.qualityScore,row.lateDays),source:'human',finalForActivity:true,finalizedAt:at,policyVersion:ACTIVITY_HUMAN_POLICY};
  }
  const updated=store.put('activity-human-review',{...row,...patch,revision:row.revision+1,updatedAt:at,events:[...row.events,{status:patch.status,actorId:actor.id,at,note:reason,qualityScore:isManager?patch.managerReview.qualityScore:row.managerReview.qualityScore}]},a.id);
  audit(actor,a,updated,isManager?'manager-reviewed':'admin-reviewed');
  const recipients=patch.status==='hr_review'?workflow.accounts().filter(p=>p.role==='hr').map(p=>p.id):patch.status==='manager_review'?[workflow.user(a.ownerId).managerId]:[a.ownerId];
  notify(actor,a,updated,recipients,patch.status==='approved'?'نتیجه شاخص با تأیید ادمین نهایی شد':'مرحله تأیید انسانی شاخص تغییر کرد',patch.status==='hr_review'?'incoming':patch.status==='manager_review'?'position-review':a.kind==='project'?'projectAssignments':'assignments');return updated;
 });}
 function list(actor){return store.list('activity-human-review').filter(row=>{const a=store.get(row.activityId,'activity');return a&&!a.removedAt&&readable(actor,a)&&(actor.role!=='manager'||manager(actor,a))&&activityHumanReviewRow(store,a)?.id===row.id;}).map(row=>({...row,employeeName:workflow.user(row.employeeId)?.name,unitName:workflow.user(row.employeeId)?.unitName}));}
 function document(actor,id,documentId){const a=current(id);if(!readable(actor,a))fail('دسترسی مجاز نیست.',403);const row=activityHumanReviewRow(store,a),ref=row?.documents.find(d=>d.id===documentId),d=store.get(documentId,'document');if(!ref||!d||d.sha256!==ref.sha256||!store.list('document',a.id).some(x=>x.id===d.id))fail('مستند این درخواست پیدا نشد.',404);return d;}
 return {state,submit,decide,list,document};
}

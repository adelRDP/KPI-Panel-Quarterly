import {createHash} from 'node:crypto';
import Model from '../src/performance-model.js';
import {periodAtDate as quarterAtDate,nextQuarter,quarterOf} from './quarter-period.mjs';
import {calculateQuarterSlice} from './quarterly-calculation.mjs';

export const CLOSEOUT_VERSION='quarterly-position-closeout-v1';
const fail=message=>{throw Object.assign(new Error(message),{status:409,publicMessage:message});};
const dayMs=86400000;
export const daysBetween=(start,end)=>(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/dayMs;
export const previousDay=end=>new Date(Date.parse(end+'T00:00:00Z')-dayMs).toISOString().slice(0,10);
export const periodAtDate=quarterAtDate;
export const nextPeriod=nextQuarter;
export const quarterFor=quarterOf;
export const positionClosed=(store,id)=>{if(!id)return null;const position=store.get(id,'position-assignment');return store.list('position-closeout',position?.employeeId).find(r=>r.status==='locked'&&r.positionId===id)||null;};
export const closedActivity=(store,a)=>!!(a.positionId&&positionClosed(store,a.positionId))||store.list('position-closeout',a.ownerId).some(r=>r.status==='locked'&&r.months.some(m=>m.assignments.some(x=>x.id===a.id)));
export function assertPositionActivityWritable(store,a){if(closedActivity(store,a))fail('امتیاز و مبلغ این شاخص در پایان سمت نهایی و بسته شده است؛ تغییر یا بررسی مجدد مجاز نیست.');}

// All intervals are [start,end). Cumulative integer allocation counts every day
// exactly once, including the last currency unit of a split month.
export function calculatePositionSlice(snapshot,{start,end,bounds,positionId}){
 if(start<bounds.start||end>bounds.end||start>=end||!Number.isSafeInteger(daysBetween(start,end)))fail('بازهٔ محاسبه معتبر نیست.');
 if(snapshot.moneyMissing)fail('حقوق مبنای سمت هنوز تعیین نشده است.');
 const calculation=calculateQuarterSlice({quarter:snapshot.period,start,end,monthlySalary:snapshot.monthlySalary,policy:snapshot.policy,hasProjects:snapshot.hasProjects,eligible:!snapshot.notApplicable,scores:Object.fromEntries(snapshot.components.map(c=>[c.id,c.score]))});
 return {...snapshot,...calculation,positionId,lastDay:previousDay(end),formulaVersion:CLOSEOUT_VERSION};
}

export function createPositionCloseout(store,workflow,{periodBounds,today,audit,busy=new Set()}){
 function preview(proposal){
  const old=proposal?.supersedes&&store.get(proposal.supersedes,'position-assignment');
  if(!old)return {required:false,ready:true,months:[],blockers:[],fingerprint:null};
  const cutoff=proposal.effectiveFrom,blockers=[];
  if(old.status!=='published'||old.employeeId!==proposal.employeeId||old.effectiveTo&&old.effectiveTo!==cutoff||positionClosed(store,old.id))blockers.push('سمت قبلی تغییر کرده یا قبلاً بسته شده است؛ درخواست تازه لازم است.');
  if(cutoff<=old.effectiveFrom)blockers.push('تاریخ جابه‌جایی باید پس از شروع سمت قبلی باشد.');
  if(cutoff>today())blockers.push('نهایی‌سازی جابه‌جایی آینده پیش از رسیدن تاریخ و تکمیل امتیازها مجاز نیست.');
  const quarterLocks=store.list('quarter-evaluation',old.employeeId).filter(q=>q.status==='locked');
  if(quarterLocks.some(q=>q.quarter===quarterFor(periodAtDate(cutoff))))blockers.push('فصل تاریخ جابه‌جایی قبلاً قفل شده است؛ بازنویسی نتیجه مجاز نیست.');
  if(store.list('ai-role-run',old.id).some(r=>['queued','running'].includes(r.status)))blockers.push('تحلیل تعریف شاخص در حال انجام است.');
  if(store.list('activity').some(a=>a.ownerId===old.employeeId&&(!a.positionId||a.positionId===old.id)&&busy.has(a.id)))blockers.push('بارگذاری یا ارزیابی شاخص در حال انجام است؛ پس از پایان دوباره تلاش کنید.');
  const periods=new Set(),recordPeriods=['activity','manager-survey','service-survey-aggregate'].flatMap(kind=>store.list(kind).filter(r=>(r.ownerId||r.employeeId)===old.employeeId&&!r.removedAt&&/^14\d{2}-Q[1-4]$/.test(r.period||'')).map(r=>r.period));
  // Migration's 2020 placeholder is not evidence of six years of entitlement.
  // Start at the first recorded assessment or current quarter, whichever is earlier.
  const quarterStart=workflow.currentPeriod;
  const first=old.events?.[0]?.by==='migration'?[quarterStart,...recordPeriods].sort()[0]:periodAtDate(old.effectiveFrom);
  let count=0;for(let p=first;p<=periodAtDate(previousDay(cutoff));p=nextPeriod(p)){
   if(++count>1200)fail('بازهٔ سمت بیش از حد مجاز است؛ تاریخ شروع باید بررسی شود.');
   const b=periodBounds(p);if(b.end>old.effectiveFrom&&b.start<cutoff)periods.add(p);
  }
  const months=[],lockedQuarters=new Set(store.list('quarter-evaluation',old.employeeId).filter(q=>q.status==='locked').map(q=>q.quarter));
  for(const p of [...periods].sort()){
   const bounds=periodBounds(p);if(lockedQuarters.has(quarterFor(p))){if(cutoff>bounds.start&&cutoff<bounds.end)blockers.push(`${p}: تاریخ جابه‌جایی داخل فصل نهایی‌شده است.`);continue;}
   const start=old.effectiveFrom>bounds.start?old.effectiveFrom:bounds.start,end=cutoff<bounds.end?cutoff:bounds.end;
   const snapshot=workflow.snapshotForPosition(old.employeeId,p,old.id);
   const slice=calculatePositionSlice(snapshot,{start,end,bounds,positionId:old.id});months.push(slice);
   if(slice.positionReviewRequired)blockers.push(`${p}: جابه‌جایی تاریخی دیگری در این ماه هنوز تفکیک و نهایی نشده است.`);
   if(!slice.complete)blockers.push(`${p}: امتیازهای ${slice.components.filter(c=>c.applicable&&c.score===null).map(c=>c.name).join('، ')} تکمیل نشده‌اند.`);
   if(store.list('review-case').some(r=>slice.assignments.some(a=>a.id===r.activityId)&&['manager_review','hr_review','needs_revision'].includes(r.status)))blockers.push(`${p}: درخواست بازبینی یا تمدید شاخص هنوز تعیین تکلیف نشده است.`);
   if(slice.assignments.some(a=>a.score===null))blockers.push(`${p}: همهٔ شاخص‌های تخصیص‌یافته باید امتیاز نهایی معتبر داشته باشند، حتی اگر سهم مدل آن‌ها صفر باشد.`);
   if(store.list('review').some(r=>slice.assignments.some(a=>a.id===(r.activityId||r.activitySnapshot?.id))&&['queued','running'].includes(r.status))||store.list('activity-human-review').some(r=>slice.assignments.some(a=>a.id===r.activityId)&&['manager_review','hr_review'].includes(r.status)))blockers.push(`${p}: بررسی شاخص هنوز در حال انجام است.`);
   if(store.list('ai-preprocess-attempt').some(r=>r.status==='running'&&slice.assignments.some(a=>a.id===r.activitySnapshot?.id)))blockers.push(`${p}: پردازش مستند هنوز پایان نیافته است.`);
  }
  if(!months.length&&!lockedQuarters.size&&old.isKpiEligible!==false)blockers.push('هیچ بازهٔ ارزیابی قابل نهایی‌سازی پیدا نشد.');
  const earned=months.reduce((n,m)=>n+m.earned,0),ceiling=months.reduce((n,m)=>n+m.ceiling,0),baseSalary=months.reduce((n,m)=>n+m.baseSalary,0);
  const material={version:CLOSEOUT_VERSION,proposal,position:old,months,blockers};
  return {required:true,ready:!blockers.length,positionId:old.id,start:months[0]?.start||old.effectiveFrom,end:cutoff,months,blockers,earned:!blockers.length?earned:null,ceiling,baseSalary,performance:ceiling?months.reduce((n,m)=>n+(m.performance??0)*m.ceiling,0)/ceiling:null,fingerprint:createHash('sha256').update(JSON.stringify(material)).digest('hex')};
 }
 function lock(actor,proposal,input){
  const result=preview(proposal);if(!result.required)return null;
  if(!result.ready)fail(result.blockers.join('\n'));
  if(input.closeoutAcknowledgment!==true||input.closeoutFingerprint!==result.fingerprint)fail('پیش‌نمایش نهایی امتیاز و مبلغ را بازبینی و تأیید کنید؛ داده‌ها ممکن است تغییر کرده باشند.');
  const record=store.put('position-closeout',{...result,version:CLOSEOUT_VERSION,employeeId:proposal.employeeId,nextPositionId:proposal.id,status:'locked',lockedBy:actor.id,lockedAt:new Date().toISOString()},proposal.employeeId);
  audit(actor,'position.closeout-locked','position-closeout',record.id,{positionId:result.positionId,nextPositionId:proposal.id,fingerprint:result.fingerprint});return record;
 }
 return {preview,lock};
}

import {createHash} from 'node:crypto';
import {periodAtDate,nextQuarter} from './quarter-period.mjs';
import {quarterBounds} from './quarterly-calculation.mjs';
import {positionClosed,calculatePositionSlice} from './position-closeout.mjs';
export const SETTLEMENT_VERSION='quarterly-settlement-inclusive-v1';
const nextDay=day=>new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const priorDay=day=>new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Read-only plan. Registration recalculates this inside the write transaction.
export function settlementPlan(store,workflow,employeeId,settlementDate,{today,busy=new Set()}){
 const end=nextDay(settlementDate),blockers=[],positions=store.list('position-assignment',employeeId).filter(p=>p.status==='published');
 if(settlementDate>today)blockers.push('تسویهٔ آینده قابل نهایی‌سازی نیست؛ پس از رسیدن تاریخ و تکمیل امتیازها اقدام کنید.');
 if(!positions.some(p=>p.effectiveFrom<=settlementDate))blockers.push('تاریخ تسویه نباید پیش از شروع همکاری باشد.');
 if(positions.some(p=>p.effectiveFrom>=end))blockers.push('بعد از تاریخ تسویه، سمت منتشرشده وجود دارد؛ تسویهٔ عقب‌گرد مجاز نیست.');
 const frozen=store.list('position-closeout',employeeId).filter(r=>r.status==='locked');
 if(frozen.some(r=>r.end>end))blockers.push('تاریخ تسویه داخل بازهٔ سمت نهایی‌شده است؛ تغییر مبلغ بسته‌شده مجاز نیست.');
 const locks=store.list('quarter-evaluation',employeeId).filter(r=>r.status==='locked');
 if(locks.some(r=>quarterBounds(r.quarter).end>end))blockers.push('تاریخ تسویه پیش از پایان فصل نهایی‌شده است؛ بازنویسی نتیجه مجاز نیست.');
 if(blockers.length)return {version:SETTLEMENT_VERSION,employeeId,settlementDate,end,ready:false,blockers,closeouts:[],earned:null,baseSalary:null,total:null,fingerprint:digest({employeeId,settlementDate,blockers})};
 const activities=store.list('activity').filter(a=>a.ownerId===employeeId),ids=new Set([employeeId,...positions.map(p=>p.id),...store.list('kpi-design',employeeId).map(d=>d.id),...activities.map(a=>a.id)]);
 const pending=['review','ai-design-attempt','ai-preprocess-attempt','ai-role-run','activity-human-review'].flatMap(kind=>store.list(kind).filter(r=>['queued','running','manager_review','hr_review'].includes(r.status)&&[r.employeeId,r.designId,r.activityId,r.activitySnapshot?.id,r.positionId].some(id=>ids.has(id))));
 if(pending.length||[...ids].some(id=>busy.has(id)))blockers.push('بارگذاری یا بررسی AI/انسانی هنوز پایان نیافته است؛ تسویه مجاز نیست.');
 const closeouts=[];
 for(const position of positions.filter(p=>p.effectiveFrom<end&&!positionClosed(store,p.id))){
  const cutoff=position.effectiveTo&&position.effectiveTo<end?position.effectiveTo:end,months=[];
  if(cutoff<=position.effectiveFrom)continue;
  let count=0;
  for(let quarter=periodAtDate(position.effectiveFrom);quarter<=periodAtDate(priorDay(cutoff));quarter=nextQuarter(quarter)){
   if(++count>1200){blockers.push('بازهٔ همکاری بیش از حد مجاز است؛ تاریخ شروع را بررسی کنید.');break;}
   if(locks.some(r=>r.quarter===quarter))continue;
   const bounds=quarterBounds(quarter),start=position.effectiveFrom>bounds.start?position.effectiveFrom:bounds.start,sliceEnd=cutoff<bounds.end?cutoff:bounds.end;
   const snapshot=workflow.snapshotForPosition(employeeId,quarter,position.id,{start,end:sliceEnd});
   if(snapshot.moneyMissing){blockers.push(`${quarter}: مبنای مبلغ این بازه تعیین نشده است.`);continue;}
   const slice=calculatePositionSlice(snapshot,{start,end:sliceEnd,bounds,positionId:position.id});months.push(slice);
   if(!slice.complete||slice.positionReviewRequired||slice.assignments.some(a=>a.score===null))blockers.push(`${quarter}: پیش از تسویه، همهٔ امتیازها، شاخص‌ها و مبنای مبلغ این بازه باید تکمیل و جابه‌جایی‌های قبلی نهایی شوند.`);
  }
  const ceiling=months.reduce((n,m)=>n+(m.ceiling||0),0),earned=months.reduce((n,m)=>n+(m.earned||0),0),baseSalary=months.reduce((n,m)=>n+(m.baseSalary||0),0);
  closeouts.push({positionId:position.id,start:months[0]?.start||position.effectiveFrom,end:cutoff,months,ceiling,earned,baseSalary,performance:ceiling?months.reduce((n,m)=>n+(m.performance||0)*m.ceiling,0)/ceiling:null});
 }
 const ready=blockers.length===0,earned=ready?closeouts.reduce((n,c)=>n+c.earned,0):null,baseSalary=ready?closeouts.reduce((n,c)=>n+c.baseSalary,0):null;
 return {version:SETTLEMENT_VERSION,employeeId,settlementDate,end,ready,blockers,closeouts,earned,baseSalary,total:ready?earned+baseSalary:null,fingerprint:digest({version:SETTLEMENT_VERSION,employeeId,settlementDate,positions,frozen,locks,closeouts,blockers})};
}

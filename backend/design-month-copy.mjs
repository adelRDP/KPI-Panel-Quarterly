import {createHash} from 'node:crypto';
import {periodBounds} from './personnel-workflow.mjs';
import {canonical,safeTasks} from './job-design-analysis.mjs';

export const MONTH_COPY_VERSION='design-month-copy-v1';
export const copyHash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{status:409,publicMessage:message});};
export function nextDesignMonth(period){
 if(!/^14\d{2}-(0[1-9]|1[0-2])$/.test(period||''))fail('ماه نسخه برای کپی معتبر نیست.');
 const [year,month]=period.split('-').map(Number),next=`${year+(month===12?1:0)}-${String(month===12?1:month+1).padStart(2,'0')}`;
 if(!/^14\d{2}-/.test(next))fail('ماه بعد بیرون از بازهٔ پشتیبانی‌شده است.');return next;
}
export const copyPolicySnapshot=policy=>({version:policy.version,unitId:policy.unitId,weights:policy.weights,calculationVersion:policy.calculationVersion});
export const copyMaterialFingerprint=design=>copyHash({version:MONTH_COPY_VERSION,id:design.id,employeeId:design.employeeId,managerId:design.managerId,unitId:design.unitId,period:design.period,designVersion:design.version,positionId:design.positionId,positionVersion:design.positionVersion,policyVersion:design.policyVersion,tasks:safeTasks(design.tasks||[]),aiReview:design.aiReview||null});
export const copySourceFingerprint=design=>copyHash({material:copyMaterialFingerprint(design),status:design.status,managerReview:design.managerReview||null,hrReview:design.hrReview||null,removedAt:design.removedAt||null});

const digits=value=>String(value).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632));
const explicitMonth=/(?:فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*(?:ماه|14\d{2})|ماه\s*(?:فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)(?:\s|$)/;
const persianParts=iso=>{const parts=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(new Date(iso+'T12:00:00Z'));return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value);};
function rewriteKnownDateReferences(value,changes){
 const dates=[];
 const updated=String(value).replace(/[0-9۰-۹٠-٩]{4}[-/][0-9۰-۹٠-٩]{1,2}[-/][0-9۰-۹٠-٩]{1,2}/g,(token,offset,original)=>{
  if(/(?:(?:پنج|چهار|سه|دو|یک)[‌ ]?شنبه|شنبه|جمعه|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*(?:مورخ\s*)?$/i.test(original.slice(0,offset)))fail('روز هفتهٔ نوشته‌شده کنار موعد نیازمند بازبینی صریح است؛ فقط عدد تاریخ تغییر نمی‌کند.');
  const parsed=/^(\d{4})([-/])(\d{1,2})([-/])(\d{1,2})$/.exec(digits(token));let iso;
  const year=Number(parsed[1]),month=Number(parsed[3]),day=Number(parsed[5]);
  if(/^14\d{2}$/.test(parsed[1])){const bounds=periodBounds(`${year}-${String(month).padStart(2,'0')}`);if(day<1||day>bounds.totalDays)fail('تاریخ متن معیار معتبر نیست.');iso=new Date(Date.parse(bounds.start+'T00:00:00Z')+(day-1)*86400000).toISOString().slice(0,10);}
  else iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const match=changes.find(row=>row.before===iso);if(!match)fail('تاریخ متن به موعد ساختاری همین شاخص متصل نیست؛ بازبینی لازم است.');
  const prefix=original.slice(Math.max(0,offset-100),offset),deadlineCue=/(?:^|\s|[:：])(?:تا(?:\s+(?:روز|تاریخ))?|موعد|مهلت|تحویل(?:\s+(?:تا|در|روز|تاریخ))?|deadline|due(?:\s+date)?|delivery(?:\s+date)?)\s*[:：]?\s*$/i;
  if(!deadlineCue.test(prefix)||/مصوبه|بخشنامه|دستورالعمل|استاندارد|سیاست|(?:policy|resolution|regulation|standard)\s/i.test(prefix))fail('نقش تاریخ متن به‌عنوان موعد صریح معلوم نیست؛ تاریخ سند یا سیاست خودکار تغییر نمی‌کند.');
  const parts=/^14\d{2}$/.test(parsed[1])?persianParts(match.after):match.after.split('-');let replacement=parts[0]+parsed[2]+String(Number(parts[1])).padStart(parsed[3].length,'0')+parsed[4]+String(Number(parts[2])).padStart(parsed[5].length,'0');
  if(/[۰-۹]/.test(token))replacement=replacement.replace(/\d/g,d=>String.fromCharCode(1776+Number(d)));else if(/[٠-٩]/.test(token))replacement=replacement.replace(/\d/g,d=>String.fromCharCode(1632+Number(d)));
  dates.push({before:token,after:replacement});return replacement;
 });
 if(explicitMonth.test(digits(updated)))fail('متن شاخص به ماه مشخص اشاره دارد؛ کپی بدون بازبینی متن مجاز نیست.');
 return {value:updated,dates};
}
function shiftDate(value){
 const parsed=new Date(value+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail('تاریخ ساختاری شاخص معتبر نیست.');
 const parts=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(new Date(value+'T12:00:00Z'));
 const part=key=>parts.find(p=>p.type===key).value,period=nextDesignMonth(part('year')+'-'+part('month')),bounds=periodBounds(period),day=Number(part('day'));
 if(day>bounds.totalDays)fail('روز موعد در ماه بعد وجود ندارد؛ تاریخ تازه باید صریحاً تعیین و بررسی شود.');
 return new Date(Date.parse(bounds.start+'T00:00:00Z')+(day-1)*86400000).toISOString().slice(0,10);
}
export function copyTasksToNextMonth(tasks,sourcePeriod,targetPeriod=nextDesignMonth(sourcePeriod)){
 if(targetPeriod!==nextDesignMonth(sourcePeriod))fail('کپی فقط به ماه بلافاصله بعد مجاز است.');
 const bounds=periodBounds(targetPeriod),dateChanges=[],textChanges=[];
 const copied=structuredClone(tasks).map(task=>{
  const firstChange=dateChanges.length;
  if(task.frequency==='ماهانه'&&task.timeLimit?.dayOfMonth>bounds.totalDays)fail('روز انجام شاخص در ماه بعد وجود ندارد؛ روز جدید را صریحاً تعیین کنید.');
  for(const field of ['dueDate','deadline'])if(task[field]){const before=task[field],after=shiftDate(before);if(after<bounds.start)fail('موعد کپی‌شده پیش از ماه جدید است؛ بازبینی زمان لازم است.');task[field]=after;dateChanges.push({taskId:task.id,field,before,after});}
  for(const [index,m] of (task.milestones||[]).entries())if(m.dueDate){const before=m.dueDate,after=shiftDate(before);m.dueDate=after;dateChanges.push({taskId:task.id,field:`milestones.${index}.dueDate`,before,after});}
  const known=dateChanges.slice(firstChange),rewrite=(before,field)=>{const changed=rewriteKnownDateReferences(before,known);if(changed.dates.length)textChanges.push({taskId:task.id,field,before,after:changed.value,dates:changed.dates});return changed.value;};
  for(const field of ['title','description'])if(task[field]!=null)task[field]=rewrite(task[field],field);
  task.criteria=(task.criteria||[]).map((value,index)=>rewrite(value,`criteria.${index}`));
  for(const [index,m]of (task.milestones||[]).entries())if(m.name!=null)m.name=rewrite(m.name,`milestones.${index}.name`);
  return task;
 });
 return {tasks:copied,dateChanges,textChanges};
}

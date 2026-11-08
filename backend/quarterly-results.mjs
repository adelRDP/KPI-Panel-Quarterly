import {createHash} from 'node:crypto';
import {requireQuarter} from './quarter-period.mjs';
import {quarterBounds} from './quarterly-calculation.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status,publicMessage:message});};
export function quarterlyResult(store,workflow,actor,quarter,id,{busy=new Set(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran'}).format(new Date())}={}){
 requireQuarter(quarter);if(!workflow.canRead(actor,id))fail('دسترسی به فصل این پرسنل مجاز نیست.',403);
 const row=workflow.snapshotForSystem(id,quarter),bounds=quarterBounds(quarter),blockers=[];
 if(row.notApplicable)blockers.push('بازهٔ سمت واجد شرایط در این فصل وجود ندارد.');
 if(today<bounds.end)blockers.push('فصل هنوز پایان نیافته است؛ نتیجه قابل نهایی‌سازی نیست.');
 if(!row.complete)blockers.push('امتیازها یا مبنای مبلغ فصل هنوز کامل نیستند.');
 if(row.positionReviewRequired)blockers.push('بازهٔ قبلی سمت هنوز نهایی نشده است.');
 if(row.assignments.some(a=>a.score===null))blockers.push('تمام شاخص‌های تخصیص‌یافته باید نتیجهٔ معتبر داشته باشند.');
 const ids=new Set(row.assignments.map(a=>a.id));
 if(row.assignments.some(a=>busy.has(a.id))||store.list('review').some(r=>ids.has(r.activityId||r.activitySnapshot?.id)&&['queued','running'].includes(r.status))||store.list('activity-human-review').some(r=>ids.has(r.activityId)&&['manager_review','hr_review'].includes(r.status))||store.list('ai-preprocess-attempt').some(r=>ids.has(r.activitySnapshot?.id)&&r.status==='running'))blockers.push('بررسی شواهد هنوز در حال انجام است.');
 if(store.list('review-case').some(r=>ids.has(r.activityId)&&['manager_review','hr_review','needs_revision'].includes(r.status)))blockers.push('درخواست اعتراض یا تمدید شاخص هنوز تعیین تکلیف نشده است.');
 const segments=row.segments||[row],quarterPay={complete:row.complete,finalized:row.complete,earned:row.complete?row.earned:null,knownEarned:row.earned,ceiling:row.ceiling,formulaVersion:'quarterly-direct-v1',policyVersion:row.policy.version,breakdown:segments.map(p=>({positionId:p.positionId,start:p.start||bounds.start,end:p.end||bounds.end,days:p.days||bounds.totalDays,closed:!!p.closed,score:p.performance,ceiling:p.ceiling,earned:p.earned})),oneTimeContribution:null};
 const calculation={components:row.components,performance:row.performance,complete:row.complete,earned:row.earned,ceiling:row.ceiling,baseSalary:row.baseSalary,modelType:'unified',policyVersion:row.policy.version,calculationVersion:'quarterly-direct-v1'};
 const result={employee:row.employee,quarter,months:[quarter],modelType:'unified',policy:row.policy,exam:row.exam,monthRows:[{period:quarter,components:row.components,positionId:row.positionId,positionVersion:row.positionVersion}],calculation,quarterPay,blockers,status:blockers.length?'incomplete':'ready',canFinalize:!blockers.length,aggregationVersion:'quarterly-direct-v1',source:'quarterly-project',sourceSnapshot:row};
 result.fingerprint=createHash('sha256').update(JSON.stringify({result,segments,assignments:row.assignments,survey:row.survey})).digest('hex');return result;
}
export function quarterlyProgress(workflow,actor,quarter,asOfPeriod){
 if(actor.role!=='personnel')fail('دسترسی پرسنل لازم است.',403);requireQuarter(quarter);if(asOfPeriod!==quarter)fail('فصل انتخاب‌شده معتبر نیست.');
 const row=workflow.snapshotForSystem(actor.id,quarter);
 return {quarter,amendmentVersion:row.amendmentVersion||0,throughPeriod:quarter,monthsCount:1,totalMonths:1,performance:row.performance,earned:row.earned,ceiling:row.ceiling,baseSalaryToDate:row.baseSalary,fullBaseSalary:row.baseSalary,finalToDate:row.baseSalary==null||row.earned==null?null:row.baseSalary+row.earned,maxQuarterSalary:row.baseSalary==null||row.ceiling==null?null:row.baseSalary+row.ceiling,pendingCount:row.components.filter(c=>c.applicable&&c.score===null).length,aggregationVersion:'quarterly-direct-v1',source:'quarterly-project'};
}

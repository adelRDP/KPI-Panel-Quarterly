import {approvedActivityScore} from './activity-exceptions.mjs';
import {requireQuarter,periodAtDate,quarterOf} from './quarter-period.mjs';
import {quarterBounds,calculateQuarterSlice} from './quarterly-calculation.mjs';
import {policyForPeriod} from './evaluation-settings.mjs';
import {reviewEvidenceMatches} from './review-retention.mjs';
import {activityHumanFinal} from './activity-human-review.mjs';
import {assertQuarterWritable} from './quarter-lock.mjs';
import {settlementState,settlementFor} from './personnel-settlement.mjs';
import {validateActivity} from './evaluation.mjs';
import {finalQuarterSnapshot,frozenWorkflowSnapshot} from './quarter-final-snapshot.mjs';
export const currentPeriod=()=>periodAtDate();
export const quarterMonths=q=>[requireQuarter(q)];
export const periodBounds=quarterBounds;
export {quarterOf};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran'}).format(new Date());
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status,publicMessage:message});};
const scoreOf=n=>{if(!Number.isFinite(n)||n<0||n>100)fail('امتیاز باید بین صفر تا صد باشد.');return n;};
const text=(v,n)=>{if(typeof v!=='string'||!v.trim()||v.length>n)fail('متن ورودی معتبر نیست.');return v.trim();};
const publicUser=p=>p&&Object.fromEntries(['id','name','role','level','jobTitle','jobFamily','sectionId','unitId','unitName','managerId','isKpiEligible','isSettled','settlementDate'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
export function createWorkflow(store){
 const positionAt=(id,at=today())=>store.list('position-assignment',id).find(p=>p.status==='published'&&p.effectiveFrom<=at&&(!p.effectiveTo||p.effectiveTo>at))||null;
 const merge=(p,pos)=>p?{...p,...(pos?{level:pos.jobLevel,jobTitle:pos.jobTitle,jobFamily:pos.jobFamily,sectionId:pos.sectionId,unitId:pos.unitId,unitName:pos.unitName,managerId:pos.managerId,isKpiEligible:pos.isKpiEligible,hasProjects:pos.hasProjects,baseSalary:pos.baseSalary}:{} )}:null;
 const user=id=>{const row=store.get(id,'workflow-user'),exit=settlementFor(store,id),pos=positionAt(id)||(exit?positionAt(id,exit.settlementDate):null);return ['personnel','manager','hr'].includes(row?.role)?settlementState(store,merge(row,pos),today()):null;};
 const assessmentPosition=(id,q)=>{const b=quarterBounds(q);return store.list('position-assignment',id).filter(p=>p.status==='published'&&p.effectiveFrom<b.end&&(!p.effectiveTo||p.effectiveTo>b.start)&&(q!==currentPeriod()||p.effectiveFrom<=today())).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0]||null;};
 const userAt=(id,q)=>{const pos=assessmentPosition(id,q),b=quarterBounds(q),end=new Date(Date.parse(b.end+'T00:00:00Z')-86400000).toISOString().slice(0,10);return settlementState(store,merge(store.get(id,'workflow-user'),pos),end<today()?end:today());};
 const manages=(actor,p)=>actor?.role==='manager'&&p?.role==='personnel'&&actor.unitId===p.unitId;
 const canRead=(actor,id)=>actor?.role==='hr'||actor?.id===id||manages(actor,user(id));
 const closed=id=>store.list('position-closeout').find(p=>p.positionId===id&&p.status==='locked');
 function requireEmployee(actor,id,write=false){const p=user(id);if(p?.role!=='personnel'||(write?!manages(actor,p):!canRead(actor,id)))fail('دسترسی به پرسنل مجاز نیست.',403);return p;}
 function activityScore(a){const amended=approvedActivityScore(store,a);if(amended)return amended.score;const human=activityHumanFinal(store,a);if(human)return human.result.finalScore;const r=store.list('review',a.id).find(r=>r.status==='done');return r?.result?.finalForActivity&&Number.isFinite(r.result.qualityScore)&&reviewEvidenceMatches(store,a,r)?r.result.finalScore??r.result.qualityScore:null;}
 function snapshotCore(id,q,positionId=null,interval=null){
  requireQuarter(q);const p=userAt(id,q);if(p?.role!=='personnel')fail('پرسنل معتبر نیست.');
  const b=quarterBounds(q),pos=positionId?store.get(positionId,'position-assignment'):assessmentPosition(id,q);
  if(positionId&&pos?.employeeId!==id)fail('سمت متعلق به این فرد نیست.',403);
  const start=interval?.start||(pos?.effectiveFrom>b.start?pos.effectiveFrom:b.start),end=interval?.end||(pos?.effectiveTo&&pos.effectiveTo<b.end?pos.effectiveTo:b.end);
  const assignments=store.list('activity').filter(a=>a.ownerId===id&&a.period===q&&a.positionId===pos?.id&&!a.removedAt&&a.assignmentStatus==='approved').map(a=>({...a,score:activityScore(a)}));
  for(const kind of ['routine','project']){const list=assignments.filter(a=>a.kind===kind);if(list.length&&list.every(a=>Number.isInteger(a.weightPoints)&&a.weightPoints>=1&&a.weightPoints<=5)){const total=list.reduce((n,a)=>n+a.weightPoints,0);for(const a of list)a.kpiWeight=100*a.weightPoints/total;}}
  const grouped=kind=>{const list=assignments.filter(a=>a.kind===kind);return !list.length||list.some(a=>a.score===null)?null:list.reduce((n,a)=>n+a.score*(a.kpiWeight||1),0)/list.reduce((n,a)=>n+(a.kpiWeight||1),0);};
  const exam=store.list('exam-result',id).find(r=>r.period===q),survey=store.list('manager-survey',id).find(r=>r.period===q&&r.positionId===pos?.id),peer=store.list('service-survey-aggregate',id).find(r=>r.period===q&&r.positionId===pos?.id&&(!r.campaignId||!store.get(r.campaignId,'service-survey-campaign')?.removedAt));
  const policy=policyForPeriod(store,q,null,pos?.unitId||p.unitId),hasProjects=pos?.hasProjects===true||assignments.some(a=>a.kind==='project'),salary=pos?(pos.baseSalary??p.baseSalary):0,eligible=!!pos&&pos.isKpiEligible!==false;
  const moneyMissing=eligible&&(!Number.isSafeInteger(salary)||salary<0);
  const scores={exam:exam?.score??null,manager:survey?.score??null,peer:peer?.score??null,routine:grouped('routine'),project:grouped('project')};
  const calculation=calculateQuarterSlice({quarter:q,start,end,monthlySalary:Number.isSafeInteger(salary)&&salary>=0?salary:0,policy,scores,hasProjects,eligible});
  const otherOpen=store.list('position-assignment',id).some(p=>p.status==='published'&&p.id!==pos?.id&&p.effectiveFrom<b.end&&(!p.effectiveTo||p.effectiveTo>b.start)&&!closed(p.id));
  return {...calculation,...(moneyMissing?{complete:false,ceiling:null,earned:null,baseSalary:null,knownTotal:null,finalSalary:null,maxFinalSalary:null}:{}),moneyMissing,employee:publicUser(merge(p,pos)),period:q,policy,hasProjects,exam:exam||null,survey:survey||null,assignments,positionId:pos?.id||null,positionVersion:pos?.version||null,positionReviewRequired:otherOpen,projectExemptionRequired:false,source:'quarterly-project'};
 }
 function liveSnapshotForSystem(id,q){
  const current=assessmentPosition(id,q),frozen=store.list('position-closeout',id).filter(r=>r.status==='locked').flatMap(r=>r.months.filter(s=>s.period===q).map(s=>({...s,closed:true,closeoutId:r.id})));
  if(!frozen.length)return snapshotCore(id,q);
  const parts=[...frozen];if(current&&!closed(current.id))parts.push(snapshotCore(id,q,current.id));parts.sort((a,b)=>a.start.localeCompare(b.start));
  const gaps=parts.some((p,i)=>i>0&&p.start<parts[i-1].end),complete=parts.every(p=>p.complete)&&!gaps,ceiling=parts.reduce((n,p)=>n+(p.ceiling||0),0),earned=parts.reduce((n,p)=>n+(p.earned||0),0),baseSalary=parts.reduce((n,p)=>n+(p.baseSalary||0),0);
  const components=['exam','manager','routine','project','peer'].map(id=>{const rows=parts.map(p=>p.components.find(c=>c.id===id)).filter(Boolean),cap=rows.reduce((n,c)=>n+c.ceiling,0),pending=rows.some(c=>c.applicable&&c.score===null);return {...rows[0],id,ceiling:cap,weight:ceiling?cap/ceiling*100:0,score:pending||!cap?null:rows.reduce((n,c)=>n+(c.score||0)*c.ceiling,0)/cap,earned:pending?null:rows.reduce((n,c)=>n+(c.earned||0),0),applicable:rows.some(c=>c.applicable),status:pending?'pending':'scored'};});
  return {...parts.at(-1),segments:parts,components,assignments:parts.flatMap(p=>p.assignments.map(a=>({...a,positionClosed:!!p.closed}))),baseSalary,ceiling,earned,knownTotal:baseSalary+earned,finalSalary:complete?baseSalary+earned:null,maxFinalSalary:baseSalary+ceiling,complete,performance:complete&&ceiling?parts.reduce((n,p)=>n+(p.performance||0)*p.ceiling,0)/ceiling:null,positionReviewRequired:gaps||parts.some(p=>p.positionReviewRequired),formulaVersion:'quarterly-position-closeout-v1'};
 }
 function snapshotForSystem(id,q){const final=finalQuarterSnapshot(store,id,q);return final?frozenWorkflowSnapshot(final.snapshot.sourceSnapshot||liveSnapshotForSystem(id,q),final):liveSnapshotForSystem(id,q);}
 const managerSafe=data=>({...data,baseSalary:undefined,monthlySalary:undefined,earned:undefined,ceiling:undefined,knownTotal:undefined,finalSalary:undefined,maxFinalSalary:undefined,segments:data.segments?.map(managerSafe),components:data.components.map(({earned,ceiling,...c})=>c)});
 const snapshot=(actor,id,q=currentPeriod())=>{requireEmployee(actor,id);const r=snapshotForSystem(id,q);return actor.role==='manager'?managerSafe(r):r;};
 function saveSurvey(actor,input){const p=requireEmployee(actor,input.employeeId,true),q=requireQuarter(input.period),pos=assessmentPosition(p.id,q);if(p.isSettled||!pos||pos.isKpiEligible===false)fail('این فرد در این فصل مشمول ارزیابی نیست.',409);if(pos.managerId!==actor.id)fail('فقط مدیر همان سمت مجاز است.',403);assertQuarterWritable(store,p.id,q);if(closed(pos.id))fail('بازهٔ سمت بسته شده است.',409);if(!policyForPeriod(store,q,null,pos.unitId).weights.manager)fail('نظر مدیر سهمی ندارد.');const previous=store.list('manager-survey',p.id).find(r=>r.period===q&&r.positionId===pos.id);return store.put('manager-survey',{id:previous?.id,employeeId:p.id,managerId:actor.id,positionId:pos.id,period:q,score:scoreOf(input.score),note:input.note?text(input.note,2000):'',createdAt:new Date().toISOString()},p.id);}
 function recordExamResult({employeeId,period,score,reference,source='import'}){requireQuarter(period);if(user(employeeId)?.role!=='personnel')fail('پرسنل معتبر نیست.');scoreOf(score);text(reference,200);const old=store.list('exam-result',employeeId).find(r=>r.period===period);if(old&&old.score===score&&old.reference===reference)return old;assertQuarterWritable(store,employeeId,period);if(old)fail('برای این فصل نتیجهٔ آزمون ثبت شده است.',409);if(user(employeeId)?.isSettled)fail('فرد تسویه شده است.',409);return store.put('exam-result',{employeeId,period,score,reference,source,createdAt:new Date().toISOString()},employeeId);}
 function submitProposal(actor,input){const p=requireEmployee(actor,input.employeeId,true),period=requireQuarter(input.period);assertQuarterWritable(store,p.id,period);if(!['task','indicator'].includes(input.type)||!['routine','project'].includes(input.category))fail('نوع پیشنهاد معتبر نیست.');const title=text(input.title,200),description=text(input.description,4000),criteria=text(input.criteria,4000);validateActivity({kind:input.category,title,description,period,criteria:criteria.split('\n')});return store.put('kpi-proposal',{employeeId:p.id,managerId:actor.id,unitId:p.unitId,period,type:input.type,category:input.category,title,description,criteria,status:'pending',createdAt:new Date().toISOString(),events:[]},p.id);}
 return {user,userAt,positionAt,assessmentPosition,publicUser,canRead,manages,get currentPeriod(){return currentPeriod();},get defaultUserId(){return store.list('workflow-user').find(p=>p.role==='hr')?.id;},accounts:()=>store.list('workflow-user').map(p=>publicUser(user(p.id))).filter(Boolean),snapshot,snapshotForSystem,snapshotForPosition:(id,q,positionId,interval)=>snapshotCore(id,q,positionId,interval),saveSurvey,recordExamResult,submitProposal,resolveProposal:()=>fail('پیشنهاد را از گردش تعریف شاخص منتشر کنید.',409),team:(actor,q=currentPeriod())=>{if(actor.role!=='manager')fail('دسترسی مدیر لازم است.',403);return store.list('workflow-user').map(p=>user(p.id)).filter(p=>manages(actor,p)&&userAt(p.id,q)?.isKpiEligible!==false).map(p=>snapshot(actor,p.id,q));},proposals:actor=>{if(actor.role!=='manager')fail('دسترسی مدیر لازم است.',403);return store.list('kpi-proposal').filter(r=>r.managerId===actor.id);}};
}

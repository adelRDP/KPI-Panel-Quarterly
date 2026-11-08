import {createHash} from 'node:crypto';
import Model from '../src/performance-model.js';
import {finalQuarterSnapshot} from './quarter-final-snapshot.mjs';
export const QUARTER_AMENDMENT_VERSION='quarter-score-amendment-v1';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status,publicMessage:message});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createQuarterAmendments(store,workflow){
 function context(actor,appeal){
  const person=workflow.user(appeal.employeeId);if(actor.role!=='hr'&&actor.id!==appeal.employeeId&&!(actor.role==='manager'&&person?.managerId===actor.id&&person.unitId===actor.unitId))fail('دسترسی به اصلاح نتیجه مجاز نیست.',403);
  const final=finalQuarterSnapshot(store,appeal.employeeId,appeal.quarter);if(!final||final.evaluationId!==appeal.evaluationId)fail('نتیجهٔ نهایی معتبر پیدا نشد.');
  const source=final.snapshot.sourceSnapshot;if(!source)fail('نسخهٔ قدیمی فاقد ورودی کاملِ محفوظ برای اصلاح خودکار است؛ مبلغ حدس زده نمی‌شود.');
  const parts=source.segments||[source],version=final.amendmentId||final.evaluationId;
  return {final,source,parts,version};
 }
 function fields(actor,appeal){const c=context(actor,appeal);return {baseVersion:c.version,fields:c.parts.flatMap((p,index)=>p.components.filter(x=>x.applicable&&x.weight>0&&!(x.id==='project'&&!p.hasProjects)).map(x=>({positionId:p.positionId||'segment-'+index,componentId:x.id,label:x.name,start:p.start,end:p.end,score:x.score,weight:x.weight})))};}
 function plan(actor,appeal,input){
  const c=context(actor,appeal);if(input.baseVersion!==c.version)fail('نسخهٔ نتیجه تغییر کرده است؛ دوباره بازبینی کنید.');
  if(!Array.isArray(input.changes)||!input.changes.length||input.changes.length>100)fail('حداقل یک نمرهٔ اصلاحی مشخص کنید.');
  const available=fields(actor,appeal).fields,seen=new Set(),changes=input.changes.map(change=>{
   const field=available.find(f=>f.positionId===change.positionId&&f.componentId===change.componentId),key=change.positionId+':'+change.componentId;
   if(!field||seen.has(key)||!Number.isFinite(change.score)||change.score<0||change.score>100||change.score===field.score)fail('نمره یا مؤلفهٔ اصلاحی معتبر نیست.');seen.add(key);return {positionId:field.positionId,componentId:field.componentId,before:field.score,score:change.score};
  });
  const parts=c.parts.map((p,index)=>{const scores=Object.fromEntries(p.components.map(x=>[x.id,x.score]));for(const change of changes.filter(x=>x.positionId===(p.positionId||'segment-'+index)))scores[change.componentId]=change.score;return {...p,...Model.calculate({baseSalary:p.baseSalary,bonusCeiling:p.ceiling,policy:p.policy,scores,hasProjects:p.hasProjects})};});
  if(parts.some(p=>!p.complete))fail('ورودی محفوظ برای نتیجهٔ اصلاحی کامل نیست.');
  const baseSalary=parts.reduce((n,p)=>n+p.baseSalary,0),ceiling=parts.reduce((n,p)=>n+p.ceiling,0),earned=parts.reduce((n,p)=>n+p.earned,0),performance=ceiling?parts.reduce((n,p)=>n+(p.performance||0)*p.ceiling,0)/ceiling:null;
  const components=['exam','manager','routine','project','peer'].map(id=>{const rows=parts.map(p=>p.components.find(x=>x.id===id)).filter(Boolean),cap=rows.reduce((n,x)=>n+x.ceiling,0);return {...rows[0],id,ceiling:cap,earned:rows.reduce((n,x)=>n+(x.earned||0),0),weight:ceiling?cap/ceiling*100:0,score:cap?rows.reduce((n,x)=>n+(x.score||0)*x.ceiling,0)/cap:null,applicable:rows.some(x=>x.applicable),status:'scored'};});
  const source={...c.source,...(c.source.segments?{segments:parts}:parts[0]),components,baseSalary,ceiling,earned,performance,knownTotal:baseSalary+earned,finalSalary:baseSalary+earned,maxFinalSalary:baseSalary+ceiling,complete:true};
  for(const [key,id] of [['exam','exam'],['survey','manager']]){const component=components.find(x=>x.id===id);if(source[key]&&component?.score!=null)source[key]={...source[key],originalScore:source[key].originalScore??source[key].score,score:component.score,correctedInQuarter:true};}
  const snapshot={...c.final.snapshot,exam:source.exam,sourceSnapshot:source,monthRows:parts.map(p=>({period:appeal.quarter,positionId:p.positionId,positionVersion:p.positionVersion,components:p.components})),calculation:{...c.final.snapshot.calculation,components,baseSalary,ceiling,earned,performance,complete:true},quarterPay:{...c.final.snapshot.quarterPay,earned,knownEarned:earned,breakdown:parts.map(p=>({positionId:p.positionId,start:p.start,end:p.end,days:p.days,closed:!!p.closed,score:p.performance,ceiling:p.ceiling,earned:p.earned}))}};
  snapshot.fingerprint=hash({source,calculation:snapshot.calculation,quarterPay:snapshot.quarterPay});
  const proof={baseVersion:c.version,changes,snapshot,deltaEarned:earned-c.final.snapshot.quarterPay.earned};return {...proof,hash:hash(proof)};
 }
 function propose(actor,appeal,input){if(actor.role!=='manager')fail('پیشنهاد نمرهٔ اصلاحی فقط برای مدیر مجاز است.',403);const p=plan(actor,appeal,input),row=store.put('quarter-amendment-proposal',{id:'amend-proposal-'+appeal.id,appealId:appeal.id,employeeId:appeal.employeeId,quarter:appeal.quarter,managerId:actor.id,...p,createdAt:new Date().toISOString()},appeal.id);return {id:row.id,hash:row.hash,baseVersion:row.baseVersion,changes:row.changes};}
 function preview(actor,appeal){const p=store.get('amend-proposal-'+appeal.id,'quarter-amendment-proposal');if(!p)fail('پیشنهاد نمرهٔ مدیر ثبت نشده است.');const fresh=plan(actor,appeal,p);if(fresh.hash!==p.hash)fail('پیشنهاد اصلاحی قدیمی شده است.');return actor.role==='hr'?{hash:p.hash,baseVersion:p.baseVersion,changes:p.changes,beforeEarned:p.snapshot.quarterPay.earned-p.deltaEarned,afterEarned:p.snapshot.quarterPay.earned,deltaEarned:p.deltaEarned}: {hash:p.hash,baseVersion:p.baseVersion,changes:p.changes};}
 function approve(actor,appeal,input){if(actor.role!=='hr')fail('تصویب اصلاح نتیجه فقط برای ادمین مجاز است.',403);const p=store.get('amend-proposal-'+appeal.id,'quarter-amendment-proposal'),proof=preview(actor,appeal);if(input.correctionHash!==proof.hash)fail('پیش‌نمایش اصلاح مبلغ و نمره را بازبینی و تأیید کنید.');
  const final=context(actor,appeal).final,sequence=(final.amendmentSequence||0)+1,row=store.put('quarter-result-amendment',{id:'quarter-amendment-'+appeal.id,version:QUARTER_AMENDMENT_VERSION,status:'approved',employeeId:appeal.employeeId,quarter:appeal.quarter,evaluationId:appeal.evaluationId,previousVersion:proof.baseVersion,sequence,appealId:appeal.id,managerId:p.managerId,approvedBy:actor.id,approvedAt:new Date().toISOString(),reason:appeal.reason,changes:p.changes,deltaEarned:p.deltaEarned,lockedSnapshot:p.snapshot},appeal.employeeId);return {id:row.id,sequence,deltaEarned:row.deltaEarned};
 }
 return {fields,propose,preview,approve};
}

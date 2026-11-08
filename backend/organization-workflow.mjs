import {createApprovalSla} from './approval-sla.mjs';
import {createPeerSurveyImport} from './peer-survey-import.mjs';
import {finalQuarterSnapshot} from './quarter-final-snapshot.mjs';
import {createQuarterAmendments} from './quarter-amendments.mjs';
import {quarterlyEvidenceWindow} from './quarterly-evidence-window.mjs';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { providerConfig } from './providers.mjs';
import { validateActivity } from './evaluation.mjs';
import PerformanceModel from '../src/performance-model.js';
import { quarterMonths, periodBounds } from './quarterly-workflow.mjs';
import {periodAtDate as quarterAtDate} from './quarter-period.mjs';
import {quarterlyResult,quarterlyProgress} from './quarterly-results.mjs';
import {policyForPeriod,surveyDefaultsForPeriod} from './evaluation-settings.mjs';
import {scoreRulesAt,ruleDaysBetween,addRuleDays} from './score-rules.mjs';
import { zipSync, strToU8 } from 'fflate';
import {createJobDesignAnalysis,positionSnapshot,canonical,analysisBasis,safeTasks,alignmentContractVersion,checkTypes} from './job-design-analysis.mjs';
import {applyStoredChanges,normalizedCriteria,stabilityHash,maxCorrectionRounds} from './alignment-stability.mjs';
import {MONTH_COPY_VERSION,copyHash,nextDesignMonth,copyPolicySnapshot,copyMaterialFingerprint,copySourceFingerprint,copyTasksToNextMonth} from './design-month-copy.mjs';
import {settlementFor} from './personnel-settlement.mjs';
import {settlementPlan,SETTLEMENT_VERSION} from './quarterly-settlement.mjs';
import {currentHumanReviewDesign} from './human-review-policy.mjs';
import {effectiveChanges} from './analysis-consistency.mjs';
import {quarterLocked,assertQuarterWritable} from './quarter-lock.mjs';
import {clarificationTasks,clarificationContextHash,normalizeClarifications} from './design-clarifications.mjs';
import {createPositionCloseout,positionClosed,calculatePositionSlice,CLOSEOUT_VERSION,quarterFor} from './position-closeout.mjs';

const fail=(message,status=400)=>{const error=new Error(message);error.publicMessage=message;error.status=status;throw error;};
const text=(value,max,required=true)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('متن ورودی معتبر نیست.');return value.trim();};
const date=(value,optional=false)=>{if(optional&&value==null)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(Date.parse(value+'T00:00:00Z')).toISOString().slice(0,10)!==value)fail('تاریخ باید به شکل میلادی YYYY-MM-DD باشد.');return value;};
const tehranDate=value=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}-${parts.find(p=>p.type==='day').value}`;};
const today=()=>tehranDate(new Date());
const periodAtDate=quarterAtDate;
const nextDate=value=>new Date(Date.parse(value+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const addCalendarDays=(value,days)=>new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const serviceSurveyDeadline=period=>addCalendarDays(periodBounds(period).end,4);
const campaignDeadline=c=>c.scoreRulesSnapshot?c.dueAt:serviceSurveyDeadline(c.period);
const requiredResponses=c=>Math.max(c.status==='completed'&&!c.privacyVersion?0:3,Math.ceil(c.population*c.minParticipation),Number(c.scoreRulesSnapshot?.values.surveyResponses||0));
const score=value=>{if(!Number.isFinite(value)||value<0||value>100)fail('امتیاز باید بین صفر تا صد باشد.');return value;};
const businessDaysBetween=(from,to)=>{let count=0;for(let stamp=Date.parse(from+'T00:00:00Z')+86400000;stamp<=Date.parse(to+'T00:00:00Z');stamp+=86400000)if(new Date(stamp).getUTCDay()!==5)count++;return count;};
const addBusinessDays=(from,days)=>{let stamp=Date.parse(from+'T00:00:00Z'),count=0;while(count<days){stamp+=86400000;if(new Date(stamp).getUTCDay()!==5)count++;}return new Date(stamp).toISOString().slice(0,10);};
const quarterId=value=>{if(typeof value!=='string'||!/^14\d{2}-Q[1-4]$/.test(value))fail('فصل باید به شکل 1405-Q3 باشد.');return value;};
const personnelCode=value=>typeof value==='string'?value.trim().replace(/[۰-۹]/g,digit=>String(digit.charCodeAt(0)-1776)).replace(/[٠-٩]/g,digit=>String(digit.charCodeAt(0)-1632)):'';
const hash=value=>createHash('sha256').update(value).digest('hex');

import {normalizeTaskWeights,validateTaskRecurrence,taskDocumentFormats} from './task-definition.mjs';

export function createOrganizationWorkflow(store,workflow,{runModel,notifications,busy=new Set()}={}){
  if(alignmentContractVersion!=='kpi-alignment-v4')fail('مسیر تحلیل باید قرارداد v4 داشته باشد؛ راه‌اندازی متوقف شد.',503);
  const user=id=>typeof id==='string'&&id?workflow.user(id):null;
  const role=(actor,allowed)=>{if(!allowed.includes(actor?.role))fail('برای این عملیات مجوز ندارید.',403);};
  const privacyConfig=store.get('survey-hmac-key','privacy-config')||store.put('privacy-config',{id:'survey-hmac-key',value:randomBytes(32).toString('hex')},'privacy-config');
  const respondentToken=(scope,id)=>createHmac('sha256',privacyConfig.value).update(`${scope}:${id}`).digest('hex');
  const employee=id=>{const value=user(id);if(!value||value.role!=='personnel')fail('پرسنل معتبر نیست.');return value;};
  const managerOf=(actor,id)=>{const person=employee(id);if(!workflow.manages(actor,person))fail('فرد در محدوده مدیریت شما نیست.',403);return person;};
  const approvalSla=createApprovalSla(store,workflow,notifications);
  const audit=(actor,action,entityType,entityId,details={})=>{approvalSla.observe(entityType,entityId);const event=store.put('audit-event',{actorId:actor?.id||'system',action,entityType,entityId,details,createdAt:new Date().toISOString()});notifications?.fromAudit(event,{record:store.get(entityId,entityType),serviceRespondents});return event;};
  const positionAt=(id,at=today())=>store.list('position-assignment',id).find(p=>p.status==='published'&&p.effectiveFrom<=at&&(!p.effectiveTo||at<p.effectiveTo))||null;
  const designPosition=design=>design.positionId?store.get(design.positionId,'position-assignment'):workflow.assessmentPosition(design.employeeId,design.period);
  const closeouts=createPositionCloseout(store,workflow,{periodBounds,today,audit,busy});
  function positionCloseoutPreview(actor,id){role(actor,['hr']);const row=store.get(id,'position-assignment');if(!row)fail('درخواست پیدا نشد.',404);return closeouts.preview(row);}
  function closeoutHistory(actor,id){if(!['hr','personnel'].includes(actor.role)||actor.role!=='hr'&&actor.id!==id)fail('دسترسی به مبالغ این فرد مجاز نیست.',403);return store.list('position-closeout',id);}
  const modelFor=(person,period)=>policyForPeriod(store,period,null,person.unitId);
  // New UI forms omit the individual project flag; legacy imports retain their explicit factual flag.
  const projectsForPosition=(input,unitId,effectiveFrom,isManager=false)=>!isManager&&(input.hasProjects===undefined?policyForPeriod(store,periodAtDate(effectiveFrom),null,unitId).weights.project>0:!!input.hasProjects);
  const periodPeople=period=>store.list('workflow-user').map(row=>workflow.userAt(row.id,period)).filter(Boolean);
  const serviceRespondents=(period,targetUnitId)=>periodPeople(period).filter(person=>['personnel','manager'].includes(person.role)&&!person.isSettled&&!user(person.id)?.isSettled&&workflow.assessmentPosition(person.id,period)&&person.unitId!==targetUnitId);
  const canRespond=(actor,campaign)=>['personnel','manager'].includes(actor.role)&&!user(campaign.employeeId)?.isSettled&&!workflow.userAt(campaign.employeeId,campaign.period)?.isSettled&&actor.id!==campaign.employeeId&&serviceRespondents(campaign.period,campaign.unitId).some(person=>person.id===actor.id);
  function evaluationModels(actor,period=workflow.currentPeriod){
    role(actor,['hr','manager','personnel']);if(!/^14\d{2}-Q[1-4]$/.test(period||''))fail('فصل ارزیابی معتبر نیست.');periodBounds(period);
const people=periodPeople(period).filter(person=>person.role==='personnel'&&person.isKpiEligible!==false&&(actor.role==='hr'||actor.id===person.id||workflow.manages(actor,person)));
return {period,people:people.map(person=>{const p=workflow.assessmentPosition(person.id,period),b=periodBounds(period),start=p?.effectiveFrom>b.start?p.effectiveFrom:b.start,end=p?.effectiveTo&&p.effectiveTo<b.end?p.effectiveTo:b.end;return {...workflow.publicUser(person),positionId:p?.id||null,assessmentStart:start,evidenceStart:quarterlyEvidenceWindow(store,p,period).start,assessmentLastDay:new Date(Date.parse(end+'T00:00:00Z')-86400000).toISOString().slice(0,10),partialPeriod:start!==b.start||end!==b.end,hasProjects:person.hasProjects===true,policy:modelFor(person,period)};}),...(actor.role==='hr'?{byUnit:Object.fromEntries(store.list('org-unit').filter(unit=>!unit.removedAt).map(unit=>[unit.id,policyForPeriod(store,period,null,unit.id)])),global:policyForPeriod(store,period,null,null)}:{})};
  }
  const activePosition=id=>positionAt(id);
  const amendments=createQuarterAmendments(store,workflow);
  const jobDesignAnalysis=createJobDesignAnalysis(store,{runModel});
  const isRoleAlignment=design=>['kpi-alignment-v2','kpi-alignment-v3',alignmentContractVersion].includes(design.aiReview?.contractVersion);
  const alignmentCurrent=design=>isRoleAlignment(design)&&design.aiReview.contractVersion===alignmentContractVersion&&jobDesignAnalysis.isCurrentRun(store.get(design.aiReview.runId,'ai-role-run'))&&(!design.aiReview.inheritedFrom||monthCopyProofCurrent(design))&&currentDutiesBasis(design);
  const clarificationContext=design=>{const p=designPosition(design);return clarificationContextHash(design,p,p?policyForPeriod(store,design.period,null,p.unitId):null);};
  const clarificationDraft=design=>store.list('kpi-design',design.employeeId).find(d=>!d.removedAt&&d.status==='draft'&&d.revises===design.id)||null;
  const finalReviewReason='پنج بررسی این طرح پایان یافته است؛ ساخت یا ارسال پیش‌نویس اصلاحی قفل است. بازبینی نهایی مدیر و ارسال به ادمین یا حذف با حفظ سابقه امکان‌پذیر است.';
  const effectiveDesign=design=>currentHumanReviewDesign(jobDesignAnalysis.projectConsistency(design));
  function finalReviewLock(employeeId,period,managerId){
    // A new draft or failed attempt cannot reset a finished correction cycle.
    // Completed historical versions and previously reviewed successors remain intact.
    const latest=store.list('kpi-design',employeeId).filter(d=>!d.removedAt&&d.period===period&&d.managerId===managerId&&(!d.positionId||d.positionId===workflow.assessmentPosition(employeeId,period)?.id)&&(d.aiReview?.result||['published','rejected'].includes(d.status))).sort((a,b)=>(Number(b.version)||0)-(Number(a.version)||0)||(b.createdAt||'').localeCompare(a.createdAt||''))[0];
    const result=effectiveDesign(latest)?.aiReview?.result;
    return latest&&['manager_review','needs_revision','hr_review'].includes(latest.status)&&Number(result?.correctionRound)>=maxCorrectionRounds&&(result?.blockers?.length||result?.correctionQualityFailed)?latest:null;
  }
  function assertCorrectionOpen(design){assertQuarterWritable(store,design.employeeId,design.period);if(positionClosed(store,design.positionId))fail('این بازهٔ سمت نهایی و بسته شده است.',409);if(finalReviewLock(design.employeeId,design.period,design.managerId))fail(finalReviewReason,409);}
  function currentDutiesBasis(design){
    if(design.status==='published')return true; // Published results remain historical evidence, not editable approvals.
    const position=designPosition(design);
    return !!position&&design.aiReview.basisHash===analysisBasis(position,design,policyForPeriod(store,design.period,null,position.unitId));
  }
  function monthCopyProofCurrent(design,seen=new Set()){
    try{
      if(seen.has(design.id))return false;seen.add(design.id);
      const proof=design.monthCopy,ref=design.aiReview.inheritedFrom,source=proof&&store.get(proof.sourceDesignId,'kpi-design');
      if(!source||source.removedAt||proof.version!==MONTH_COPY_VERSION||ref.designId!==source.id||ref.period!==source.period||proof.sourceMaterialFingerprint!==copyMaterialFingerprint(source)||design.period!==nextDesignMonth(source.period)||source.employeeId!==design.employeeId||source.managerId!==design.managerId||!['manager_review','hr_review','published'].includes(source.status))return false;
      if(source.aiReview?.contractVersion!==alignmentContractVersion||!jobDesignAnalysis.isCurrentRun(store.get(source.aiReview.runId,'ai-role-run'))||source.aiReview.result.blockers.length||source.aiReview.result.correctionQualityFailed||source.aiReview.result.humanReviewRequired||source.aiReview.inheritedFrom&&!monthCopyProofCurrent(source,seen))return false;
      const a=positionAt(source.employeeId,periodBounds(source.period).start),b=designPosition(design),p=a&&policyForPeriod(store,source.period,null,a.unitId),q=b&&policyForPeriod(store,design.period,null,b.unitId);
      if(!a||!b||copyHash(positionSnapshot(a))!==copyHash(positionSnapshot(b))||copyHash(copyPolicySnapshot(p))!==copyHash(copyPolicySnapshot(q))||source.aiReview.basisHash!==analysisBasis(a,source,p)||design.positionId!==b.id||design.positionVersion!==b.version||design.policyVersion!==q.version||user(design.employeeId)?.managerId!==design.managerId)return false;
      const shifted=copyTasksToNextMonth(source.tasks,source.period,design.period),basisHash=analysisBasis(b,design,q);
      if(copyHash(shifted.tasks)!==copyHash(design.tasks)||copyHash(shifted.dateChanges)!==copyHash(proof.dateChanges)||copyHash(shifted.textChanges)!==copyHash(proof.textChanges||[])||proof.targetBasisHash!==basisHash)return false;
      const expected={...source.aiReview,basisHash,inheritedFrom:{version:MONTH_COPY_VERSION,designId:source.id,period:source.period,runId:source.aiReview.runId,sourceReviewHash:copyHash(source.aiReview),modelCalls:0}};
      return copyHash(expected)===copyHash(design.aiReview);
    }catch{return false;}
  }
  function planMonthCopy(actor,source){
    fail('کپی ماهانه در این پروژه فعال نیست؛ برای فصل جدید پیش‌نویس مستقل تعریف کنید.',409);
    role(actor,['manager']);
    if(!source||source.removedAt||!workflow.manages(actor,user(source.employeeId))||source.managerId!==actor.id||user(source.employeeId)?.managerId!==actor.id)fail('نسخهٔ مبدأ در محدودهٔ مدیریت شما نیست.',403);
    if(source.tasks.some(t=>t.clarifications?.length))fail('پاسخ‌های ابهام به همین ماه متصل‌اند؛ برای ماه بعد پیش‌نویس و بازبینی تازه لازم است.',409);
    if(!['manager_review','hr_review','published'].includes(source.status)||!alignmentCurrent(source)||source.aiReview.result.blockers.length||source.aiReview.result.correctionQualityFailed||source.aiReview.result.humanReviewRequired)fail('کپی فقط پس از تأیید تحلیل جاریِ هفت‌محوری و بدون مانع مجاز است.',409);
    if(['hr_review','published'].includes(source.status)&&source.managerReview?.decision!=='approve'||source.status==='published'&&source.hrReview?.decision!=='approve')fail('وضعیت تأیید نسخهٔ مبدأ کامل نیست.',409);
    const targetPeriod=nextDesignMonth(source.period),bounds=periodBounds(targetPeriod),position=positionAt(source.employeeId,periodBounds(source.period).start),targetPosition=positionAt(source.employeeId,bounds.start);
    if(targetPeriod<workflow.currentPeriod)fail('کپی با تأییدهای به‌ارث‌رسیده به ماه‌های گذشته مجاز نیست.',409);
    if(!position||!targetPosition||position.id!==source.positionId||position.version!==source.positionVersion||copyHash(positionSnapshot(position))!==copyHash(positionSnapshot(targetPosition))||targetPosition.managerId!==actor.id||targetPosition.unitId!==actor.unitId)fail('شرح وظایف، نسخهٔ سمت یا مدیر ماه بعد تغییر کرده؛ کپی بدون تحلیل تازه مجاز نیست.',409);
    const overlapping=store.list('position-assignment',source.employeeId).filter(p=>p.status==='published'&&p.effectiveFrom<bounds.end&&(!p.effectiveTo||p.effectiveTo>bounds.start));if(overlapping.length!==1||targetPosition.effectiveTo&&targetPosition.effectiveTo<bounds.end)fail('انتقال میان‌ماه اجازهٔ کپی خودکار را نمی‌دهد.',409);
    const policy=policyForPeriod(store,source.period,null,position.unitId),targetPolicy=policyForPeriod(store,targetPeriod,null,targetPosition.unitId);
    if(source.aiReview.basisHash!==analysisBasis(position,source,policy)||copyHash(copyPolicySnapshot(policy))!==copyHash(copyPolicySnapshot(targetPolicy)))fail('سیاست مؤثر یا مبنای تحلیل تغییر کرده؛ بررسی تازه لازم است.',409);
    if(store.list('quarter-evaluation',source.employeeId).some(q=>q.status==='locked'&&q.quarter===`${targetPeriod.slice(0,4)}-Q${Math.ceil(Number(targetPeriod.slice(5))/3)}`))fail('فصل مقصد قفل شده است؛ کپی انجام نمی‌شود.',409);
    const shifted=copyTasksToNextMonth(source.tasks,source.period,targetPeriod),validated=validateDesign({employeeId:source.employeeId,period:targetPeriod,tasks:shifted.tasks},actor);
    if(copyHash(shifted.tasks)!==copyHash(validated.tasks))fail('تعریف شاخص نیازمند اصلاح ساختاری است؛ کپی بدون بازبینی مجاز نیست.',409);
    const fingerprint=copySourceFingerprint(source),existing=store.list('kpi-design',source.employeeId).find(d=>!d.removedAt&&d.period===targetPeriod&&d.monthCopy?.sourceDesignId===source.id&&d.monthCopy.sourceFingerprint===fingerprint);
    if(existing&&!monthCopyProofCurrent(existing))fail('نسخهٔ کپی‌شده قبلی تغییر کرده است؛ کپی دوباره آن را بازنویسی نمی‌کند.',409);
    if(!existing&&store.list('kpi-design',source.employeeId).some(d=>!d.removedAt&&d.period===targetPeriod)||!existing&&store.list('activity').some(a=>a.ownerId===source.employeeId&&!a.removedAt&&a.period===targetPeriod&&a.assignmentStatus==='approved'&&a.source!=='synthetic'))fail('برای این فرد در ماه بعد نسخه یا شاخص فعال وجود دارد؛ از ایجاد تخصیص تکراری جلوگیری شد.',409);
    return {...validated,targetPeriod,targetPolicy,dateChanges:shifted.dateChanges,textChanges:shifted.textChanges,sourceFingerprint:fingerprint,existing};
  }
  function monthCopyAvailability(actor,source){
    try{const p=planMonthCopy(actor,store.get(source.id,'kpi-design')||source);return {allowed:true,targetPeriod:p.targetPeriod,sourceFingerprint:p.sourceFingerprint,existingId:p.existing?.id||null,dateChanges:p.dateChanges,textChangeCount:p.textChanges.length};}catch(error){return {allowed:false,reason:error.publicMessage||'کپی خودکار این نسخه ممکن نیست.'};}
  }
  function copyDesignToNextMonth(actor,id,input){
    role(actor,['manager']);if(Object.keys(input||{}).some(k=>k!=='sourceFingerprint')||!/^[a-f0-9]{64}$/.test(input?.sourceFingerprint||''))fail('شناسهٔ نسخهٔ مبدأ برای کپی لازم است.',400);
    return store.transaction(()=>{
      const source=store.get(id,'kpi-design');if(!source||source.removedAt)fail('نسخهٔ مبدأ پیدا نشد.',404);
      if(input.sourceFingerprint!==copySourceFingerprint(source))fail('نسخهٔ مبدأ تغییر کرده؛ فهرست را تازه کنید.',409);
      const p=planMonthCopy(actor,source);if(p.existing)return {...p.existing,copyCached:true};
      const at=new Date().toISOString(),version=Math.max(0,...store.list('kpi-design',source.employeeId).filter(d=>d.period===p.targetPeriod).map(d=>Number(d.version)||0))+1;
      let copied={id:randomUUID(),employeeId:source.employeeId,managerId:actor.id,unitId:p.position.unitId,positionId:p.position.id,positionVersion:p.position.version,period:p.targetPeriod,policyVersion:p.targetPolicy.version,tasks:p.tasks,status:source.status,version,createdBy:actor.id,createdAt:at,events:[{state:source.status,by:actor.id,at,action:'month-copy',sourceDesignId:source.id}],...(source.managerReview?{managerReview:{...source.managerReview,inheritedFromDesignId:source.id}}:{}),...(source.hrReview?{hrReview:{...source.hrReview,inheritedFromDesignId:source.id}}:{})};
      const basisHash=analysisBasis(p.position,copied,p.targetPolicy);
      copied={...copied,aiReview:{...structuredClone(source.aiReview),basisHash,inheritedFrom:{version:MONTH_COPY_VERSION,designId:source.id,period:source.period,runId:source.aiReview.runId,sourceReviewHash:copyHash(source.aiReview),modelCalls:0}},monthCopy:{version:MONTH_COPY_VERSION,sourceDesignId:source.id,sourcePeriod:source.period,sourceVersion:source.version,sourceFingerprint:p.sourceFingerprint,sourceMaterialFingerprint:copyMaterialFingerprint(source),targetBasisHash:basisHash,dateChanges:p.dateChanges,textChanges:p.textChanges,copiedBy:actor.id,copiedAt:at}};
      if(source.status==='published')copied={...copied,activityIds:createDesignActivities(copied,p.position,p.person),publishedAt:at};
      const row=store.put('kpi-design',copied,source.employeeId);audit(actor,'kpi-design.month-copied','kpi-design',row.id,{sourceDesignId:source.id,sourcePeriod:source.period,targetPeriod:p.targetPeriod,sourceStatus:source.status,modelCalls:0,inheritedManagerApproval:source.managerReview?.actorId||null,inheritedHrApproval:source.hrReview?.actorId||null});
      if(row.status==='published')notifications?.publish({eventKey:'design-month-copy:'+row.id,recipientIds:[row.employeeId],kind:'info',title:'شاخص‌های ماه بعد کپی شدند',description:'نسخهٔ تازه از شاخص‌های مصوب با تأییدهای به‌ارث‌رسیده آماده است.',view:'assignments',entityId:row.activityIds[0]});return row;
    });
  }
  const canReanalyze=design=>!!design.aiReview&&!finalReviewLock(design.employeeId,design.period,design.managerId)&&!alignmentCurrent(design)&&['manager_review','hr_review'].includes(design.status);
  function aiCapabilities(actor){role(actor,['manager','hr']);return {jobAnalysis:true,alignment:true,alignmentContractVersion,alignmentChecks:checkTypes,evidenceReviewV3:false};}
  function authorizedPosition(actor,id){
    role(actor,['manager','hr']);
    const position=store.get(id,'position-assignment');if(!position||actor.role==='manager'&&(!workflow.manages(actor,user(position.employeeId))||user(position.employeeId)?.managerId!==actor.id))fail('شرح وظایف پیدا نشد یا در محدوده شما نیست.',404);
    if(position.isManager||user(position.employeeId)?.role==='manager')fail('شرح وظیفه و تحلیل آن برای دسترسی مدیر کاربرد ندارد.',409);
    return position;
  }
  function jobAnalysisState(actor,id){
    const position=authorizedPosition(actor,id),snapshotHash=hash(canonical(positionSnapshot(position)));
    const analysis=store.list('job-analysis',id).find(row=>row.snapshotHash===snapshotHash&&jobDesignAnalysis.isCurrentRun(store.get(row.runId,'ai-role-run')));
    const runs=store.list('ai-role-run',id).filter(row=>row.stage==='job-analysis-v1');
    return {positionId:id,positionVersion:position.version,status:analysis?'succeeded':runs[0]?.status==='succeeded'?'stale':runs[0]?.status||'not_started',analysis:analysis?{id:analysis.id,result:analysis.result,source:analysis.source,createdAt:analysis.createdAt}:null,attempts:runs.map(({id,status,validationStatus,provider,model,startedAt,finishedAt,error})=>({id,status,validationStatus,provider,model,startedAt,finishedAt,error}))};
  }
  async function analyzeJobPosition(actor,id,provider='codex'){
    const position=authorizedPosition(actor,id),snapshot=canonical(positionSnapshot(position));
    await jobDesignAnalysis.analyzePosition(position,actor,provider,()=>{try{const fresh=workflow.user(actor.id);return canonical(positionSnapshot(authorizedPosition(fresh,id)))===snapshot;}catch{return false;}});
    return jobAnalysisState(actor,id);
  }
  function currentAnalysisContext(actor,design,position,policy){
    const fresh=workflow.user(actor.id),current=store.get(design.id,'kpi-design'),active=workflow.assessmentPosition(design.employeeId,design.period);
    if(quarterLocked(store,design.employeeId,design.period)||positionClosed(store,design.positionId)||active?.id!==design.positionId)return false;
    if(user(design.employeeId)?.isSettled||workflow.userAt(design.employeeId,design.period)?.isKpiEligible===false||active?.isKpiEligible===false)return false;
    return !!fresh&&['manager','hr'].includes(fresh.role)&&(fresh.role==='hr'||workflow.manages(fresh,user(design.employeeId))&&user(design.employeeId)?.managerId===fresh.id)&&!!current&&!current.removedAt&&(['ai_pending','ai_failed','manager_review','hr_review'].includes(current.status)||current.status==='needs_revision'&&finalReviewLock(current.employeeId,current.period,current.managerId)?.id===current.id)&&!!active&&analysisBasis(active,current,policyForPeriod(store,current.period,null,active.unitId))===analysisBasis(position,design,policy);
  }
  function assertCurrentAnalysis(actor,design,input={}){
    design=effectiveDesign(design);
    assertDesignNotSettled(design.employeeId,design.period);
    if(designPosition(design)?.isKpiEligible===false)fail('این سمت در ماه شاخص خارج از KPI فردی است.',409);
    if(design.aiReview?.contractVersion!==alignmentContractVersion)fail('این گزارش با روش قدیمی تحلیل شده است؛ پیش از تأیید، تحلیل مجدد با v4 لازم است.',409);
    if(!alignmentCurrent(design))fail('قرارداد یا اجرای تحلیل قدیمی است؛ با محورهای جدید دوباره تحلیل کنید.',409);
    const position=designPosition(design),policy=position&&policyForPeriod(store,design.period,null,position.unitId);
    const run=store.get(design.aiReview.runId,'ai-role-run');if(!jobDesignAnalysis.isCurrentRun(run))fail('اجرای تحلیل جاری معتبر نیست؛ دوباره تحلیل کنید.',409);
    if(!position||design.aiReview.model!==providerConfig(design.aiReview.provider).model||design.aiReview.basisHash!==analysisBasis(position,design,policy)||!currentAnalysisContext(actor,design,position,policy))fail('نسخه یا رابطهٔ سازمانی تغییر کرده؛ طرح باید دوباره تحلیل شود.',409);
    if(design.aiReview.result.blockers.length||design.aiReview.result.correctionQualityFailed){
      if(!design.aiReview.result.humanReviewRequired||input.humanReviewAcknowledgment!==true)fail('شاخص‌ها نیازمند اصلاح یا اطلاعات هستند؛ ابتدا موانع تحلیل را رفع کنید.',409);
      text(input.reason,2000);if(input.reason.trim().length<20)fail('برای بازبینی انسانی، دلیل مستند حداقل ۲۰ کاراکتر لازم است.',409);
      if(actor.role==='hr'&&!design.managerReview?.humanReviewAcknowledgment)fail('بازبینی مستند مدیر پیش از تصمیم HR لازم است.',409);
    }
    const bounds=periodBounds(design.period);if(store.list('position-assignment',design.employeeId).filter(row=>row.status==='published'&&row.effectiveFrom<bounds.end&&(!row.effectiveTo||row.effectiveTo>bounds.start)&&row.id!==position?.id&&!positionClosed(store,row.id)).length)fail('بازهٔ قبلی هنوز نهایی نشده است؛ انتشار متوقف شد.',409);
  }
  function bootstrap(){
    for(const person of store.list('workflow-user'))if(person.unitId&&!store.get(person.unitId,'org-unit'))store.put('org-unit',{id:person.unitId,name:person.unitName,createdBy:'migration',createdAt:new Date().toISOString()},null);
    for(const person of store.list('workflow-user'))if(person.unitId&&!store.get(person.unitId,'org-unit')?.removedAt){const name=person.jobFamily||person.unitName;if(!name)continue;const id=`section-${hash(`${person.unitId}:${name}`).slice(0,12)}`;if(!store.get(id,'org-section'))store.put('org-section',{id,unitId:person.unitId,name,createdBy:'migration',createdAt:new Date().toISOString()},null);}
    for(const person of store.list('workflow-user'))if(['personnel','manager'].includes(person.role)&&!store.list('position-assignment',person.id).length){
      store.put('position-assignment',{employeeId:person.id,jobTitle:person.jobTitle||person.level||person.role,jobFamily:person.jobFamily||person.unitName,jobLevel:person.level||'مدیر',unitId:person.unitId,unitName:person.unitName,managerId:person.managerId||null,duties:person.role==='manager'?'راهبری واحد، تصویب تسک‌های زیرمجموعه و پایش عملکرد تیم':'شرح وظایف نمونه برای تکمیل توسط HR',isManager:person.role==='manager',isKpiEligible:person.role==='personnel'&&person.isKpiEligible!==false,hasProjects:!!person.hasProjects,approvedProjectExemption:person.approvedProjectExemption===true,baseSalary:person.baseSalary??null,effectiveFrom:'2020-01-01',effectiveTo:null,status:'published',version:1,createdAt:new Date().toISOString(),events:[{state:'published',by:'migration',at:new Date().toISOString(),note:'نسخه پایه نمایشی'}]},person.id);
    }
  }
  // Organization is provisioned only through explicit import or registration.
  for(const attempt of store.list('ai-design-attempt').filter(row=>row.status==='running')){
    const finishedAt=new Date().toISOString();store.put('ai-design-attempt',{...attempt,status:'failed',finishedAt,error:'اجرا با توقف سرویس قطع شد.'},attempt.designId);
    const design=store.get(attempt.designId,'kpi-design');if(design?.status==='ai_pending')store.put('kpi-design',{...design,status:'ai_failed',events:[...(design.events||[]),{state:'ai_failed',at:finishedAt,reason:'اجرای AI با توقف سرویس قطع شد.'}]},design.employeeId);
  }

  function listPositions(actor){role(actor,['hr']);return store.list('position-assignment').map(({modelType,...position})=>({...position,policy:policyForPeriod(store,periodAtDate(position.effectiveFrom),null,position.unitId),employeeCode:user(position.employeeId)?.employeeCode||null}));}
  function updatePositionDuties(actor,id,input){
    role(actor,['hr']);
    if(positionClosed(store,id))fail('شرح وظایف سمت بسته‌شده قابل تغییر نیست؛ برای سمت جدید نسخهٔ تازه ثبت کنید.',409);
    if(!input||Object.keys(input).some(key=>!['duties','expectedVersion'].includes(key))||!Number.isSafeInteger(input.expectedVersion))fail('متن و نسخهٔ شرح وظیفه لازم است.');
    const duties=text(input.duties,6000);
    return store.transaction(()=>{
      const row=store.get(id,'position-assignment');
      if(!row)fail('شرح وظیفه پیدا نشد.',404);
      if(row.isManager||user(row.employeeId)?.role==='manager')fail('شرح وظیفه برای دسترسی مدیر کاربرد ندارد.',409);
      if(row.status!=='published'||activePosition(row.employeeId)?.id!==id)fail('فقط شرح وظیفهٔ منتشرشده و جاری قابل ویرایش است.',409);
      if(row.version!==input.expectedVersion)fail('شرح وظیفه تغییر کرده است؛ پنجره را ببندید و نسخهٔ تازه را باز کنید.',409);
      if(row.duties===duties)return row;
      const at=new Date().toISOString(),version=Math.max(row.version,...store.list('position-assignment',row.employeeId).map(p=>Number(p.version)||0))+1;
      // A text correction is not a personnel transfer: keep identity, dates and organizational facts intact.
      const revision=store.put('position-duties-revision',{positionId:id,employeeId:row.employeeId,previousVersion:row.version,version,previous:row,duties,editedBy:actor.id,createdAt:at},id);
      const updated=store.put('position-assignment',{...row,duties,version,dutiesUpdatedAt:at,dutiesUpdatedBy:actor.id,events:[...(row.events||[]),{state:'duties-updated',by:actor.id,at,previousVersion:row.version,version,revisionId:revision.id}]},row.employeeId);
      audit(actor,'position.duties-updated','position-assignment',id,{employeeId:row.employeeId,previousVersion:row.version,version,revisionId:revision.id});return updated;
    });
  }
  function structureDeletion(kind,row){
    const at=today(),unit=kind==='org-unit',people=store.list('workflow-user').map(p=>user(p.id)).filter(Boolean),matches=p=>unit?p.unitId===row.id:p.unitId===row.unitId&&(p.sectionId===row.id||!p.sectionId&&p.jobFamily===row.name);
    if(people.some(matches)||store.list('position-assignment').some(p=>matches(p)&&!p.revisedBy&&(['manager_review','hr_approval','needs_revision'].includes(p.status)||p.status==='published'&&(!p.effectiveTo||p.effectiveTo>at))))return {allowed:false,reason:'این مورد به پرسنل یا درخواست سمت فعال متصل است؛ ابتدا وابستگی را جابه‌جا کنید.'};
    if(unit&&store.list('org-section').some(s=>s.unitId===row.id&&!s.removedAt))return {allowed:false,reason:'ابتدا بخش‌های فعال این واحد را حذف یا منتقل کنید.'};
    if(unit&&['evaluation-settings','score-rule-draft','score-rule-version','kpi-design','activity','service-survey-campaign'].some(kind=>store.list(kind).some(r=>r.unitId===row.id&&!r.removedAt&&r.status!=='discarded'&&r.status!=='rejected')))return {allowed:false,reason:'واحد به تنظیمات یا گردش KPI فعال متصل است و قابل حذف نیست.'};
    return {allowed:true,reason:null};
  }
  function removeStructure(actor,kind,id){
    role(actor,['hr']);return store.transaction(()=>{const row=store.get(id,kind);if(!row)fail('واحد یا بخش پیدا نشد.',404);if(row.removedAt)return {id,removed:true};const availability=structureDeletion(kind,row);if(!availability.allowed)fail(availability.reason,409);const removed=store.put(kind,{...row,removedAt:new Date().toISOString(),removedBy:actor.id});audit(actor,kind==='org-unit'?'unit.removed':'section.removed',kind,id);return {id:removed.id,removed:true};});
  }
  function removeUnit(actor,id){return removeStructure(actor,'org-unit',id);}
  function removeSection(actor,id){return removeStructure(actor,'org-section',id);}
  function units(actor){role(actor,['hr']);return store.list('org-unit').filter(row=>!row.removedAt).map(row=>({...row,deletion:structureDeletion('org-unit',row)}));}
  function createUnit(actor,input){role(actor,['hr']);const id=text(input.id,80),name=text(input.name,120);if(store.get(id,'org-unit'))fail('این شناسهٔ واحد قبلاً ثبت شده است.',409);const row=store.put('org-unit',{id,name,createdBy:actor.id,createdAt:new Date().toISOString()},null);audit(actor,'unit.created','org-unit',id);return row;}
  function sections(actor){role(actor,['hr']);return store.list('org-section').filter(row=>!row.removedAt).map(row=>({...row,deletion:structureDeletion('org-section',row)}));}
  function createSection(actor,input){role(actor,['hr']);const id=input.id==null?`section-${randomUUID()}`:text(input.id,80),name=text(input.name,120),unitId=text(input.unitId,80);if(!store.get(unitId,'org-unit')||store.get(unitId,'org-unit').removedAt)fail('واحد سازمانی برای این بخش ثبت نشده است.');if(store.get(id,'org-section'))fail('این شناسهٔ بخش قبلاً ثبت شده است.',409);if(store.list('org-section').some(row=>!row.removedAt&&row.unitId===unitId&&row.name===name))fail('بخشی با این نام در واحد ثبت شده است.',409);const row=store.put('org-section',{id,name,unitId,createdBy:actor.id,createdAt:new Date().toISOString()},null);audit(actor,'section.created','org-section',id);return row;}
  function sectionFor(input,unitId){if(!input.sectionId)return null;const section=store.get(text(input.sectionId,80),'org-section');if(!section||section.removedAt||section.unitId!==unitId)fail('بخش انتخاب‌شده برای این واحد معتبر نیست.');return section;}
  function chart(actor){role(actor,['hr','manager','personnel']);const all=store.list('workflow-user').map(row=>user(row.id)).filter(person=>person&&['personnel','manager'].includes(person.role));let visible=all;if(actor.role==='manager')visible=all.filter(person=>person.unitId===actor.unitId);if(actor.role==='personnel'){const ids=new Set([actor.id,actor.managerId,...all.filter(person=>person.managerId===actor.id).map(person=>person.id)]);visible=all.filter(person=>ids.has(person.id));}return {scope:actor.role==='hr'?'all':actor.role==='manager'?'unit':'direct',units:actor.role==='hr'?units(actor):[{id:actor.unitId,name:actor.unitName}],people:visible.map(person=>({id:person.id,name:person.name,role:person.role,unitId:person.unitId,unitName:person.unitName,managerId:person.managerId||null,jobTitle:person.jobTitle||person.level||'',jobLevel:person.level||'',...(actor.role==='hr'||actor.id===person.id?{phone:person.phone||null,employeeCode:person.employeeCode||null}:{})}))};}
  // Every manager-facing position response uses the same allowlist, including
  // legacy routes and decision responses. Stored/HR records retain full data.
  const managerPositionFields=['id','employeeId','jobTitle','jobFamily','sectionId','jobLevel','unitId','unitName','managerId','duties','effectiveFrom','effectiveTo','transferDate','status','version','createdAt','managerReview','hrReview','isManager','isKpiEligible','events','requestOrigin'];
  const managerPosition=row=>Object.fromEntries(managerPositionFields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
  function positionProposals(actor){role(actor,['manager']);return store.list('position-assignment').filter(p=>p.unitId===actor.unitId&&p.status==='manager_review').map(managerPosition);}
  function personnelRequests(actor){
    role(actor,['manager']);
    const positions=store.list('position-assignment').filter(p=>p.unitId===actor.unitId&&p.events?.[0]?.by!=='migration').map(p=>({...managerPosition(p),requestOrigin:p.requestOrigin||(!p.supersedes&&p.version===1?'registration':'position'),employeeName:user(p.employeeId)?.name||p.employeeId,employeeCode:user(p.employeeId)?.employeeCode||null}));
    const archived=row=>row.status==='published'||row.status==='approved'||row.managerReview?.decision==='approve'&&!['manager_review','needs_revision'].includes(row.status);
    return {positions:positions.map(row=>({...row,archived:archived(row),approvedAt:row.managerReview?.at||row.publishedAt||row.events?.find(e=>e.state==='published')?.at||null})),appeals:listAppeals(actor).map(row=>({...row,archived:archived(row),approvedAt:row.managerReview?.at||row.hrReview?.at||null}))};
  }
  function scanDeadlines(){
    approvalSla.scan();
    const surveyAdmin=store.list('workflow-user').find(p=>p.role==='hr');if(surveyAdmin)for(const c of store.list('service-survey-campaign').filter(c=>c.collectionPolicy==='until-deadline-v1'&&c.status==='open'&&!c.removedAt&&campaignDeadline(c)<today())){try{closeServiceCampaign(surveyAdmin,c.id);}catch{/* Finalized/closed sources remain immutable. */}}
    for(const event of store.list('task-deadline').filter(row=>!row.clearedAt&&!row.scoreRuleVersion&&[2,3].includes(row.day)))store.put('task-deadline',{...event,clearedAt:new Date().toISOString(),state:'cleared',supersededBy:'five-business-day-deadline'},event.positionId);
    const generated=[];for(const person of store.list('workflow-user').map(row=>user(row.id)).filter(row=>row?.role==='personnel')){
      if(person.isKpiEligible===false){for(const event of store.list('task-deadline').filter(row=>row.employeeId===person.id&&!row.clearedAt))store.put('task-deadline',{...event,clearedAt:new Date().toISOString(),state:'cleared',reason:'outside-individual-kpi'},event.positionId);continue;}
      const model=modelFor(person,workflow.currentPeriod);
      if(!model.weights.routine&&(!model.weights.project||!person.hasProjects))for(const event of store.list('task-deadline').filter(row=>row.employeeId===person.id&&!row.clearedAt))store.put('task-deadline',{...event,clearedAt:new Date().toISOString(),state:'cleared',reason:'unit-model-does-not-require-tasks'},event.positionId);
      const positions=store.list('position-assignment',person.id).filter(p=>p.status==='published'&&p.isKpiEligible&&(model.weights.routine>0||model.weights.project>0&&p.hasProjects)&&p.effectiveFrom<=today()&&(!p.effectiveTo||today()<p.effectiveTo)&&p.events?.[0]?.by!=='migration');
      for(const position of positions){
        const defined=store.list('kpi-design',person.id).some(d=>!d.removedAt&&d.positionId===position.id&&['ai_pending','ai_failed','manager_review','hr_review','published'].includes(d.status));
        const previous=store.list('task-deadline',position.id);if(defined){for(const event of previous.filter(row=>!row.clearedAt))store.put('task-deadline',{...event,clearedAt:new Date().toISOString(),state:'cleared'},position.id);continue;}
        const rules=scoreRulesAt(store,{unitId:position.unitId,at:position.effectiveFrom+'T00:00:00+03:30'}),reminder=Number(rules.values.reminderDays),limit=Number(rules.values.definitionDays);
        const elapsed=businessDaysBetween(position.effectiveFrom,today());for(const day of [reminder,limit])if(day===reminder?elapsed>=reminder:elapsed>limit){const id=`deadline-${position.id}-day${day}`,old=store.get(id,'task-deadline');if(!old){const event=store.put('task-deadline',{id,employeeId:person.id,managerId:position.managerId,unitId:position.unitId,positionId:position.id,positionVersion:position.version,day,scoreRuleVersion:rules.version,state:day===reminder?'reminder':'escalation',createdAt:new Date().toISOString(),noAutomaticScore:true},position.id);generated.push(event);audit(null,`task-deadline.${event.state}`,'task-deadline',event.id,{positionId:position.id,employeeId:person.id});}}
      }
    }return generated;
  }
  function taskDeadlines(actor){role(actor,['hr','manager']);scanDeadlines();return store.list('task-deadline').filter(row=>!row.clearedAt&&(actor.role==='hr'||row.managerId===actor.id)).map(row=>({...row,employeeName:user(row.employeeId)?.name}));}
  function assertDesignNotSettled(id,period){
    assertQuarterWritable(store,id,period);
    const exit=settlementFor(store,id);
    if(exit&&(user(id)?.isSettled||exit.settlementDate<periodBounds(period).end))fail('برای این پرسنل تسویه ثبت شده است؛ تعریف یا بررسی شاخص در این بازه مجاز نیست.',409);
  }
  function settlementPeople(actor){
    role(actor,['hr']);
    return {people:store.list('workflow-user').filter(p=>p.role==='personnel').map(p=>({id:p.id,name:p.name,employeeCode:p.employeeCode||null,settlementDate:settlementFor(store,p.id)?.settlementDate||null})),settlements:store.list('personnel-settlement').map(row=>({id:row.id,employeeId:row.employeeId,employeeName:store.get(row.employeeId,'workflow-user')?.name||'—',employeeCode:store.get(row.employeeId,'workflow-user')?.employeeCode||null,settlementDate:row.settlementDate,createdAt:row.createdAt,status:row.settlementDate<=today()?'effective':'scheduled'}))};
  }
  function settlementPreview(actor,input){
    role(actor,['hr']);const person=employee(input.employeeId),settlementDate=date(input.settlementDate),code=personnelCode(input.employeeCode);
    if(code&&code!==personnelCode(person.employeeCode))fail('نام و کد پرسنلی به یک فرد تعلق ندارند.',409);
    if(settlementFor(store,person.id))fail('تسویهٔ این فرد قبلاً ثبت شده است.',409);
    return settlementPlan(store,workflow,person.id,settlementDate,{today:today(),busy});
  }
  function registerSettlement(actor,input){
    role(actor,['hr']);const person=employee(input.employeeId),settlementDate=date(input.settlementDate),code=personnelCode(input.employeeCode);
    if(code&&code!==personnelCode(person.employeeCode))fail('نام و کد پرسنلی به یک فرد تعلق ندارند.',409);
    return store.transaction(()=>{
      const existing=settlementFor(store,person.id);
      if(existing){if(existing.settlementDate===settlementDate)return existing;fail('قبلاً برای این فرد تسویه ثبت شده است؛ تاریخ متفاوت نیازمند اصلاحیه است.',409);}
      const plan=settlementPreview(actor,input);
      if(!plan.ready)fail(plan.blockers.join('\n'),409);
      if(input.closeoutAcknowledgment!==true||input.closeoutFingerprint!==plan.fingerprint)fail('پیش‌نمایش مبلغ و امتیاز تسویه را بازبینی و تأیید کنید؛ داده‌ها ممکن است تغییر کرده باشند.',409);
      const at=new Date().toISOString(),id=randomUUID(),closeoutIds=[];
      for(const result of plan.closeouts){
        const row=store.put('position-closeout',{...result,version:SETTLEMENT_VERSION,employeeId:person.id,nextPositionId:null,reason:'settlement',settlementId:id,status:'locked',lockedBy:actor.id,lockedAt:at,fingerprint:plan.fingerprint},person.id);closeoutIds.push(row.id);
        const position=store.get(result.positionId,'position-assignment');
        store.put('position-assignment',{...position,effectiveTo:result.end,settlementId:id,events:[...(position.events||[]),{state:'settled',by:actor.id,at}]},person.id);
        audit(actor,'position.closeout-locked','position-closeout',row.id,{positionId:result.positionId,settlementId:id,fingerprint:plan.fingerprint});
      }
      const saved=store.put('personnel-settlement',{id,employeeId:person.id,settlementDate,assessmentEnd:plan.end,version:SETTLEMENT_VERSION,closeoutIds,earned:plan.earned,baseSalary:plan.baseSalary,total:plan.total,fingerprint:plan.fingerprint,status:'registered',createdBy:actor.id,createdAt:at},person.id);
      audit(actor,'personnel.settlement-registered','personnel-settlement',saved.id,{employeeId:person.id,settlementDate,assessmentEnd:plan.end,closeoutIds,version:SETTLEMENT_VERSION});
      return saved;
    });
  }
  function assertPositionSupervisor(row){
    const manager=user(row.managerId);
    if(!manager||manager.role!=='manager'||manager.isSettled||manager.unitId!==row.unitId||manager.id===row.employeeId)fail('مافوق این درخواست باید به مدیر مجاز همان واحد اصلاح شود؛ درخواست را برای اصلاح برگردانید.',409);
  }
  function proposePosition(actor,input){
    role(actor,['hr']);const person=employee(input.employeeId);const manager=user(input.managerId);
    if(settlementFor(store,person.id))fail('برای این فرد تسویه ثبت شده است؛ جابجایی جدید مجاز نیست.',409);
    if(!manager||manager.role!=='manager'||manager.isSettled)fail('شخص مافوق باید مدیر مجاز همان واحد باشد.');
    if(manager.unitId!==input.unitId||manager.id===person.id)fail('بالاسری باید فرد دیگری در همان واحد جدید باشد.');
    const transferDate=date(input.transferDate,true),requestedStart=date(input.effectiveFrom,true),effectiveFrom=transferDate||requestedStart;if(!effectiveFrom)fail('تاریخ شروع اثر یا تاریخ انتقال لازم است.');if(transferDate&&requestedStart&&requestedStart!==effectiveFrom)fail('شروع سمت جدید باید خودِ تاریخ جابه‌جایی باشد.');if(input.effectiveTo!=null&&date(input.effectiveTo)<=effectiveFrom)fail('بازه سمت معتبر نیست.');
    const hasProjects=projectsForPosition(input,input.unitId,effectiveFrom,!!input.isManager),exemption=false; // Legacy exemption inputs no longer change the model.
    const unitId=text(input.unitId,80),registeredUnit=store.get(unitId,'org-unit');if(!registeredUnit||registeredUnit.removedAt||registeredUnit.name!==input.unitName)fail('واحد مقصد معتبر نیست.');const section=sectionFor(input,unitId);
    const current=activePosition(person.id),row={employeeId:person.id,jobTitle:text(input.jobTitle,160),jobFamily:section?.name||text(input.jobFamily,120),sectionId:section?.id||null,jobLevel:text(input.jobLevel,80),unitId,unitName:registeredUnit.name,managerId:manager.id,duties:text(input.duties,6000),isManager:!!input.isManager,isKpiEligible:!input.isManager&&input.isKpiEligible!==false,hasProjects,approvedProjectExemption:exemption,projectExemptionRef:exemption?text(input.projectExemptionRef,200):null,baseSalary:input.baseSalary==null?current?.baseSalary??person.baseSalary??null:Number(input.baseSalary),transferDate,effectiveFrom,effectiveTo:input.effectiveTo==null?null:date(input.effectiveTo),supersedes:current?.id||null,status:'manager_review',version:Math.max(0,...store.list('position-assignment',person.id).map(p=>Number(p.version)||0))+1,createdBy:actor.id,createdAt:new Date().toISOString(),events:[{state:'manager_review',by:actor.id,at:new Date().toISOString()}]};
    if(row.baseSalary!==null&&(!Number.isSafeInteger(row.baseSalary)||row.baseSalary<0))fail('حقوق پایه معتبر نیست.');
    if(row.isManager&&row.isKpiEligible)fail('مدیر طبق مدل فعلی از شمول KPI فردی خارج است.');
    if(current&&row.effectiveFrom<current.effectiveFrom)fail('تاریخ اثر نمی‌تواند پیش از نسخه جاری باشد.');
    const result=store.put('position-assignment',row,person.id);audit(actor,'position.proposed','position-assignment',result.id,{employeeId:person.id,version:result.version});return result;
  }
  function createPerson(actor,input){
    role(actor,['hr']);
    if(input.isManager!==undefined&&typeof input.isManager!=='boolean')fail('گزینهٔ سمت مدیریتی باید درست یا نادرست باشد.');
    role(actor,['hr']);const name=text(input.name,160),newRole=input.role==='manager'?'manager':'personnel',isManager=newRole==='manager',manager=isManager?null:user(input.managerId),unitId=text(input.unitId,80),unitName=text(input.unitName,120),baseSalary=isManager?null:Number(input.baseSalary),approvedProjectExemption=false;
    if(!isManager&&(!['number','string'].includes(typeof input.baseSalary)||String(input.baseSalary).trim()===''||!Number.isSafeInteger(baseSalary)||baseSalary<0))fail('حقوق پایه معتبر نیست.');
    const registeredUnit=store.get(unitId,'org-unit');if(!registeredUnit||registeredUnit.removedAt)fail('ابتدا واحد سازمانی را در پنل HR ثبت کنید.');if(registeredUnit.name!==unitName)fail('نام واحد باید با شناسهٔ ثبت‌شده مطابقت داشته باشد.');const section=isManager?null:sectionFor(input,unitId);
    if(!isManager&&(!manager||manager.role!=='manager'||manager.isSettled||manager.unitId!==unitId))fail('شخص مافوق باید مدیر مجاز همان واحد باشد.');if(isManager&&store.list('workflow-user').some(row=>user(row.id)?.role==='manager'&&user(row.id).unitId===unitId))fail('برای این واحد مدیر وجود دارد؛ از تغییر سمت نسخه‌دار استفاده کنید.');
    const id=`employee-${randomUUID()}`,exemptionRef='';
    const effectiveFrom=date(input.effectiveFrom||today()),hasProjects=projectsForPosition(input,unitId,effectiveFrom,newRole==='manager'||input.isManager===true||input.isKpiEligible===false);
    const phone=text(personnelCode(input.phone||''),30,false),employeeCode=text(personnelCode(input.employeeCode||''),60,false);if(phone&&!/^[0-9+\-\s()]+$/.test(phone))fail('شماره تماس معتبر نیست.');if(employeeCode&&store.list('workflow-user').some(person=>personnelCode(person.employeeCode)===employeeCode))fail('کد پرسنلی قبلاً ثبت شده است.',409);
    const person={id,name,role:newRole,level:text(input.jobLevel,80),jobTitle:text(input.jobTitle,160),jobFamily:isManager?null:section?.name||text(input.jobFamily,120),sectionId:section?.id||null,unitId,unitName,managerId:manager?.id||null,phone,employeeCode,baseSalary,bonusCeiling:isManager||input.isManager===true||input.isKpiEligible===false?null:Math.round(baseSalary*PerformanceModel.monthlyRate),hasProjects,approvedProjectExemption,isKpiEligible:!isManager&&input.isManager!==true&&input.isKpiEligible!==false,createdAt:new Date().toISOString()};
return store.transaction(()=>{store.put('workflow-user',person);let position;if(newRole==='manager'){position=store.put('position-assignment',{employeeId:id,jobTitle:person.jobTitle,jobFamily:person.jobFamily,sectionId:person.sectionId,jobLevel:person.level,unitId,unitName,managerId:null,duties:null,isManager:true,isKpiEligible:false,hasProjects:false,approvedProjectExemption:false,baseSalary,effectiveFrom:date(input.effectiveFrom||today()),effectiveTo:null,status:'published',version:1,createdBy:actor.id,createdAt:new Date().toISOString(),events:[{state:'published',by:actor.id,at:new Date().toISOString()}]},id);}else position=proposePosition(actor,{...input,employeeId:id,jobTitle:person.jobTitle,jobFamily:person.jobFamily,sectionId:person.sectionId,jobLevel:person.level,unitId,unitName,managerId:manager.id,baseSalary,hasProjects,approvedProjectExemption,projectExemptionRef:exemptionRef,effectiveFrom:input.effectiveFrom||today()});position=store.put('position-assignment',{...position,requestOrigin:'registration'},id);audit(actor,'person.created','workflow-user',id,{unitId,managerId:manager?.id||null});return {employee:workflow.publicUser(workflow.user(id)),position};});
  }
  function reviewPosition(actor,id,input){
    role(actor,['manager']);const row=store.get(id,'position-assignment');if(!row)fail('پیشنهاد سمت پیدا نشد.',404);
    if(actor.unitId!==row.unitId)fail('فقط مدیر واحد مقصد می‌تواند اطلاعات سمت را بازبینی کند.',403);
    if(row.status!=='manager_review')fail('وضعیت پیشنهاد سمت قابل بازبینی نیست.',409);
    const decision=input.decision;if(!['approve','return'].includes(decision))fail('تصمیم مدیر معتبر نیست.');const reason=text(input.reason||'',2000,decision==='return');
    if(decision==='approve')assertPositionSupervisor(row);
    const updated=store.put('position-assignment',{...row,status:decision==='approve'?'hr_approval':'needs_revision',managerReview:{actorId:actor.id,decision,reason,at:new Date().toISOString()},events:[...row.events,{state:decision==='approve'?'hr_approval':'needs_revision',by:actor.id,reason,at:new Date().toISOString()}]},row.employeeId);audit(actor,'position.manager-review','position-assignment',id,{decision});return managerPosition(updated);
  }
  function approvePosition(actor,id,input){
    role(actor,['hr']);const row=store.get(id,'position-assignment');if(!row)fail('پیشنهاد سمت پیدا نشد.',404);
    if(row.status!=='hr_approval')fail('بازبینی مدیر و نسخهٔ اصلاح‌شده لازم است.',409);
    if(input.decision==='return'){const updated=store.put('position-assignment',{...row,status:'needs_revision',hrReview:{actorId:actor.id,decision:'return',reason:text(input.reason,2000),at:new Date().toISOString()},events:[...row.events,{state:'needs_revision',by:actor.id,reason:input.reason,at:new Date().toISOString()}]},row.employeeId);audit(actor,'position.returned','position-assignment',id);return updated;}
    if(input.decision!=='approve')fail('تصمیم HR معتبر نیست.');
    assertPositionSupervisor(row);
    if(settlementFor(store,row.employeeId))fail('برای این فرد تسویه ثبت شده است؛ انتشار سمت جدید مجاز نیست.',409);
    const effectiveFrom=date(row.effectiveFrom),previous=activePosition(row.employeeId);
    return store.transaction(()=>{
      assertPositionSupervisor(row);
      if(row.supersedes&&previous?.id!==row.supersedes)fail('سمت فعال از زمان ثبت درخواست تغییر کرده است؛ درخواست تازه لازم است.',409);
      const closeout=row.supersedes?closeouts.lock(actor,row,input):null;
      const conflicting=store.list('position-assignment',row.employeeId).find(p=>p.id!==row.id&&p.status==='published'&&p.effectiveFrom<=(row.effectiveTo||'9999-12-31')&&(!p.effectiveTo||p.effectiveTo>effectiveFrom)&&p.effectiveFrom>=effectiveFrom);
      if(conflicting)fail('با نسخهٔ منتشرشدهٔ دیگری هم‌پوشانی دارد؛ ابتدا تاریخ اثر را اصلاح کنید.',409);
      if(previous&&previous.id!==row.id&&previous.effectiveFrom<effectiveFrom)store.put('position-assignment',{...previous,effectiveTo:effectiveFrom,supersededBy:row.id,events:[...previous.events,{state:'effective-period-closed',by:actor.id,at:new Date().toISOString(),next:row.id}]},row.employeeId);
      const active=store.put('position-assignment',{...row,...(closeout?{previousCloseoutId:closeout.id,closeoutVersion:CLOSEOUT_VERSION}:{}),status:'published',approvedBy:actor.id,publishedAt:new Date().toISOString(),events:[...row.events,{state:'published',by:actor.id,at:new Date().toISOString()}]},row.employeeId);audit(actor,'position.published','position-assignment',id,{employeeId:row.employeeId,version:row.version});return active;
    });
  }
  function revisePosition(actor,id,input){
    role(actor,['hr']);const previous=store.get(id,'position-assignment');if(!previous)fail('پیشنهاد سمت پیدا نشد.',404);if(previous.status!=='needs_revision')fail('فقط پیشنهاد برگشتی قابل اصلاح است.',409);
    let revised=proposePosition(actor,{...input,employeeId:previous.employeeId});if(previous.requestOrigin)revised=store.put('position-assignment',{...revised,requestOrigin:previous.requestOrigin},previous.employeeId);store.put('position-assignment',{...previous,revisedBy:revised.id,events:[...previous.events,{state:'revision-submitted',by:actor.id,at:new Date().toISOString(),next:revised.id}]},previous.employeeId);return revised;
  }
  function listDesigns(actor){
    const rows=store.list('kpi-design').filter(d=>!d.removedAt).map(effectiveDesign).map(d=>{const lock=['published','rejected'].includes(d.status)?null:finalReviewLock(d.employeeId,d.period,d.managerId);return {...d,finalReviewOnly:!!lock,finalReviewSourceId:lock?.id||null,finalReviewReason:lock?finalReviewReason:null};}).map(d=>({...d,...(['manager','hr'].includes(actor.role)&&d.aiReview?{alignmentCurrent:alignmentCurrent(d),canReanalyze:canReanalyze(d)}:{}),...(actor.role==='manager'&&d.status!=='draft'&&workflow.manages(actor,user(d.employeeId))?{copyNextMonth:monthCopyAvailability(actor,d)}:{})}));
    const present=d=>{const draft=clarificationDraft(d),context=clarificationContext(d),tasks=clarificationTasks(d,context);return {...d,tasks:tasks.map(task=>{const saved=draft?.tasks.find(t=>t.id===task.id);return saved&&saved.clarifications?.length&&JSON.stringify(safeTasks([saved]).map(({clarifications,...t})=>t))===JSON.stringify(safeTasks([task]).map(({clarifications,...t})=>t))?{...task,clarifications:clarificationTasks(draft,context).find(t=>t.id===task.id).clarifications}:task;}),...(['manager_review','needs_revision'].includes(d.status)?{clarificationDraft:draft?{id:draft.id,draftRevision:draft.draftRevision}:null}: {})};};
    if(actor.role==='hr')return rows.filter(d=>d.status!=='draft').map(present);
    if(actor.role==='manager')return rows.filter(d=>workflow.manages(actor,user(d.employeeId))).map(present);
    if(actor.role==='personnel')return rows.filter(d=>d.employeeId===actor.id&&d.status==='published');
    return fail('دسترسی به طرح KPI مجاز نیست.',403);
  }
  function validateDesign(input,actor,clarificationSource=null){
    const person=managerOf(actor,input.employeeId);const period=text(input.period,16);
    if(!/^14\d{2}-Q[1-4]$/.test(period))fail('دوره باید به شکل 1405-Q3 باشد.');
    assertDesignNotSettled(person.id,period);
    if(!Array.isArray(input.tasks)||input.tasks.length<1||input.tasks.length>30)fail('۱ تا ۳۰ تسک برای طرح لازم است.');
    let tasks=normalizeTaskWeights(input.tasks).map((task,index)=>{
      if(!['routine','project'].includes(task.category))fail('دسته تسک معتبر نیست.');
      const kind=task.category==='project'?'project':'routine';const title=text(task.title,200),description=text(task.description,4000),criteria=Array.isArray(task.criteria)?task.criteria.map(v=>text(v,500)):String(task.criteria||'').split('\n').map(v=>v.trim()).filter(Boolean);
      validateActivity({kind,title,description,period,criteria});
      let descriptionSections;
      if(task.descriptionSections!==undefined){
        if(!Array.isArray(task.descriptionSections)||task.descriptionSections.length<3||task.descriptionSections.length>20)fail('تعداد باکس‌های توضیحات باید بین ۳ تا ۲۰ باشد.');
        const sections=task.descriptionSections.map(s=>({title:text(s?.title,80),text:text(s?.text,4000,false)}));
        if(!['شرح','هدف','مسئولیت'].every((label,i)=>sections[i].title===label))fail('سه باکس اول باید شرح، هدف و مسئولیت باشند.');
        const combined=sections.slice(1).every(s=>!s.text)?sections[0].text:sections.filter(s=>s.text).map(s=>s.title+':\n'+s.text).join('\n\n');
        // AI corrections may replace the full description; stale presentation metadata must not restore old text.
        if(combined===description)descriptionSections=sections;
      }
      const common={id:task.id||`T${index+1}`,category:task.category,title,description,criteria,weight:task.weight,...(task.weightPoints!=null?{weightPoints:task.weightPoints,weightVersion:task.weightVersion}:{}),...validateTaskRecurrence(task,{legacy:task.weightPoints==null}),responsible:text(task.responsible||person.name,160),evidenceTypes:Array.isArray(task.evidenceTypes)?task.evidenceTypes.map(v=>text(v,80)):['مستند خروجی']};
      if(descriptionSections)common.descriptionSections=descriptionSections;
      if(task.category==='routine')return {...common,dueDate:task.dueDate?date(task.dueDate):task.frequency==='فصلی'?new Date(Date.parse(periodBounds(period).end+'T00:00:00Z')-86400000).toISOString().slice(0,10):null};
      if(!Array.isArray(task.milestones)||!task.milestones.length||task.milestones.length>20)fail('برای تسک پروژه نقاط تحویل لازم است.');
      if(task.documentFormat!=null&&!Object.hasOwn(taskDocumentFormats,task.documentFormat))fail('فرمت مستندات را از فهرست مجاز انتخاب کنید.');
      const output=task.documentFormat!=null?{documentFormat:task.documentFormat,documentFormatVersion:'project-document-format-v1'}:{deliverable:text(task.deliverable,1000)};
      return {...common,...output,deadline:date(task.deadline),milestones:task.milestones.map(m=>({name:text(m.name,160),dueDate:date(m.dueDate)}))};
    });
    if(new Set(tasks.map(task=>task.id)).size!==tasks.length)fail('شناسه‌های شاخص‌های یک نسخه باید یکتا باشند.');
    const position=workflow.assessmentPosition(person.id,period);if(!position)fail('شناسنامه سمت تأییدشده برای این پرسنل لازم است.');if(position.isKpiEligible===false)fail('این سمت خارج از KPI فردی است و شاخص برای آن ثبت نمی‌شود.',409);
    if(positionClosed(store,position.id))fail('این بازهٔ سمت نهایی و بسته شده است.',409);
    if(clarificationSource?.positionId&&clarificationSource.positionId!==position.id)fail('طرح مربوط به سمت قبلی است؛ برای بازهٔ جدید پیش‌نویس تازه بسازید.',409);
    const {start,end}=quarterlyEvidenceWindow(store,position,period);
    if(tasks.some(task=>[task.dueDate,task.deadline,...(task.milestones||[]).map(m=>m.dueDate)].filter(Boolean).some(at=>at<start)))fail('موعد شاخص یا نقطهٔ تحویل نباید پیش از شروع بازهٔ سمت باشد.',409);
    if(tasks.some(task=>[task.dueDate,task.deadline,...(task.milestones||[]).map(m=>m.dueDate)].filter(Boolean).some(at=>at>=end)))fail('موعد شاخص یا نقطهٔ تحویل باید داخل بازهٔ همین فصل و سمت باشد.',409);
    if(position.unitId!==actor.unitId)fail('سمت پرسنل در فصل انتخاب‌شده بیرون از واحد شماست.',403);
    if(clarificationSource&&(clarificationSource.employeeId!==person.id||clarificationSource.period!==period||clarificationSource.managerId!==actor.id))fail('پاسخ‌های نسخهٔ دیگری قابل استفاده نیستند.',403);
    const policy=policyForPeriod(store,period,null,position.unitId),context=clarificationContextHash({employeeId:person.id,managerId:actor.id,period},position,policy);
    tasks=normalizeClarifications(tasks,input.tasks,clarificationSource?effectiveDesign(clarificationSource):null,context,actor.id);
    return {person,period,tasks,position};
  }
  function submitDesign(actor,input){
    role(actor,['manager']);const {person,period,tasks,position}=validateDesign(input,actor);
    assertCorrectionOpen({employeeId:person.id,period,managerId:actor.id});
    const result=store.put('kpi-design',{employeeId:person.id,managerId:actor.id,unitId:position.unitId,positionId:position.id,positionVersion:position.version,period,policyVersion:policyForPeriod(store,period,null,position.unitId).version,tasks,status:'ai_pending',createdBy:actor.id,version:store.list('kpi-design',person.id).filter(d=>d.period===period).length+1,createdAt:new Date().toISOString(),events:[{state:'ai_pending',by:actor.id,at:new Date().toISOString()}]},person.id);audit(actor,'kpi-design.submitted','kpi-design',result.id,{employeeId:person.id,version:result.version});return result;
  }
  function ownDesign(actor,id){
    role(actor,['manager']);const design=store.get(id,'kpi-design');
    if(!design||!workflow.manages(actor,user(design.employeeId)))fail('طرح شاخص پیدا نشد یا در محدودهٔ شما نیست.',404);
    assertQuarterWritable(store,design.employeeId,design.period);
    if(positionClosed(store,design.positionId))fail('این طرح متعلق به بازهٔ نهایی‌شده است؛ برای سمت جدید پیش‌نویس تازه بسازید.',409);
    return design;
  }
  function saveDesignDraft(actor,input,id=null){
    return id?store.transaction(()=>saveDesignDraftRow(actor,input,id)):saveDesignDraftRow(actor,input,id);
  }
  function saveDesignDraftRow(actor,input,id=null){
    role(actor,['manager']);let previous=id?ownDesign(actor,id):null;
    if(previous&&(previous.removedAt||previous.status!=='draft'))fail('فقط پیش‌نویس فعال قابل ویرایش است.',409);
    if(previous?.tasks.some(t=>t.clarifications?.length)&&input.draftRevision!==previous.draftRevision)fail('پیش‌نویس یا پاسخ‌ها تغییر کرده‌اند؛ فهرست را تازه کنید.',409);
    const requested=previous?{...input,employeeId:previous.employeeId,period:previous.period}:input;
    const revisionSource=!previous&&input.revises?ownDesign(actor,input.revises):null;
    const validated=validateDesign(requested,actor,previous||revisionSource);
    if(previous&&input.draftRevision!==(previous.draftRevision||0))fail('پیش‌نویس تغییر کرده است؛ نسخهٔ تازه را دریافت کنید. متن ویرایش شما در فرم حفظ شده است.',409);
    assertCorrectionOpen({employeeId:validated.person.id,period:validated.period,managerId:actor.id});
    // Append new tasks to the one open draft for this person/month, never to a sent version.
    if(!id){consolidateDesignDrafts(actor,validated.person.id,validated.period);previous=store.list('kpi-design',validated.person.id).find(row=>row.period===validated.period&&row.status==='draft'&&!row.removedAt&&workflow.manages(actor,user(row.employeeId)));}
    if(previous&&!id&&previous.tasks.some(t=>t.clarifications?.length))fail('پیش‌نویس دارای پاسخ ابهام را با دکمهٔ ویرایش همان نسخه تکمیل کنید.',409);
    const {person,period,tasks,position}=previous&&!id?validateDesign({...requested,tasks:[...previous.tasks,...validated.tasks].map((task,index)=>({...task,id:`T${index+1}`}))},actor,previous):validated;
    const revises=revisionSource;
    if(revises&&(revises.removedAt||revises.status!=='needs_revision'&&!(revises.status==='ai_failed'&&revises.tasks.some(t=>t.clarifications?.length))||revises.employeeId!==person.id||revises.period!==period))fail('طرح برگشتی برای این پیش‌نویس معتبر نیست.',409);
    const at=new Date().toISOString();
    const row=store.put('kpi-design',{...previous,employeeId:person.id,managerId:actor.id,unitId:position.unitId,positionId:position.id,positionVersion:position.version,period,policyVersion:policyForPeriod(store,period,null,position.unitId).version,tasks,status:'draft',version:previous?.version||store.list('kpi-design',person.id).filter(d=>d.period===period).length+1,draftRevision:(previous?.draftRevision||0)+1,...(revises?{revises:revises.id}:{}),createdBy:previous?.createdBy||actor.id,createdAt:previous?.createdAt||at,updatedAt:at,events:[...(previous?.events||[]),{state:'draft',by:actor.id,at,action:previous?'edit':'create'}]},person.id);
    audit(actor,previous?'kpi-design.draft-edited':'kpi-design.draft-saved','kpi-design',row.id,{version:row.version,draftRevision:row.draftRevision});return row;
  }
  function openDesignCorrectionDraft(actor,id,input){
    const source=ownDesign(actor,id);
    if(!input||Object.keys(input).some(k=>!['runId','proposalId','draftId','draftRevision'].includes(k)))fail('درخواست ویرایش شاخص معتبر نیست.');
    if(source.removedAt||source.managerId!==actor.id||!['manager_review','needs_revision'].includes(source.status)||source.aiReview?.contractVersion!==alignmentContractVersion)fail('فقط طرح جاری مدیر قابل اصلاح است.',409);
    assertCorrectionOpen(source);
    if(input.runId!==source.aiReview.runId||!alignmentCurrent(source))fail('گزارش تحلیل تغییر کرده یا معتبر نیست؛ فهرست را تازه کنید.',409);
    if(!source.tasks.some(t=>t.id===input.proposalId))fail('شاخص مورد اصلاح پیدا نشد.',404);
    const previous=clarificationDraft(source);
    if((input.draftId||null)!==(previous?.id||null)||previous&&input.draftRevision!==previous.draftRevision)fail('پیش‌نویس اصلاحی تغییر کرده؛ فهرست را تازه کنید.',409);
    if(source.revisedBy&&source.revisedBy!==previous?.id)fail('نسخهٔ اصلاحی جدیدتری ارسال شده؛ همان نسخه را بررسی کنید.',409);
    if(previous){if(!previous.tasks.some(t=>t.id===input.proposalId))fail('شاخص در پیش‌نویس جاری وجود ندارد؛ همان پیش‌نویس را بررسی کنید.',409);return previous;} // Never append or replace its tasks/answers.
    if(store.list('kpi-design',source.employeeId).some(d=>!d.removedAt&&d.status==='draft'&&d.period===source.period))fail('پیش‌نویس دیگری باز است؛ ابتدا همان نسخه را بررسی کنید.',409);
    const tasks=clarificationTasks(effectiveDesign(source),clarificationContext(source)),checked=validateDesign({...source,tasks},actor,source),at=new Date().toISOString();
    return store.transaction(()=>{
      const draft=store.put('kpi-design',{employeeId:source.employeeId,managerId:actor.id,unitId:checked.position.unitId,positionId:checked.position.id,positionVersion:checked.position.version,period:source.period,policyVersion:policyForPeriod(store,source.period,null,checked.position.unitId).version,tasks:checked.tasks,status:'draft',revises:source.id,version:Math.max(0,...store.list('kpi-design',source.employeeId).filter(d=>d.period===source.period).map(d=>d.version||0))+1,draftRevision:1,createdBy:actor.id,createdAt:at,updatedAt:at,events:[{state:'draft',action:'manual-correction-draft',by:actor.id,at}]},source.employeeId);
      store.put('kpi-design',{...source,status:'needs_revision',revisedBy:draft.id,events:[...source.events,{state:'needs_revision',action:'manual-correction-draft',by:actor.id,at,next:draft.id}]},source.employeeId);
      audit(actor,'kpi-design.correction-draft-opened','kpi-design',draft.id,{sourceDesignId:source.id,sourceRunId:source.aiReview.runId,proposalId:input.proposalId});return draft;
    });
  }
  function saveDesignClarifications(actor,id,input){
    const source=ownDesign(actor,id);if(source.removedAt||source.managerId!==actor.id||!['manager_review','needs_revision'].includes(source.status)||source.aiReview?.contractVersion!==alignmentContractVersion)fail('پاسخ فقط برای طرح جاریِ قابل اصلاح مجاز است.',409);
    assertCorrectionOpen(source);
    if(input.runId!==source.aiReview.runId)fail('گزارش تحلیل تغییر کرده؛ پرسش‌ها را دوباره دریافت کنید.',409);
    const previous=clarificationDraft(source);if((input.draftId||null)!==(previous?.id||null)||(previous&&input.draftRevision!==previous.draftRevision))fail('پیش‌نویس پاسخ‌ها تغییر کرده؛ فهرست را تازه کنید.',409);
    if(source.revisedBy&&source.revisedBy!==previous?.id)fail('نسخهٔ اصلاحی جدیدتری ارسال شده؛ پرسش‌های همان نسخه را پاسخ دهید.',409);
    if(store.list('kpi-design',source.employeeId).some(d=>!d.removedAt&&d.status==='draft'&&d.period===source.period&&d.id!==previous?.id))fail('پیش‌نویس دیگری باز است؛ ابتدا آن را بررسی کنید.',409);
    const base=previous||source,task=base.tasks.find(t=>t.id===input.proposalId),original=source.tasks.find(t=>t.id===input.proposalId);
    if(!task||!original)fail('شاخصِ سؤال پیدا نشد.',404);
    if(previous&&JSON.stringify(safeTasks([task]).map(({clarifications,...t})=>t))!==JSON.stringify(safeTasks([original]).map(({clarifications,...t})=>t)))fail('متن شاخص در پیش‌نویس تغییر کرده؛ پاسخ را در ویرایش همان پیش‌نویس ثبت کنید.',409);
    if(!Array.isArray(input.answers)||!input.answers.length)fail('پاسخ‌های پرسش را وارد کنید.');
    const tasks=base.tasks.map(t=>t.id===input.proposalId?{...t,clarifications:input.answers}:t),checked=validateDesign({...base,tasks},actor,base),at=new Date().toISOString();
    return store.transaction(()=>{
      const draft=store.put('kpi-design',{...(previous||{}),employeeId:source.employeeId,managerId:actor.id,unitId:checked.position.unitId,positionId:checked.position.id,positionVersion:checked.position.version,period:source.period,policyVersion:policyForPeriod(store,source.period,null,checked.position.unitId).version,tasks:checked.tasks,status:'draft',revises:source.id,version:previous?.version||Math.max(0,...store.list('kpi-design',source.employeeId).filter(d=>d.period===source.period).map(d=>d.version||0))+1,draftRevision:(previous?.draftRevision||0)+1,createdBy:previous?.createdBy||actor.id,createdAt:previous?.createdAt||at,updatedAt:at,events:[...(previous?.events||[]),{state:'draft',action:'clarifications-saved',by:actor.id,at}]},source.employeeId);
      store.put('kpi-design',{...source,status:'needs_revision',revisedBy:draft.id,events:[...source.events,{state:'needs_revision',action:'clarification-draft',by:actor.id,at,next:draft.id}]},source.employeeId);
      audit(actor,'kpi-design.clarifications-saved','kpi-design',draft.id,{sourceDesignId:source.id,sourceRunId:source.aiReview.runId,proposalId:input.proposalId,questionIds:input.answers.map(q=>q.id),draftRevision:draft.draftRevision});return draft;
    });
  }
  function consolidateDesignDrafts(actor=null,employeeId=null,period=null){
    if(actor)role(actor,['manager']);const groups=new Map();
    for(const row of store.list('kpi-design').filter(row=>row.status==='draft'&&!row.removedAt&&(!actor||workflow.manages(actor,user(row.employeeId)))&&(!employeeId||row.employeeId===employeeId)&&(!period||row.period===period))){const key=JSON.stringify([row.employeeId,row.period,row.positionId||null]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    let merged=0;for(const rows of groups.values()){
      if(rows.some(d=>quarterLocked(store,d.employeeId,d.period)||positionClosed(store,d.positionId)||finalReviewLock(d.employeeId,d.period,d.managerId)))continue;
      if(rows.some(d=>d.tasks.some(t=>t.clarifications?.length)))continue;
      if(rows.length<2)continue;rows.sort((a,b)=>(a.version||1)-(b.version||1));const main=rows[0],at=new Date().toISOString();
      const joined=rows.flatMap(row=>row.tasks.map(task=>({...task,weightPoints:task.weightPoints??Math.max(1,Math.round(5*task.weight/Math.max(...row.tasks.filter(t=>t.category===task.category).map(t=>t.weight))))}))).map((task,index)=>({...task,id:`T${index+1}`}));
      if(joined.length>30)fail('پیش‌نویس تجمیعی بیش از ۳۰ شاخص دارد؛ ابتدا شاخص‌های اضافی را بازبینی کنید.',409);
      store.transaction(()=>{assertQuarterWritable(store,main.employeeId,main.period);store.put('kpi-design',{...main,tasks:normalizeTaskWeights(joined),draftRevision:(main.draftRevision||0)+1,updatedAt:at,consolidationSources:[...(main.consolidationSources||[]),...rows.map(row=>({id:row.id,version:row.version,tasks:row.tasks}))],mergedDraftIds:[...(main.mergedDraftIds||[]),...rows.slice(1).map(row=>row.id)],events:[...(main.events||[]),{state:'draft',action:'consolidated',by:actor?.id||'system',at}]},main.employeeId);
        for(const row of rows.slice(1))store.put('kpi-design',{...row,removedAt:at,removedBy:actor?.id||'system',mergedInto:main.id,events:[...(row.events||[]),{state:'merged',by:actor?.id||'system',at,next:main.id}]},row.employeeId);
        audit(actor,'kpi-design.drafts-consolidated','kpi-design',main.id,{mergedCount:rows.length-1,taskCount:joined.length});});merged+=rows.length-1;
    }return {merged};
  }
  async function publishDesignDraft(actor,id,provider='codex',expectedRevision){
    const draft=ownDesign(actor,id);if(draft.removedAt||draft.status!=='draft')fail('فقط پیش‌نویس فعال قابل انتشار است.',409);
    assertCorrectionOpen(draft);
    if((expectedRevision!==undefined||draft.tasks.some(t=>t.clarifications?.length))&&expectedRevision!==(draft.draftRevision||0))fail('نسخهٔ پیش‌نویس یا پاسخ‌ها تغییر کرده؛ فهرست را تازه کنید.',409);
    const {tasks,position}=validateDesign({...draft,tasks:draft.tasks.map(task=>({...task,recurrenceVersion:'required-task-time-v2',timeLimit:task.frequency==='ماهانه'&&task.timeLimit?{dayOfMonth:task.timeLimit.dayOfMonth,time:task.timeLimit.time}:task.timeLimit}))},actor,draft),at=new Date().toISOString();
    if(tasks.some(t=>t.clarifications?.some(q=>q.needsReconfirmation)))fail('پاسخ‌های قبلی با تغییر شاخص یا زمینه نیازمند بازبینی و تأیید مجدد هستند.',409);
    store.put('kpi-design',{...draft,tasks,positionId:position.id,positionVersion:position.version,status:'ai_pending',submittedAt:at,events:[...draft.events,{state:'ai_pending',by:actor.id,at}]},draft.employeeId);
    audit(actor,'kpi-design.submitted','kpi-design',id,{version:draft.version});
    try{return await analyzeDesign(actor,id,provider);}catch(error){
      const current=store.get(id,'kpi-design');if(current?.status==='ai_pending')store.put('kpi-design',{...current,status:'ai_failed',events:[...current.events,{state:'ai_failed',by:actor.id,at:new Date().toISOString()}]},draft.employeeId);
      throw error;
    }
  }
  function removeDesign(actor,id){
    const design=ownDesign(actor,id);if(design.removedAt)return design;
    if(positionClosed(store,design.positionId))fail('شاخص‌های بازهٔ نهایی‌شده قابل حذف نیستند.',409);
    // Archiving is not a correction: the terminal review must not prevent it.
    const activities=store.list('activity').filter(a=>a.designId===id),activityIds=new Set(activities.map(a=>a.id));
    const running=store.list('ai-design-attempt',id).some(a=>a.status==='running')||store.list('review').some(r=>r.status==='running'&&activityIds.has(r.activityId||r.activitySnapshot?.id))||store.list('ai-preprocess-attempt').some(a=>a.status==='running'&&activityIds.has(a.activitySnapshot?.id));
    if(running)fail('بررسی این شاخص در حال اجرا است؛ بعد از پایان بررسی حذف کنید.',409);
    return store.transaction(()=>{
      assertQuarterWritable(store,design.employeeId,design.period);
      const removedAt=new Date().toISOString();for(const activity of activities)store.put('activity',{...activity,removedAt,removedBy:actor.id,assignmentStatus:'removed'},activity.ownerId);
      const removed=store.put('kpi-design',{...design,removedAt,removedBy:actor.id,events:[...(design.events||[]),{state:'removed',by:actor.id,at:removedAt}]},design.employeeId);
      audit(actor,'kpi-design.removed','kpi-design',id,{previousStatus:design.status,activityCount:activities.length});return removed;
    });
  }
  async function analyzeDesign(actor,id,provider='codex'){
    role(actor,['manager','hr']);const design=store.get(id,'kpi-design');if(!design||design.removedAt)fail('طرح KPI پیدا نشد.',404);
    if(actor.role==='manager'&&!workflow.manages(actor,user(design.employeeId)))fail('طرح بیرون از محدوده شماست.',403);
    assertCorrectionOpen(design);
    assertDesignNotSettled(design.employeeId,design.period);
    if(!['ai_pending','ai_failed'].includes(design.status)&&!canReanalyze(design))fail('این طرح اکنون منتظر تحلیل AI نیست.',409);
    if(store.list('ai-design-attempt',id).some(row=>row.status==='running'))fail('تحلیل همین طرح در حال اجرا است.',409);
    if(typeof runModel!=='function')fail('سرویس بررسی AI آماده نیست.',503);const config=providerConfig(provider);
    const position=designPosition(design);if(!position)fail('سمت تأییدشده پیدا نشد.',409);
    if(position.isKpiEligible===false)fail('این سمت در ماه شاخص خارج از KPI فردی است.',409);
    if(clarificationTasks(design,clarificationContext(design),{includeMissing:false}).some(t=>t.clarifications?.some(q=>q.needsReconfirmation)))fail('ابتدا پاسخ‌های قدیمی را در پیش‌نویس اصلاحی بازبینی کنید.',409);
    // v4 is the only execution path, independent of environment/legacy flags.
    {
      if(actor.role==='manager'&&user(design.employeeId)?.managerId!==actor.id)fail('رابطهٔ مدیریت جاری برای تحلیل معتبر نیست.',403);
      const policy=policyForPeriod(store,design.period,null,position.unitId),attempt=store.put('ai-design-attempt',{designId:id,designVersion:design.version,status:'running',provider,model:config.model,actorId:actor.id,startedAt:new Date().toISOString(),positionVersion:position.version,contractVersion:alignmentContractVersion,inputs:{position:{jobTitle:position.jobTitle,duties:position.duties,version:position.version},tasks:safeTasks(design.tasks)}},id);
      try{
        const aiReview=await jobDesignAnalysis.align(position,design,policy,actor,provider,()=>currentAnalysisContext(actor,design,position,policy),tasks=>{const checked=validateDesign({...design,tasks},workflow.user(design.managerId),design);if(checked.tasks.some(t=>t.clarifications?.some(q=>q.needsReconfirmation)))fail('اصلاح شاخص نیازمند بازبینی پاسخ‌های مرتبط است.',409);return checked;});
        return store.transaction(()=>{
          assertCorrectionOpen(design);
          if(!currentAnalysisContext(actor,design,position,policy))fail('پاسخ تحلیل قدیمی شده است؛ دوباره تحلیل کنید.',409);
          const current=store.get(id,'kpi-design');store.put('ai-design-attempt',{...attempt,status:'done',result:aiReview.result,usage:aiReview.usage,runId:aiReview.runId,finishedAt:new Date().toISOString()},id);
          const {managerReview,hrReview,...fresh}=current;
          const updated=store.put('kpi-design',{...fresh,positionId:position.id,positionVersion:position.version,policyVersion:policy.version,status:'manager_review',aiReview,events:[...current.events,{state:'manager_review',by:actor.id,at:new Date().toISOString(),aiModel:config.model,contractVersion:alignmentContractVersion}]},design.employeeId);audit(actor,'kpi-design.ai-reviewed','kpi-design',id,{provider,model:config.model});return updated;
        });
      }catch(error){
        store.put('ai-design-attempt',{...attempt,status:'failed',error:error.publicMessage||'تحلیل کامل نشد؛ نتیجهٔ معتبر ثبت نشده است.',finishedAt:new Date().toISOString()},id);
        const current=store.get(id,'kpi-design');if(current&&!current.removedAt&&['ai_pending','ai_failed'].includes(current.status))store.put('kpi-design',{...current,status:'ai_failed',events:[...current.events,{state:'ai_failed',by:actor.id,at:new Date().toISOString()}]},current.employeeId);throw error;
      }
    }
  }
  function acceptDesignChange(actor,id,input){
    const previous=effectiveDesign(ownDesign(actor,id));if(previous.removedAt||!['manager_review','needs_revision'].includes(previous.status)||previous.aiReview?.contractVersion!==alignmentContractVersion)fail('پذیرش پیشنهاد فقط از تحلیل جاریِ قابل اصلاح مجاز است.',409);
    const position=designPosition(previous);
    if(!alignmentCurrent(previous))fail('اجرای تحلیل جاری معتبر نیست؛ دوباره تحلیل کنید.',409);
    if(!position||user(previous.employeeId)?.managerId!==actor.id||previous.aiReview.basisHash!==analysisBasis(position,previous,policyForPeriod(store,previous.period,null,position.unitId)))fail('تحلیل یا رابطهٔ مدیریت قدیمی است؛ پیشنهاد قابل پذیرش نیست.',409);
    if(previous.aiReview.result.humanReviewRequired)fail('چرخه اصلاح به بازبینی انسانی ارجاع شده؛ ادامه پذیرش خودکار اصلاح مجاز نیست.',409);
    const selected=previous.aiReview.result.reviews.filter(review=>input.all===true||review.proposalId===input.proposalId);
    if(selected.length&&selected.every(review=>!effectiveChanges(previous.tasks.find(t=>t.id===review.proposalId),review).length))fail('پیشنهاد با متن موجود یکسان است؛ اصلاح واقعی ندارد و پیش‌نویس تازه ساخته نمی‌شود.',409);
    if(input.all!==true&&previous.aiReview.result.reviews.filter(review=>review.changes.length).length>1)fail('کنترل کیفیت روی مجموعه اصلاحات انجام شده؛ اصلاحات چند شاخص باید یکجا اعمال شوند.',409);
    if(selected.some(review=>review.changes.length&&review.correctionValidation?.status!=='verified'))fail('اصلاح پیشنهادی هنوز از کنترل کیفیت عبور نکرده است.',409);
    const tested=applyStoredChanges(safeTasks(previous.tasks).map(task=>({...task,criteria:normalizedCriteria(task.criteria)})),previous.aiReview.result.reviews);
    if(selected.some(review=>review.changes.length&&review.correctionValidation.testedPlanHash!==stabilityHash(tested)))fail('مجموعه اصلاحات با نسخه کنترل‌شده یکسان نیست؛ دوباره بررسی کنید.',409);
    if(selected.some(review=>review.changes.length&&review.correctionValidation.testedTaskHash!==stabilityHash(tested.find(task=>task.id===review.proposalId))))fail('مقدار اصلاح با نسخه کنترل‌شده یکسان نیست؛ دوباره بررسی کنید.',409);
    if(input.field&&selected.some(review=>review.changes.length>1))fail('اصلاحات مرتبط یک شاخص باید یکجا اعمال شوند تا تناقض ایجاد نشود.',409);
    const changes=selected.flatMap(review=>effectiveChanges(previous.tasks.find(t=>t.id===review.proposalId),review).filter(change=>!input.field||change.field===input.field).map(change=>({proposalId:review.proposalId,...change})));
    if(!changes.length)fail('تغییر پیشنهادی معتبر پیدا نشد.',404);
    if(store.list('kpi-design',previous.employeeId).some(row=>row.status==='draft'&&!row.removedAt&&row.period===previous.period))fail('ابتدا پیش‌نویس موجود این ماه را تعیین تکلیف کنید.',409);
    const reason=text(input.reason,2000),at=new Date().toISOString();
    const acceptedSuggestions=changes.map(change=>({analysisRunId:previous.aiReview.runId,proposalId:change.proposalId,field:change.field,oldValue:previous.tasks.find(task=>task.id===change.proposalId)?.[change.field]??null,proposedValue:change.proposedValue,reason,actorId:actor.id,at}));
    const tasks=previous.tasks.map(task=>{const revised={...task};for(const change of changes.filter(change=>change.proposalId===task.id))revised[change.field]=change.field==='timeLimit'?Object.fromEntries(Object.entries(change.proposedValue).filter(([,value])=>value!==null)):change.proposedValue;return revised;});
    return store.transaction(()=>{
      store.put('kpi-design',{...previous,status:'needs_revision',events:[...previous.events,{state:'needs_revision',by:actor.id,at,reason}]},previous.employeeId);
      const draft=saveDesignDraft(actor,{employeeId:previous.employeeId,period:previous.period,tasks,revises:previous.id});
      const revised=store.put('kpi-design',{...draft,acceptedSuggestions,...(input.all===true?{}:{acceptedSuggestion:acceptedSuggestions[0]})},previous.employeeId);
      store.put('kpi-design',{...store.get(id,'kpi-design'),revisedBy:revised.id},previous.employeeId);audit(actor,'kpi-design.suggestion-accepted','kpi-design',revised.id,{revises:id,all:input.all===true,changes:acceptedSuggestions.map(row=>({proposalId:row.proposalId,field:row.field}))});return revised;
    });
  }
  function managerReviewDesign(actor,id,input){
    role(actor,['manager']);const d=store.get(id,'kpi-design');if(!d||d.removedAt)fail('طرح KPI پیدا نشد.',404);if(!workflow.manages(actor,user(d.employeeId)))fail('طرح بیرون از محدوده شماست.',403);
    assertQuarterWritable(store,d.employeeId,d.period);
    const lock=finalReviewLock(d.employeeId,d.period,d.managerId),finalSource=lock?.id===d.id;
    if(lock&&(!finalSource||input.decision!=='approve'))fail(finalReviewReason,409);
    if((d.status!=='manager_review'&&!(finalSource&&d.status==='needs_revision'))||!d.aiReview)fail('تحلیل AI باید ابتدا ثبت شود.',409);
    if(!['approve','return','reject'].includes(input.decision))fail('تصمیم مدیر معتبر نیست.');const reason=text(input.reason||'',2000,input.decision!=='approve');
    if(input.decision==='approve')assertCurrentAnalysis(actor,d,input);
    const manual=input.decision==='approve'&&effectiveDesign(d).aiReview.result.humanReviewRequired;
    const status=input.decision==='approve'?'hr_review':input.decision==='return'?'needs_revision':'rejected';const result=store.put('kpi-design',{...d,status,managerReview:{actorId:actor.id,decision:input.decision,reason,at:new Date().toISOString(),...(manual?{humanReviewAcknowledgment:true,analysisRunId:d.aiReview.runId,reviewedFindings:d.aiReview.result.findings?.filter(row=>row.status==='open').map(row=>row.id)||[]}: {})},events:[...d.events,{state:status,by:actor.id,reason,at:new Date().toISOString()}]},d.employeeId);audit(actor,'kpi-design.manager-review','kpi-design',id,{decision:input.decision,humanReview:!!manual,analysisRunId:d.aiReview.runId});return result;
  }
  function createDesignActivities(d,position,person){
    assertQuarterWritable(store,d.employeeId,d.period);
    return d.tasks.map(task=>{const activity=validateActivity({kind:task.category,title:task.title,description:task.description,period:d.period,criteria:task.criteria});const created=store.put('activity',{...activity,ownerId:person.id,unitId:position.unitId,positionId:position.id,positionVersion:position.version,designId:d.id,designVersion:d.version,assessmentStart:quarterlyEvidenceWindow(store,position,d.period).start,assessmentEnd:quarterlyEvidenceWindow(store,position,d.period).end,assignmentStatus:'approved',kpiWeight:task.weight,weightPoints:task.weightPoints??null,weightVersion:task.weightVersion||'legacy-task-percent-v1',frequency:task.frequency||null,targetVolume:task.targetVolume||null,targetUnit:task.targetUnit||null,timeLimit:task.timeLimit||null,documentFormat:task.documentFormat||null,documentFormatVersion:task.documentFormatVersion||null,deliverable:task.deliverable||null,milestones:task.milestones||[],responsible:task.responsible,evidenceTypes:task.evidenceTypes,dueDate:task.deadline||task.dueDate||null,source:'approved-design',...(d.monthCopy?{copiedFromDesignId:d.monthCopy.sourceDesignId}:{}),createdAt:new Date().toISOString()});return created.id;});
  }
  function hrReviewDesign(actor,id,input){
    role(actor,['hr']);const d=store.get(id,'kpi-design');if(!d||d.removedAt)fail('طرح KPI پیدا نشد.',404);if(d.status!=='hr_review')fail('تأیید مدیر لازم است.',409);
    assertQuarterWritable(store,d.employeeId,d.period);
    if(input.decision==='return'){const result=store.put('kpi-design',{...d,status:'needs_revision',hrReview:{actorId:actor.id,decision:'return',reason:text(input.reason,2000),at:new Date().toISOString()},events:[...d.events,{state:'needs_revision',by:actor.id,reason:input.reason,at:new Date().toISOString()}]},d.employeeId);audit(actor,'kpi-design.returned','kpi-design',id);return result;}
    if(input.decision!=='approve')fail('تصمیم HR معتبر نیست.');const person=employee(d.employeeId);const position=designPosition(d);
    assertCurrentAnalysis(actor,d,input);
    if(!position||position.id!==d.positionId||position.version!==d.positionVersion)fail('نسخه سمت تغییر کرده؛ طرح باید دوباره تطبیق و تصویب شود.',409);
    return store.transaction(()=>{
      const activityIds=createDesignActivities(d,position,person);
      const manual=effectiveDesign(d).aiReview?.result?.humanReviewRequired;
      const result=store.put('kpi-design',{...d,status:'published',activityIds,hrReview:{actorId:actor.id,decision:'approve',at:new Date().toISOString(),...(manual?{reason:input.reason,humanReviewAcknowledgment:true,analysisRunId:d.aiReview.runId}: {})},publishedAt:new Date().toISOString(),events:[...d.events,{state:'published',by:actor.id,at:new Date().toISOString(),activityIds}]},d.employeeId);audit(actor,'kpi-design.published','kpi-design',id,{employeeId:person.id,activityIds,humanReview:!!manual,analysisRunId:d.aiReview?.runId});return result;
    });
  }

  function reviseDesign(actor,id,input){
    role(actor,['manager']);const previous=store.get(id,'kpi-design');if(!previous||previous.removedAt)fail('طرح KPI پیدا نشد.',404);
    if(!workflow.manages(actor,user(previous.employeeId)))fail('طرح بیرون از محدوده شماست.',403);
    assertCorrectionOpen(previous);
    if(previous.status!=='needs_revision')fail('فقط طرح برگشتی قابل اصلاح است.',409);
    const {person,period,tasks,position}=validateDesign({...input,employeeId:previous.employeeId,period:previous.period},actor,previous);
    const version=store.list('kpi-design',person.id).filter(d=>d.period===period).length+1;
    return store.transaction(()=>{
      const revised=store.put('kpi-design',{employeeId:person.id,managerId:actor.id,unitId:position.unitId,positionId:position.id,positionVersion:position.version,period,policyVersion:policyForPeriod(store,period,null,position.unitId).version,tasks,status:'ai_pending',createdBy:actor.id,version,revises:previous.id,createdAt:new Date().toISOString(),events:[{state:'ai_pending',by:actor.id,at:new Date().toISOString(),revises:previous.id}]},person.id);
      store.put('kpi-design',{...previous,revisedBy:revised.id,events:[...previous.events,{state:'revision-submitted',by:actor.id,at:new Date().toISOString(),next:revised.id}]},person.id);audit(actor,'kpi-design.revised','kpi-design',revised.id,{revises:previous.id,version});return revised;
    });
  }

  function createServiceCampaign(actor,input){
    role(actor,['hr']);const period=text(input.period,16);if(!/^14\d{2}-Q[1-4]$/.test(period))fail('دوره باید به شکل 1405-Q3 باشد.');if(period<workflow.currentPeriod)fail('برای فصل‌های گذشته پیش‌نویس جدید نظرسنجی ساخته نمی‌شود.',409);
    const eligible=person=>person?.role==='personnel'&&!person.isSettled&&!user(person.id)?.isSettled&&workflow.assessmentPosition(person.id,period)?.isKpiEligible&&modelFor(person,period).weights.peer>0;
    const allServices=input.employeeId==='all',targets=allServices?periodPeople(period).filter(eligible):[workflow.userAt(employee(input.employeeId).id,period)];if(!targets.length||targets.some(target=>!eligible(target)))fail('نظرسنجی همکاران فقط برای پرسنلی با سهم نظرسنجی در مدل ارزیابی مجاز است.');
    const settingsFor=target=>{const population=serviceRespondents(period,target.unitId).filter(person=>person.id!==target.id).length;if(population<3)fail('برای محرمانگی دست‌کم سه پاسخ‌دهندهٔ مجاز لازم است.',409);const rules=scoreRulesAt(store,{unitId:target.unitId}),minParticipation=Number(input.minParticipation??rules.values.surveyParticipation)/100;if(!Number.isFinite(minParticipation)||minParticipation<0.3||minParticipation>1)fail('درصد مشارکت معتبر نیست.');if(Number(rules.values.surveyResponses)>population)fail('حداقل پاسخ قانون از جمعیت مجاز بیشتر است.',409);return {population,minParticipation,scoreRulesSnapshot:rules};};targets.forEach(settingsFor);
    const question=text(input.question||'کیفیت خدمت ارائه‌شده را چگونه ارزیابی می‌کنید؟',500),existing=new Set(store.list('service-survey-campaign').filter(c=>c.period===period&&c.employeeId&&!c.removedAt&&(!c.positionId||!positionClosed(store,c.positionId))).map(c=>c.employeeId));if(!allServices&&existing.has(targets[0].id))fail('برای این فرد و ماه قبلاً نظرسنجی ثبت شده است.',409);
    const created=store.transaction(()=>targets.filter(target=>!existing.has(target.id)).map(target=>{const {population,minParticipation,scoreRulesSnapshot}=settingsFor(target),row=store.put('service-survey-campaign',{employeeId:target.id,positionId:workflow.assessmentPosition(target.id,period)?.id||null,employeeName:target.name,unitId:target.unitId,unitName:target.unitName,period,policyVersion:modelFor(target,period).version,question,population,minParticipation,scoreRulesSnapshot,privacyVersion:'peer-min-three-responses-v1',collectionPolicy:'until-deadline-v1',openedAt:null,dueAt:addRuleDays(periodBounds(period).end,Number(scoreRulesSnapshot.values.surveyDays)-1),status:'draft',createdAt:new Date().toISOString(),events:[{state:'draft',by:actor.id,at:new Date().toISOString()}]});audit(actor,'service-survey.drafted','service-survey-campaign',row.id,{period,employeeId:target.id,population});return row;}));return allServices?{createdCount:created.length,skippedCount:targets.length-created.length,campaigns:created}:created[0];
  }
  function assertCampaignWritable(campaign){
    if(!campaign)return;
    assertQuarterWritable(store,campaign.employeeId,campaign.period);
    if(positionClosed(store,campaign.positionId))fail('بازهٔ سمت این نظرسنجی نهایی و بسته شده است.',409);
  }
  function publishServiceCampaign(actor,id){
    assertCampaignWritable(store.get(id,'service-survey-campaign'));
    role(actor,['hr']);const campaign=store.get(id,'service-survey-campaign');if(!campaign?.employeeId||campaign.removedAt)fail('نظرسنجی پیدا نشد.',404);if(campaign.status!=='draft')fail('فقط پیش‌نویس قابل انتشار است.',409);if(campaign.period>workflow.currentPeriod)fail('انتشار نظرسنجی ماه آینده از آغاز همان ماه مجاز است.',409);if(today()>campaignDeadline(campaign))fail('مهلت انتشار این نظرسنجی گذشته است.',409);
    const target=workflow.userAt(campaign.employeeId,campaign.period),policy=target&&modelFor(target,campaign.period),population=serviceRespondents(campaign.period,target?.unitId).filter(person=>person.id!==campaign.employeeId).length;
    if(target?.isSettled||user(campaign.employeeId)?.isSettled||!policy?.weights.peer||!workflow.assessmentPosition(target.id,campaign.period)?.isKpiEligible)fail('این فرد در مدل واحدِ ماه ارزیابی سهم نظرسنجی ندارد.',409);
    if(population<3)fail('برای محرمانگی دست‌کم سه پاسخ‌دهندهٔ مجاز لازم است.',409);
    const opened=store.put('service-survey-campaign',{...campaign,unitId:target.unitId,unitName:target.unitName,policyVersion:policy.version,population,status:'open',openedAt:today(),dueAt:campaignDeadline(campaign),events:[...campaign.events,{state:'open',by:actor.id,at:new Date().toISOString()}]});audit(actor,'service-survey.opened','service-survey-campaign',id,{period:campaign.period,employeeId:campaign.employeeId,population});return opened;
  }
  function publishServiceCampaignMonth(actor,period){
    role(actor,['hr']);if(!/^14\d{2}-Q[1-4]$/.test(period||''))fail('ماه ارزیابی معتبر نیست.');
    const drafts=store.list('service-survey-campaign').filter(c=>c.period===period&&c.employeeId&&!c.removedAt&&c.status==='draft');
    if(!drafts.length)fail('برای این ماه پیش‌نویسی جهت انتشار وجود ندارد.',409);
    if(period>workflow.currentPeriod)fail('انتشار نظرسنجی ماه آینده از آغاز همان ماه مجاز است.',409);
    // Publication validates each campaign's pinned deadline separately.
    const campaigns=store.transaction(()=>drafts.map(c=>publishServiceCampaign(actor,c.id)));
    return {period,publishedCount:campaigns.length,campaigns};
  }
  function removeServiceCampaign(actor,id){
    assertCampaignWritable(store.get(id,'service-survey-campaign'));
    role(actor,['hr']);const campaign=store.get(id,'service-survey-campaign');if(!campaign?.employeeId)fail('نظرسنجی پیدا نشد.',404);if(campaign.removedAt)return campaign;
    const removed=store.put('service-survey-campaign',{...campaign,status:'deleted',removedAt:new Date().toISOString(),removedBy:actor.id,events:[...campaign.events,{state:'deleted',by:actor.id,at:new Date().toISOString()}]});audit(actor,'service-survey.removed','service-survey-campaign',id,{period:campaign.period,employeeId:campaign.employeeId,responseCount:store.list('service-survey-response',id).length});return removed;
  }
  function removeServiceCampaignMonth(actor,period){
    role(actor,['hr']);if(!/^14\d{2}-Q[1-4]$/.test(period||''))fail('ماه ارزیابی معتبر نیست.');
    const active=store.list('service-survey-campaign').filter(c=>c.period===period&&c.employeeId&&!c.removedAt);
    if(!active.length)fail('برای این ماه نظرسنجی قابل حذف وجود ندارد.',409);
    const campaigns=store.transaction(()=>active.map(c=>removeServiceCampaign(actor,c.id)));
    return {period,removedCount:campaigns.length,campaigns};
  }
  function serviceCampaigns(actor){
    if(actor.role==='hr')return store.list('service-survey-campaign').filter(c=>c.employeeId&&!c.removedAt).map(c=>({...c,canRespond:canRespond(actor,c),dueAt:campaignDeadline(c),responseCount:store.list('service-survey-response',c.id).length,requiredCount:requiredResponses(c)}));
    if(actor.role==='manager')return store.list('service-survey-campaign').filter(c=>c.employeeId&&!c.removedAt&&c.status!=='draft'&&!store.list('service-survey-ballot',c.id).some(b=>b.respondentHash===respondentToken(c.id,actor.id))&&(c.unitId===actor.unitId||c.status==='open'&&serviceRespondents(c.period,c.unitId).some(p=>p.id===actor.id))).map(c=>({...c,canRespond:canRespond(actor,c),dueAt:campaignDeadline(c),...(c.status==='completed'?{}:{responseCount:undefined,aggregate:undefined})}));
    if(actor.role==='personnel')return store.list('service-survey-campaign')
      .filter(c=>c.employeeId&&!c.removedAt&&c.status!=='draft'&&(c.employeeId===actor.id||c.status==='open'&&serviceRespondents(c.period,c.unitId).some(p=>p.id===actor.id)&&!store.list('service-survey-ballot',c.id).some(b=>b.respondentHash===respondentToken(c.id,actor.id))))
      .map(c=>c.employeeId===actor.id
        ?{...c,canRespond:canRespond(actor,c),dueAt:campaignDeadline(c),responseCount:c.status==='completed'?c.responseCount:undefined,aggregate:c.status==='completed'?c.aggregate:undefined,ownCampaign:true}
        :{...c,canRespond:canRespond(actor,c),dueAt:campaignDeadline(c),responseCount:undefined,aggregate:undefined});
    return fail('دسترسی به نظرسنجی مجاز نیست.',403);
  }
  function submitServiceResponse(actor,id,input){
    assertCampaignWritable(store.get(id,'service-survey-campaign'));
    role(actor,['personnel','manager']);const campaign=store.get(id,'service-survey-campaign');if(!campaign||!campaign.employeeId||campaign.removedAt||!canRespond(actor,campaign))fail('این نظرسنجی برای شما در دسترس نیست.',404);
    if(!['number','string'].includes(typeof input.score)||String(input.score).trim()==='')fail('امتیاز باید بین صفر تا صد باشد.');
    const responseScore=score(Number(input.score)),respondentHash=respondentToken(campaign.id,actor.id);
    if(store.list('service-survey-ballot',campaign.id).some(b=>b.respondentHash===respondentHash))fail('برای این دوره قبلاً پاسخ ثبت کرده‌اید.',409);
    if(campaign.status!=='open')fail('مهلت نظرسنجی پایان یافته است.',409);
    const now=today(),deadline=campaignDeadline(campaign);if(now>deadline)fail('مهلت نظرسنجی پایان یافته است.',409);
    store.transaction(()=>{store.put('service-survey-ballot',{campaignId:campaign.id,respondentHash,createdAt:new Date().toISOString()},campaign.id);store.put('service-survey-response',{campaignId:campaign.id,score:responseScore,createdAt:new Date().toISOString()},campaign.id);});
    const responses=store.list('service-survey-response',campaign.id),required=requiredResponses(campaign);
    let result={status:'collecting',responses:responses.length,required,published:false};
    if(responses.length>=required&&campaign.collectionPolicy!=='until-deadline-v1'){
      const aggregate=Math.round((responses.reduce((sum,row)=>sum+row.score,0)/responses.length)*10)/10;const completed=store.put('service-survey-campaign',{...campaign,privacyVersion:'peer-min-three-responses-v1',status:'completed',completedAt:new Date().toISOString(),responseCount:responses.length,aggregate,events:[...campaign.events,{state:'completed',by:'system',at:new Date().toISOString(),responseCount:responses.length}]});
      store.put('service-survey-aggregate',{employeeId:campaign.employeeId,positionId:campaign.positionId||null,period:campaign.period,score:aggregate,campaignId:campaign.id,responseCount:responses.length,source:'peer-survey'},campaign.employeeId);
      audit(actor,'service-survey.completed','service-survey-campaign',campaign.id,{responseCount:responses.length});result={status:'completed',responses:responses.length,required,published:true,aggregate};return {saved:true,...result,campaign:completed};
    }
    return {saved:true,...result,quorumReached:responses.length>=required};
  }
  const peerImport=createPeerSurveyImport({store,workflow,secret:privacyConfig.value,canRespond,assertWritable:assertCampaignWritable,respondentToken,deadline:campaignDeadline,today,required:requiredResponses,complete:closeServiceCampaign,audit});
  const importPeerResponses=(actor,input)=>peerImport.run(actor,input);
  const listPeerImports=actor=>peerImport.list(actor);
  function closeServiceCampaign(actor,id){
    assertCampaignWritable(store.get(id,'service-survey-campaign'));
    role(actor,['hr']);const campaign=store.get(id,'service-survey-campaign');if(!campaign?.employeeId||campaign.removedAt)fail('نظرسنجی فردی پیدا نشد.',404);if(campaign.status!=='open')return campaign;
    if(user(campaign.employeeId)?.isSettled)fail('این فرد تسویه شده است؛ نتیجهٔ تازهٔ KPI ثبت نمی‌شود.',409);
    const responses=store.list('service-survey-response',campaign.id),required=requiredResponses(campaign);if(responses.length>=required){const aggregate=Math.round(responses.reduce((sum,row)=>sum+row.score,0)/responses.length*10)/10;const completed=store.put('service-survey-campaign',{...campaign,privacyVersion:'peer-min-three-responses-v1',status:'completed',responseCount:responses.length,aggregate,completedAt:new Date().toISOString(),events:[...campaign.events,{state:'completed',by:actor.id,at:new Date().toISOString()}]});store.put('service-survey-aggregate',{employeeId:campaign.employeeId,positionId:campaign.positionId||null,period:campaign.period,score:aggregate,campaignId:campaign.id,responseCount:responses.length,source:'peer-survey'},campaign.employeeId);audit(actor,'service-survey.completed','service-survey-campaign',campaign.id,{responseCount:responses.length});return completed;}
    const closed=store.put('service-survey-campaign',{...campaign,status:'insufficient',responseCount:responses.length,aggregate:null,closedAt:new Date().toISOString(),events:[...campaign.events,{state:'insufficient',by:actor.id,at:new Date().toISOString(),responseCount:responses.length,required,reason:'closed-by-hr'}]});audit(actor,'service-survey.insufficient','service-survey-campaign',id,{responseCount:responses.length,required,reason:'closed-by-hr'});return closed;
  }

  function managerQuarterCalculation(calculation){
    if(!calculation)return calculation;const {baseSalary,earned,ceiling,knownTotal,finalSalary,maxFinalSalary,...safe}=calculation;
    return {...safe,components:calculation.components?.map(({earned,ceiling,...component})=>component)};
  }
  function managerQuarterPayment(payment){
    if(!payment)return payment;const {earned,knownEarned,ceiling,...safe}=payment;
    return {...safe,breakdown:payment.breakdown?.map(({earned,ceiling,...interval})=>interval),oneTimeContribution:payment.oneTimeContribution?((({earned,ceiling,...component})=>component)(payment.oneTimeContribution)):null};
  }
  function managerQuarterView(result){
    if(!result)return result;const {sourceSnapshot,...safe}=result;return {...safe,monthRows:result.monthRows?.map(row=>({...row,components:row.components?.map(({earned,ceiling,...component})=>component)})),quarterPay:managerQuarterPayment(result.quarterPay),calculation:managerQuarterCalculation(result.calculation)};
  }

  function quarterResult(actor,quarter,id){
    if(!workflow.canRead(actor,id))fail('دسترسی به فصل این پرسنل مجاز نیست.',403);
    const final=finalQuarterSnapshot(store,id,quarter);if(final){const result={...final.snapshot,status:'locked',canFinalize:false,evaluationId:final.evaluationId};return actor.role==='manager'?managerQuarterView(result):result;}
    const result=quarterlyResult(store,workflow,actor,quarter,id,{busy,today:today()});
    return actor.role==='manager'?managerQuarterView(result):result;
  }
  function quarterProgress(actor,quarter,asOfPeriod){
    return quarterlyProgress(workflow,actor,quarter,asOfPeriod);
  }
  function quarterTeam(actor,quarter){
    const eligibleInQuarter=person=>{
      const position=workflow.assessmentPosition(person.id,quarter),exit=settlementFor(store,person.id),bounds=periodBounds(quarter);
      return !!(position&&position.isKpiEligible!==false&&(!exit||nextDate(exit.settlementDate)>bounds.start))||store.list('position-closeout',person.id).some(r=>r.status==='locked'&&r.months.some(m=>m.period===quarter))||store.list('quarter-evaluation',person.id).some(row=>row.quarter===quarter&&row.status==='locked');
    };
    const resultFor=id=>{
      const evaluation=store.list('quarter-evaluation',id).find(row=>row.quarter===quarter&&['hr_review','locked'].includes(row.status));
      if(!evaluation)return quarterResult(actor,quarter,id);
      const result=evaluation.status==='locked'?finalQuarterSnapshot(store,id,quarter).snapshot:quarterResult(actor,quarter,id),status=evaluation.status;
      if(actor.role==='manager')return {...managerQuarterView(result),status,canFinalize:false,evaluationId:evaluation.id};
      return {...result,status,canFinalize:false,evaluationId:evaluation.id};
    };
    if(actor.role==='manager')return store.list('workflow-user').map(u=>user(u.id)).filter(p=>workflow.manages(actor,p)&&eligibleInQuarter(p)).map(p=>resultFor(p.id));
    if(actor.role==='hr')return store.list('workflow-user').map(u=>user(u.id)).filter(p=>p?.role==='personnel'&&eligibleInQuarter(p)).map(p=>resultFor(p.id));
    if(actor.role==='personnel')return [resultFor(actor.id)];return fail('دسترسی به نتایج فصل مجاز نیست.',403);
  }
  function submitQuarter(actor,quarter,id){
    role(actor,['manager']);return store.transaction(()=>{const result=quarterResult(actor,quarter,id);
    if(store.list('quarter-evaluation',id).some(row=>row.quarter===quarter&&row.status==='locked'))fail('نتیجهٔ این فصل قبلاً نهایی و قفل شده است؛ ارسال مجدد مجاز نیست.',409);
    if(!result.canFinalize)fail('فصل تا رفع موارد نقص قابل ارسال نیست.',409);
    const fingerprint=result.fingerprint,existing=store.list('quarter-evaluation',id).find(row=>row.quarter===quarter&&row.status==='hr_review');if(existing&&existing.managerFingerprint===fingerprint)return existing;
    const row=store.put('quarter-evaluation',{employeeId:id,quarter,status:'hr_review',managerId:actor.id,managerFingerprint:fingerprint,snapshot:result,aggregationVersion:result.aggregationVersion,formulaVersion:result.quarterPay.formulaVersion,createdAt:new Date().toISOString(),events:[{state:'hr_review',by:actor.id,at:new Date().toISOString()}]},id);audit(actor,'quarter.submitted-for-hr','quarter-evaluation',row.id,{employeeId:id,quarter});return row;});
  }
  function approveQuarter(actor,id,input){
    role(actor,['hr']);return store.transaction(()=>{const row=store.get(id,'quarter-evaluation');if(!row)fail('ارزیابی فصل پیدا نشد.',404);if(row.status!=='hr_review')fail('ارزیابی در صف تأیید HR نیست.',409);
    if(input.decision==='return'){const updated=store.put('quarter-evaluation',{...row,status:'returned',hrReview:{actorId:actor.id,decision:'return',reason:text(input.reason,2000),at:new Date().toISOString()},events:[...row.events,{state:'returned',by:actor.id,at:new Date().toISOString()}]},row.employeeId);audit(actor,'quarter.returned','quarter-evaluation',id);return updated;}
    if(input.decision!=='approve')fail('تصمیم HR معتبر نیست.');
    if(store.list('quarter-evaluation',row.employeeId).some(other=>other.id!==row.id&&other.quarter===row.quarter&&other.status==='locked'))fail('برای این فرد و فصل قبلاً نتیجهٔ قطعی ثبت شده است؛ تأیید تکراری مجاز نیست.',409);
    const fresh=quarterResult(actor,row.quarter,row.employeeId);if(!fresh.canFinalize||fresh.fingerprint!==row.managerFingerprint)fail('داده یا نسخهٔ محاسبه بعد از تأیید مدیر تغییر کرده؛ ارزیابی باید دوباره ارسال شود.',409);
    const locked=store.put('quarter-evaluation',{...row,status:'locked',lockedSnapshot:fresh,scoreRulesSnapshot:scoreRulesAt(store,{unitId:fresh.employee.unitId}),lockedAt:new Date().toISOString(),hrReview:{actorId:actor.id,decision:'approve',at:new Date().toISOString()},events:[...row.events,{state:'locked',by:actor.id,at:new Date().toISOString()}]},row.employeeId);audit(actor,'quarter.locked','quarter-evaluation',id,{quarter:row.quarter});return locked;});
  }
  function listEvaluations(actor){role(actor,['hr']);return store.list('quarter-evaluation');}
  function finalExcel(actor,quarter){
    role(actor,['hr']);quarter=quarterId(quarter);const evaluations=store.list('quarter-evaluation').filter(row=>row.quarter===quarter&&row.status==='locked');if(!evaluations.length)fail('برای این فصل ارزیابی قفل‌شده‌ای وجود ندارد.',409);
    const seenEmployees=new Set();for(const row of evaluations){if(seenEmployees.has(row.employeeId))fail('برای یک فرد در این فصل بیش از یک نتیجهٔ قفل‌شده وجود دارد؛ تا بررسی سابقهٔ تکراری، خروجی نهایی ساخته نمی‌شود.',409);seenEmployees.add(row.employeeId);}
    const xml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const rows=[['شناسه پرسنل','نام','واحد','سمت','فصل','امتیاز عملکرد','KPI دریافتی (تومان)','سقف KPI (تومان)','نسخه فرمول','شناسه ارزیابی','نسخه اصلاحی','اختلاف KPI نسبت به نتیجه اولیه (تومان)'],...evaluations.map(row=>{const official=finalQuarterSnapshot(store,row.employeeId,quarter),snapshot=official.snapshot,person={...row.snapshot?.employee,...snapshot.employee};return [row.employeeId,person.name??'ثبت نشده در سابقه',person.unitName??'ثبت نشده در سابقه',person.jobTitle??person.level??'ثبت نشده در سابقه',quarter,snapshot.calculation?.performance??'',snapshot.quarterPay?.earned??'',snapshot.quarterPay?.ceiling??'',snapshot.quarterPay?.formulaVersion||'',row.id,official.amendmentSequence||0,(snapshot.quarterPay?.earned||0)-(row.lockedSnapshot.quarterPay?.earned||0)];})];
    const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" ${typeof value==='number'?'':'t="inlineStr"'}>${typeof value==='number'?`<v>${value}</v>`:`<is><t>${xml(value)}</t></is>`}</c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
    const files={'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>','_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>','xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Final KPI" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':sheet};
    audit(actor,'quarter.excel-exported','quarter',quarter,{count:evaluations.length});return {filename:`kpi-final-${quarter}.xlsx`,data:zipSync(Object.fromEntries(Object.entries(files).map(([name,content])=>[name,strToU8(content)])))};
  }


  function submitAppeal(actor,input){
    role(actor,['personnel']);const quarter=quarterId(input.quarter);const evaluation=store.list('quarter-evaluation',actor.id).find(row=>row.quarter===quarter&&row.status==='locked');if(!evaluation)fail('برای این فصل نتیجهٔ قفل‌شده پیدا نشد.',404);
    const rules=evaluation.scoreRulesSnapshot||scoreRulesAt(store,{unitId:workflow.user(actor.id).unitId,at:evaluation.lockedAt}),values=rules.values;
    const days=ruleDaysBetween(tehranDate(evaluation.lockedAt),today(),values.appealDayType);if(days>Number(values.quarterAppealDays))fail('مهلت ثبت اعتراض طبق قانون نتیجهٔ قفل‌شده پایان یافته است.',409);
    const previous=store.list('quarter-appeal',actor.id).filter(row=>row.quarter===quarter);if(previous.length>=Number(values.quarterAppealCount))fail('سقف تعداد اعتراض این فصل طبق قانون مؤثر تکمیل شده است.',409);
    if(values.appealRepeat==='closed_only'&&previous.some(row=>!['approved','rejected'].includes(row.status)))fail('ابتدا باید بررسی درخواست قبلی پایان یابد.',409);
    const appeal=store.put('quarter-appeal',{employeeId:actor.id,evaluationId:evaluation.id,scoreRulesSnapshot:rules,quarter,type:input.type==='payroll'?'payroll':'score',reason:text(input.reason,2000),status:'manager_review',createdAt:new Date().toISOString(),events:[{state:'manager_review',by:actor.id,at:new Date().toISOString()}]},actor.id);audit(actor,'quarter.appeal-submitted','quarter-appeal',appeal.id,{quarter,type:appeal.type});return appeal;
  }
  function appealFor(actor,id){
    const appeal=store.get(id,'quarter-appeal');if(!appeal)fail('درخواست اعتراض پیدا نشد.',404);
    if(actor.role==='personnel'&&actor.id===appeal.employeeId||actor.role==='manager'&&workflow.manages(actor,user(appeal.employeeId))||actor.role==='hr')return appeal;
    fail('دسترسی به این درخواست اعتراض مجاز نیست.',403);
  }
  function resubmitAppeal(actor,id,input){
    role(actor,['personnel']);const appeal=appealFor(actor,id);
    if(appeal.employeeId!==actor.id)fail('ارسال مجدد فقط برای صاحب درخواست مجاز است.',403);
    if(appeal.status!=='needs_revision')fail('فقط اعتراض برگشتی قابل ارسال مجدد است.',409);
    const reason=text(input.reason,2000),at=new Date().toISOString();
    // A correction is the same appeal, not a new allowance or a changed locked result.
    const {managerReview,hrReview,...previous}=appeal;
    const updated=store.put('quarter-appeal',{...previous,reason,status:'manager_review',revision:(appeal.revision||0)+1,events:[...(appeal.events||[]),{state:'manager_review',by:actor.id,at,action:'resubmit',previousReason:appeal.reason,previousManagerReview:managerReview||null,previousHrReview:hrReview||null}]},appeal.employeeId);
    audit(actor,'quarter.appeal-resubmitted','quarter-appeal',id,{revision:updated.revision});return updated;
  }
  function canUploadAppealFile(actor,id){
    const appeal=appealFor(actor,id);
    if(actor.role==='personnel'&&['manager_review','needs_revision'].includes(appeal.status)||actor.role==='manager'&&appeal.status==='manager_review')return appeal;
    fail('افزودن مستند در این مرحله مجاز نیست.',403);
  }
  function addAppealFile(actor,id,input){
    const appeal=canUploadAppealFile(actor,id),files=store.list('quarter-appeal-file',appeal.id);
    if(files.length>=5)fail('حداکثر پنج فایل برای هر درخواست قابل ثبت است.',409);
    const name=text(input.name,200),fileId=text(input.id,80),size=Number(input.size),digest=text(input.sha256,64);
    if(!/^[a-f0-9-]{36}$/.test(fileId)||/[/\\\x00-\x1f]/.test(name)||!Number.isSafeInteger(size)||size<1||size>10*1024*1024||!/^[a-f0-9]{64}$/.test(digest))fail('مشخصات فایل معتبر نیست.');
    if(files.some(file=>file.sha256===digest))fail('این فایل قبلاً به درخواست اضافه شده است.',409);
    const saved=store.put('quarter-appeal-file',{id:fileId,appealId:appeal.id,employeeId:appeal.employeeId,managerId:user(appeal.employeeId)?.managerId||null,name,size,sha256:digest,uploadedBy:actor.id,createdAt:new Date().toISOString()},appeal.id);
    audit(actor,'quarter.appeal-file-added','quarter-appeal-file',saved.id,{appealId:appeal.id,employeeId:appeal.employeeId});return saved;
  }
  function appealFile(actor,id,fileId){
    const appeal=appealFor(actor,id),file=store.get(fileId,'quarter-appeal-file');
    if(!file||file.appealId!==appeal.id)fail('فایل درخواست پیدا نشد.',404);
    return file;
  }
  function listAppeals(actor){
    let rows;if(actor.role==='personnel')rows=store.list('quarter-appeal',actor.id);else if(actor.role==='hr')rows=store.list('quarter-appeal');else if(actor.role==='manager')rows=store.list('quarter-appeal').filter(a=>workflow.manages(actor,user(a.employeeId)));else return fail('دسترسی به اعتراض‌ها مجاز نیست.',403);
    return rows.map(appeal=>({...appeal,files:store.list('quarter-appeal-file',appeal.id)}));
  }
  function appealCorrection(actor,id,preview=false){const appeal=appealFor(actor,id);return preview?amendments.preview(actor,appeal):amendments.fields(actor,appeal);}
  function reviewAppeal(actor,id,input){return store.transaction(()=>{
    const appeal=appealFor(actor,id);if(!['approve','return','reject'].includes(input.decision))fail('تصمیم معتبر نیست.');const reason=text(input.reason||'',2000),at=new Date().toISOString();
    if(actor.role==='manager'){
      if(user(appeal.employeeId)?.managerId!==actor.id||appeal.status!=='manager_review')fail('درخواست در صف مدیر مستقیم شما نیست.',403);
      if(input.decision==='approve'&&appeal.scoreRulesSnapshot?.values.appealEvidence==='required'&&!store.list('quarter-appeal-file',appeal.id).length)fail('حداقل یک فایل مستند پیش از تأیید لازم است.',409);
      const proposal=input.decision==='approve'?amendments.propose(actor,appeal,input):null,status=input.decision==='approve'?'hr_review':input.decision==='return'?'needs_revision':'rejected';
      const updated=store.put('quarter-appeal',{...appeal,status,correctionProposal:proposal,managerReview:{actorId:actor.id,decision:input.decision,reason,at},events:[...appeal.events,{state:status,by:actor.id,at}]},appeal.employeeId);audit(actor,'quarter.appeal-manager-review','quarter-appeal',id,{decision:input.decision});return updated;
    }
    role(actor,['hr']);if(appeal.status!=='hr_review')fail('تأیید مدیر لازم است.',409);
    const result=input.decision==='approve'?amendments.approve(actor,appeal,input):null,status=input.decision==='approve'?'approved':input.decision==='return'?'needs_revision':'rejected';
    const updated=store.put('quarter-appeal',{...appeal,status,...(result?{amendment:{id:result.id,sequence:result.sequence}}:{}),hrReview:{actorId:actor.id,decision:input.decision,reason,at},events:[...appeal.events,{state:status,by:actor.id,at}]},appeal.employeeId);audit(actor,'quarter.appeal-hr-review','quarter-appeal',id,{decision:input.decision,amendmentId:result?.id});return updated;
  });}

  const sourceCatalog=actor=>{role(actor,['hr']);return [
    {id:'local-file',type:'file',status:'available',format:'XLSX/CSV/JSON',owner:'منابع انسانی',note:'ورودی این نسخه با اعتبارسنجی و قرنطینهٔ رکورد نامعتبر ذخیره می‌شود.'},
    {id:'hris-api',type:'api',status:'unconfigured',owner:null,note:'نیازمند آدرس، هویت سرویس و مجوز سازمانی.'},
    {id:'database',type:'database',status:'unconfigured',owner:null,note:'نیازمند قرارداد schema، حساب فقط‌خواندنی و شبکه مجاز.'},
    {id:'rpa',type:'rpa',status:'unconfigured',owner:null,note:'فقط در نبود API/DB پایدار و پس از تحلیل ریسک.'}
  ];};
  function listExamImports(actor){role(actor,['hr']);return store.list('exam-import-batch').filter(row=>!row.removedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  function removeExamImport(actor,id){
    role(actor,['hr']);if(typeof id!=='string'||!/^exam-import-[a-f0-9]{24}$/.test(id))fail('شناسهٔ بسته معتبر نیست.');
    const batch=store.get(id,'exam-import-batch');if(!batch)fail('بستهٔ بارگذاری پیدا نشد.',404);if(batch.removedAt)return batch;
    const removed=store.put('exam-import-batch',{...batch,removedAt:new Date().toISOString(),removedBy:actor.id});
    audit(actor,'exam.import-archive-removed','exam-import-batch',id,{quarter:batch.quarter,importedCount:batch.importedCount});return removed;
  }
  function importExamBatch(actor,input){
    role(actor,['hr']);const quarter=quarterId(input.quarter),batchKey=text(input.batchKey,120);if(!Array.isArray(input.rows)||input.rows.length<1||input.rows.length>500)fail('بستهٔ ورود باید ۱ تا ۵۰۰ نتیجه داشته باشد.');
    const source=input.source||'local-csv';if(!['local-csv','local-json','local-xlsx'].includes(source))fail('منبع ورود آزمون معتبر نیست.');
    const fileName=input.fileName==null?null:text(input.fileName,200);if(fileName&&(/[/\\\x00-\x1f]/.test(fileName)||!fileName.toLowerCase().endsWith('.xlsx')))fail('نام فایل اکسل معتبر نیست.');
    const rows=input.rows.map(row=>{const byCode=Object.hasOwn(row||{},'employeeCode'),employeeId=typeof row?.employeeId==='string'?row.employeeId.trim().slice(0,120):'',employeeCode=personnelCode(row?.employeeCode),reference=typeof row?.reference==='string'?row.reference.trim().slice(0,200):'',rawScore=row?.score,parsedScore=typeof rawScore==='number'?rawScore:typeof rawScore==='string'&&rawScore.trim()?Number(rawScore):NaN;return byCode?{employeeCode,reference,score:Number.isFinite(parsedScore)?parsedScore:null}:{employeeId,reference,score:Number.isFinite(parsedScore)?parsedScore:null};});
    const rowKey=row=>'employeeCode'in row?row.employeeCode:row.employeeId,canonicalRows=[...rows].sort((a,b)=>rowKey(a).localeCompare(rowKey(b))||a.reference.localeCompare(b.reference)||(a.score??-1)-(b.score??-1)),payloadHash=hash(JSON.stringify({quarter,source,rows:canonicalRows})),id=`exam-import-${hash(batchKey).slice(0,24)}`,existing=store.get(id,'exam-import-batch');if(existing){if(existing.payloadHash!==payloadHash)fail('شناسه بسته قبلاً با محتوای متفاوت استفاده شده است.',409);return existing;}
    const internalReference=(person,resultScore)=>{
      const previous=store.list('exam-result',person.id).find(result=>result.period===quarter&&result.source==='import'&&result.score===resultScore);
      return previous?.reference||`exam:${quarter}:${person.id}`;
    };
    const validated=[],quarantined=[],seen=new Set();for(const row of rows){try{let person;if('employeeCode'in row){if(!row.employeeCode)fail('کد پرسنلی وارد نشده است.');if(row.employeeCode.length>60)fail('کد پرسنلی بیش از حد مجاز است.');const matches=store.list('workflow-user').filter(value=>value.role==='personnel'&&personnelCode(value.employeeCode)===row.employeeCode);if(matches.length!==1)fail(matches.length?'کد پرسنلی تکراری است؛ اطلاعات پرسنلی را اصلاح کنید.':'کد پرسنلی پیدا نشد.');person=employee(matches[0].id);}else person=employee(row.employeeId);const resultScore=score(row.score),reference=text(row.reference||internalReference(person,resultScore),200);if(seen.has(person.id))fail('در همین بسته برای این فرد نتیجهٔ تکراری وجود دارد.');seen.add(person.id);validated.push({employeeId:person.id,score:resultScore,reference});}catch(error){quarantined.push({...('employeeCode'in row?{employeeCode:row.employeeCode||null}:{employeeId:row.employeeId||null}),reference:row.reference||null,reason:error.publicMessage||'ردیف نامعتبر'});}}
    const imported=[];store.transaction(()=>{for(const row of validated){try{const before=store.list('exam-result',row.employeeId).find(result=>result.period===quarter),saved=workflow.recordExamResult({...row,period:quarter,source:'import'});imported.push(saved);if(!before||before.score!==saved.score||before.reference!==saved.reference)notifications?.publish({eventKey:`exam-import:${id}:${row.employeeId}`,recipientIds:[row.employeeId],actorId:actor.id,kind:'info',title:'نتیجهٔ آزمون ثبت شد',description:'امتیاز آزمون دوره در ارزیابی فصلی قابل مشاهده است.',view:'quarters',entityId:saved.id});}catch(error){quarantined.push({employeeId:row.employeeId,reference:row.reference,reason:error.publicMessage||'رکورد نامعتبر'});}}store.put('exam-import-batch',{id,quarter,batchKey,payloadHash,source,fileName,rowCount:rows.length,importedCount:imported.length,quarantined,status:quarantined.length?(imported.length?'partial':'quarantined'):'complete',createdBy:actor.id,createdAt:new Date().toISOString()});audit(actor,'exam.imported','exam-import-batch',id,{imported:imported.length,quarantined:quarantined.length,quarter});});
    return store.get(id,'exam-import-batch');
  }

  return {approvalDeadlines:approvalSla.list,appealCorrection,importPeerResponses,listPeerImports,positionCloseoutPreview,closeoutHistory,resubmitAppeal,settlementPeople,settlementPreview,registerSettlement,personnelRequests,removeUnit,removeSection,updatePositionDuties,aiCapabilities,jobAnalysisState,analyzeJobPosition,acceptDesignChange,activePosition,positionAt,evaluationModels,listPositions,units,createUnit,sections,createSection,chart,positionProposals,proposePosition,createPerson,revisePosition,reviewPosition,approvePosition,scanDeadlines,taskDeadlines,submitDesign,saveDesignDraft,openDesignCorrectionDraft,saveDesignClarifications,consolidateDesignDrafts,publishDesignDraft,copyDesignToNextMonth,removeDesign,reviseDesign,listDesigns,analyzeDesign,managerReviewDesign,hrReviewDesign,createServiceCampaign,publishServiceCampaign,publishServiceCampaignMonth,removeServiceCampaign,removeServiceCampaignMonth,serviceCampaigns,submitServiceResponse,closeServiceCampaign,quarterResult,quarterProgress,quarterTeam,submitQuarter,approveQuarter,listEvaluations,finalExcel,submitAppeal,listAppeals,reviewAppeal,canUploadAppealFile,addAppealFile,appealFile,sourceCatalog,listExamImports,removeExamImport,importExamBatch,audit};
}

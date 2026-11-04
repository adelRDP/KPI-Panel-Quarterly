import {createHash,randomUUID} from 'node:crypto';
import PerformanceModel from '../src/performance-model.js';
import {amountRulesForPeriod} from './score-rules.mjs';

const currentPeriod=()=>{const parts=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`;};
const quarterOf=period=>{if(!/^(?:13|14)\d{2}-(0[1-9]|1[0-2])$/.test(period||''))fail('دورهٔ ارزیابی معتبر نیست.');const [year,month]=period.split('-').map(Number);return `${year}-Q${Math.ceil(month/3)}`;};

const fail=(message,status=400)=>{const error=new Error(message);error.publicMessage=message;error.status=status;throw error;};
const requireHr=actor=>{if(actor?.role!=='hr')fail('تنظیمات ارزیابی فقط در دسترسی منابع انسانی قابل مدیریت است.',403);};
const quarterNumber=value=>{const match=/^((?:13|14)\d{2})-Q([1-4])$/.exec(value||'');if(!match)fail('فصل شروع اثر معتبر نیست.');return Number(match[1])*4+Number(match[2])-1;};
const currentQuarter=()=>quarterOf(currentPeriod());
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const defaultSurvey={minParticipation:60};
const defaultWeights={exam:15,manager:15,routine:30,project:40,peer:0};
// Read legacy versioned records without using a person's former model classification.
const unifiedWeights=(store,row)=>row?.weights?.exam!==undefined?{...row.weights}:row?.weights?(row.unitId==='services'&&row.weights.services?{exam:0,manager:row.weights.services.manager,routine:0,project:0,peer:row.weights.services.peer}:{...row.weights.general,peer:0}):{...defaultWeights};
const publishedRows=store=>store.list('evaluation-settings').filter(row=>row.status==='published').sort((a,b)=>quarterNumber(a.effectiveQuarter)-quarterNumber(b.effectiveQuarter)||(Number(a.version?.split('-v').at(-1))||0)-(Number(b.version?.split('-v').at(-1))||0));
const publishedFor=(store,quarter,unitId=null)=>{const applicable=publishedRows(store).filter(row=>quarterNumber(row.effectiveQuarter)<=quarterNumber(quarter));return (unitId?applicable.filter(row=>row.unitId===unitId).at(-1):null)||applicable.filter(row=>!row.unitId).at(-1)||null;};

export function policyForPeriod(store,period,modelType,unitId=null){
  // modelType is an ignored compatibility argument; the unit and effective quarter alone select the model.
  const quarter=/^(?:13|14)\d{2}-Q[1-4]$/.test(period)?period:quarterOf(period),published=publishedFor(store,quarter,unitId);
  const fallback=store.get('active-policy','workflow-policy')||PerformanceModel.demoPolicy;
  const amountRules=amountRulesForPeriod(store,period,unitId);
  return {version:published?.version||fallback.version,source:published?'hr-published':fallback.source,unitId:published?.unitId||null,scope:published?.unitId?'unit':'global',name:published?.unitId?`مدل اختصاصی ${store.get(published.unitId,'org-unit')?.name||published.unitId}`:'مدل عمومی سازمان',modelType:'unified',weights:published?unifiedWeights(store,published):{...defaultWeights,...fallback.weights,peer:fallback.weights.peer||0},redistributeProjectWeight:false,calculationVersion:PerformanceModel.calculationVersion,...(amountRules?{amountRules}:{})};
}

export function surveyDefaultsForPeriod(store,period,unitId=null){
  return {...defaultSurvey};
}

function validateDraft(input,store){
  const effectiveQuarter=input?.effectiveQuarter,earliest=currentQuarter(),unitId=input?.unitId||null;
  if(quarterNumber(effectiveQuarter)<quarterNumber(earliest))fail(`تنظیمات فقط از فصل باز ${earliest} یا فصل‌های بعد قابل انتشار است.`);
if(unitId&&(typeof unitId!=='string'||!store.get(unitId,'org-unit')||store.get(unitId,'org-unit').removedAt))fail('واحد سازمانی انتخاب‌شده معتبر نیست.');
  const weights={};for(const id of ['exam','manager','routine','project','peer']){const value=input?.weights?.[id];if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)fail('هر وزن باید عددی بین صفر تا صد باشد.');weights[id]=value;}
  if(Math.abs(Object.values(weights).reduce((sum,value)=>sum+value,0)-100)>0.001)fail('جمع وزن‌های مدل باید ۱۰۰٪ باشد.');
  return {effectiveQuarter,unitId,weights};
}

function sample(policy,scores,hasProjects=true){const result=PerformanceModel.calculate({baseSalary:0,bonusCeiling:0,policy,scores,hasProjects,approvedProjectExemption:!hasProjects});return {score:result.performance,terms:result.components.filter(component=>component.applicable&&component.weight>0).map(({id,name,score,weight})=>({id,name,score,weight}))};}

export function createEvaluationSettings(store){
  const atQuarter=(quarter,unitId=null)=>({effectiveQuarter:quarter,unitId,weights:policyForPeriod(store,quarter,null,unitId).weights});
  const active=()=>atQuarter(currentQuarter());
  const drafts=()=>store.list('evaluation-settings').filter(row=>row.status==='draft').sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  const normalizedDraft=row=>row.weights.exam===undefined?{...row,weights:unifiedWeights(store,row,row.unitId),previewHash:null,migratedLegacyDraft:true}:row;
  const chosenDraft=id=>id?store.get(id,'evaluation-settings'):drafts()[0];
  const state=actor=>{requireHr(actor);const quarter=currentQuarter(),activeDrafts=drafts().map(normalizedDraft);return {current:active(),currentByUnit:Object.fromEntries(store.list('org-unit').filter(unit=>!unit.removedAt).map(unit=>[unit.id,atQuarter(quarter,unit.id)])),defaults:{global:{...defaultWeights},byUnit:Object.fromEntries(store.list('org-unit').filter(unit=>!unit.removedAt).map(unit=>[unit.id,{...defaultWeights}]))},earliestQuarter:quarter,draft:activeDrafts[0]||null,drafts:activeDrafts,published:publishedRows(store).map(row=>({...row,weights:unifiedWeights(store,row)}))};};
  const saveDraft=(actor,input)=>{requireHr(actor);const values=validateDraft(input,store),existing=drafts().find(row=>row.effectiveQuarter===values.effectiveQuarter&&(row.unitId||null)===values.unitId),row=store.put('evaluation-settings',{id:existing?.id||`evaluation-draft-${randomUUID()}`,status:'draft',...values,previewHash:null,createdAt:existing?.createdAt||new Date().toISOString(),updatedBy:actor.id,updatedAt:new Date().toISOString()});store.put('audit-event',{actorId:actor.id,action:'evaluation-settings.draft-saved',entityType:'evaluation-settings',entityId:row.id,details:{effectiveQuarter:row.effectiveQuarter,unitId:row.unitId},createdAt:new Date().toISOString()});return row;};
  const preview=(actor,id)=>{requireHr(actor);const stored=chosenDraft(id),draft=stored?.status==='draft'?normalizedDraft(stored):stored;if(draft?.status!=='draft')fail('ابتدا پیش‌نویس را ذخیره کنید.',409);validateDraft(draft,store);
    const compare=values=>{const policy={modelType:'unified',weights:values.weights,redistributeProjectWeight:false},withProject=sample(policy,{exam:80,manager:90,routine:85,project:75,peer:82}),withoutProject=sample(policy,{exam:80,manager:90,routine:85,project:0,peer:82},false);return {score:withProject.score,withoutProject:withoutProject.score,terms:{score:withProject.terms,withoutProject:withoutProject.terms},weights:{...values.weights}};};
    const existing=publishedFor(store,draft.effectiveQuarter,draft.unitId),result={sampleScores:{exam:80,manager:90,routine:85,project:75,peer:82},current:compare(atQuarter(draft.effectiveQuarter,draft.unitId)),draft:compare(draft),currentSource:{version:existing?.version||null,scope:existing?.unitId?'unit':existing?'global':'default'},effectiveQuarter:draft.effectiveQuarter,unitId:draft.unitId};const previewHash=digest({effectiveQuarter:draft.effectiveQuarter,unitId:draft.unitId,weights:draft.weights});
    store.put('evaluation-settings',{...draft,previewHash,previewedAt:new Date().toISOString()});return result;
  };
  const publish=(actor,id)=>{requireHr(actor);const stored=chosenDraft(id),draft=stored?.status==='draft'?normalizedDraft(stored):stored;if(draft?.status!=='draft')fail('پیش‌نویس پیدا نشد.',409);validateDraft(draft,store);
    if(draft.effectiveQuarter!==currentQuarter()&&publishedRows(store).some(row=>row.effectiveQuarter===draft.effectiveQuarter&&(row.unitId||null)===draft.unitId))fail('برای این واحد و فصل آینده قبلاً نسخه‌ای منتشر شده است؛ فصل دیگری انتخاب کنید.',409);
    return store.transaction(()=>{const lastVersion=Math.max(0,...store.list('evaluation-settings').map(row=>Number(/^evaluation-policy-v(\d+)$/.exec(row.version||row.id)?.[1]||0))),version=`evaluation-policy-v${lastVersion+1}`,row=store.put('evaluation-settings',{id:version,version,status:'published',effectiveQuarter:draft.effectiveQuarter,unitId:draft.unitId,weights:draft.weights,createdBy:actor.id,createdAt:new Date().toISOString()});store.put('audit-event',{actorId:actor.id,action:'evaluation-settings.published',entityType:'evaluation-settings',entityId:row.id,details:{effectiveQuarter:row.effectiveQuarter,unitId:row.unitId,version},createdAt:new Date().toISOString()});store.put('evaluation-settings',{...draft,status:'archived-draft',previewHash:null,publishedVersion:version});return row;});
  };
  const deleteDraft=(actor,id)=>{requireHr(actor);const draft=chosenDraft(id);if(draft?.status!=='draft')fail('پیش‌نویسی برای حذف وجود ندارد.',409);return store.transaction(()=>{const removed=store.put('evaluation-settings',{...draft,status:'discarded',previewHash:null,discardedBy:actor.id,discardedAt:new Date().toISOString()});store.put('audit-event',{actorId:actor.id,action:'evaluation-settings.draft-deleted',entityType:'evaluation-settings',entityId:draft.id,details:{effectiveQuarter:draft.effectiveQuarter,unitId:draft.unitId},createdAt:new Date().toISOString()});return {deleted:true,id:removed.id};});};
  const deletePublished=(actor,id)=>{
    requireHr(actor);if(typeof id!=='string'||!/^evaluation-policy-v\d+$/.test(id))fail('شناسهٔ نسخهٔ منتشرشده معتبر نیست.');
    const row=store.get(id,'evaluation-settings');if(!row)fail('نسخهٔ منتشرشده پیدا نشد.',404);
    if(row.status==='withdrawn')return {deleted:true,id:row.id,unitId:row.unitId||null,effectiveQuarter:row.effectiveQuarter};
    if(row.status!=='published')fail('فقط نسخهٔ منتشرشده قابل حذف است.',409);
    return store.transaction(()=>{store.put('evaluation-settings',{...row,status:'withdrawn',deletedBy:actor.id,deletedAt:new Date().toISOString()});store.put('audit-event',{actorId:actor.id,action:'evaluation-settings.published-deleted',entityType:'evaluation-settings',entityId:row.id,details:{version:row.version,effectiveQuarter:row.effectiveQuarter,unitId:row.unitId||null},createdAt:new Date().toISOString()});return {deleted:true,id:row.id,unitId:row.unitId||null,effectiveQuarter:row.effectiveQuarter};});
  };
  return {state,saveDraft,preview,publish,deleteDraft,deletePublished};
}

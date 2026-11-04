import {createHash} from 'node:crypto';

const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
export const stabilityHash=value=>createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
export const stabilityVersion='alignment-stability-v1';
export const maxCorrectionRounds=4;
const digits=value=>String(value).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632));
const persian=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'});
const dateCache=new Map();
export function normalizedDate(value){
  const text=digits(value),match=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);if(!match)return null;
  const [year,month,day]=match.slice(1).map(Number);if(month<1||month>12||day<1||day>31)return null;
  if(year>=1700){const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;return !Number.isNaN(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:null;}
  if(year<1300||year>1600)return null;const key=`${year}/${month}/${day}`;if(dateCache.has(key))return dateCache.get(key);
  const start=Date.UTC(year+621,2,15),target=[year,month,day];let result=null;
  for(let offset=0;offset<380;offset++){const date=new Date(start+offset*86400000),parts=persian.formatToParts(date),actual=['year','month','day'].map(type=>Number(parts.find(p=>p.type===type).value));if(actual.every((v,i)=>v===target[i])){result=date.toISOString().slice(0,10);break;}}
  dateCache.set(key,result);return result;
}
export function normalizedCriteria(criteria){
  const values=criteria.map(value=>value.trim());
  // A pasted quotation surrounding the entire multi-line list is presentation, not a new requirement.
  if(values.length&&values[0].startsWith('"')&&values.at(-1).endsWith('"')){values[0]=values[0].slice(1);values[values.length-1]=values.at(-1).slice(0,-1);}
  return values;
}
export function taskFacts(task){
  const dates=[];for(const [field,value] of Object.entries(task)){const text=digits(typeof value==='string'?value:JSON.stringify(value));for(const match of text.matchAll(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g)){const iso=normalizedDate(match[0]);if(iso)dates.push({field,text:match[0],iso});}}
  return {proposalId:task.id,criteriaAreSeparateStrings:Array.isArray(task.criteria),dates};
}
export function applyStoredChanges(tasks,reviews){
  return tasks.map(task=>{const next=structuredClone(task);for(const change of reviews.find(row=>row.proposalId===task.id)?.changes||[])next[change.field]=change.field==='timeLimit'?Object.fromEntries(Object.entries(change.proposedValue).filter(([,value])=>value!==null)):structuredClone(change.proposedValue);return next;});
}
export function revisionChain(store,design){
  const chain=[],seen=new Set([design.id]);let id=design.revises;
  while(id&&chain.length<30){if(seen.has(id))break;seen.add(id);const row=store.get(id,'kpi-design');if(!row||row.removedAt||row.employeeId!==design.employeeId||row.period!==design.period||row.managerId!==design.managerId)break;chain.push(row);id=row.revises;}
  return chain;
}
export function priorContext(store,design,tasks,contextHash,provider,model,isCurrentRun){
  const chain=revisionChain(store,design),locks=[],history=[];
  for(const task of tasks){
    // Only inspect the uninterrupted history of this exact task under the same job/model/policy.
    for(const previous of chain){
      const run=store.get(previous.aiReview?.runId,'ai-role-run'),oldTask=run?.inputs?.stagePayload?.proposals?.find(row=>row.id===task.id);
      if(!run||!isCurrentRun(run)||run.provider!==provider||run.model!==model||run.inputs.stagePayload.stabilityContextHash!==contextHash||!oldTask)break;
      if(stabilityHash(oldTask)!==stabilityHash(task)){
        // An explicitly accepted patch can inherit the independently verified retain result,
        // but only when the complete tested plan and its context are exactly unchanged.
        const original=previous.aiReview.result.reviews.find(row=>row.proposalId===task.id),quality=store.get(original?.correctionValidation?.runId,'ai-role-run');
        const accepted=(design.acceptedSuggestions||[]).some(row=>row.analysisRunId===run.id&&row.proposalId===task.id);
        const verified=accepted&&original?.correctionValidation?.status==='verified'&&isCurrentRun(quality)&&quality.stage==='kpi-correction-validation-v1'&&quality.provider===provider&&quality.model===model&&quality.inputs.stagePayload.stabilityContextHash===contextHash&&stabilityHash(quality.inputs.stagePayload.proposals)===stabilityHash(tasks)&&original.correctionValidation.testedPlanHash===stabilityHash(tasks);
        const review=verified&&quality.result.reviews.find(row=>row.proposalId===task.id);
        if(review?.recommendation==='retain'&&!review.missingInformation.length&&review.checks.every(check=>check.status==='pass'||check.severity==='advisory'))locks.push({proposalId:task.id,sourceRunId:quality.id,taskHash:stabilityHash(task),review:structuredClone(review)});
        break;
      }
      const review=previous.aiReview.result.reviews.find(row=>row.proposalId===task.id);
      if(review?.recommendation==='retain'&&!review.missingInformation.length&&review.checks.every(check=>check.status==='pass'||check.severity==='advisory')){locks.push({proposalId:task.id,sourceRunId:review.lock?.sourceRunId||run.id,taskHash:stabilityHash(task),review:structuredClone(review)});break;}
    }
  }
  for(const previous of chain.slice(0,3)){
    const run=store.get(previous.aiReview?.runId,'ai-role-run');if(!run||run.status!=='succeeded'||run.validationStatus!=='valid')continue;
    history.push({designVersion:previous.version,runId:run.id,changes:(previous.acceptedSuggestions||[]).map(({proposalId,field,oldValue,proposedValue,reason})=>({proposalId,field,oldValue,proposedValue,reason})),reviews:(previous.aiReview.result.reviews||[]).map(row=>({proposalId:row.proposalId,recommendation:row.recommendation,checks:row.checks.filter(check=>check.status!=='pass').map(({type,ruleId,severity,reason,status})=>({type,ruleId,severity,reason,status})),changes:row.changes.map(({field,proposedValue,reason})=>({field,proposedValue,reason})),missingInformation:row.missingInformation}))});
  }
  const corrections=(design.acceptedSuggestions||[]).map(({proposalId,field,oldValue,proposedValue,reason})=>({proposalId,field,oldValue,proposedValue,reason}));
  const rounds=chain.filter(row=>{const run=store.get(row.aiReview?.runId,'ai-role-run');return row.aiReview?.result?.blockers?.length&&run?.status==='succeeded'&&run.validationStatus==='valid'&&run.provider===provider&&run.model===model&&run.inputs?.stagePayload?.stabilityContextHash===contextHash;}).length;
  return {locks,history,corrections,rounds};
}
export function normalizeStaticJudgments(result){
  for(const review of result.reviews){
    let normalized=review.checks.some(check=>check.status!=='pass'&&check.severity==='advisory');
    for(const check of review.checks){
      if(check.ruleId!=='date_consistency'||check.status==='pass')continue;
      const dates=check.citations.flatMap(ref=>[...digits(ref.quote).matchAll(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g)].map(match=>({text:match[0],iso:normalizedDate(match[0])})));
      if(dates.length>=2&&dates.every(date=>date.iso)&&new Set(dates.map(date=>date.iso)).size===1&&new Set(dates.map(date=>date.text)).size>1){check.status='pass';check.severity='none';check.reason='تبدیل قطعی تقویم در برنامه: تاریخ‌های ذکرشده یک روز هستند و تعارض ندارند.';normalized=true;}
    }
    if(normalized&&review.checks.every(check=>check.status==='pass'||check.severity==='advisory')&&!review.missingInformation.length){review.recommendation='retain';review.changes=[];}
  }
  return result;
}
export function restoreLockedReviews(result,locks,manifest){
  for(const lock of locks){
    const rebind=refs=>(refs||[]).map(ref=>{const source=manifest.find(source=>source.sourceId===ref.sourceId),segment=source?.segments.find(segment=>segment.segmentId===ref.segmentId);if(!segment||!segment.text.includes(ref.quote))throw new Error('شاهد قفل‌شده تغییر کرده است.');return {...ref,sourceVersion:source.sourceVersion};});
    const old=structuredClone(lock.review);delete old.findings;delete old.correctionValidation;delete old.lock;
    const review={...old,citations:rebind(old.citations),checks:old.checks.map(check=>({...check,citations:rebind(check.citations)})),changes:[]};
    result.reviews=result.reviews.filter(row=>row.proposalId!==lock.proposalId);result.reviews.push(review);
  }
  return result;
}
export function findingsFor(result,previous=[]){
  const findings=[];for(const review of result.reviews)for(const check of review.checks.filter(check=>check.status!=='pass'))findings.push({id:stabilityHash({proposalId:review.proposalId,axis:check.type,rule:check.ruleId||check.type}).slice(0,20),proposalId:review.proposalId,axis:check.type,severity:check.severity|| (check.status==='unknown'?'information':'blocking'),reason:check.reason,status:'open'});
  const old=previous.flatMap(item=>item.reviews.flatMap(review=>review.checks.map(check=>({id:stabilityHash({proposalId:review.proposalId,axis:check.type,rule:check.ruleId||check.type}).slice(0,20),proposalId:review.proposalId,axis:check.type,reason:check.reason}))));
  const seen=new Set(findings.map(item=>item.id));for(const item of old)if(!seen.has(item.id)){findings.push({...item,status:'resolved',severity:'none'});seen.add(item.id);}
  return findings;
}

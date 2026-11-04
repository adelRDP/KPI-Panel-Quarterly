import {createHash} from 'node:crypto';

const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,publicMessage:message});};
const material=['id','category','title','description','criteria','frequency','targetVolume','targetUnit','timeLimit','deadline','dueDate','documentFormat','deliverable','milestones','weightPoints','evidenceTypes'];
export const clarificationContractVersion='manager-clarifications-v1';
export const clarificationTaskHash=task=>hash(Object.fromEntries(material.filter(k=>task[k]!==undefined).map(k=>[k,task[k]])));
export const clarificationContextHash=(design,position,policy)=>hash({employeeId:design.employeeId,managerId:design.managerId,period:design.period,positionId:position?.id||design.positionId,positionVersion:position?.version||design.positionVersion,duties:position?.duties||'',jobTitle:position?.jobTitle,jobLevel:position?.jobLevel,unitId:position?.unitId,jobFamily:position?.jobFamily,positionManagerId:position?.managerId,effectiveFrom:position?.effectiveFrom,effectiveTo:position?.effectiveTo||null,isKpiEligible:position?.isKpiEligible,policyVersion:policy?.version||design.policyVersion,weights:policy?.weights});
export const sameClarificationQuestion=(a,b)=>a.trim().normalize('NFKC').replace(/\s+/g,' ')===b.trim().normalize('NFKC').replace(/\s+/g,' ');

export function clarificationTasks(design,contextHash,{includeMissing=true}={}){
  const tasks=(design.tasks||[]).map(task=>{
    const rows=structuredClone(task.clarifications||[]);
    if(includeMissing&&design.aiReview?.contractVersion==='kpi-alignment-v4'){
      const review=design.aiReview.result?.reviews?.find(r=>r.proposalId===task.id);
      for(const question of review?.missingInformation||[]){
        if(rows.some(r=>sameClarificationQuestion(r.question,question)))continue;
        rows.push({id:'q-'+hash({runId:design.aiReview.runId,proposalId:task.id,question}).slice(0,28),question,sourceDesignId:design.id,sourceRunId:design.aiReview.runId,sourceDesignVersion:design.version,answer:'',confirmedTaskHash:null,confirmedContextHash:null});
      }
      // Ground a response field in the stored finding when the model omitted a question.
      // One combined field per proposal keeps the existing 80-question limit bounded.
      const unresolved=review?.checks?.filter(c=>c.status!=='pass'&&c.severity!=='advisory')||[];
      if(!review?.missingInformation?.length&&unresolved.length){
        const axes={relevance:'ارتباط با شغل',control:'کنترل‌پذیری',definition:'تعریف شاخص',target:'هدف',measurability:'سنجش‌پذیری',overlap:'هم‌پوشانی',gaming:'رفتار ناخواسته'},id='q-'+hash({runId:design.aiReview.runId,proposalId:task.id,findings:unresolved.map(({type,status,reason})=>({type,status,reason}))}).slice(0,28);
        if(!rows.some(r=>r.id===id))rows.push({id,question:'برای رفع ایرادهای ثبت‌شده، توضیح و اطلاعات کاری مرتبط را تکمیل کنید: '+unresolved.map(c=>(axes[c.type]||c.type)+' — '+c.reason.slice(0,120)).join('؛ '),sourceDesignId:design.id,sourceRunId:design.aiReview.runId,sourceDesignVersion:design.version,origin:'analysis-findings',answer:'',confirmedTaskHash:null,confirmedContextHash:null});
      }
    }
    if(!rows.length)return {...task};
    const taskHash=clarificationTaskHash(task);
    return {...task,clarifications:rows.map(r=>({...r,needsReconfirmation:!!r.answer&&(r.confirmedTaskHash!==taskHash||r.confirmedContextHash!==contextHash)}))};
  });
  return tasks;
}

export function normalizeClarifications(tasks,inputTasks,source,contextHash,actorId){
  const known=source?new Map(clarificationTasks(source,contextHash).map(t=>[t.id,t])):new Map();
  const normalized=tasks.map(task=>{
    const previous=known.get(task.id),rows=previous?.clarifications||[],input=inputTasks.find((t,i)=>(t.id||`T${i+1}`)===task.id)||{},answers=input.clarifications;
    if(answers!==undefined&&(!Array.isArray(answers)||answers.length>80))fail('پاسخ‌های ابهام معتبر نیستند.');
    const seen=new Set();for(const item of answers||[]){
      if(!item||typeof item.id!=='string'||seen.has(item.id)||!rows.some(r=>r.id===item.id))fail('پاسخ باید به سؤال واقعی همین شاخص و نسخه متصل باشد.');seen.add(item.id);
      if(typeof item.answer!=='string'||item.answer.length>2000)fail('هر پاسخ باید متن حداکثر ۲۰۰۰ کاراکتری باشد.');
      if(item.reconfirmed!==undefined&&typeof item.reconfirmed!=='boolean')fail('تأیید بازبینی پاسخ معتبر نیست.');
    }
    if(!rows.length||answers===undefined&&!source?.tasks.find(t=>t.id===task.id)?.clarifications?.length)return task;
    const taskHash=clarificationTaskHash(task),at=new Date().toISOString();
    return {...task,clarifications:rows.map(row=>{
      const requested=answers?.find(r=>r.id===row.id),answer=requested?requested.answer.trim():row.answer;
      const stale=!!row.answer&&(row.confirmedTaskHash!==taskHash||row.confirmedContextHash!==contextHash);
      const confirmed=!!answer&&(!stale||requested?.reconfirmed===true);
      return {...row,answer,confirmedTaskHash:confirmed?taskHash:answer?row.confirmedTaskHash:null,confirmedContextHash:confirmed?contextHash:answer?row.confirmedContextHash:null,needsReconfirmation:!!answer&&!confirmed,...(requested&&(answer!==row.answer||requested.reconfirmed===true)?{answeredBy:actorId,answeredAt:at}:{})};
    })};
  });
  if(normalized.reduce((n,t)=>n+(t.clarifications?.length||0),0)>80)fail('بیش از ۸۰ پرسش برای بررسی هم‌زمان ثبت شده؛ دامنهٔ طرح را بازبینی کنید.',413);
  return normalized;
}

// Personal identity/provenance stays in the audit record, never in the prompt.
export const safeClarifications=task=>(task.clarifications||[]).map(r=>({id:r.id,question:r.question,answer:r.needsReconfirmation?'':r.answer||'',needsReconfirmation:!!r.needsReconfirmation}));
export function clarificationManifest(tasks,version){
  return tasks.filter(t=>t.clarifications?.length).map(t=>({sourceId:'clarification-'+t.id,sourceVersion:String(version),segments:safeClarifications(t).flatMap(r=>[{segmentId:r.id+'-question',text:r.question},...(!r.needsReconfirmation&&r.answer?[{segmentId:r.id+'-answer',text:r.answer}]:[])])}));
}

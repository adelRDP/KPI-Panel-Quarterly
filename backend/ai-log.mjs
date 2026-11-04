// HR-only projections and display-only archive metadata. Never mutate source results
// or return raw records, prompts, credentials or filesystem paths.
import {sha256} from './evaluation.mjs';
const fail=(message,status=400)=>{const error=new Error(message);error.publicMessage=message;error.status=status;throw error;};
const fields=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
const limited=(value,max=6000)=>typeof value==='string'?value.slice(0,max):'';
const analysisFailure=run=>/^(تحلیل شرح وظایف|تطبیق شاخص‌ها) ناموفق: /.test(run?.error||'')?limited(run.error,700):'تحلیل کامل نشد؛ نتیجهٔ معتبر ثبت نشده است.';
const usage=value=>Object.fromEntries(Object.entries(value||{}).filter(([key,n])=>/token|input|output|total|cached|reasoning/i.test(key)&&Number.isFinite(n)));
const task=value=>fields(value,['id','category','title','description','criteria','weight','weightPoints','weightVersion','frequency','targetVolume','targetUnit','timeLimit','documentFormat','documentFormatVersion','deliverable','milestones','deadline','dueDate','responsible','evidenceTypes']);
const alignment=value=>value?.reviews?{summary:limited(value.summary),reviews:value.reviews,coverage:value.coverage,candidates:value.candidates,blockers:value.blockers,...fields(value,['findings','planConflicts','correctionRound','humanReviewRequired','qualityRunId'])}:value?{summary:limited(value.summary),tasks:(value.tasks||[]).map(row=>fields(row,['taskId','matches','confidence','issues','reason','suggestion']))}:null;
const decision=value=>value?{...fields(value,['decision','qualityScore','finalForActivity','policyVersion','coverage','fileProcessing']),summary:limited(value.summary),criteria:(value.criteria||[]).map(row=>({...fields(row,['id','status','score']),reason:limited(row.reason),citations:(row.citations||[]).map(c=>({chunkId:limited(c.chunkId,200),quote:limited(c.quote)}))}))}:null;
const evidence=value=>{
  let characters=0;const chunks=[];
  for(const row of value||[]){if(chunks.length>=40||characters>=24000)break;const text=limited(row.text,24000-characters);characters+=text.length;chunks.push({...fields(row,['id','documentId','label']),text});}
  return {chunks,totalChunks:(value||[]).length,truncated:chunks.length!==(value||[]).length||(value||[]).some((row,i)=>chunks[i]&&chunks[i].text.length<(row.text?.length||0))};
};
const types={job_analysis:'تحلیل شرح وظایف',design:'تطبیق طرح شاخص',review:'ارزیابی فعالیت و مستندات',preprocess:'پیش‌پردازش دیداری',proposal:'پیشنهاد قدیمی · هارنس'};
const states={queued:'در انتظار AI',running:'در حال بررسی AI',waiting_human:'در انتظار تأیید انسانی',done:'بررسی تکمیل‌شده',failed:'بررسی ناموفق',blocked:'نیازمند اتصال یا تبدیل',needs_revision:'نیازمند اصلاح',rejected:'ردشده'};
const logRevision=row=>sha256(JSON.stringify({id:row.id,state:row.state,updatedAt:row.updatedAt,resultSummary:row.resultSummary,runId:row.record.aiReview?.runId,documents:row.pendingDocuments?.map(doc=>[doc.id,doc.sha256,sha256(JSON.stringify(doc.extraction))])}));
const statusTone=row=>['failed','rejected'].includes(row.state)?'error':row.state!=='done'?'pending':row.type==='design'&&row.record.status==='published'||row.type==='proposal'&&row.record.status==='approved'||row.type==='review'&&row.record.result?.decision==='completed'&&row.record.result?.finalForActivity===true?'approved':'neutral';
const resultText=value=>value?.summary||({completed:'خروجی فعالیت تأیید شده است.',needs_revision:'خروجی فعالیت نیازمند اصلاح است.',insufficient:'شواهد برای نتیجهٔ قطعی کافی نیست.'}[value?.decision])||'هنوز نتیجهٔ AI ثبت نشده است.';

export function createAiLog(store,workflow){
  const requireHr=actor=>{if(actor?.role!=='hr')fail('لاگ هوش مصنوعی فقط برای ادمین منابع انسانی قابل مشاهده است.',403);};
  const owner=(id,period)=>{if(typeof id!=='string'||!id)return {id:null,name:'مالک نامشخص در سابقه'};const person=/^14\d{2}-Q[1-4]$/.test(period||'')?workflow.userAt(id,period):workflow.user(id);return person?fields(person,['id','name','employeeCode','unitId','unitName']):{id,name:'پرسنل ثبت‌شده در سابقه'};};
  const events=rows=>(rows||[]).map(row=>({...fields(row,['state','status','at','reason','reference']),actor:row.by||row.actorId?owner(row.by||row.actorId):null}));
  function collect(){
    const rows=[],attempts=store.list('ai-design-attempt'),reviews=store.list('review'),preprocessRuns=store.list('ai-preprocess-attempt'),activities=new Map(store.list('activity').map(row=>[row.id,row])),documentActivities=new Map(),activityDocuments=new Map();
    for(const run of store.list('ai-role-run').filter(row=>row.stage==='job-analysis-v1')){
      const position=store.get(run.positionId,'position-assignment'),state=run.status==='succeeded'?(run.validationStatus==='valid'?'done':'blocked'):run.status==='failed'?'failed':run.status==='running'?'running':'queued';
      rows.push({id:'job_analysis:'+run.id,type:'job_analysis',sourceId:run.id,title:'تحلیل شرح وظایف · '+(position?.jobTitle||'سمت'),period:null,employee:owner(run.employeeId),unitId:position?.unitId,state,stage:run.validationStatus==='stale'?'نتیجه قدیمی · قابل استفاده نیست':'تحلیل مستقل شرح وظایف',provider:run.provider,model:run.model,createdAt:run.startedAt,updatedAt:run.finishedAt||run.startedAt,resultSummary:limited(run.result?.summary)||'هنوز نتیجهٔ معتبر ثبت نشده است.',record:run});
    }
    for(const activity of activities.values()){const documents=store.list('document',activity.id);activityDocuments.set(activity.id,documents);for(const document of documents)documentActivities.set(document.id,activity);}
    for(const design of store.list('kpi-design')){
      if(design.status==='draft')continue;
      const runs=attempts.filter(row=>row.designId===design.id),running=runs.find(row=>row.status==='running');
      const state=running?'running':({ai_pending:'queued',ai_failed:'failed',manager_review:'waiting_human',hr_review:'waiting_human',published:'done',needs_revision:'needs_revision',rejected:'rejected'}[design.status]||'queued');
      const stage=running?'تحلیل طرح با AI':({ai_pending:'در انتظار تحلیل AI',ai_failed:'تحلیل AI کامل نشده',manager_review:'تأیید مدیر پس از AI',hr_review:'تصویب HR پس از مدیر و AI',published:'منتشرشده پس از تأیید انسانی',needs_revision:'اصلاح طرح',rejected:'رد در بازبینی انسانی'}[design.status]||design.status);
      rows.push({id:'design:'+design.id,type:'design',sourceId:design.id,title:`طرح شاخص · نسخه ${design.version||1}`,period:design.period,employee:owner(design.employeeId,design.period),unitId:design.unitId,state,stage:design.removedAt?'بایگانی‌شده · '+stage:stage,provider:running?.provider||design.aiReview?.provider||null,model:running?.model||design.aiReview?.model||null,createdAt:design.createdAt,updatedAt:running?.startedAt||design.events?.at(-1)?.at||design.aiReview?.createdAt||design.createdAt,resultSummary:limited(design.aiReview?.result?.summary)|| (state==='failed'?'تحلیل ناموفق؛ نتیجهٔ معتبر ثبت نشده است.':'هنوز نتیجهٔ AI ثبت نشده است.'),record:design,runs});
    }
    for(const activity of activities.values()){
      if(activity.removedAt)continue;
      const documents=(activityDocuments.get(activity.id)||[]).filter(document=>!document.archivedAt);if(!documents.length)continue;
      const matching=reviews.some(review=>review.activitySnapshot?.id===activity.id&&review.documentHashes?.length===documents.length&&documents.every(document=>review.documentHashes.some(hash=>hash.id===document.id&&hash.sha256===document.sha256&&hash.extractionHash===sha256(JSON.stringify(document.extraction)))));
      if(matching)continue;
      const state=documents.some(document=>document.extraction?.chunks?.length)?'queued':'blocked';
      rows.push({id:'activity:'+activity.id,type:'review',sourceId:activity.id,title:activity.title,period:activity.period,employee:owner(activity.ownerId,activity.period),unitId:activity.unitId,state,stage:state==='queued'?'شواهد فعلی منتظر ارزیابی؛ درخواست اجرا ثبت نشده':'منتظر تولید شاهد قابل ارزیابی',provider:null,model:null,createdAt:activity.createdAt,updatedAt:documents[0].createdAt||activity.createdAt,resultSummary:'برای شواهد فعلی نتیجهٔ AI ثبت نشده است؛ نمایش این ردیف به معنی اجرای خودکار نیست.',record:activity,pendingDocuments:documents});
    }
    for(const review of reviews){
      const activity=review.activitySnapshot||activities.get(review.activityId)||{};
      rows.push({id:'review:'+review.id,type:'review',sourceId:review.id,title:activity.title||'ارزیابی فعالیت',period:activity.period,employee:owner(activity.ownerId,activity.period),unitId:activity.unitId,state:review.status==='queued'?'queued':review.status==='running'?'running':review.status==='failed'?'failed':'done',stage:review.status==='queued'?'ثبت در صف بررسی خودکار':review.status==='running'?'ارزیابی شواهد با AI':review.status==='failed'?'ارزیابی کامل نشده':'نتیجهٔ ارزیابی ثبت شده',provider:review.provider,model:review.model,createdAt:review.startedAt||review.createdAt,updatedAt:review.finishedAt||review.startedAt||review.createdAt,resultSummary:review.status==='queued'?'درخواست بررسی ثبت شده و منتظر اجرای مدل است.':review.status==='failed'?'ارزیابی کامل نشد؛ نتیجهٔ نهایی ثبت نشد.':limited(resultText(review.result)),record:review});
    }
    for(const document of store.list('document')){
      if(preprocessRuns.some(run=>run.documentId===document.id))continue;
      const extraction=document.extraction||{},conversion=extraction.conversion;
      if(!conversion&&!extraction.conversionFailed&&extraction.status!=='needs_conversion')continue;
      const activity=activities.get(document.activityId)||documentActivities.get(document.id)||{};
      const state=conversion?.status==='disabled'||extraction.status==='needs_conversion'?'blocked':extraction.conversionFailed||extraction.status==='failed'?'failed':'done';
      rows.push({id:'preprocess:'+document.id,type:'preprocess',sourceId:document.id,title:document.name,period:activity.period,employee:owner(activity.ownerId),unitId:activity.unitId,state,stage:state==='blocked'?'خوانش دیداری غیرفعال یا نیازمند تبدیل':state==='failed'?'تبدیل دیداری ناموفق':'خوانش دیداری ثبت شده',provider:conversion?.provider||null,model:conversion?.model||null,createdAt:document.createdAt,updatedAt:conversion?.finishedAt||document.createdAt,resultSummary:state==='done'?'خوانش ماشینی انجام شده؛ این نتیجه تأیید نهایی فعالیت نیست.':state==='blocked'?'هنوز شاهد دیداری قابل ارزیابی تولید نشده است.':'تبدیل کامل نشد؛ فایل و اتصال پیش‌پردازش نیازمند بررسی هستند.',record:document,activity});
    }
    for(const run of preprocessRuns){
      if(run.stage!=='visual_transcribe'&&!run.extraction?.conversion&&run.status!=='failed'&&run.status!=='blocked')continue;
      const activity=run.activitySnapshot||{},conversion=run.extraction?.conversion||{},state=run.status;
      rows.push({id:'preprocess-run:'+run.id,type:'preprocess',sourceId:run.id,title:run.document?.name||'خوانش فایل',period:activity.period,employee:owner(activity.ownerId),unitId:activity.unitId,state,stage:state==='running'?'خوانش دیداری با AI':state==='blocked'?'خوانش دیداری غیرفعال یا نیازمند تبدیل':state==='failed'?'پیش‌پردازش کامل نشده':'خوانش دیداری ثبت شده',provider:conversion.provider||run.provider||null,model:conversion.model||null,createdAt:run.startedAt,updatedAt:run.finishedAt||run.startedAt,resultSummary:state==='done'?'خوانش ماشینی ثبت شده؛ این مرحله تأیید نهایی فعالیت نیست.':state==='running'?'خوانش فایل در حال اجرا است.':'هنوز شاهد دیداری قابل ارزیابی تولید نشده است.',record:{...run.document,extraction:run.extraction||{status:state,chunks:[],warnings:[]}},activity,run});
    }
    for(const proposal of store.list('kpi-proposal'))rows.push({id:'proposal:'+proposal.id,type:'proposal',sourceId:proposal.id,title:proposal.title,period:proposal.period,employee:owner(proposal.employeeId),unitId:proposal.unitId,state:proposal.status==='pending'?'blocked':proposal.status==='rejected'?'rejected':proposal.status==='needs_revision'?'needs_revision':'done',stage:proposal.status==='pending'?'در انتظار هارنس قدیمی؛ اتصال AI ثبت نشده':'نتیجهٔ هارنس قدیمی',provider:null,model:null,createdAt:proposal.createdAt,updatedAt:proposal.resolvedAt||proposal.createdAt,resultSummary:proposal.status==='pending'?'این مسیر قدیمی نتیجهٔ AI ندارد؛ با اجرای واقعی AI اشتباه گرفته نشود.':limited(proposal.reason)||'نتیجهٔ هارنس ثبت شده است.',record:proposal});
    const archives=new Map(store.list('ai-log-archive').map(row=>[row.logId,row]));
    return rows.map(row=>{const logVersion=logRevision(row),archive=archives.get(row.id),archived=archive?.archived===true&&archive.logRevision===logVersion;return {...row,logRevision:logVersion,statusTone:statusTone(row),archived,archivedAt:archived?archive.archivedAt:null};}).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||a.id.localeCompare(b.id));
  }
  const summary=({record,runs,activity,run,pendingDocuments,...row})=>({...row,typeLabel:types[row.type],stateLabel:states[row.state]});
  function list(actor,query={}){
    requireHr(actor);const type=query.type||'all',state=query.state||'all',archive=query.archive||'active',period=String(query.period??'all'),search=String(query.search||'').trim(),offset=Number(query.offset||0),limit=Number(query.limit||30);
    if(type!=='all'&&!Object.hasOwn(types,type)||state!=='all'&&!Object.hasOwn(states,state)||!['active','archived'].includes(archive)||search.length>160||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)fail('فیلتر لاگ معتبر نیست.');
    if(!['all','none'].includes(period)&&!/^14\d{2}-Q[1-4]$/.test(period))fail('فیلتر دورهٔ لاگ معتبر نیست.');
    const all=collect().filter(row=>row.archived===(archive==='archived')&&(period==='all'||(period==='none'?!row.period:row.period===period))),needle=search.toLocaleLowerCase(),filtered=all.filter(row=>(type==='all'||row.type===type)&&(state==='all'||row.state===state)&&(!needle||[row.title,row.period,row.employee?.name,row.employee?.employeeCode,row.employee?.unitName,row.stage,row.resultSummary].some(value=>String(value||'').toLocaleLowerCase().includes(needle))));
    return {items:filtered.slice(offset,offset+limit).map(summary),total:filtered.length,offset,limit,period,counts:{total:all.length,...Object.fromEntries(Object.keys(states).map(state=>[state,all.filter(row=>row.state===state).length]))},types,states};
  }
  function detail(actor,id){
    requireHr(actor);const row=collect().find(row=>row.id===id);if(!row)fail('رکورد لاگ پیدا نشد.',404);const record=row.record,position=record.positionId?store.get(record.positionId,'position-assignment'):null;
    const base={...summary(row),events:events(record.events),inputs:{},result:null,metadata:{},attempts:[]};
    if(row.type==='job_analysis'){
      base.inputs={position:position?fields(position,['jobTitle','version']):null};base.result=record.result||null;base.metadata={...fields(record,['stage','promptVersion','schemaVersion','inputHash','fingerprint','validationStatus','attempt','failurePhase']),usage:usage(record.usage),error:record.status==='failed'?analysisFailure(record):null};
    }else if(row.type==='design'){
      base.inputs={position:position?fields(position,['jobTitle','duties','version']):null,positionVersion:record.positionVersion,policyVersion:record.policyVersion,tasks:(record.tasks||[]).map(task)};
      base.result=alignment(record.aiReview?.result);base.metadata={version:record.version,contractVersion:record.aiReview?.contractVersion,analysisRunId:record.aiReview?.runId,basisHash:record.aiReview?.basisHash,usage:usage(record.aiReview?.usage),managerReview:record.managerReview?fields(record.managerReview,['decision','reason','at']):null,hrReview:record.hrReview?fields(record.hrReview,['decision','reason','at']):null,revises:record.revises||null,revisedBy:record.revisedBy||null};
      base.attempts=(row.runs||[]).map(run=>({...fields(run,['id','status','provider','model','startedAt','finishedAt','positionVersion']),error:run.status==='failed'?analysisFailure(run):null,usage:usage(run.usage),result:alignment(run.result),inputs:run.inputs?{position:fields(run.inputs.position,['jobTitle','duties','version']),tasks:(run.inputs.tasks||[]).map(task)}:null}));
    }else if(row.pendingDocuments){
      base.inputs={activity:fields(record,['id','kind','title','description','period','criteria']),documents:row.pendingDocuments.map(doc=>({id:doc.id,name:doc.name,sha256:doc.sha256,status:doc.extraction?.status})),evidence:evidence(row.pendingDocuments.flatMap(doc=>(doc.extraction?.chunks||[]).map(chunk=>({...chunk,documentId:doc.id}))))};
    }else if(row.type==='review'){
      base.inputs={activity:fields(record.activitySnapshot,['id','kind','title','description','period','criteria']),documents:(record.documentHashes||[]).map(doc=>fields(doc,['id','name','sha256','extractionHash','status','warnings'])),evidence:evidence(record.evidenceSnapshot?.chunks)};
      base.result=decision(record.result);base.metadata={usage:usage(record.usage),policyVersion:record.policyVersion,promptHash:record.promptHash,fingerprint:record.fingerprint,error:record.status==='failed'?'ارزیابی کامل نشد؛ نتیجهٔ نهایی ثبت نشد.':null};
    }else if(row.type==='preprocess'){
      base.inputs={activity:fields(row.activity,['id','title','period','criteria']),document:fields(record,['id','name','size','sha256','archivedAt'])};
      base.result={status:record.extraction.status,warnings:(record.extraction.warnings||[]).map(value=>limited(value)),evidence:evidence(record.extraction.chunks)};
      const conversion=record.extraction.conversion||{};base.metadata={...fields(conversion,['version','durationMs','calls','estimatedCostUsd','promptHash']),usage:usage(conversion.usage),images:(conversion.images||[]).map(image=>fields(image,['index','label','sha256'])),...(row.state==='failed'?{error:'پیش‌پردازش کامل نشد؛ فایل و اتصال را بررسی کنید.'}:{})};
    }else{base.inputs=fields(record,['title','description','criteria','type','category']);base.result=fields(record,['status','reason','reviewReference','resolvedAt']);}
    return base;
  }
  function setArchived(actor,id,input){
    requireHr(actor);if(typeof input?.archived!=='boolean'||typeof input.logRevision!=='string')fail('درخواست آرشیو معتبر نیست.');
    const row=collect().find(row=>row.id===id);if(!row)fail('رکورد لاگ پیدا نشد.',404);
    if(row.logRevision!==input.logRevision)fail('وضعیت لاگ تغییر کرده است؛ فهرست را تازه‌سازی کنید.',409);
    if(input.archived&&row.state==='running')fail('بررسی در حال اجرا را پس از پایان به آرشیو بفرستید.',409);
    if(row.archived===input.archived)return {id,archived:row.archived};
    return store.transaction(()=>{
      const at=new Date().toISOString();store.put('ai-log-archive',{id:'ai-log-archive:'+id,logId:id,logRevision:row.logRevision,archived:input.archived,archivedAt:input.archived?at:null,updatedAt:at,updatedBy:actor.id},id);
      store.put('audit-event',{actorId:actor.id,action:input.archived?'ai-log.archived':'ai-log.restored',entityType:'ai-log',entityId:id,details:{archived:input.archived},createdAt:at});
      return {id,archived:input.archived};
    });
  }
  return {list,detail,setArchived};
}

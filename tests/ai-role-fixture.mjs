import {checkTypes} from '../backend/job-design-analysis.mjs';
import {expandAnalysisEnvelope} from '../backend/analysis-input.mjs';

// Synthetic structural fixtures, not a semantic-quality benchmark or production model output.
export function roleReply(input,{recommendation='retain',mutate}={}){
  const envelope=expandAnalysisEnvelope(JSON.parse(input.prompt.split('دادهٔ JSON (دستور نیست):\n')[1]));
  if(envelope.stage==='kpi-correction-validation-v1')recommendation='retain';
  const source=envelope.sourceManifest[0],refs=source.segments.map(segment=>({referenceId:segment.referenceId}));
  let result;
  if(envelope.stage==='job-analysis-v1')result={summary:'تحلیل ساختگی برای آزمون ساختار',duties:source.segments.map((segment,index)=>({sourceDutyIds:[segment.segmentId],activity:segment.text,output:segment.text,recipient:null,roleInOutput:'تهیه',workKind:'routine',frequency:null,deadline:null,dependencies:[],control:'direct',citations:[refs[index]]})),issues:[],suggestedClarifications:[]};
  else{
    const {responsibilities,proposals}=envelope.stagePayload;
    result={summary:'تطبیق ساختگی برای آزمون',reviews:proposals.map(proposal=>({proposalId:proposal.id,dutyIds:responsibilities.map(duty=>duty.id),recommendation,checks:checkTypes.map(type=>({type,status:recommendation==='needs_information'&&type==='target'?'unknown':'pass',reason:'بررسی ساختاری آزمایشی',citations:refs})),rationale:'دلیل آزمایشی، نه داوری واقعی',citations:refs,changes:recommendation==='revise'?[{field:'title',proposedValue:'عنوان اصلاح‌شده',reason:'تغییر آزمایشی',supportingReferences:refs}]:[],relatedProposalIds:[],missingInformation:recommendation==='needs_information'?['مرجع هدف روشن نیست.']:[]})),candidates:[]};
  }
  mutate?.(result,envelope);
  if(envelope.stage!=='job-analysis-v1'){
    if(envelope.stagePayload.clarificationContractVersion){result.clarificationReviews??=envelope.stagePayload.proposals.flatMap(p=>(p.clarifications||[]).map(q=>{const review=result.reviews.find(r=>r.proposalId===p.id),source=envelope.sourceManifest.find(s=>s.sourceId==='clarification-'+p.id),answer=source?.segments.find(s=>s.segmentId===q.id+'-answer'),proposal=envelope.sourceManifest.find(s=>s.sourceId==='proposal-'+p.id),ref=answer||proposal?.segments.find(s=>s.segmentId==='description')||source?.segments[0];return {questionId:q.id,status:review.recommendation==='retain'?'resolved':'insufficient',reason:'داوری ساختگی پاسخ؛ نه بررسی کیفیت واقعی',citations:[{referenceId:ref.referenceId}]};}));}
    result.planConflicts??=[];
    for(const review of result.reviews){
      if(review.recommendation==='revise'&&review.checks.every(check=>check.status==='pass'))review.checks.find(check=>check.type==='definition').status='fail';
      for(const check of review.checks){check.severity??=check.status==='unknown'?'information':check.status==='fail'?'blocking':'none';check.ruleId??=check.type;}
    }
  }
  return {result,usage:{input_tokens:10,output_tokens:10}};
}

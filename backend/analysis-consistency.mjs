import {stabilityHash,restoreLockedReviews,findingsFor} from './alignment-stability.mjs';

export const consistencyVersion='verified-no-op-consistency-v1';
export const contractReview=row=>Object.fromEntries(['proposalId','dutyIds','recommendation','checks','rationale','citations','changes','relatedProposalIds','missingInformation'].map(k=>[k,structuredClone(row[k])]));
const value=(field,v)=>field==='timeLimit'&&v?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==null)):v;
export function effectiveChanges(task,review){
  return (review?.changes||[]).filter(c=>stabilityHash({value:value(c.field,task?.[c.field])})!==stabilityHash({value:value(c.field,c.proposedValue)}));
}
const retained=r=>r?.recommendation==='retain'&&!r.missingInformation.length&&!r.changes.length&&r.checks.every(c=>c.status==='pass'||c.severity==='advisory');

// A prior deleted version is evidence only if it still existed during this analysis.
// No model calls, writes, or approval transitions are performed by this projection.
export function verifiedNoOpLocks(store,design,tasks,context,provider,model,isCurrentRun,analysisAt){
  const sources=[design],previous=design.revises&&store.get(design.revises,'kpi-design');
  if(previous&&previous.employeeId===design.employeeId&&previous.managerId===design.managerId&&previous.period===design.period&&(!previous.removedAt||analysisAt&&previous.removedAt>analysisAt))sources.push(previous);
  const locks=[];
  for(const source of sources){
    const run=store.get(source.aiReview?.runId,'ai-role-run');if(!isCurrentRun(run)||run.provider!==provider||run.model!==model||run.inputs?.stagePayload?.stabilityContextHash!==context)continue;
    for(const review of source.aiReview.result.reviews){
      if(locks.some(l=>l.proposalId===review.proposalId)||!review.changes.length)continue;
      const oldTask=run.inputs.stagePayload.proposals.find(t=>t.id===review.proposalId),cv=review.correctionValidation,q=store.get(cv?.runId,'ai-role-run');
      if(!oldTask)continue;
      if(effectiveChanges(oldTask,review).length||cv?.status!=='verified'||!isCurrentRun(q)||q.stage!=='kpi-correction-validation-v1'||q.provider!==provider||q.model!==model||q.inputs.stagePayload.stabilityContextHash!==context||cv.testedPlanHash!==stabilityHash(tasks)||stabilityHash(q.inputs.stagePayload.proposals)!==stabilityHash(tasks)||q.result.planConflicts.length||!q.result.reviews.every(retained))continue;
      if(source.id!==design.id&&!(design.acceptedSuggestions||[]).some(a=>a.analysisRunId===run.id&&a.proposalId===review.proposalId))continue;
      const task=tasks.find(t=>t.id===review.proposalId),tested=q.result.reviews.find(r=>r.proposalId===review.proposalId);
      if(!task||cv.testedTaskHash!==stabilityHash(task)||!retained(tested))continue;
      locks.push({proposalId:task.id,sourceRunId:q.id,sourceDesignId:source.id,taskHash:stabilityHash(task),review:tested,clarificationReviews:q.result.clarificationReviews||[]});
    }
  }
  return locks;
}

export function applyVerifiedNoOpLocks(result,locks,manifest,tasks,validate){
  if(!locks.length)return result;
  const base=Object.fromEntries(['summary','reviews','candidates','planConflicts','clarificationReviews'].filter(k=>result[k]!==undefined).map(k=>[k,structuredClone(result[k])]));
  // Metadata never enters the strict model contract.
  for(const review of base.reviews)for(const key of Object.keys(review))if(!['proposalId','dutyIds','recommendation','checks','rationale','citations','changes','relatedProposalIds','missingInformation'].includes(key))delete review[key];
  restoreLockedReviews(base,locks,manifest);
  const rebind=refs=>refs.map(ref=>{const source=manifest.find(s=>s.sourceId===ref.sourceId),segment=source?.segments.find(s=>s.segmentId===ref.segmentId);if(!segment?.text.includes(ref.quote))throw Error('Verified clarification evidence changed');return {...ref,sourceVersion:source.sourceVersion};});
  if(base.clarificationReviews)for(const lock of locks){const ids=new Set(tasks.find(t=>t.id===lock.proposalId)?.clarifications?.map(q=>q.id)||[]);for(const q of lock.clarificationReviews.filter(q=>ids.has(q.questionId))){const i=base.clarificationReviews.findIndex(r=>r.questionId===q.questionId);if(i>=0)base.clarificationReviews[i]={...structuredClone(q),citations:rebind(q.citations)};}}
  const checked=validate(base),resolved=new Set(locks.map(l=>l.proposalId));
  const reviews=checked.reviews.map(r=>{const l=locks.find(l=>l.proposalId===r.proposalId);return l?{...r,lock:{sourceRunId:l.sourceRunId,taskHash:l.taskHash},consistencyResolution:{version:consistencyVersion,sourceDesignId:l.sourceDesignId,sourceRunId:l.sourceRunId}}:{...result.reviews.find(old=>old.proposalId===r.proposalId),...r};});
  const findings=findingsFor(checked,[{reviews:result.reviews.map(r=>({...r,checks:r.checks.filter(c=>c.status!=='pass')}))}]);
  return {...result,...checked,reviews,consistencyResolution:{version:consistencyVersion,proposalIds:[...resolved],qualityRunIds:[...new Set(locks.map(l=>l.sourceRunId))]},findings};
}

import {maxCorrectionRounds} from './alignment-stability.mjs';
export const humanReviewPolicyVersion='human-review-fifth-analysis-v2';

// Preserve reports as evidence; project the current policy for pending designs.
export function currentHumanReviewResult(result){
  if(!result)return result;
  const rounds=Number(result.correctionRound)||0;
  // Legacy quality checks only ran below their two-round limit. At that limit
  // the stop was caused by the counter, not an independent quality failure.
  const qualityFailed=result.correctionQualityFailed===true||result.humanReviewTrigger==='quality_failed'||
    (result.humanReviewTrigger===undefined&&result.humanReviewRequired&&rounds<2);
  const roundLimit=rounds>=maxCorrectionRounds&&(result.blockers?.length>0||qualityFailed);
  return {...result,maxCorrectionRounds,correctionQualityFailed:!!qualityFailed,humanReviewPolicyVersion,humanReviewRequired:!!roundLimit,humanReviewTrigger:roundLimit?'round_limit':null};
}
export function currentHumanReviewDesign(design){
  if(!design?.aiReview?.result||['published','rejected'].includes(design.status)||design.aiReview.contractVersion!=='kpi-alignment-v4')return design;
  return {...design,aiReview:{...design.aiReview,result:currentHumanReviewResult(design.aiReview.result)}};
}

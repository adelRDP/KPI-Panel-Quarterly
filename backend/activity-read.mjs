import {sha256} from './evaluation.mjs';

const fields=['id','status','createdAt','startedAt','finishedAt','error','provider','model','policyVersion','documentHashes','evidenceDisposition','fileProcessing'];
const select=(row,keys)=>Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));

// Versions track changes to report content, not the large raw evidence snapshot.
export const reviewReportVersion=review=>sha256(JSON.stringify([review.status,review.finishedAt,review.result,review.fileProcessing,review.evidenceDisposition,review.error]));
export function reviewSummary(review){
 const result=review.result&&select(review.result,['decision','qualityScore','finalScore','finalForActivity','coverage']);
 return {...select(review,fields),summaryOnly:true,reportVersion:reviewReportVersion(review),...(result?{result}:{})};
}
export function reviewReport(review){
 return {...select(review,fields),reportVersion:reviewReportVersion(review),...select(review,['activitySnapshot','result','usage']),
  ...(review.evidenceSnapshot?{evidenceSnapshot:{chunks:(review.evidenceSnapshot.chunks||[]).map(chunk=>select(chunk,['id','documentId','label']))}}:{})};
}

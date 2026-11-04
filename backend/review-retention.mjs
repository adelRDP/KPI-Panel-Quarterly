import {sha256} from './evaluation.mjs';
import {closedActivity} from './position-closeout.mjs';
const approved=r=>r.status==='done'&&r.result?.decision==='completed'&&r.result.finalForActivity===true;
const locked=(store,a)=>closedActivity(store,a)||store.list('quarter-evaluation',a.ownerId).some(q=>q.status==='locked'&&q.quarter===a.period);

// Automatic removal from the active list is recoverable; audit evidence and raw files remain.
export function createReviewRetention(store){
 function plan(row){
  const id=row.activitySnapshot?.id||row.activityId,a=id&&store.get(id,'activity');
  if(!a||a.removedAt||locked(store,a))return {activityId:id,documentIds:[],skipped:'locked_or_missing'};
  if(!['done','failed','blocked'].includes(row.status)||approved(row))return {activityId:id,documentIds:[],skipped:'pending_or_approved'};
  if((row.actorId||row.activitySnapshot?.ownerId)&&(row.actorId||row.activitySnapshot.ownerId)!==a.ownerId)return {activityId:id,documentIds:[],skipped:'owner_changed'};
  const reviews=store.list('review',id),accepted=reviews.filter(approved).flatMap(r=>r.documentHashes||[]),pending=reviews.filter(r=>['queued','running'].includes(r.status)&&r.id!==row.id).flatMap(r=>r.documentHashes||[]),documents=store.list('document',id);
  const matches=(ref,d)=>ref.id===d.id&&ref.sha256===d.sha256;
  const ids=(row.documentHashes||[]).filter(ref=>{const d=documents.find(d=>!d.archivedAt&&matches(ref,d));return d&&(!ref.extractionHash||ref.extractionHash===sha256(JSON.stringify(d.extraction)))&&!accepted.some(ref=>matches(ref,d))&&!pending.some(ref=>matches(ref,d));}).map(ref=>ref.id);
  return {activityId:id,documentIds:[...new Set(ids)],skipped:null};
 }
 function cleanup(row){
  return store.transaction(()=>{
   const p=plan(row);if(!p.documentIds.length)return {archivedDocumentIds:[],skipped:p.skipped};const at=new Date().toISOString(),reason=row.status==='blocked'?'precheck_not_approved':'review_not_approved';
   for(const id of p.documentIds){const d=store.get(id,'document');store.put('document',{...d,archivedAt:at,archivedBy:'system-ai',archiveReason:reason,archivedByReviewId:row.id||null},p.activityId);}
   const disposition={policy:'approved-only-active-v1',archivedAt:at,archivedDocumentIds:p.documentIds,reason};
   const saved=row.id&&store.get(row.id,'review');if(saved)store.put('review',{...saved,evidenceDisposition:disposition},p.activityId);
   store.put('audit-event',{actorId:'system-ai',action:'review.evidence-archived',entityType:'activity',entityId:p.activityId,details:{reviewId:row.id||null,documentIds:p.documentIds,status:row.status,decision:row.result?.decision||null},createdAt:at});
   return disposition;
  });
 }
 function blocked(actor,a,documents){return cleanup({activitySnapshot:a,actorId:actor.id,status:'blocked',documentHashes:documents.map(d=>({id:d.id,sha256:d.sha256,extractionHash:sha256(JSON.stringify(d.extraction))}))});}
 return {plan,cleanup,blocked};
}

// Auto-archiving does not erase a valid partial grade or reinterpret its frozen evidence.
// Manual removal or newly submitted evidence still invalidates a previous grade.
export function reviewEvidenceMatches(store,activity,review){
 if(!review)return false;const all=store.list('document',activity.id),active=all.filter(d=>!d.archivedAt),refs=review.documentHashes||[];
 if(!refs.length||new Set(refs.map(ref=>ref.id)).size!==refs.length||active.some(d=>!refs.some(ref=>ref.id===d.id&&ref.sha256===d.sha256)))return false;
 // A failed newer delivery must not resurrect an older grade after its files leave the active list.
 const completedAt=review.finishedAt||review.createdAt;
 if(completedAt&&all.some(d=>d.createdAt>completedAt&&!refs.some(ref=>ref.id===d.id&&ref.sha256===d.sha256)))return false;
 return refs.every(ref=>{const d=all.find(d=>d.id===ref.id&&d.sha256===ref.sha256&&sha256(JSON.stringify(d.extraction))===ref.extractionHash);return d&&(!d.archivedAt||d.archiveReason==='review_not_approved'&&d.archivedByReviewId===review.id);});
}

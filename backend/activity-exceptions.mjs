import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)??'null').digest('hex');
export const activityDefinitionHash=a=>hash(Object.fromEntries(['id','ownerId','positionId','positionVersion','designVersion','period','title','description','criteria','dueDate','assessmentEnd'].map(k=>[k,a[k]])));
export function activityReviewBasis(store,a){return hash({definition:activityDefinitionHash(a),documents:store.list('document',a.id).map(d=>[d.id,d.sha256,d.archivedAt||null,hash(d.extraction)]).sort(),reviews:store.list('review',a.id).map(r=>[r.id,r.status,r.finishedAt,r.result]).sort(),human:store.list('activity-human-review',a.id).map(r=>[r.id,r.status,r.result])});}
export function approvedActivityDeadline(store,a){return store.list('activity-deadline-extension',a.id).filter(r=>r.definitionHash===activityDefinitionHash(a)).sort((a,b)=>b.dueDate.localeCompare(a.dueDate))[0]||null;}
export function approvedActivityScore(store,a){const row=store.list('activity-score-amendment',a.id)[0];return row&&row.sourceHash===activityReviewBasis(store,a)?row:null;}

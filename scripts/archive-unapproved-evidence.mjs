// Scoped, recoverable cleanup for one explicitly selected existing review; never calls a model.
import {DatabaseSync,backup} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {openStore} from '../backend/store.mjs';
import {createReviewRetention} from '../backend/review-retention.mjs';

const args=process.argv.slice(2),activityId=args.find(a=>a.startsWith('--activity='))?.slice(11),reviewId=args.find(a=>a.startsWith('--review='))?.slice(9),apply=args.includes('--apply');
if(!/^[a-f0-9-]{36}$/.test(activityId||'')||!/^[a-f0-9-]{36}$/.test(reviewId||'')||args.some(a=>a!=='--apply'&&!a.startsWith('--activity=')&&!a.startsWith('--review=')))throw Error('Use --activity=<exact UUID> --review=<exact UUID> [--apply]. Default: read-only preview.');
const root=resolve('data/processed/kpi-panel'),dbPath=join(root,'panel.sqlite');
if(!existsSync(dbPath))throw Error('Existing main database not found; no new database will be created.');
const db=new DatabaseSync(dbPath,{readOnly:true});
const readOnly={get(id,kind){const r=db.prepare('SELECT value FROM records WHERE id=? AND kind=?').get(id,kind);return r?JSON.parse(r.value):null;},list(kind,parent){const rows=parent===undefined?db.prepare('SELECT value FROM records WHERE kind=? ORDER BY rowid DESC').all(kind):db.prepare('SELECT value FROM records WHERE kind=? AND parent=? ORDER BY rowid DESC').all(kind,parent);return rows.map(r=>JSON.parse(r.value));}};
function validate(store){
 const a=store.get(activityId,'activity'),reviews=store.list('review',activityId),r=store.get(reviewId,'review');
 if(!a||a.removedAt||!r||r.activitySnapshot?.id!==activityId)throw Error('Exact activity/review relationship not found.');
 if(reviews[0]?.id!==reviewId||reviews.some(r=>['queued','running'].includes(r.status)))throw Error('Review changed or activity has a pending job; nothing archived.');
 const plan=createReviewRetention(store).plan(r);
 return {a,r,plan};
}
const preview=validate(readOnly),files=preview.plan.documentIds.map(id=>{const d=readOnly.get(id,'document');return {id,name:d.name,sha256:d.sha256,rawFilePresent:!!d.path&&existsSync(d.path)};});
let snapshot=null,result=null;
if(apply&&preview.plan.documentIds.length){
 if(files.some(d=>!d.rawFilePresent))throw Error('Raw file missing; inspect before changing metadata.');
 snapshot=join(root,'before-reviewed-evidence-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
 await backup(db,snapshot);db.close();
 const store=openStore(root);
 try{const fresh=validate(store);if(JSON.stringify(fresh.plan.documentIds)!==JSON.stringify(preview.plan.documentIds))throw Error('Evidence changed since preview; nothing archived.');result=createReviewRetention(store).cleanup(fresh.r);}finally{store.close();}
}else db.close();
console.log(JSON.stringify({apply,activityId,reviewId,decision:preview.r.result?.decision||preview.r.status,files,skipped:preview.plan.skipped,snapshot,result,rawFilesDeleted:0,modelCalls:0},null,2));

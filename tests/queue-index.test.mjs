import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../backend/store.mjs';
import {createAutomaticReview} from '../backend/automatic-review.mjs';
test('indexed queue preserves FIFO and version isolation without reading historical review bodies',async t=>{
 const root=await mkdtemp(join(tmpdir(),'kpi-queue-test-')),store=openStore(root);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const saved=store.put('review',{status:'done',evidenceSnapshot:{text:'x'.repeat(500000)},inputsVersion:'v',policyVersion:'p'}),other=store.put('review',{status:'queued',inputsVersion:'old',policyVersion:'p'}),first=store.put('review',{status:'queued',inputsVersion:'v',policyVersion:'p'}),second=store.put('review',{status:'queued',inputsVersion:'v',policyVersion:'p'});
 assert.equal(store.nextQueuedReview('v','p').id,first.id);store.put('review',{...first,status:'done'});assert.equal(store.nextQueuedReview('v','p').id,second.id);store.put('review',{...second,status:'failed'});assert.equal(store.nextQueuedReview('v','p'),null);assert.equal(store.nextQueuedReview('old','p').id,other.id);assert.equal(store.get(saved.id,'review').evidenceSnapshot.text.length,500000);
 const db=new DatabaseSync(join(root,'panel.sqlite'),{readOnly:true});try{const plan=db.prepare("EXPLAIN QUERY PLAN SELECT value FROM records WHERE kind='review' AND json_extract(value,'$.status')='queued' AND json_extract(value,'$.inputsVersion')=? AND json_extract(value,'$.policyVersion')=? ORDER BY rowid ASC LIMIT 1").all('v','p');assert.match(JSON.stringify(plan),/records_queued_reviews/);}finally{db.close();}
 const readonly=openStore(root,{readOnly:true});try{assert.equal(readonly.nextQueuedReview('v','p'),null);}finally{readonly.close();}
});
test('idle automatic worker uses indexed lookup and never lists full history',async()=>{
 let reads=0;const worker=createAutomaticReview({nextQueuedReview:()=>{reads++;return null;},list:()=>{throw Error('Full history must not be read');}}, {},{busy:new Set(),enabled:false});
 worker.stop();assert.equal(reads,0);
 const active=createAutomaticReview({nextQueuedReview:()=>{reads++;return null;},list:()=>{throw Error('Full history must not be read');}}, {},{busy:new Set()});try{await active.tick();assert.equal(reads,1);}finally{active.stop();}
});

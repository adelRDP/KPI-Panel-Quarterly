import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createPanelServer} from '../server.mjs';

test('read scopes reuse parsed records and respect parent boundaries, writes, rollback and scope exit',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kpi-read-cache-')),store=openStore(dir);
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 store.put('review',{id:'r',value:1},'a');
 store.withReadCache(()=>{
  const first=store.list('review','a')[0];
  assert.equal(store.get('r','review'),first);assert.equal(store.get('r','review','a'),first);
  assert.equal(store.get('r','review','b'),null);
  store.withReadCache(()=>assert.equal(store.list('review','a')[0],first));
  store.list('review','a').pop();assert.equal(store.list('review','a').length,1);
  store.put('review',{id:'r',value:2},'b');
  assert.equal(store.get('r','review','a'),null);assert.equal(store.list('review','a').length,0);
  assert.equal(store.get('r','review','b').value,2);
  assert.throws(()=>store.transaction(()=>{store.put('review',{id:'r',value:3},'b');assert.equal(store.get('r','review').value,3);throw Error('rollback');}));
  assert.equal(store.get('r','review').value,2);
  store.remove('r','review','b');assert.equal(store.get('r','review'),null);
 });
 store.put('review',{id:'r',value:4},'a');let cached;
 store.withReadCache(()=>{cached=store.get('r','review');});
 assert.notEqual(store.get('r','review'),cached);assert.equal(store.get('r','review').value,4);
 const readonly=openStore(dir,{readOnly:true});try{assert.equal(readonly.get('r','review').value,4);assert.throws(()=>readonly.put('review',{id:'r',value:5},'a'));}finally{readonly.close();}
});

test('compact activity reads preserve scores and quota, fetch only the selected report and enforce owner and parent permissions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kpi-compact-read-')),server=createPanelServer({dataRoot:dir,autoAssessment:false,runModel:async()=>{throw Error('No model during reads');}}),store=openStore(dir);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true,maxRetries:3});});
 const activity=store.list('activity').find(a=>a.ownerId==='employee-mohammad'),other=store.list('activity').find(a=>a.ownerId==='employee-maryam');
 for(let i=0;i<5;i++)store.put('review',{id:'large-review-'+i,status:i===4?'running':'done',activitySnapshot:activity,createdAt:'2026-10-01T00:00:00Z',finishedAt:i===4?null:'2026-10-02T00:00:00Z',submissionKey:'delivery-'+i,documentHashes:[{id:'d'+i,sha256:'hash'+i}],evidenceSnapshot:{incomplete:false,chunks:[{id:'c'+i,documentId:'d'+i,label:'sheet 1',text:'Private synthetic source. '.repeat(30000)}]},result:i===4?null:{decision:'needs_revision',qualityScore:75,finalScore:70,finalForActivity:true,summary:'Synthetic finding',criteria:[{id:'C1',status:'unmet',reason:'Needs a date',citations:[{chunkId:'c'+i,quote:'Private synthetic source.'}]}],coverage:{incomplete:false,totalChunks:1,omittedChunks:0,bytes:750000}}},activity.id);
 const before=JSON.stringify(store.list('review',activity.id)),base='http://127.0.0.1:'+server.address().port;
 let session=await(await fetch(base+'/api/session')).json();
 const read=async path=>{const r=await fetch(base+path,{headers:{'x-panel-token':session.token}});return {status:r.status,data:await r.json()};};
 const login=async userId=>{const r=await fetch(base+'/api/session',{method:'POST',headers:{'x-panel-token':session.token},body:JSON.stringify({userId})});session=await r.json();};
 await login(activity.ownerId);const path='/api/activities/'+activity.id,full=(await read(path)).data,compact=(await read(path+'?summary=1')).data;
 assert.deepEqual(compact.submissionQuota,full.submissionQuota);assert.deepEqual(compact.humanReview,full.humanReview);assert.deepEqual(compact.history,full.history);
 assert.equal(compact.reviews.length,5);assert.ok(JSON.stringify(compact).length<JSON.stringify(full).length/50);
 for(const [i,r] of compact.reviews.entries()){
  assert.equal(r.summaryOnly,true);assert.ok(r.reportVersion);assert.equal(r.evidenceSnapshot,undefined);assert.equal(r.activitySnapshot,undefined);assert.equal(r.result?.criteria,undefined);assert.equal(r.result?.finalScore,full.reviews[i].result?.finalScore);
 }
 const report=(await read(path+'/reviews/large-review-1')).data;
 assert.equal(report.id,'large-review-1');assert.deepEqual(report.result,full.reviews.find(r=>r.id===report.id).result);assert.equal(report.evidenceSnapshot.chunks[0].label,'sheet 1');assert.equal(report.evidenceSnapshot.chunks[0].text,undefined);assert.equal(report.activitySnapshot.id,activity.id);
 assert.equal((await read('/api/activities/'+other.id+'/reviews/large-review-1')).status,403);
 assert.equal((await read(path+'/reviews/missing')).status,404);
 const state=(await read(path+'/quota?humanReview=1')).data;assert.deepEqual(state.submissionQuota,compact.submissionQuota);assert.deepEqual(state.humanReview,compact.humanReview);
 await login('manager-ops');assert.equal((await read(path+'/reviews/large-review-1')).status,200);
 await login('hr-demo');assert.equal((await read(path+'/reviews/large-review-1')).status,200);assert.equal((await read('/api/activities/'+other.id+'/reviews/large-review-1')).status,404);
 await login('employee-maryam');assert.equal((await read(path+'?summary=1')).status,403);assert.equal((await read(path+'/reviews/large-review-1')).status,403);
 assert.equal(JSON.stringify(store.list('review',activity.id)),before);
});

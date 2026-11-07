import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';
import {createPanelServer} from '../server.mjs';

test('admin counter counts actionable requests across periods and excludes removed designs',()=>{
 const root=mkdtempSync(join(tmpdir(),'incoming-count-')),store=openStore(root);
 try{
  assert.equal(store.pendingAdminRequestCount(),0);
  for(const [kind,status] of [['position-assignment','hr_approval'],['kpi-design','hr_review'],['quarter-evaluation','hr_review'],['quarter-appeal','hr_review']])store.put(kind,{id:kind,status,period:'1405-Q3'});
  store.put('kpi-design',{id:'other-quarter',status:'hr_review',period:'1405-Q2'});
  store.put('kpi-design',{id:'removed',status:'hr_review',removedAt:'2026-11-07'});
  for(const status of ['draft','published','manager_review','rejected'])store.put('kpi-design',{status});
  store.put('position-history-visibility',{positionId:'position-assignment',hidden:true});
  assert.equal(store.pendingAdminRequestCount(),5);
  const readonly=openStore(root,{readOnly:true});try{assert.equal(readonly.pendingAdminRequestCount(),5);}finally{readonly.close();}
  store.put('kpi-design',{id:'kpi-design',status:'published'});assert.equal(store.pendingAdminRequestCount(),4);
  for(const [id,kind] of [['other-quarter','kpi-design'],['position-assignment','position-assignment'],['quarter-evaluation','quarter-evaluation'],['quarter-appeal','quarter-appeal']])store.put(kind,{id,status:'approved'});
  assert.equal(store.pendingAdminRequestCount(),0);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('notification polling exposes the count only to admin; reading notices never resolves requests',async()=>{
 const root=mkdtempSync(join(tmpdir(),'incoming-count-http-'));seedQuarterlyFixture(root);
 const server=createPanelServer({dataRoot:root,demoLogin:false,autoAssessment:false,runModel:()=>{throw Error('No live AI');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{
  const store=openStore(root);try{store.put('kpi-design',{id:'pending-design',status:'hr_review'});store.put('notification',{id:'notice',recipientId:'admin',kind:'action',title:'Synthetic notice',view:'incoming',createdAt:new Date().toISOString(),readAt:null},'admin');}finally{store.close();}
  let session=await(await fetch(base+'/api/session')).json();
  const req=(path,method='GET',body)=>fetch(base+path,{method,headers:{'x-panel-token':session.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  let response=await(await req('/api/notifications')).json();assert.equal(response.incomingRequestCount,1);assert.ok(response.unreadCount>=1);
  assert.equal((await req('/api/notifications/read-all','POST',{})).status,200);
  response=await(await req('/api/notifications')).json();assert.equal(response.unreadCount,0);assert.equal(response.incomingRequestCount,1);
  for(const userId of ['manager','employee-0']){session=await(await req('/api/session','POST',{userId})).json();response=await(await req('/api/notifications')).json();assert.equal(Object.hasOwn(response,'incomingRequestCount'),false);}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});

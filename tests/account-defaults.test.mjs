import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createLocalAccounts} from '../backend/local-accounts.mjs';
import {createPanelServer} from '../server.mjs';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'kpi-account-defaults-')),store=openStore(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});const people=[{id:'admin',name:'Admin',role:'hr'},{id:'manager',name:'Manager',role:'manager'},{id:'one',name:'Staff',role:'personnel',employeeCode:'123'},{id:'two',name:'Duplicate code',role:'personnel',employeeCode:'123'},{id:'disabled',name:'Existing disabled',role:'personnel'},{id:'former',name:'Settled',role:'personnel',isSettled:true}],workflow={accounts:()=>people,user:id=>people.find(p=>p.id===id)},accounts=createLocalAccounts(store,workflow);return {store,people,workflow,accounts,admin:people[0]};}
test('default accounts have unique identities and random passwords, preserve existing disabled accounts and skip former staff',async t=>{
 const f=await fixture(t);await f.accounts.save(f.admin,{userId:'disabled',username:'user.123',password:'Existing-synthetic-password'});await f.accounts.save(f.admin,{userId:'disabled',username:'user.123',enabled:false});const previous=JSON.stringify(f.store.get('local-account-disabled','local-account'));
 await assert.rejects(f.accounts.createDefaults(f.people[1]),e=>e.status===403);
 const result=await f.accounts.createDefaults(f.admin);assert.equal(result.created,4);assert.equal(result.skipped,2);assert.equal(new Set(result.credentials.map(r=>r.username)).size,4);assert.equal(new Set(result.credentials.map(r=>r.password)).size,4);assert.equal(result.credentials.find(r=>r.userId==='one').username,'user.123.2');
 for(const row of result.credentials){assert.ok(row.password.length>=24);assert.equal(await f.accounts.verify(row),row.userId);assert.equal(f.accounts.requiresChange(row.userId),true);assert.ok(!JSON.stringify(f.store.list('local-account')).includes(row.password));assert.ok(!JSON.stringify(f.store.list('audit-event')).includes(row.password));}
 assert.equal(f.store.get('local-account-former','local-account'),null);assert.equal(JSON.stringify(f.store.get('local-account-disabled','local-account')),previous);const again=await f.accounts.createDefaults(f.admin);assert.equal(again.created,0);assert.deepEqual(again.credentials,[]);assert.equal(JSON.stringify(f.store.get('local-account-disabled','local-account')),previous);
 assert.ok(f.accounts.list(f.admin).every(row=>!('password' in row)&&!('digest' in row)));
});
test('parallel bulk submissions reject the second request and an interrupted transaction leaves no partial accounts',async t=>{
 const f=await fixture(t);let writes=0;const broken={...f.store,put:(kind,...args)=>{if(kind==='local-account'&&++writes===2)throw Error('Synthetic storage failure');return f.store.put(kind,...args);}},service=createLocalAccounts(broken,f.workflow);
 const first=service.createDefaults(f.admin);await assert.rejects(service.createDefaults(f.admin),e=>e.status===409);await assert.rejects(first,/Synthetic storage failure/);assert.equal(f.store.list('local-account').length,0);assert.equal(f.store.list('audit-event').length,0);
 const result=await f.accounts.createDefaults(f.admin);assert.equal(result.created,5);
});
test('bulk HTTP endpoint is admin-only, no-store, and repeated requests never reset existing credentials',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kpi-defaults-http-'));seedQuarterlyFixture(dir);const server=createPanelServer({dataRoot:dir,authMode:'hybrid',demoLogin:false,autoAssessment:false,runModel:async()=>{throw Error('No model');}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port;
 const call=(token,path,data)=>fetch(base+path,{method:data?'POST':'GET',headers:{'x-panel-token':token,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});let session=await (await fetch(base+'/api/session')).json();session=await (await call(session.token,'/api/session',{userId:'employee-0'})).json();assert.equal((await call(session.token,'/api/auth/accounts/defaults',{})).status,403);session=await (await call(session.token,'/api/session',{userId:'admin'})).json();const response=await call(session.token,'/api/auth/accounts/defaults',{});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const result=await response.json();assert.ok(result.created>0);assert.equal((await (await call(session.token,'/api/auth/accounts/defaults',{})).json()).created,0);const metadata=JSON.stringify(await (await call(session.token,'/api/auth/accounts')).json());for(const row of result.credentials)assert.equal(metadata.includes(row.password),false);
});

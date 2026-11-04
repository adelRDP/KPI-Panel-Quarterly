import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createLocalAccounts,createSessionRegistry} from '../backend/local-accounts.mjs';
import {createPanelServer} from '../server.mjs';
const password='Synthetic-password-5040',changed='Another-synthetic-password-5040';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'kpi-accounts-')),store=openStore(root),workflow=createWorkflow(store),accounts=createLocalAccounts(store,workflow),state={root,store,workflow,accounts,hr:workflow.user('hr-demo'),owner:workflow.user('employee-mohammad'),closeExternal:async()=>{}};t.after(async()=>{await state.closeExternal();store.close();await rm(root,{recursive:true,force:true});});return state;}
test('local credentials use salted hashes, normalized unique usernames and owner-only password changes',async t=>{
 const f=await fixture(t);await assert.rejects(f.accounts.bootstrap({userId:f.owner.id,username:'first',password}));await f.accounts.bootstrap({userId:f.hr.id,username:'First.Admin',password});
 assert.equal(await f.accounts.verify({username:' FIRST.ADMIN ',password}),f.hr.id);assert.equal(await f.accounts.verify({username:'missing',password}),null);
 await assert.rejects(f.accounts.save(f.owner,{userId:f.owner.id,username:'staff',password}),e=>e.status===403);
 await f.accounts.save(f.hr,{userId:f.owner.id,username:'Staff',password});assert.equal(f.accounts.requiresChange(f.owner.id),true);
 await assert.rejects(f.accounts.save(f.hr,{userId:'employee-sara',username:'STAFF',password}),e=>e.status===409);await assert.rejects(f.accounts.save(f.hr,{userId:'employee-sara',username:'other',password:'weak'}));
 await assert.rejects(f.accounts.changePassword(f.owner,{currentPassword:'wrong',password:changed}),e=>e.status===403);await f.accounts.changePassword(f.owner,{currentPassword:password,password:changed});assert.equal(f.accounts.requiresChange(f.owner.id),false);assert.equal(await f.accounts.verify({username:'staff',password}),null);assert.equal(await f.accounts.verify({username:'staff',password:changed}),f.owner.id);
 const raw=JSON.stringify(f.store.list('local-account')),audit=JSON.stringify(f.store.list('audit-event'));assert.ok(!raw.includes(password)&&!raw.includes(changed));assert.ok(!audit.includes(password)&&!audit.includes(changed));assert.equal(f.accounts.list(f.hr).some(r=>'digest' in r||'salt' in r),false);
 await assert.rejects(f.accounts.save(f.hr,{userId:f.hr.id,username:'admin',enabled:false}),e=>e.status===409);await assert.rejects(f.accounts.bootstrap({userId:f.hr.id,username:'again',password}),e=>e.status===409);
});
test('session tokens are hashed, persisted, revoked on logout/reset, and separated by authentication mode',async t=>{
 const f=await fixture(t);await f.accounts.bootstrap({userId:f.hr.id,username:'admin',password});const token='a'.repeat(64),session={userId:f.hr.id,remember:true,expires:Date.now()+100000},registry=()=>createSessionRegistry(f.store,{revision:f.accounts.sessionRevision,mode:'local'});
 registry().set(token,session);assert.equal(registry().get(token).userId,f.hr.id);assert.equal(JSON.stringify(f.store.list('auth-session')).includes(token),false);assert.equal(createSessionRegistry(f.store,{revision:f.accounts.sessionRevision,mode:'demo'}).get(token),undefined);
 await f.accounts.changePassword(f.hr,{currentPassword:password,password:changed});assert.equal(registry().get(token),undefined);registry().set(token,session);registry().delete(token);assert.equal(registry().get(token),undefined);assert.equal(f.store.list('auth-session').length,0);
});
test('local HTTP login forbids role switching, requires temporary password change and remembers the same identity after restart',async t=>{
 const f=await fixture(t);await f.accounts.bootstrap({userId:f.hr.id,username:'admin',password});await f.accounts.save(f.hr,{userId:f.owner.id,username:'staff',password});
 let server;const start=async()=>{server=createPanelServer({dataRoot:f.root,autoAssessment:false,authMode:'local',runModel:async()=>{throw Error('No AI');}});server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;},stop=async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));};f.closeExternal=async()=>{if(server?.listening)await stop();};let base=await start();
 const login=async(username,p= password)=>fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:p,remember:true})});
 assert.equal((await fetch(base+'/api/session')).status,401);assert.equal((await login('staff','wrong')).status,401);
 let response=await login('staff'),cookie=response.headers.get('set-cookie').split(';')[0],session=await response.json();assert.equal(session.user.id,f.owner.id);assert.equal(session.demo,false);assert.equal(session.mustChangePassword,true);assert.ok(session.accounts.every(p=>p.id===f.owner.id));
 const request=(path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{'x-panel-token':session.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request('/api/workflow/me')).status,403);assert.equal((await request('/api/session',{userId:f.hr.id})).status,403);
 const previous=session.token;response=await request('/api/auth/password',{currentPassword:password,password:changed});assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];session=await response.json();assert.equal(session.mustChangePassword,false);assert.equal((await fetch(base+'/api/workflow/me',{headers:{'x-panel-token':previous}})).status,403);
 assert.equal((await request('/api/auth/accounts')).status,403);assert.equal((await request('/api/session',{userId:f.hr.id})).status,403);assert.equal((await request('/api/workflow/me')).status,200);
 await stop();base=await start();const restored=await fetch(base+'/api/session',{headers:{cookie}});assert.equal(restored.status,200);assert.equal((await restored.json()).user.id,f.owner.id);
 await f.accounts.save(f.hr,{userId:f.owner.id,username:'staff',enabled:false});assert.equal((await fetch(base+'/api/session',{headers:{cookie}})).status,401);
});

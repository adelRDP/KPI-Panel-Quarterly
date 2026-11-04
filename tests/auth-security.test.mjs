import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createLocalAccounts} from '../backend/local-accounts.mjs';
import {passwordDigest} from '../backend/demo-login.mjs';
import {createPanelServer} from '../server.mjs';
test('explicit hybrid authentication remains gated when using a restored custom data directory',async t=>{
 const root=await mkdtemp(join(tmpdir(),'kpi-restored-auth-')),server=createPanelServer({root,dataRoot:join(root,'db'),authMode:'hybrid',autoAssessment:false});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port;assert.equal((await fetch(base+'/api/session')).status,401);assert.equal((await fetch(base+'/',{redirect:'manual'})).status,302);assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({access:'main',username:'any',password:'any'})})).status,503);
});
test('admin security report records successful and failed logins without secrets; shared revocation leaves personal identities working',async t=>{
 const root=await mkdtemp(join(tmpdir(),'kpi-security-')),store=openStore(root),workflow=createWorkflow(store),accounts=createLocalAccounts(store,workflow),password='Synthetic-strong-password';await accounts.bootstrap({userId:'hr-demo',username:'admin',password});
 const salt='f'.repeat(32),server=createPanelServer({dataRoot:root,authMode:'hybrid',demoLogin:{username:'main',salt,digest:passwordDigest(password,salt)},autoAssessment:false});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();await rm(root,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port;
 const login=(access,username,p=password)=>fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({access,username,password:p})});const call=(s,path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{'x-panel-token':s.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await login('admin','admin','private-wrong-value')).status,401);const personal=await (await login('admin','admin')).json(),main=await (await login('main','main')).json();let response=await call(personal,'/api/auth/security');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const report=await response.json();assert.equal(report.accounts[0].failedAttempts,1);assert.ok(report.accounts[0].lastLoginAt);assert.ok(report.events.some(r=>r.action==='login.failure'));assert.equal((await call(main,'/api/auth/security')).status,403);
 const raw=JSON.stringify(store.list('auth-event'));for(const secret of [password,'private-wrong-value',personal.token,main.token,'digest','salt'])assert.equal(raw.includes(secret),false);
 const before=JSON.stringify(store.list('workflow-user')),result=await (await call(personal,'/api/auth/security/revoke-main',{})).json();assert.ok(result.revoked>=1);assert.equal(result.loggedOut,false);assert.equal((await call(main,'/api/org/chart')).status,403);assert.equal((await call(personal,'/api/org/chart')).status,200);assert.equal(JSON.stringify(store.list('workflow-user')),before);
 for(let n=0;n<120;n++)store.put('auth-event',{action:'logout',authKind:'local',userId:'hr-demo',createdAt:new Date().toISOString()});assert.equal((await (await call(personal,'/api/auth/security')).json()).events.length,100);
});

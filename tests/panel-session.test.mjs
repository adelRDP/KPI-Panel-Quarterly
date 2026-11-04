import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createPanelServer} from '../server.mjs';
import {passwordDigest} from '../backend/demo-login.mjs';

const loginConfig=()=>{const salt='a'.repeat(32);return {username:'synthetic-admin',salt,digest:passwordDigest('Synthetic-test-only-5040',salt)};};
async function gated(t,config=loginConfig()){
 const root=await mkdtemp(join(tmpdir(),'kpi-gated-login-')),server=createPanelServer({dataRoot:root,demoLogin:config,autoAssessment:false,runModel:async()=>{throw Error('No model');}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});return 'http://127.0.0.1:'+server.address().port;
}

test('shared demo login gates HTML and APIs, authenticates on server, rotates role tokens and logs every role out to login',async t=>{
 const base=await gated(t),credentials={username:'synthetic-admin',password:'Synthetic-test-only-5040'};
 const root=await fetch(base+'/',{redirect:'manual'});assert.equal(root.status,302);assert.equal(root.headers.get('location'),'/login.html');
 assert.equal((await fetch(base+'/index.html',{redirect:'manual'})).status,302);assert.equal((await fetch(base+'/login.html')).status,200);
 const absent=await fetch(base+'/api/session');assert.equal(absent.status,401);assert.equal((await absent.json()).token,undefined);
 assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'hr-demo'})})).status,403);
 const login=body=>fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await fetch(base+'/api/login',{method:'POST',body:'{invalid JSON'})).status,400);assert.equal((await login(null)).status,400);
 assert.equal((await login({...credentials,password:'wrong'})).status,401);
 assert.equal((await login({...credentials,username:'wrong'})).status,401);
 for(const id of ['employee-mohammad','manager-ops','hr-demo']){
   const entry=await login(credentials),cookie=entry.headers.get('set-cookie').split(';')[0];assert.equal(entry.status,200);assert.match(entry.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.doesNotMatch(entry.headers.get('set-cookie'),/Max-Age/);
   const session=await entry.json();assert.equal(session.credentialLogin,true);assert.equal((await fetch(base+'/',{headers:{Cookie:cookie}})).status,200);assert.equal((await fetch(base+'/api/session',{headers:{Cookie:cookie}})).status,200);
   const change=await fetch(base+'/api/session',{method:'POST',headers:{'x-panel-token':session.token,'Content-Type':'application/json'},body:JSON.stringify({userId:id})});assert.equal(change.status,200);const selected=await change.json(),newCookie=change.headers.get('set-cookie').split(';')[0];assert.equal(selected.user.id,id);assert.equal((await fetch(base+'/api/workflow/me',{headers:{'x-panel-token':session.token}})).status,403);
   const out=await fetch(base+'/api/session',{method:'DELETE',headers:{'x-panel-token':selected.token}});assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await fetch(base+'/api/session',{headers:{Cookie:newCookie}})).status,401);assert.equal((await fetch(base+'/',{redirect:'manual',headers:{Cookie:newCookie}})).status,302);
 }
 const persistent=await login({...credentials,remember:true});assert.match(persistent.headers.get('set-cookie'),/Max-Age=604\d{3}/);const p=await persistent.json();const r=await fetch(base+'/api/session',{method:'POST',headers:{'x-panel-token':p.token,'Content-Type':'application/json'},body:JSON.stringify({userId:'hr-demo'})});assert.match(r.headers.get('set-cookie'),/Max-Age=604\d{3}/);
 const cross=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify(credentials)});assert.equal(cross.status,403);
 const publicJs=await(await fetch(base+'/src/login.js')).text();assert.ok(!publicJs.includes(credentials.password));assert.equal((await fetch(base+'/.runtime/demo-login.json')).status,404);
});

test('missing configuration fails closed and repeated wrong passwords have a bounded retry window',async t=>{
 const unavailable=await gated(t,{unavailable:true});assert.equal((await fetch(unavailable+'/api/session')).status,401);assert.equal((await fetch(unavailable+'/api/login',{method:'POST',body:'{}'})).status,503);
 const base=await gated(t);for(let i=0;i<5;i++)assert.equal((await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({username:'synthetic-admin',password:'wrong'})})).status,401);
 const blocked=await fetch(base+'/api/login',{method:'POST',body:'{}'});assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
});

test('logout revokes only the caller session, clears cookie and never touches other sessions or data',async t=>{
 const root=await mkdtemp(join(tmpdir(),'kpi-logout-')),server=createPanelServer({dataRoot:root,autoAssessment:false,runModel:async()=>{throw Error('No model');}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
 const first=await(await fetch(base+'/api/session')).json(),second=await(await fetch(base+'/api/session')).json();const get=token=>fetch(base+'/api/workflow/me',{headers:{'x-panel-token':token}});assert.equal((await get(first.token)).status,200);assert.equal((await get(second.token)).status,200);
 const out=await fetch(base+'/api/session',{method:'DELETE',headers:{'x-panel-token':first.token}});assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await get(first.token)).status,403);assert.equal((await get(second.token)).status,200);assert.equal((await fetch(base+'/api/session',{method:'DELETE'})).status,403);
 const next=await(await fetch(base+'/api/session')).json();assert.notEqual(next.token,first.token);assert.equal((await get(next.token)).status,200);
});

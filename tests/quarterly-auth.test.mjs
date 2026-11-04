import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createPanelServer} from '../server.mjs';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/quarterly-workflow.mjs';
import {createLocalAccounts} from '../backend/local-accounts.mjs';
import {passwordDigest} from '../backend/demo-login.mjs';
test('independent accounts for three roles; cross-instance tokens and old-panel cookies are rejected',async t=>{
 const root=mkdtempSync(join(tmpdir(),'quarter-auth-')),servers=[],stores=[];
 t.after(async()=>{for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}for(const s of stores)s.close();rmSync(root,{recursive:true,force:true});});
 const password='Quarter-synthetic-password',salt='1'.repeat(32),demoLogin={username:'main-test',salt,digest:passwordDigest(password,salt)};
 async function instance(name){const db=join(root,name);seedQuarterlyFixture(db);const store=openStore(db);stores.push(store);const w=createWorkflow(store),accounts=createLocalAccounts(store,w);for(const id of ['admin','manager','employee-0'])await accounts.save(w.user('admin'),{userId:id,username:id,password});const s=createPanelServer({root:process.cwd(),dataRoot:db,authMode:'hybrid',demoLogin,autoAssessment:false,runModel:()=>{throw Error('No live AI');}});servers.push(s);s.listen(0,'127.0.0.1');await once(s,'listening');return {base:'http://127.0.0.1:'+s.address().port,store};}
 const a=await instance('a'),b=await instance('b');
 async function request(target,path,body,token,cookie){const r=await fetch(target.base+path,{method:body?'POST':'GET',headers:{...(token?{'x-panel-token':token}:{}),...(cookie?{cookie}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};}
 for(const [id,access]of [['admin','admin'],['manager','manager'],['employee-0','personnel']]){
  const login=await request(a,'/api/login',{username:id,password,access});assert.equal(login.status,200);assert.equal(login.data.user.id,id);assert.equal(login.data.demo,false);assert.equal(login.data.mustChangePassword,true);assert.match(login.cookie,/quarterly-panel-session=/);
  assert.equal((await request(b,'/api/org/quarters/1405-Q3',null,login.data.token)).status,403);
  const changed=await request(a,'/api/auth/password',{currentPassword:password,password:password+'-changed'},login.data.token);assert.equal(changed.status,200);assert.equal(changed.data.mustChangePassword,false);assert.equal((await request(a,'/api/session',{userId:'admin'},changed.data.token)).status,403);
  assert.equal((await request(b,'/api/login',{username:id,password,access})).status,200);
 }
 assert.equal((await request(a,'/api/session',null,null,'panel-session='+'a'.repeat(64))).status,401);
 const shared=await request(a,'/api/login',{username:'main-test',password,access:'main'});assert.equal(shared.data.demo,true);assert.equal((await request(a,'/api/session',{userId:'manager'},shared.data.token)).status,200);
});

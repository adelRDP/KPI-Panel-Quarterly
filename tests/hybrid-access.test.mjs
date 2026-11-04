import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {JSDOM} from 'jsdom';
import {Script} from 'node:vm';
import {createPanelServer} from '../server.mjs';
import {passwordDigest} from '../backend/demo-login.mjs';
const password='Synthetic-personal-password',changed='Synthetic-changed-password',sharedPassword='Synthetic-original-password';

test('hybrid preserves main switching while binding all three personal portals to their own identity across restart',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kpi-hybrid-')),salt='f'.repeat(32);let server,base;
 const start=async()=>{server=createPanelServer({dataRoot:dir,autoAssessment:false,authMode:'hybrid',demoLogin:{username:'original',salt,digest:passwordDigest(sharedPassword,salt)},runModel:async()=>{throw Error('No model calls allowed');}});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;};
 const stop=async()=>{if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}};
 t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});await start();
 const login=(access,username,password)=>fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({access,username,password,remember:true})});
 const call=(session,path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{'x-panel-token':session.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.deepEqual(await (await fetch(base+'/api/auth/options')).json(),{shared:true,personal:true});
 assert.equal((await fetch(base+'/api/session')).status,401);
 let response=await login('main','original',sharedPassword);assert.equal(response.status,200);let main=await response.json();const mainCookie=response.headers.get('set-cookie').split(';')[0];assert.equal(main.demo,true);
 response=await call(main,'/api/session',{userId:'hr-demo'});main=await response.json();assert.equal(main.canManageAccounts,true);const adminCookie=response.headers.get('set-cookie').split(';')[0];
 const users=[['admin','hr-demo'],['manager',main.accounts.find(p=>p.role==='manager').id],['personnel','employee-mohammad']];
 for(const [role,userId]of users){response=await call(main,'/api/auth/accounts',{userId,username:role+'.login',password});assert.equal(response.status,200);}
 // Main keeps full navigation even when that same identity has a temporary password.
 assert.equal((await call(main,'/api/org/chart')).status,200);
 assert.equal((await login('admin','original',sharedPassword)).status,401);
 assert.equal((await login('admin','personnel.login',password)).status,401);
 const personalCookies=[];
 for(const [role,userId]of users){
  response=await login(role,role+'.login',password);assert.equal(response.status,200);let session=await response.json();assert.equal(session.demo,false);assert.equal(session.user.id,userId);assert.equal(session.mustChangePassword,true);
  assert.equal((await call(session,'/api/workflow/me')).status,403);
  response=await call(session,'/api/auth/password',{currentPassword:password,password:changed});assert.equal(response.status,200);session=await response.json();personalCookies.push([userId,response.headers.get('set-cookie').split(';')[0]]);
  assert.equal(session.mustChangePassword,false);assert.equal(session.demo,false);
  assert.equal((await call(session,'/api/session',{userId:userId==='hr-demo'?'employee-mohammad':'hr-demo',access:'main'})).status,403);
  assert.equal((await call(session,'/api/org/chart')).status,200);
  assert.equal((await call(session,'/api/auth/accounts')).status,role==='admin'?200:403);
  if(role==='personnel')assert.ok(session.accounts.every(p=>p.id===userId));
 }
 await stop();await start();
 for(const [userId,cookie]of personalCookies){response=await fetch(base+'/api/session',{headers:{cookie}});assert.equal(response.status,200);const session=await response.json();assert.equal(session.user.id,userId);assert.equal(session.demo,false);}
 for(const cookie of [mainCookie,adminCookie]){response=await fetch(base+'/api/session',{headers:{cookie}});if(cookie===mainCookie){assert.equal(response.status,401);continue;}assert.equal(response.status,200);main=await response.json();assert.equal(main.demo,true);}
 response=await call(main,'/api/session',{userId:'employee-mohammad'});assert.equal(response.status,200);assert.equal((await response.json()).demo,true);
});

test('role login links select the intended entry and send the access alongside credentials',async()=>{
 const dom=new JSDOM(await readFile('login.html','utf8'),{url:'http://localhost/login.html?access=manager',runScripts:'outside-only'});
 try{const {window}=dom;let submitted;window.fetch=async(path,options)=>path==='/api/auth/options'?{ok:true,json:async()=>({shared:true,personal:true})}:{ok:false,json:async()=>{submitted=JSON.parse(options.body);return {error:'Synthetic refusal'};}};
 new Script(await readFile('src/login.js','utf8')).runInContext(dom.getInternalVMContext());await new Promise(r=>setTimeout(r,0));const form=window.document.querySelector('form');assert.equal(form.elements.access.value,'manager');form.elements.username.value='manager.login';form.elements.password.value=password;await form.onsubmit({preventDefault(){}});assert.equal(submitted.access,'manager');assert.equal(submitted.password,password);assert.match(window.document.querySelector('#loginTitle').textContent,/مدیر/);
 }finally{dom.window.close();}
});

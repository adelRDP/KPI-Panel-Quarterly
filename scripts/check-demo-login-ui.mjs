import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createPanelServer} from '../server.mjs';
import {passwordDigest} from '../backend/demo-login.mjs';
const root=await mkdtemp(join(tmpdir(),'kpi-login-ui-')),output=await mkdtemp(resolve('outputs/demo-login-ui-'));
const credentials={username:'synthetic-admin',password:'Synthetic-login-only-5040'},salt='b'.repeat(32),server=createPanelServer({dataRoot:root,demoLogin:{username:credentials.username,salt,digest:passwordDigest(credentials.password,salt)},autoAssessment:false,runModel:async()=>{throw Error('No model in login QA');}});
server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+join(output,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let ws;const checks=[];
try{
 let ports;for(let i=0;i<100;i++){try{ports=(await readFile(join(output,'profile','DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}assert.ok(ports);ws=new WebSocket('ws://127.0.0.1:'+ports[0]+ports[1]);await once(ws,'open');let seq=0,session;const pending=new Map();
 ws.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);});
 const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error(method+' timed out')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){try{if(await evaluate(expression))return;}catch{}await pause(100);}throw Error('Not settled: '+expression);};
 await send('Page.enable');await send('Page.navigate',{url:base});await wait("!!document.querySelector('#loginForm')");assert.equal(await evaluate('location.pathname'),'/login.html');
 for(const width of [1575,1024,390,320])for(const theme of ['dark','light']){
  await evaluate(`localStorage.setItem('kpi-panel-theme','${theme}')`);await send('Page.reload');await wait("!!document.querySelector('#loginForm')");assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');assert.equal(await evaluate("localStorage.getItem('kpi-panel-theme')"),theme);assert.equal(await evaluate("document.querySelector('#themeToggle')"),null);
  await send('Emulation.setDeviceMetricsOverride',{width,height:941,deviceScaleFactor:1,mobile:false});await evaluate('document.fonts.ready');await pause(120);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.login-atmosphere')).backgroundImage.includes('emerald_kpi_dashboard_login.svg')"),true);assert.equal(await evaluate("(async()=>{const r=await fetch('/src/assets/emerald_kpi_dashboard_login.svg');return r.status;})()"),200);
  const layout=await evaluate("(()=>{const c=document.querySelector('.login-card').getBoundingClientRect(),f=document.querySelector('#loginForm');return {left:c.left,right:c.right,width:c.width,pageWidth:document.documentElement.scrollWidth,fields:[...f.querySelectorAll('.login-field')].map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),canvasImages:document.querySelectorAll('.login-atmosphere image,.login-illustration image').length};})()");assert.ok(layout.left>=0&&layout.right<=width&&layout.pageWidth<=width);assert.ok(layout.fields.every(f=>f.width>180&&f.height>=50));assert.equal(layout.canvasImages,0);
  const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,`login-${width}-${theme}.png`),Buffer.from(shot.data,'base64'));checks.push({width,theme,layout});
 }
 assert.equal(await evaluate("document.querySelector('#togglePassword use').getAttribute('href')"),'#login-eye-off');await evaluate("document.querySelector('#togglePassword').click()");assert.equal(await evaluate("document.querySelector('[name=password]').type"),'text');assert.equal(await evaluate("document.querySelector('#togglePassword use').getAttribute('href')"),'#login-eye');await evaluate("document.querySelector('#togglePassword').click()");assert.equal(await evaluate("document.querySelector('[name=password]').type"),'password');assert.equal(await evaluate("document.querySelector('#togglePassword use').getAttribute('href')"),'#login-eye-off');
 await evaluate(`(()=>{const f=document.querySelector('#loginForm');f.elements.username.value=${JSON.stringify(credentials.username)};f.elements.password.value='wrong';f.requestSubmit();})()`);await wait("document.querySelector('#loginStatus').textContent.includes('نادرست')");assert.equal(await evaluate('location.pathname'),'/login.html');
 for(const id of ['employee-mohammad','manager-ops','hr-demo']){
  await send('Emulation.setDeviceMetricsOverride',{width:1575,height:941,deviceScaleFactor:1,mobile:false});
  await evaluate(`(()=>{const f=document.querySelector('#loginForm');f.elements.username.value=${JSON.stringify(credentials.username)};f.elements.password.value=${JSON.stringify(credentials.password)};f.requestSubmit();})()`);
  await wait("window.PanelWorkflow?.user&&!PanelWorkflow.working&&!!window.PanelUtilities");assert.equal(await evaluate('location.pathname'),'/');assert.equal(await evaluate('PanelWorkflow.loginProtected'),true);
  await evaluate(`(async()=>{const f=document.querySelector('#demoAccount');f.innerHTML='<option value="${id}">${id}</option>';f.value='${id}';await f.onchange({target:f});})()`);await wait('!PanelWorkflow.working');assert.equal(await evaluate('PanelWorkflow.user.id'),id);
  await evaluate("document.querySelector('#accountMenuToggle').click();document.querySelector('#panelLogout').click()");await wait("location.pathname==='/login.html'&&!!document.querySelector('#loginForm')");assert.equal(await evaluate("document.querySelector('.app-shell')===null"),true);
  const token=await evaluate("(async()=>{const r=await fetch('/api/session');return {status:r.status,data:await r.json()};})()");assert.equal(token.status,401);assert.equal(token.data.token,undefined);checks.push({role:id,loginLogout:true});
 }
 const report={syntheticOnly:true,liveModelCalls:0,checks};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,visualCases:8,roleLoginLogout:3,liveModelCalls:0}));
}finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3});}

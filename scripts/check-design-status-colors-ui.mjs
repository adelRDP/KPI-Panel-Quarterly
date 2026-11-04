import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createPanelServer} from '../server.mjs';
const root=await mkdtemp(join(tmpdir(),'kpi-status-colors-')),output=await mkdtemp(resolve('outputs/design-status-colors-')),checks=[];let modelCalls=0,ws;
const server=createPanelServer({dataRoot:root,autoAssessment:false,runModel:async()=>{modelCalls++;throw Error('No model in color QA');}});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+join(output,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'}),pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let ports;for(let i=0;i<100;i++){try{ports=(await readFile(join(output,'profile','DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}assert.ok(ports);ws=new WebSocket('ws://127.0.0.1:'+ports[0]+ports[1]);await once(ws,'open');let seq=0,session;const pending=new Map();
 ws.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);});
 const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error(method+' timed out')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Not settled: '+expression);};
 await send('Page.enable');await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});await wait('window.PanelWorkflow?.user&&!PanelWorkflow.working&&!PanelLifecycle.working');
 await evaluate("(async()=>{const f=document.querySelector('#demoAccount');f.innerHTML='<option value=manager-ops>حساب ساختگی</option>';f.value='manager-ops';await f.onchange({target:f});})()");
 await evaluate("window.statusWrites=[];window.statusErrors=[];addEventListener('error',e=>statusErrors.push(e.message));const originalStatusFetch=window.fetch;window.fetch=async(p,o)=>{if(o?.method==='POST'&&p!=='/api/session')statusWrites.push(p);if(p==='/api/org/designs')return new Response(JSON.stringify(['published','needs_revision','manager_review','hr_review','ai_pending','ai_failed','rejected','unknown'].map((status,i)=>({id:'color-test-'+i,status,period:document.querySelector('#workflowPeriod').value,employeeId:'employee-mohammad',managerId:'manager-ops',version:i+1,tasks:[]}))),{headers:{'content-type':'application/json'}});return originalStatusFetch(p,o);};");
 const db=new DatabaseSync(join(root,'panel.sqlite'),{readOnly:true}),snapshot=()=>JSON.stringify(db.prepare('SELECT id,kind,parent,value FROM records ORDER BY id').all()),before=snapshot();
 try{
  await evaluate("PanelWorkflow.go('tasks');PanelLifecycle.refresh()");await wait('!PanelWorkflow.working&&!PanelLifecycle.working');await wait("document.querySelectorAll('#designPublishedPanel [data-design-row]').length===8");
  for(const width of [1573,390,320])for(const theme of ['dark','light']){
   await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});if(await evaluate('document.documentElement.dataset.theme')!==theme)await evaluate("document.querySelector('#themeToggle').click()");await pause(250);await evaluate("document.querySelector('#designPublishedPanel').scrollIntoView({block:'start'})");
   const badges=await evaluate("[...document.querySelectorAll('#designPublishedPanel [data-design-row] > td:nth-child(4) .workflow-state')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),c=e.parentElement.getBoundingClientRect();return {status:e.dataset.status,text:e.textContent,color:s.color,background:s.backgroundColor,border:s.borderTopColor,insideCell:r.left>=c.left-1&&r.right<=c.right+1};})");
   assert.equal(badges.length,8);assert.equal(new Set(badges.slice(0,5).map(b=>b.color)).size,5);assert.equal(new Set(badges.slice(0,5).map(b=>b.background)).size,5);assert.equal(badges[5].color,badges[6].color);assert.ok(badges.every(b=>b.insideCell));assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
   // Opaque semantic backgrounds let the contrast check match the rendered badge.
   const luminance=color=>{const channels=[...color.matchAll(/[\d.]+/g)].slice(0,3).map(([n])=>{const c=Number(n)/(color.startsWith('color(srgb')?1:255);return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return channels.reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);};
   for(const badge of badges.slice(0,7)){const fg=luminance(badge.color),bg=luminance(badge.background);badge.contrast=(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);assert.ok(badge.contrast>=4.5,JSON.stringify(badge));}
   if(width===1573){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'statuses-'+theme+'.png'),Buffer.from(shot.data,'base64'));}checks.push({width,theme,badges});
  }
  assert.equal(snapshot(),before);
 }finally{db.close();}
 assert.equal(modelCalls,0);assert.deepEqual(await evaluate('statusWrites'),[]);assert.deepEqual(await evaluate('statusErrors'),[]);await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,modelCalls,writes:0,recordsUnchanged:true,checks},null,2));console.log(JSON.stringify({output,checks:checks.length,modelCalls,writes:0,recordsUnchanged:true}));
}finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3});}

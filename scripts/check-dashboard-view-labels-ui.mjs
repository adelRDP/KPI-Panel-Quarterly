import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createPanelServer} from '../server.mjs';
const root=await mkdtemp(join(tmpdir(),'kpi-dashboard-labels-')),output=await mkdtemp(resolve('outputs/dashboard-view-labels-ui-'));let modelCalls=0;
const server=createPanelServer({dataRoot:root,autoAssessment:false,runModel:async()=>{modelCalls++;throw Error('No model in dashboard label QA');}});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+join(output,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'}),pause=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];let ws;
try{
 let ports;for(let i=0;i<100;i++){try{ports=(await readFile(join(output,'profile','DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}assert.ok(ports);ws=new WebSocket('ws://127.0.0.1:'+ports[0]+ports[1]);await once(ws,'open');let seq=0,session;const pending=new Map();
 ws.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);});
 const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error(method+' timed out')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Not settled: '+expression);};
 await send('Page.enable');await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});await wait("window.PanelWorkflow?.user&&!PanelWorkflow.working&&!PanelLifecycle.working&&document.querySelector('.operations-cards')");await evaluate('document.fonts.ready');
 const salary=await evaluate("document.querySelector('#finalSalary').textContent");await evaluate("window.dashboardWrites=0;const f=window.fetch;window.fetch=(p,o)=>{if(o?.method==='POST')dashboardWrites++;return f(p,o);};");
 for(const width of [1575,1024,390,320])for(const theme of ['dark','light'])for(const [id,level] of [['showOperations','operations'],['showQuarter','quarter'],['showMonth','month']]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});await evaluate("if(document.querySelector('#sidebar').classList.contains('open'))document.querySelector('#mobileOverlay').click()");if(await evaluate('document.documentElement.dataset.theme')!==theme)await evaluate("document.querySelector('#themeToggle').click()");
  await evaluate("document.getElementById('"+id+"').click();window.scrollTo(0,0)");await pause(350);
  const layout=await evaluate("(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:r.width,height:r.height};},h=document.querySelector('.performance-heading h1');return {headingHidden:h.hidden,headingDisplay:getComputedStyle(h).display,buttons:[...document.querySelectorAll('.dashboard-level-switch button')].map(e=>({id:e.id,text:e.textContent,button:rect(e),label:rect(e.querySelector('span')),pressed:e.getAttribute('aria-pressed'),scroll:e.scrollWidth,client:e.clientWidth})),panels:['operationsOverview','quarterOverview','monthlyDetail'].map(id=>({id,hidden:document.getElementById(id).hidden})),pageWidth:document.documentElement.scrollWidth};})()");
  assert.deepEqual(layout.buttons.map(b=>b.text),['داشبورد پرسنل','نمای عملکرد فصلی','نمای عملکرد ماهانه']);assert.equal(layout.headingHidden,true);assert.equal(layout.headingDisplay,'none');assert.ok(layout.pageWidth<=width+1,JSON.stringify({width,level,layout}));
  assert.equal(layout.buttons.find(b=>b.id===id).pressed,'true');assert.equal(layout.panels.find(p=>p.id===({operations:'operationsOverview',quarter:'quarterOverview',month:'monthlyDetail'}[level])).hidden,false);
  for(const b of layout.buttons){assert.ok(b.button.height>=56);assert.ok(b.scroll<=b.client+1,JSON.stringify({width,level,button:b}));assert.ok(b.label.left>=b.button.left&&b.label.right<=b.button.right);assert.ok(Math.abs(b.button.width-layout.buttons[0].button.width)<1);assert.ok(Math.abs(b.button.height-layout.buttons[0].button.height)<1);}
  assert.equal(await evaluate("document.querySelector('#finalSalary').textContent"),salary);if(width===1575||width===390){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,level+'-'+width+'-'+theme+'.png'),Buffer.from(shot.data,'base64'));}checks.push({width,theme,level,layout});
 }
 assert.equal(modelCalls,0);assert.equal(await evaluate('dashboardWrites'),0);await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,liveModelCalls:0,writes:0,checks},null,2));console.log(JSON.stringify({output,checks:checks.length,liveModelCalls:0,writes:0}));
}finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3});}

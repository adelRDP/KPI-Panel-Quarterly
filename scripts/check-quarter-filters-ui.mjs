import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
import {createPanelServer} from '../server.mjs';import {openStore} from '../backend/store.mjs';
const root=await mkdtemp(join(tmpdir(),'kpi-quarter-filters-ui-')),output=await mkdtemp(resolve('outputs/quarter-filters-ui-')),server=createPanelServer({dataRoot:root,autoAssessment:false,runModel:async()=>{throw Error('No model in personnel layout QA');}}),store=openStore(root);
server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+join(output,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'}),pause=ms=>new Promise(r=>setTimeout(r,ms));let ws;const checks=[];
try{
 let ports;for(let i=0;i<100;i++){try{ports=(await readFile(join(output,'profile','DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}assert.ok(ports);ws=new WebSocket('ws://127.0.0.1:'+ports[0]+ports[1]);await once(ws,'open');let seq=0,session;const pending=new Map();
 ws.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);});
 const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error(method+' timed out')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Not settled: '+expression);};
 await send('Page.enable');await send('Page.navigate',{url:base});await wait('window.PanelWorkflow?.user&&!PanelWorkflow.working');
 await evaluate(`(async()=>{const f=document.querySelector('#demoAccount');f.innerHTML='<option value="hr-demo">ادمین آزمایشی</option>';f.value='hr-demo';await f.onchange({target:f});PanelWorkflow.go('quarters');await PanelWorkflow.refresh();})()`);await evaluate('document.fonts.ready');
 assert.equal(await evaluate("typeof window.PanelMoneyWords"),'function');

 for(const actor of ['hr-demo','manager-ops','employee-mohammad']){
  await evaluate(`(async()=>{const f=document.querySelector('#demoAccount');f.innerHTML='<option value="${actor}">حساب آزمایشی</option>';f.value='${actor}';await f.onchange({target:f});PanelWorkflow.go('quarters');await PanelWorkflow.refresh();})()`);await evaluate('document.fonts.ready');
  for(const width of [1575,1024,390,320])for(const theme of ['dark','light']){
   await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});if(await evaluate('document.documentElement.dataset.theme')!==theme)await evaluate("document.querySelector('#themeToggle').click()");await pause(350);
   assert.ok(await evaluate('document.documentElement.scrollWidth')<=width+1);
   if(actor==='employee-mohammad'){assert.equal(await evaluate("document.querySelector('#quarterFilters').hidden"),true);}
   else{
    assert.equal(await evaluate("document.querySelector('#quarterFilters').hidden"),false);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#quarterCards th')].map(e=>e.textContent)"),['پرسنل','واحد','مدل','امتیاز فصل','مبلغ KPI فصلی','سقف KPI','وضعیت','اقدام']);
    await evaluate("(()=>{const f=document.querySelector('#quarterUnitFilter');f.value='"+(actor==='hr-demo'?'id:finance':'id:ops')+"';f.dispatchEvent(new Event('change'));const n=document.querySelector('#quarterPersonnelSearch');n.value='"+(actor==='hr-demo'?'مریم':'محمد')+"';n.dispatchEvent(new Event('input'));})()");
    const rows=await evaluate("[...document.querySelectorAll('#quarterCards [data-quarter-person]')].map(e=>({name:e.cells[0].textContent,unit:e.cells[1].textContent}))");assert.ok(rows.length>0);assert.ok(rows.every(r=>r.unit===(actor==='hr-demo'?'مالی':'عملیات')));
    await evaluate("document.querySelector('#quarterFiltersClear').click()");
   }
   await evaluate("document.querySelector('#view-quarters').scrollIntoView({block:'start'})");if(width===1575||width===390){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,`${actor}-${width}-${theme}.png`),Buffer.from(shot.data,'base64'));}checks.push({actor,width,theme});
  }
 }
 await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,liveModelCalls:0,checks},null,2));console.log(JSON.stringify({output,checks:checks.length,liveModelCalls:0}));
}finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));store.close();await rm(root,{recursive:true,force:true,maxRetries:3});}

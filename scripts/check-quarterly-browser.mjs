import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createPanelServer} from '../server.mjs';
import {seedQuarterlyFixture} from '../tests/quarterly-fixture.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/quarterly-workflow.mjs';
const root=await mkdtemp(join(tmpdir(),'quarterly-browser-')),output=resolve('outputs/quarterly-browser');await mkdir(output,{recursive:true});
const fixture=seedQuarterlyFixture(join(root,'db'));
const setup=openStore(join(root,'db'));setup.put('workflow-policy',{id:'active-policy',version:'browser-test',weights:{exam:0,manager:100,routine:0,project:0,peer:0}});
const workflow=createWorkflow(setup);workflow.saveSurvey(workflow.user('manager'),{employeeId:'employee-1',period:fixture.period,score:100});setup.close();
const server=createPanelServer({dataRoot:join(root,'db'),uploadRoot:join(root,'uploads'),demoLogin:false,autoAssessment:false,runModel:async()=>{throw Error('Live model forbidden in UI test');}});server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port,browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+join(root,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'}),pause=ms=>new Promise(r=>setTimeout(r,ms));let ws;const checks=[],errors=[],failedRequests=[];
try{
 let ports;for(let i=0;i<150;i++){try{ports=(await readFile(join(root,'profile','DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}assert.ok(ports,'Chrome debugging startup');
 ws=new WebSocket('ws://127.0.0.1:'+ports[0]+ports[1]);await once(ws,'open');let seq=0,session;const pending=new Map();
 ws.addEventListener('message',event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);if(r.method==='Network.responseReceived'&&r.params.response.url.includes('/api/')&&r.params.response.status>=400)failedRequests.push({url:r.params.response.url,status:r.params.response.status});const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);});
 const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Not settled: '+expression);};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Page.navigate',{url:base});await wait('window.PanelWorkflow?.user&&!PanelWorkflow.working');
 for(const actor of ['admin','manager','employee-0']){
  await evaluate(`(async()=>{const f=document.querySelector('#demoAccount');f.innerHTML='<option value="${actor}">حساب آزمایشی</option>';f.value='${actor}';await f.onchange({target:f});})()`);await wait('!PanelWorkflow.working');
  const views=await evaluate("[...document.querySelectorAll('.main-nav [data-view]')].filter(e=>!e.hidden&&PanelWorkflow.canView(e.dataset.view)).map(e=>e.dataset.view)");
  for(const view of [...new Set(views)].filter(v=>!['chat','notes'].includes(v))){
   await evaluate(`PanelWorkflow.go(${JSON.stringify(view)})`);await pause(250);await wait('!PanelWorkflow.working');
   for(const width of [1573,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});await pause(200);const state=await evaluate("({active:document.querySelector('.view.active')?.id,overflow:document.documentElement.scrollWidth>innerWidth+2,period:document.querySelector('#workflowPeriod').value,text:document.querySelector('.view.active')?.innerText.slice(0,250)})");checks.push({actor,view,width,...state});if(state.overflow)errors.push({layout:{actor,view,width}});}
  }
  await evaluate(`PanelWorkflow.go('${actor==='manager'?'tasks':actor==='admin'?'quarters':'dashboard'}')`);await pause(300);
  await send('Emulation.setDeviceMetricsOverride',{width:1573,height:884,deviceScaleFactor:1,mobile:false});await pause(250);const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,actor+'.png'),Buffer.from(shot.data,'base64'));
  await evaluate("document.querySelector('#periodToggle').click()");assert.equal(await evaluate("document.querySelector('#workflowMonth').closest('label').hidden"),true);await evaluate("document.querySelector('#workflowQuarter').value='4';document.querySelector('#periodForm').requestSubmit()");await pause(300);await wait('!PanelWorkflow.working');assert.match(await evaluate("document.querySelector('#workflowPeriod').value"),/-Q4$/);
 }
 await evaluate(`(async()=>{const f=document.querySelector('#demoAccount');f.innerHTML='<option value="admin">ادمین آزمایشی</option>';f.value='admin';await f.onchange({target:f});PanelWorkflow.go('organization');})()`);await wait('!PanelWorkflow.working');await wait("document.querySelector('#settlementNames option')");
 await evaluate(`(()=>{document.querySelector('#personnelOperation').value='settlement';document.querySelector('#personnelOperation').dispatchEvent(new Event('change'));const f=document.querySelector('#settlementForm');f.elements.employeeName.value=[...document.querySelectorAll('#settlementNames option')].find(o=>o.value.includes('پرسنل آزمایشی 1')).value;f.elements.employeeName.dispatchEvent(new Event('input'));f.elements.settlementDate.value=PanelDate.today();window.originalConfirm=window.confirm;window.confirm=text=>{window.settlementConfirmation=text;return false;};})()`);
 await evaluate("document.querySelector('#settlementForm').onsubmit(new Event('submit',{cancelable:true}))");
 assert.match(await evaluate('window.settlementConfirmation'),/تا پایان روز/);let proof=openStore(join(root,'db'),{readOnly:true});assert.equal(proof.list('personnel-settlement').length,0);proof.close();checks.push({actor:'admin',view:'settlement',action:'preview-cancel',passed:true});
 await evaluate("window.confirm=()=>true;document.querySelector('#settlementForm').onsubmit(new Event('submit',{cancelable:true}))");await wait("document.querySelector('#settlementHistory').textContent.includes('پرسنل آزمایشی 1')");
 proof=openStore(join(root,'db'),{readOnly:true});assert.equal(proof.list('personnel-settlement').length,1);assert.equal(proof.list('position-closeout').length,1);proof.close();checks.push({actor:'admin',view:'settlement',action:'confirm-lock',passed:true});await evaluate('window.confirm=window.originalConfirm');
 await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,checks,errors,failedRequests},null,2));console.log(JSON.stringify({checks:checks.length,errors:errors.length,failedRequests,output}));assert.equal(errors.length,0);assert.equal(failedRequests.length,0);
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors,failedRequests},null,2));throw error;}
finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await pause(500);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500});}

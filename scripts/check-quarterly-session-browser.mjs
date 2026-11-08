import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {passwordDigest} from '../backend/demo-login.mjs';
import assert from 'node:assert/strict';
import {createPanelServer} from '../server.mjs';
import {seedQuarterlyFixture} from '../tests/quarterly-fixture.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/quarterly-workflow.mjs';
const root=await mkdtemp(join(tmpdir(),'quarterly-browser-')),output=resolve('outputs/quarterly-session-browser');await mkdir(output,{recursive:true});
const fixture=seedQuarterlyFixture(join(root,'db'));
const setup=openStore(join(root,'db'));setup.put('workflow-policy',{id:'active-policy',version:'browser-test',weights:{exam:0,manager:100,routine:0,project:0,peer:0}});
const workflow=createWorkflow(setup);workflow.saveSurvey(workflow.user('manager'),{employeeId:'employee-1',period:fixture.period,score:100});setup.close();
const server=createPanelServer({dataRoot:join(root,'db'),uploadRoot:join(root,'uploads'),demoLogin:{username:'audit-main',salt:'1'.repeat(32),digest:passwordDigest('Synthetic-Switch-Password','1'.repeat(32))},autoAssessment:false,runModel:async()=>{throw Error('Live model forbidden in UI test');}});server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port,browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+join(root,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'}),pause=ms=>new Promise(r=>setTimeout(r,ms));let ws;const checks=[],errors=[],failedRequests=[];
try{
 let ports;for(let i=0;i<150;i++){try{ports=(await readFile(join(root,'profile','DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}assert.ok(ports,'Chrome debugging startup');
 ws=new WebSocket('ws://127.0.0.1:'+ports[0]+ports[1]);await once(ws,'open');let seq=0,session;const pending=new Map();
 ws.addEventListener('message',event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);if(r.method==='Network.responseReceived'&&r.params.response.url.includes('/api/')&&r.params.response.status>=400)failedRequests.push({url:r.params.response.url,status:r.params.response.status});const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);});
 const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Not settled: '+expression);};

 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Page.navigate',{url:base});await wait("location.pathname==='/login.html'");await evaluate("fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'audit-main',password:'Synthetic-Switch-Password',access:'main'})}).then(async r=>{if(!r.ok)throw Error(await r.text());return true;})");await send('Page.navigate',{url:base});await wait('window.PanelWorkflow?.user&&!PanelWorkflow.working');
 await wait('!!window.PanelNotifications');await evaluate(`(()=>{window.auditFetch=window.fetch;window.fetch=(url,options)=>{if(String(url)==='/api/notifications'&&!window.auditHeld){window.auditHeld=true;return new Promise((resolve,reject)=>{window.auditRelease=()=>window.auditFetch(url,options).then(resolve,reject);});}return window.auditFetch(url,options);};PanelNotifications.refresh();})()`);await wait('!!window.auditRelease');
 await evaluate(`(async()=>{const f=document.querySelector('#demoAccount');f.innerHTML='<option value="manager">Synthetic manager</option>';f.value='manager';await f.onchange({target:f});})()`);await wait("PanelWorkflow.user?.id==='manager'&&!PanelWorkflow.working");
 const before=await evaluate("(window.auditMarker='active-new-session',({path:location.pathname,user:PanelWorkflow.user.id}))");await evaluate('window.auditRelease();true');for(let i=0;i<40;i++){await pause(100);if((await evaluate('location.pathname'))==='/login.html')break;}
 const after=await evaluate('({path:location.pathname,hasPanel:!!window.PanelWorkflow?.user,marker:window.auditMarker||null})');assert.equal(after.marker,'active-new-session');assert.equal(after.path,'/');assert.equal(after.hasPanel,true);assert.equal(await evaluate('PanelWorkflow.user.id'),'manager');assert.equal(errors.length,0);assert.ok(failedRequests.some(r=>r.url.endsWith('/api/notifications')&&r.status===403));const result={syntheticOnly:true,fixed:true,before,after,failedRequests,description:'A delayed notification with an invalidated token is ignored; the new manager session and page state remain active.'};await writeFile(join(output,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,errors,failedRequests},null,2));throw error;}
finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await pause(500);assert.equal(resolve(root,'..'),resolve(tmpdir()));assert.ok(root.split(/[\\/]/).at(-1).startsWith('quarterly-browser-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500});}

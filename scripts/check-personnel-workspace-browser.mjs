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
const root=await mkdtemp(join(tmpdir(),'quarterly-browser-')),output=resolve('outputs/personnel-workspace-browser');await mkdir(output,{recursive:true});
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
 await evaluate("PanelWorkflow.go('organization')");await wait("document.querySelector('#personCreateForm').elements.unitId.options.length>0");
 const active=()=>evaluate("document.querySelector('.personnel-workflow-tabs [aria-selected=true]').dataset.personnelSection");
 const select=async id=>{await evaluate(`{const tab=document.querySelector('[data-personnel-section="${id}"]');tab.focus();tab.click();}`);await pause(50);assert.equal(await active(),id);assert.equal(await evaluate("[...document.querySelectorAll('.personnel-workflow-panel')].filter(p=>!p.hidden).length"),1);};
 assert.equal(await active(),'onboarding');checks.push('registration is the default workspace');
 assert.equal(await evaluate("document.querySelector('#personnelOperation').closest('label').hidden"),true);
 assert.equal(await evaluate("document.querySelectorAll('.personnel-workflow-tabs [role=tab]').length"),4);
 assert.equal(await evaluate("document.querySelectorAll('#personCreateForm fieldset').length"),2);
 await evaluate("document.querySelector('#personCreateForm').elements.name.value='پیش‌نویس آزمایشی';document.querySelector('#personCreateForm').elements.employeeCode.value='QA-DRAFT'");
 for(const id of ['transfer','structure','settlement','onboarding'])await select(id);
 assert.equal(await evaluate("document.querySelector('#personCreateForm').elements.name.value"),'پیش‌نویس آزمایشی');checks.push('tab switches preserve the entered draft');
 await evaluate("PanelWorkflow.refresh()");assert.equal(await active(),'onboarding');assert.equal(await evaluate("document.querySelector('#personCreateForm').elements.name.value"),'پیش‌نویس آزمایشی');checks.push('normal refresh preserves the workspace and draft');
 await evaluate("document.querySelector('#personnel-tab-onboarding').focus()");
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft'});
 assert.equal(await evaluate('document.activeElement.id'),'personnel-tab-transfer');assert.equal(await active(),'onboarding');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});assert.equal(await active(),'transfer');checks.push('RTL arrow keys move focus and Enter selects the intended tab');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End'});assert.equal(await evaluate('document.activeElement.id'),'personnel-tab-settlement');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home'});assert.equal(await evaluate('document.activeElement.id'),'personnel-tab-onboarding');checks.push('Home and End navigate the tab list');
 await evaluate("{const mode=document.querySelector('#personnelOperation');mode.value='settlement';mode.dispatchEvent(new Event('change'));}");assert.equal(await active(),'settlement');checks.push('legacy operation entry points reveal the matching panel');
 for(const id of ['onboarding','transfer','structure','settlement'])for(const width of [1577,1092,390,320])for(const theme of ['dark','light']){
  await send('Emulation.setDeviceMetricsOverride',{width,height:883,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await select(id);await evaluate("scrollTo(0,0)");await pause(80);
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+2'),false,JSON.stringify({id,width,theme}));
  assert.equal(await evaluate("document.querySelectorAll('.personnel-workflow-tabs [tabindex=\"0\"]').length"),1);
  const bounds=await evaluate("(()=>{const r=document.querySelector('.personnel-workflow-tabs').getBoundingClientRect();return {width:r.width,height:r.height};})()");assert.ok(bounds.width>200);
  if(width===1577||width===390){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,id+'-'+theme+'-'+width+'.png'),Buffer.from(shot.data,'base64'));}
  checks.push({section:id,width,theme,overflow:false});
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1577,height:883,deviceScaleFactor:1,mobile:false});await select('transfer');
 await evaluate("scrollTo(0,500)");await pause(80);
 const sticky=await evaluate("(()=>{const r=document.querySelector('.personnel-workflow-tabs').getBoundingClientRect();return {top:r.top,header:document.querySelector('.topbar').getBoundingClientRect().bottom};})()");assert.ok(sticky.top>=sticky.header&&sticky.top<=sticky.header+12,JSON.stringify(sticky));checks.push('section navigation stays below the fixed header while scrolling');
 await select('structure');
 const revealed=await evaluate("({panel:document.querySelector('.personnel-workspace').getBoundingClientRect().top,tabs:document.querySelector('.personnel-workflow-tabs').getBoundingClientRect().bottom})");
 assert.ok(revealed.panel>=revealed.tabs-2&&revealed.panel<=revealed.tabs+40,JSON.stringify(revealed));checks.push('switching from a scrolled form reveals the next section from its beginning');
 await select('onboarding');
 await evaluate("{const form=document.querySelector('#personCreateForm');form.elements.role.value='manager';form.elements.role.dispatchEvent(new Event('change'));}");assert.equal(await evaluate("document.querySelector('#personCreateForm').elements.baseSalary.disabled"),true);
 await evaluate("{const form=document.querySelector('#personCreateForm');form.elements.role.value='personnel';form.elements.role.dispatchEvent(new Event('change'));}");assert.equal(await evaluate("document.querySelector('#personCreateForm').elements.baseSalary.disabled"),false);checks.push('manager/personnel fields still follow the access type');

 await select('structure');
 await evaluate("{const f=document.querySelector('#unitForm');f.elements.id.value='qa-workspace';f.elements.name.value='واحد آزمون ناوبری';f.requestSubmit();}");
 await wait("document.querySelector('#unitList').textContent.includes('واحد آزمون ناوبری')&&!PanelLifecycle.working");assert.equal(await active(),'structure');checks.push('unit creation submits through the existing form and stays in structure');
 await evaluate("{const f=document.querySelector('#sectionForm');f.elements.name.value='بخش آزمون ناوبری';f.elements.unitId.value='qa-workspace';f.requestSubmit();}");
 await wait("document.querySelector('#sectionList').textContent.includes('بخش آزمون ناوبری')&&!PanelLifecycle.working");checks.push('section creation and its parent unit still submit normally');
 await select('onboarding');
 await evaluate("{const f=document.querySelector('#personCreateForm');f.elements.role.value='manager';f.elements.role.dispatchEvent(new Event('change'));f.elements.name.value='مدیر آزمون ناوبری';f.elements.employeeCode.value='QA-WORKSPACE';f.elements.jobTitle.value='مدیر آزمون';f.elements.jobLevel.value='مدیر';f.elements.unitId.value='qa-workspace';f.elements.unitId.dispatchEvent(new Event('change'));f.elements.effectiveFrom.value=PanelDate.today();f.requestSubmit();}");
 await wait("PanelWorkflow.accounts.some(p=>p.name==='مدیر آزمون ناوبری')&&!PanelLifecycle.working");assert.equal(await active(),'onboarding');checks.push('registration submits through the existing form after regrouping fields');
 assert.equal(errors.length,0);assert.equal(failedRequests.length,0);
 await rm(join(output,'failure.json'),{force:true});
 await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,checks,errors,failedRequests},null,2));console.log(JSON.stringify({checks:checks.length,errors,failedRequests,output}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors,failedRequests},null,2));throw error;}
finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await pause(500);assert.equal(resolve(root,'..'),resolve(tmpdir()));assert.ok(root.split(/[\\/]/).at(-1).startsWith('quarterly-browser-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500});}

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
const root=await mkdtemp(join(tmpdir(),'quarterly-browser-')),output=resolve('outputs/personnel-fields-browser');await mkdir(output,{recursive:true});
const fixture=seedQuarterlyFixture(join(root,'db'));
const setup=openStore(join(root,'db'));setup.put('workflow-policy',{id:'active-policy',version:'browser-test',weights:{exam:0,manager:100,routine:0,project:0,peer:0}});
const workflow=createWorkflow(setup);workflow.saveSurvey(workflow.user('manager'),{employeeId:'employee-1',period:fixture.period,score:100});setup.put('org-section',{id:'a-support',unitId:'u',name:'پشتیبانی'});setup.put('org-section',{id:'z-support',unitId:'u',name:'پشتیبانی'});const person=setup.get('employee-0','workflow-user');setup.put('workflow-user',{...person,sectionId:'z-support',jobFamily:'پشتیبانی'});const position=setup.get('position-employee-0','position-assignment');setup.put('position-assignment',{...position,sectionId:'z-support',jobFamily:'پشتیبانی'},'employee-0');setup.close();
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

 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__personnelPayload=null;const nativeFetch=window.fetch;window.fetch=(input,options={})=>{if(String(input)==='/api/org/sections')return Promise.resolve(Response.json([{id:'a-support',unitId:'u',name:'پشتیبانی'},{id:'z-support',unitId:'u',name:'پشتیبانی'}]));if(String(input)==='/api/org/people'&&options.method==='POST')window.__personnelPayload=JSON.parse(options.body);return nativeFetch(input,options);};`});
 await send('Emulation.setDeviceMetricsOverride',{width:1577,height:883,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base});await wait('window.PanelWorkflow?.user&&!PanelWorkflow.working');
 await evaluate("PanelWorkflow.go('organization');PanelLifecycle.refresh()");
 await evaluate("document.querySelector('[data-personnel-section=transfer]').click();document.querySelector('#positionEmployee').value='employee-0';document.querySelector('#positionEmployee').onchange()");
 assert.equal(await evaluate("document.querySelector('#positionSection').value"),'a-support');checks.push('legacy section ids map to the single canonical choice');
 await evaluate("document.querySelector('[data-personnel-section=onboarding]').click();document.querySelector('#newPersonUnit').value='u';document.querySelector('#newPersonUnit').onchange()");
 assert.equal(await evaluate("[...document.querySelector('#newPersonSection').options].filter(o=>o.text==='پشتیبانی').length"),1);checks.push('older server duplicate sections appear once in the new-person form');
 assert.match(await evaluate("document.querySelector('#newPersonStart').value"),/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/);checks.push('initial start date displays Persian digits');
 await evaluate("document.querySelector('#personCreateForm').elements.phone.focus()");await send('Input.insertText',{text:'091234567890'});
 assert.equal(await evaluate("document.querySelector('#personCreateForm').elements.phone.value.length"),11);
 for(const [value,valid] of [['0912345678',false],['091234567890',false],['09123456789',true],['۰۹۱۲۳۴۵۶۷۸۹',true],['09abcdefghi',false],['',true]]){
  const actual=await evaluate(`{const input=document.querySelector('#personCreateForm').elements.phone;input.value=${JSON.stringify(value)};input.checkValidity();}`);assert.equal(actual,valid);checks.push({mobile:value.length,valid});
 }
 for(const theme of ['dark','light'])for(const width of [1577,1092,390,320]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:883,deviceScaleFactor:1,mobile:false});await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await pause(350);
  await evaluate("{const f=document.querySelector('#personCreateForm');f.elements.baseSalary.value='';f.elements.baseSalary.dispatchEvent(new Event('input',{bubbles:true}));}");
  const before=await evaluate("(()=>{const f=document.querySelector('#personCreateForm');return {manager:f.elements.managerId.getBoundingClientRect().top,salary:f.elements.baseSalary.getBoundingClientRect().top,date:f.elements.effectiveFrom.getBoundingClientRect().top};})()");
  await evaluate("{const f=document.querySelector('#personCreateForm');f.elements.baseSalary.value='13884426';f.elements.baseSalary.dispatchEvent(new Event('input',{bubbles:true}));}");
  assert.equal(await evaluate("document.querySelector('#personCreateForm').elements.baseSalary.value"),'۱۳٬۸۸۴٬۴۲۶');
  const after=await evaluate("(()=>{const f=document.querySelector('#personCreateForm');return {manager:f.elements.managerId.getBoundingClientRect().top,salary:f.elements.baseSalary.getBoundingClientRect().top,date:f.elements.effectiveFrom.getBoundingClientRect().top};})()");
  assert.ok(Math.abs(before.manager-after.manager)<1&&Math.abs(before.salary-after.salary)<1&&Math.abs(before.date-after.date)<1,JSON.stringify({theme,width,before,after,words:await evaluate("(()=>{const e=document.querySelector('#newPersonSalaryWords'),s=getComputedStyle(e),p=e.parentElement;return {text:e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,parentWidth:p.getBoundingClientRect().width,font:s.fontSize,line:s.lineHeight,columns:getComputedStyle(p).gridTemplateColumns,form:document.querySelector('#personCreateForm').getBoundingClientRect().width};})()")}));
  if(width>580)assert.ok(Math.abs(after.manager-after.salary)<1,JSON.stringify(after));
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+2'),false);
  await evaluate("document.querySelector('#personCreateForm').elements.managerId.scrollIntoView({block:'center'})");await pause(100);
  if(width===1577||width===390){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,theme+'-'+width+'.png'),Buffer.from(shot.data,'base64'));}
  checks.push({theme,width,stableRows:true,persianMoney:true});
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1577,height:883,deviceScaleFactor:1,mobile:false});
 await evaluate("{const f=document.querySelector('#personCreateForm');f.elements.name.value='پرسنل آزمون فیلدها';f.elements.employeeCode.value='QA-FIELDS';f.elements.phone.value='۰۹۱۲۳۴۵۶۷۸۹';f.elements.jobTitle.value='کارشناس پشتیبانی';f.elements.sectionId.value='a-support';f.elements.jobLevel.value='کارشناس';f.elements.managerId.value='manager';f.elements.duties.value='تهیه گزارش قابل بررسی برای مدیر';f.requestSubmit();}");
 await wait("PanelWorkflow.accounts.some(p=>p.name==='پرسنل آزمون فیلدها')&&!PanelLifecycle.working");
 const payload=await evaluate('window.__personnelPayload');assert.equal(payload.baseSalary,13884426);assert.equal(payload.phone,'09123456789');assert.equal(payload.sectionId,'a-support');assert.match(payload.effectiveFrom,/^\d{4}-\d{2}-\d{2}$/);checks.push('the normal submission sends numeric salary, normalized mobile and Gregorian date');
 assert.match(await evaluate("document.querySelector('#newPersonStart').value"),/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/);checks.push('the date remains Persian after a successful form reset');
 assert.equal(errors.length,0);assert.equal(failedRequests.length,0);await rm(join(output,'failure.json'),{force:true});await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,checks,errors,failedRequests},null,2));console.log(JSON.stringify({checks:checks.length,errors,failedRequests,output}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors,failedRequests},null,2));throw error;}
finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await pause(500);assert.equal(resolve(root,'..'),resolve(tmpdir()));assert.ok(root.split(/[\\/]/).at(-1).startsWith('quarterly-browser-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500});}

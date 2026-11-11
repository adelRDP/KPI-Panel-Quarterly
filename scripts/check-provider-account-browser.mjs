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
const root=await mkdtemp(join(tmpdir(),'quarterly-browser-')),output=resolve('outputs/provider-account-browser');await mkdir(output,{recursive:true});
const fixture=seedQuarterlyFixture(join(root,'db'));
const setup=openStore(join(root,'db'));setup.put('workflow-policy',{id:'active-policy',version:'browser-test',weights:{exam:0,manager:100,routine:0,project:0,peer:0}});
const workflow=createWorkflow(setup);workflow.saveSurvey(workflow.user('manager'),{employeeId:'employee-1',period:fixture.period,score:100});setup.close();
const server=createPanelServer({dataRoot:join(root,'db'),uploadRoot:join(root,'uploads'),demoLogin:false,authMode:'hybrid',autoAssessment:false,runModel:async()=>{throw Error('Live model forbidden in UI test');}});server.listen(0,'127.0.0.1');await once(server,'listening');
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
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.__modelSaves=[];
  const nativeFetch=window.fetch;
  const providerState={defaultProvider:'codex',editable:true,allowKeyEntry:true,automaticReview:false,providers:[
   {provider:'codex',enabled:true,ready:false,model:'gpt-6-luna',reasoningEffort:'medium',reasoningEfforts:['low','medium','high','xhigh','max'],message:'Synthetic'},
   {provider:'openai',enabled:false,ready:false,model:'',reasoningEffort:'medium',reasoningEfforts:['low','medium','high','xhigh','max'],message:'Synthetic'},
   {provider:'gemini',enabled:false,ready:false,model:'',message:'Synthetic'}]};
  window.fetch=async(input,options={})=>{
   const path=String(input);
   if(path==='/api/providers/settings')return Response.json(providerState);
   if(path.endsWith('/save')&&path.startsWith('/api/providers/settings/')){const patch=JSON.parse(options.body);window.__modelSaves.push(patch);Object.assign(providerState.providers.find(p=>p.provider===path.split('/')[4]),patch);return Response.json({message:'Synthetic saved'});}
   return nativeFetch(input,options);
  };`});
 await send('Page.navigate',{url:base});await wait('window.PanelWorkflow?.user&&!PanelWorkflow.working');
 await evaluate("PanelWorkflow.go('ai-model-settings')");
 await wait("document.querySelectorAll('[data-ai-provider]').length===3");
 assert.equal(await evaluate("document.querySelectorAll('[name=reasoningEffort]').length"),2);checks.push('reasoning dropdowns for Codex and OpenAI');
 for(const provider of ['codex','openai']){
  assert.equal(await evaluate(`document.querySelector('[data-ai-provider="${provider}"] [name=model]').hasAttribute('list')`),false);
  assert.equal(await evaluate(`document.querySelector('[data-ai-provider="${provider}"] [data-discover-models]')===null`),true);
  await evaluate(`document.querySelector('[data-ai-provider="${provider}"] [name=model]').value='gpt-6.1-sol'`);
  await evaluate(`{const form=document.querySelector('[data-ai-provider="${provider}"]');form.elements.reasoningEffort.value='high';form.requestSubmit(form.querySelector('[data-action=save]'));}`);
  await wait(`document.querySelector('[data-ai-provider="${provider}"] [name=reasoningEffort]').dataset.savedEffort==='high'`);
  checks.push(provider+' manual model entry and reasoning save');
 }
 assert.equal(await evaluate('window.__modelSaves.every(p=>p.reasoningEffort===\'high\')'),true);
 await evaluate("document.querySelector('.brand-home').click()");await wait("document.querySelector('#view-quarters').classList.contains('active')");checks.push('logo opens dashboard');
 await evaluate("PanelWorkflow.go('account-security')");await wait("document.querySelector('#accountProvisionForm').elements.userId.options.length>0");
 assert.equal(await evaluate("document.querySelector('#accountProvisionForm').elements.password.value"),'123456');
 assert.equal(await evaluate("document.querySelector('#accountProvisionForm').elements.password.minLength"),6);
 await evaluate("URL.createObjectURL=()=> 'blob:synthetic';URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){};document.querySelector('#createDefaultAccounts').click()");
 await wait("document.querySelector('#accountCredentialsList').textContent.includes('123456')&&!PanelAccountSecurity.working");
 const count=await evaluate("document.querySelectorAll('#accountCredentialsList tbody tr').length");assert.ok(count>0);checks.push('bulk creation displays default temporary passwords');
 await evaluate("document.querySelector('#createDefaultAccounts').click()");
 await wait("document.querySelector('#accountSecurityStatus').textContent.includes('حساب جدیدی ساخته نشد')");
 assert.equal(await evaluate("document.querySelectorAll('#accountCredentialsList tbody tr').length"),count);checks.push('repeat bulk creation is a no-op');
 await evaluate('location.reload()');await wait('window.PanelWorkflow?.user&&!PanelWorkflow.working');await evaluate("PanelWorkflow.go('account-security')");await wait("document.querySelector('#accountCredentialsList').textContent.includes('123456')");checks.push('temporary passwords persist across reload');
 for(const theme of ['dark','light'])for(const width of [1573,1092,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await pause(100);
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+2'),false);
  const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'accounts-'+theme+'-'+width+'.png'),Buffer.from(shot.data,'base64'));checks.push('accounts '+theme+' '+width);
 }
 await evaluate("PanelWorkflow.go('ai-model-settings')");await wait("document.querySelectorAll('[data-ai-provider]').length===3");
 for(const theme of ['dark','light'])for(const width of [1092,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await pause(100);
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+2'),false);const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'models-'+theme+'-'+width+'.png'),Buffer.from(shot.data,'base64'));checks.push('models '+theme+' '+width);
 }
 assert.equal(errors.length,0);assert.equal(failedRequests.length,0);
 await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,checks,errors,failedRequests},null,2));console.log(JSON.stringify({checks:checks.length,errors,failedRequests,output}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors,failedRequests},null,2));throw error;}
finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await pause(500);assert.equal(resolve(root,'..'),resolve(tmpdir()));assert.ok(root.split(/[\\/]/).at(-1).startsWith('quarterly-browser-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500});}

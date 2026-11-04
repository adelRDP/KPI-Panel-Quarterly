// Browser QA against the persistent, synthetic instance only. Never starts a real panel.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const folder=resolve(process.argv[2]||''),c=JSON.parse(await readFile(join(folder,'sandbox.json'),'utf8')),state=JSON.parse(await readFile(join(folder,'scenario-state.json'),'utf8'));
assert.equal(c.origin,'http://localhost:4174');assert.equal(c.version,'transfer-sandbox-v1');
const output=join(folder,'browser');await mkdir(output,{recursive:true});const profile=await mkdtemp(join(output,'profile-')),checks=[],errors=[],pause=ms=>new Promise(r=>setTimeout(r,ms));let ws;
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
try{
 let ports;for(let i=0;i<100;i++){try{ports=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}assert.ok(ports,'Chrome debugging endpoint');ws=new WebSocket('ws://127.0.0.1:'+ports[0]+ports[1]);await once(ws,'open');let sequence=0,session;const pending=new Map();
 ws.addEventListener('message',event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);});
 const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error(method+' timed out')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Not settled: '+expression);};
 const settle=()=>wait('window.PanelWorkflow?.user&&!PanelWorkflow.working&&!PanelLifecycle.working');
 const account=async(id,role)=>{await settle();await evaluate(`(async()=>{document.querySelector('#demoRole').value='${role}';const f=document.querySelector('#demoAccount');f.innerHTML='<option value="${id}">حساب ساختگی</option>';f.value='${id}';await f.onchange({target:f});})()`);await settle();};
 const capture=async name=>{const data=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(data.data,'base64'));};
 await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:c.origin});await settle();console.log('Browser loaded');
 assert.match(await evaluate("document.querySelector('#sandboxSafetyBanner').textContent"),/آزمایشی جدا/);assert.equal(await evaluate('location.hostname'),'localhost');
 await evaluate("(async()=>{workflowYear.value='1404';workflowYear.onchange();workflowQuarter.value='3';workflowQuarter.onchange();workflowMonth.value='07';await periodForm.onsubmit({preventDefault(){}});})()");await settle();assert.equal(await evaluate('document.querySelector("#workflowPeriod").value'),'1404-07');
 // Cancel settlement through the real HR UI; no transfer may be persisted.
 await account('hr-demo','hr');await evaluate("PanelWorkflow.go('incoming');PanelLifecycle.refresh()");await settle();console.log('HR incoming loaded');
 const proposal=state.manual.proposal.id;await wait(`document.querySelector('[data-incoming-detail="${proposal}"]')`);await evaluate(`document.querySelector('[data-incoming-detail="${proposal}"]').click()`);
 await evaluate(`window.confirm=text=>{window.sandboxCloseoutConfirmation=text;return false;};document.querySelector('[data-approve-position="${proposal}"]').click()`);await wait('window.sandboxCloseoutConfirmation&&!PanelLifecycle.working');
 assert.match(await evaluate('sandboxCloseoutConfirmation'),/مبلغ قطعی/);const closeouts=await evaluate("PanelWorkflow.api('/api/org/position-closeouts')");assert.equal(closeouts.filter(x=>x.employeeId===state.manual.employee.id).length,0);checks.push({name:'HR cancellation leaves manual case untouched'});
 for(const [id,role] of [['hr-demo','hr'],[state.completed.employee.id,'personnel'],['manager-finance','manager']]){
  await account(id,role);await evaluate("PanelWorkflow.go('quarters');PanelLifecycle.refresh()");await settle();
  if(role!=='manager'){await evaluate("document.querySelector('#loadPositionCloseouts').click()");await wait("document.querySelector('#positionCloseoutHistory details')");await evaluate("document.querySelector('#positionCloseoutHistory details').open=true");const text=await evaluate("document.querySelector('#positionCloseoutHistory').textContent");assert.ok(text.includes('۲٬۰۰۰٬۰۰۰')||text.includes('۲,۰۰۰,۰۰۰'),text);}
  else {assert.equal(await evaluate("document.querySelector('#positionCloseoutPanel').hidden"),true);assert.equal(await evaluate("document.querySelector('#positionCloseoutHistory').textContent"),'');const safe=await evaluate("PanelWorkflow.api('/api/org/quarters/1404-Q3')");const q=safe.find(x=>x.employee.id===state.completed.employee.id);assert.equal(q.quarterPay.earned,undefined);}
  for(const width of [1573,390])for(const theme of ['dark','light']){await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});await pause(250);await evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('${role==='manager'?'#quarterCards':'#positionCloseoutPanel'}').scrollIntoView({block:'center'})`);const overflow=await evaluate('document.documentElement.scrollWidth>innerWidth+2');assert.equal(overflow,false);checks.push({role,width,theme,overflow});await capture(`${role}-${width}-${theme}`);}
 }
 await account(state.completed.employee.id,'personnel');await evaluate("PanelWorkflow.go('assignments');PanelWorkflow.refresh()");await settle();await wait("document.querySelector('#assignedActivities details')");await evaluate("document.querySelector('#assignedActivities details').open=true");
 const assignments=await evaluate("document.querySelector('#assignedActivities').textContent");assert.match(assignments,/بسته‌شده/);assert.match(assignments,/فقط مشاهده/);
 for(const width of [1573,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});await pause(250);await evaluate("document.querySelector('#assignedActivities details').scrollIntoView({block:'center'})");assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+2'),false);checks.push({name:'closed tasks read-only group',width});await capture('closed-assignments-'+width);}
 assert.deepEqual(errors,[]);await writeFile(join(output,'report.json'),JSON.stringify({origin:c.origin,checks,errors,manualCaseUnchanged:true},null,2));console.log(JSON.stringify({checks:checks.length,errors,output}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({message:error.message,checks,errors},null,2));throw error;}finally{ws?.close();browser.kill();}

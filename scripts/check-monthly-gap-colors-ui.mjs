import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createPanelServer} from '../server.mjs';
const root=await mkdtemp(join(tmpdir(),'kpi-gap-colors-')),output=await mkdtemp(resolve('outputs/monthly-gap-colors-')),checks=[];let modelCalls=0,ws;
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
 await evaluate("(async()=>{const f=document.querySelector('#demoAccount');f.innerHTML='<option value=employee-mohammad>حساب ساختگی</option>';f.value='employee-mohammad';await f.onchange({target:f});})()");
 await evaluate("window.gapWrites=[];window.gapPending=false;window.gapErrors=[];addEventListener('error',e=>gapErrors.push(e.message));const originalGapFetch=window.fetch;window.fetch=async(p,o)=>{if(o?.method==='POST'&&p!=='/api/session')gapWrites.push(p);const r=await originalGapFetch(p,o);if(!p.startsWith('/api/workflow/me?'))return r;const d=await r.json(),weights={exam:10,manager:20,routine:25,project:25,peer:20};d.policy.weights=weights;d.components=d.components.map((c,i)=>({...c,applicable:true,weight:weights[c.id],ceiling:weights[c.id]*100,score:gapPending&&c.id==='routine'?null:[40,20,60,0,10][i],earned:gapPending&&c.id==='routine'?null:weights[c.id]*[40,20,60,0,10][i]}));return new Response(JSON.stringify(d),{headers:{'content-type':'application/json'}});};");
 const db=new DatabaseSync(join(root,'panel.sqlite'),{readOnly:true}),snapshot=()=>JSON.stringify(db.prepare('SELECT id,kind,parent,value FROM records ORDER BY id').all()),before=snapshot();
 try{
  for(const pendingScores of [false,true]){
   await evaluate(`gapPending=${pendingScores};PanelWorkflow.refresh()`);await wait('!PanelWorkflow.working&&!PanelLifecycle.working');await evaluate("PanelWorkflow.go('dashboard');document.querySelector('#showMonth').click()");
   const moneyBefore=await evaluate("document.querySelector('#finalSalary').textContent");
   for(const width of [1573,390,320])for(const theme of ['dark','light']){
    await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});if(await evaluate('document.documentElement.dataset.theme')!==theme)await evaluate("document.querySelector('#themeToggle').click()");await pause(250);await evaluate("document.querySelector('#kpiGapList').closest('section').scrollIntoView({block:'center'})");
    const bars=await evaluate("[...document.querySelectorAll('#kpiGapList .gap-item')].map(e=>{const b=e.querySelector('i'),n=e.querySelector('.gap-item-label span').textContent,l=[...document.querySelectorAll('#compositionLegend .composition-item')].find(x=>x.children[1].textContent===n).querySelector('.composition-dot'),s=getComputedStyle(b),r=e.getBoundingClientRect();return {id:e.dataset.component,name:n,color:s.backgroundColor,legendColor:getComputedStyle(l).backgroundColor,progress:b.style.getPropertyValue('--progress'),amount:e.querySelector('strong').textContent,left:r.left,right:r.right};})");
    assert.equal(bars.length,pendingScores?4:5);assert.equal(bars[0].id,'project');assert.equal(new Set(bars.map(b=>b.color)).size,bars.length);assert.ok(bars.every(b=>b.color===b.legendColor));assert.ok(bars.every(b=>b.left>=-1&&b.right<=width+1));assert.equal(bars.some(b=>b.id==='routine'),!pendingScores);assert.equal(await evaluate("document.querySelector('#finalSalary').textContent"),moneyBefore);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    if(width===1573||width===390){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,`gap-${pendingScores?'pending':'complete'}-${width}-${theme}.png`),Buffer.from(shot.data,'base64'));}checks.push({pendingScores,width,theme,bars});
   }
  }
  assert.equal(snapshot(),before);
 }finally{db.close();}
 assert.equal(modelCalls,0);assert.deepEqual(await evaluate('gapWrites'),[]);assert.deepEqual(await evaluate('gapErrors'),[]);await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,modelCalls,writes:0,recordsUnchanged:true,checks},null,2));console.log(JSON.stringify({output,checks:checks.length,modelCalls,writes:0,recordsUnchanged:true}));
}finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3});}

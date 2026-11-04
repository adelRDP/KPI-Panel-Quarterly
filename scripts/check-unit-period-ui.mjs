import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {openStore} from '../backend/store.mjs';
import {createPanelServer} from '../server.mjs';
const root=await mkdtemp(join(tmpdir(),'kpi-unit-period-')),output=await mkdtemp(resolve('outputs/unit-period-')),checks=[];let modelCalls=0,ws;
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
 const fixture=openStore(root);for(const [period,score] of [['1405-07',89],['1405-08',41]])fixture.put('manager-survey',{id:'unit-month-'+period,employeeId:'employee-mohammad',managerId:'manager-ops',period,score,note:'Synthetic month QA'},'employee-mohammad');fixture.close();
 await evaluate("window.statusWrites=[];window.statusErrors=[];window.teamReads=[];addEventListener('error',e=>statusErrors.push(e.message));const originalStatusFetch=window.fetch;window.fetch=(p,o)=>{if(o?.method==='POST'&&p!=='/api/session')statusWrites.push(p);if(p.startsWith('/api/workflow/team?'))teamReads.push(new URL(p,location.href).searchParams.get('period'));return originalStatusFetch(p,o);};");
 const db=new DatabaseSync(join(root,'panel.sqlite'),{readOnly:true}),snapshot=()=>JSON.stringify(db.prepare('SELECT id,kind,parent,value FROM records ORDER BY id').all()),before=snapshot();
 try{
  await evaluate("PanelWorkflow.go('team');PanelWorkflow.refresh()");await wait('!PanelWorkflow.working&&!PanelLifecycle.working');
  assert.equal(await evaluate("document.querySelector('#nav-submenu-manager-kpi [data-view=quarters] span').textContent"),'ارزیابی فصلی');
  for(const width of [1573,390,320])for(const theme of ['dark','light']){
   await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});if(await evaluate('document.documentElement.dataset.theme')!==theme)await evaluate("document.querySelector('#themeToggle').click()");
   for(const period of ['1405-07','1405-08','1405-12','1406-01','1405-07']){
    await evaluate("(()=>{document.querySelector('#periodToggle').click();const [year,month]="+JSON.stringify(period)+".split('-');const y=document.querySelector('#workflowYear'),q=document.querySelector('#workflowQuarter'),m=document.querySelector('#workflowMonth');y.value=year;y.onchange();q.value=String(Math.ceil(Number(month)/3));q.onchange();m.value=month;document.querySelector('#applyPeriod').click();})()");
    await wait("!PanelWorkflow.working&&!PanelLifecycle.working&&document.querySelector('#view-team').dataset.period==="+JSON.stringify(period));
    const row=await evaluate("(()=>{const index=[...document.querySelectorAll('#view-team thead th')].findIndex(e=>e.textContent==='نظر مدیر'),row=document.querySelector('#teamRows [data-person=employee-mohammad]').closest('tr');return {score:row.children[index].textContent,note:document.querySelector('#teamPeriodNote').textContent,period:document.querySelector('#view-team').dataset.period,label:PanelWorkflow.monthLabel(document.querySelector('#workflowPeriod').value),overflow:document.documentElement.scrollWidth>innerWidth+1,hasSalary:document.querySelector('#view-team').textContent.includes('تومان')};})()");
    assert.equal(row.period,period);assert.ok(row.note.includes(row.label));assert.equal(row.score,period==='1405-07'?'۸۹٪':period==='1405-08'?'۴۱٪':'در انتظار');assert.equal(row.overflow,false);assert.equal(row.hasSalary,false);assert.equal(await evaluate("document.querySelector('.view.active').id"),'view-team');checks.push({width,theme,...row});
   }
   if(width===1573||width===390){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'unit-'+width+'-'+theme+'.png'),Buffer.from(shot.data,'base64'));}
  }
  assert.equal(snapshot(),before);
 }finally{db.close();}
 assert.equal(modelCalls,0);assert.deepEqual(await evaluate('statusWrites'),[]);assert.deepEqual(await evaluate('statusErrors'),[]);await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,modelCalls,writes:0,recordsUnchanged:true,checks},null,2));console.log(JSON.stringify({output,checks:checks.length,modelCalls,writes:0,recordsUnchanged:true}));
}finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3});}

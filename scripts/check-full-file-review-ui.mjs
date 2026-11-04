import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
import {createPanelServer} from '../server.mjs';import {openStore} from '../backend/store.mjs';import {createRequire} from 'node:module';
const root=await mkdtemp(join(tmpdir(),'kpi-full-file-ui-')),output=await mkdtemp(resolve('outputs/full-file-ui-')),server=createPanelServer({dataRoot:root,autoAssessment:false,runModel:async({prompt})=>{const e=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]),c=e.chunks.find(c=>c.text.includes('LAST_ROW_EVIDENCE'))||e.chunks[0];return {result:{summary:'گزارش ساختگی برای آزمون نمایش خواندن کامل فایل',criteria:[{id:'C1',status:'met',score:95,reason:'ردیف پایانی در ورودی ساختگی خوانده شد؛ این تست کیفیت مدل واقعی نیست.',citations:[{chunkId:c.id,quote:c.text.includes('LAST_ROW_EVIDENCE')?'LAST_ROW_EVIDENCE':c.text.slice(0,15)}]}]}};}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port,browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+join(output,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'}),pause=ms=>new Promise(r=>setTimeout(r,ms));let ws;const checks=[];
try{
 let ports;for(let i=0;i<100;i++){try{ports=(await readFile(join(output,'profile','DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}assert.ok(ports);ws=new WebSocket('ws://127.0.0.1:'+ports[0]+ports[1]);await once(ws,'open');let seq=0,session;const pending=new Map();
 ws.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);});
 const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error(method+' timed out')),20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Not settled: '+expression);};

 await send('Page.enable');
 const sessionData=await (await fetch(base+'/api/session')).json(),token=sessionData.token;
 const request=async(path,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'x-panel-token':token},body:body===undefined?undefined:JSON.stringify(body)}),d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;};
 const activity=await request('/api/activities',{kind:'routine',title:'شاخص ساختگی خواندن فایل',description:'محتوای واقعی فایل مطابق معیار بررسی شود.',period:sessionData.period,criteria:['خروجی مشخص ارائه شده باشد.']});
 const XLSX=createRequire(import.meta.url)('../src/vendor/xlsx.full.min.js'),book=XLSX.utils.book_new();
 for(const name of ['گزارشها','اطلاعات تکمیلی'])XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['مسئول','موعد','ارسال','شرح'],...Array.from({length:400},(_,i)=>['فرد ساختگی','15:00','15:03',i===399?'LAST_ROW_EVIDENCE':'ردیف '+i])]),name);
 const upload=await fetch(base+'/api/activities/'+activity.id+'/documents?name=work.xlsx&workEvidence=true',{method:'POST',headers:{'x-panel-token':token},body:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});assert.equal(upload.status,201);
 const review=await request('/api/activities/'+activity.id+'/reviews',{provider:'codex',workEvidence:true});assert.equal(review.result.fileProcessing.complete,true);assert.ok(review.result.fileProcessing.totalParts>1);
 await send('Page.navigate',{url:base});await wait('window.PanelWorkflow?.user&&!PanelWorkflow.working');await evaluate('document.fonts.ready');
 const store=openStore(root);
 try{
 for(const variant of ['complete','incomplete']){
  const result=variant==='complete'?review.result:{...review.result,decision:'insufficient',qualityScore:null,finalForActivity:false,finalScore:null,coverage:{...review.result.coverage,incomplete:true},scoreBreakdown:{...review.result.scoreBreakdown,qualityScore:null,finalScore:null},fileProcessing:{...review.result.fileProcessing,complete:false}};
  store.put('review',{...review,result},activity.id);
  await evaluate('PanelAi.open('+JSON.stringify(activity.id)+')');await wait("document.querySelector('#activityDialog').open&&document.querySelector('[data-history-detail]')");
  await evaluate("(()=>{const b=document.querySelector('[data-history-detail]');if(b.getAttribute('aria-expanded')!=='true')b.click();})()");await wait("document.querySelector('.file-review-coverage')");
  for(const width of [1575,1024,390,320])for(const theme of ['dark','light']){
   await send('Emulation.setDeviceMetricsOverride',{width,height:884,deviceScaleFactor:1,mobile:false});
   if(await evaluate('document.documentElement.dataset.theme')!==theme)await evaluate("document.querySelector('#themeToggle').click()");await pause(350);
   assert.ok(await evaluate('document.documentElement.scrollWidth')<=width+1);
   const text=await evaluate("document.querySelector('.file-review-coverage').textContent");assert.ok(text.includes(variant==='complete'?'همهٔ بخش':'پوشش فایل ناقص'));assert.ok(text.includes('شیت'));assert.ok(text.includes('سلول'));if(variant==='incomplete')assert.ok(!(await evaluate("document.querySelector('.score-breakdown').textContent")).includes('۹۵'));
   if(width===1575||width===390){await evaluate("document.querySelector('.file-review-coverage').scrollIntoView({block:'center'})");const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,variant+'-'+width+'-'+theme+'.png'),Buffer.from(shot.data,'base64'));}
   checks.push({variant,width,theme});
  }
  await evaluate("document.querySelector('#closeActivityDialog').click()");
 }
 }finally{store.close();}
 await writeFile(join(output,'report.json'),JSON.stringify({syntheticOnly:true,liveModelCalls:0,readParts:review.result.fileProcessing.totalParts,cells:review.result.fileProcessing.documents[0].cells,checks},null,2));console.log(JSON.stringify({output,checks:checks.length,liveModelCalls:0}));
}finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3});}

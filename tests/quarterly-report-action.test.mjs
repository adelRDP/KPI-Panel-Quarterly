import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {JSDOM,VirtualConsole} from 'jsdom';

const source=await readFile('src/ai-ui.js','utf8');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<150;i++){if(check())return;await pause(10);}assert.fail('Report action did not settle');}
const docRow=id=>({id,name:id+'.txt',sha256:id,extractionHash:id,extraction:{status:'ready',warnings:[],chunks:[{id:id+':1',label:'Synthetic',text:'Synthetic work evidence'}]}});
async function browser(t,{existing=false,closed=false,owner=true,automatic=true,blocked=false,failSecond=false,active=false}={}){
 const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div class="app-shell"><nav class="main-nav"></nav><main></main></div>',{url:'http://localhost:4273',runScripts:'outside-only',virtualConsole:console}),{window}=dom,document=window.document;
 t.after(()=>{window.close();assert.deepEqual(errors,[]);});
 const calls=[],uploads=[],state={activity:{id:'synthetic-activity',kind:'routine',title:'Synthetic report',description:'Synthetic task',period:'1405-Q3',ownerId:'person',criteria:[{id:'C1',text:'Work evidence'}]},documents:existing?[docRow('existing')]:[],reviews:active?[{id:'active',status:'running',documentHashes:[]}]:[],history:[],submissionQuota:{canUpload:!closed,limit:5,remaining:closed?0:5,used:closed?5:0},humanReview:{canSubmit:false}};
 let release,fail=failSecond;
 window.escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.icon=()=>'<svg></svg>';window.fa=new Intl.NumberFormat('fa-IR');window.documents=[];window.showView=()=>{};
 window.PanelDate={formatDateTime:value=>value||'',formatDate:value=>value||'',hourOnly:value=>value||''};
 window.PanelWorkflow={user:{id:owner?'person':'manager',role:owner?'personnel':'manager'},accounts:[],monthLabel:v=>v,api:async(path,options={})=>{
  if(path==='/api/providers')return {defaultProvider:'codex',providers:[{provider:'codex',ready:true,message:'Synthetic only'}]};
  if(path==='/api/activity-human-reviews')return [];
  if(path.includes('/documents?')){
   calls.push('upload');const index=uploads.length,url=new URL(path,window.location.href);uploads.push({name:options.body.name,deferred:url.searchParams.get('deferReview'),batch:url.searchParams.get('batchId')});
   if(index===0)await new Promise(resolve=>release=resolve);
   if(index===1&&fail){fail=false;throw Error('Synthetic upload failure');}
   const document=docRow('upload-'+index);document.name=options.body.name;state.documents.push(document);
   const autoReview=automatic&&url.searchParams.get('deferReview')==='0'?(blocked?{status:'blocked',error:'Synthetic evidence needs conversion'}:{id:'queued',status:'queued'}):null;
   if(autoReview?.status==='queued')state.reviews=[{...autoReview,documentHashes:[]}];
   return {...document,autoReview};
  }
  if(path.endsWith('/reviews')&&options.method==='POST'){calls.push('review');if(!uploads.length)await new Promise(resolve=>release=resolve);const review={id:'queued',status:'queued',documentHashes:[]};state.reviews=[review];return review;}
  if(path.includes('/quota'))return {submissionQuota:state.submissionQuota,humanReview:state.humanReview};
  if(path.startsWith('/api/activities/'))return structuredClone(state);
  throw Error('Unexpected request '+path);
 }};
 new Script(source,{filename:'src/ai-ui.js'}).runInContext(dom.getInternalVMContext());window.PanelAi.open(state.activity.id);await until(()=>!!document.querySelector('#submitActivityReport'));
 const consent=()=>{const input=document.querySelector('#workEvidence');input.checked=true;input.dispatchEvent(new window.Event('change'));};
 const report=text=>{const field=document.querySelector('#activityReport');field.value=text;field.dispatchEvent(new window.Event('input'));};
 const files=names=>{const field=document.querySelector('#activityFiles');Object.defineProperty(field,'files',{configurable:true,value:names.map(name=>new window.File(['Synthetic evidence'],name))});field.dispatchEvent(new window.Event('change'));};
 return {window,document,state,calls,uploads,consent,report,files,button:()=>document.querySelector('#submitActivityReport'),release:()=>release?.(),hasRelease:()=>!!release};
}

test('single action submits text and attachments as one batch; automatic assessment is never duplicated',async t=>{
 const b=await browser(t);assert.equal(b.document.querySelectorAll('.activity-review-buttons button').length,1);assert.equal(b.document.querySelector('#runReview'),null);
 assert.equal(b.button().textContent,'ثبت گزارش و ارزیابی با AI');b.consent();assert.equal(b.button().disabled,true);b.report('Synthetic report');b.files(['attachment.txt']);assert.equal(b.button().disabled,false);assert.equal(b.calls.length,0);
 b.button().click();b.button().click();await until(b.hasRelease);assert.equal(b.window.PanelAi.working,true);assert.equal(b.button().disabled,true);b.release();await until(()=>!b.window.PanelAi.working);
 assert.deepEqual(b.calls,['upload','upload']);assert.deepEqual(b.uploads.map(r=>r.deferred),['1','0']);assert.equal(new Set(b.uploads.map(r=>r.batch)).size,1);assert.equal(b.document.querySelector('#activityReport').value,'');assert.equal(b.button().disabled,true);
});

test('the same action evaluates existing evidence only after consent, with no upload or duplicate click',async t=>{
 const b=await browser(t,{existing:true});assert.equal(b.button().disabled,true);b.consent();assert.equal(b.button().disabled,false);b.button().click();b.button().click();await until(b.hasRelease);assert.deepEqual(b.calls,['review']);assert.equal(b.document.querySelector('#activityFiles').disabled,true);b.release();await until(()=>!b.window.PanelAi.working);assert.equal(b.button().disabled,true);
});

test('closed upload quota still permits checking existing evidence but cannot submit a new draft',async t=>{
 const b=await browser(t,{existing:true,closed:true});assert.equal(b.document.querySelector('#activityFiles').disabled,true);assert.equal(b.document.querySelector('#workEvidence').disabled,false);b.consent();assert.equal(b.button().disabled,false);b.report('Unsaved draft');assert.equal(b.button().disabled,true);b.report('');b.button().click();await until(b.hasRelease);b.release();await until(()=>!b.window.PanelAi.working);assert.deepEqual(b.calls,['review']);
});

test('explicit combined action falls back to one review when automatic assessment is unavailable',async t=>{
 const b=await browser(t,{automatic:false});b.report('Synthetic report');b.consent();b.button().click();await until(b.hasRelease);b.release();await until(()=>!b.window.PanelAi.working);assert.deepEqual(b.calls,['upload','review']);
});

test('blocked extraction is shown without bypassing the block or requesting another review',async t=>{
 const b=await browser(t,{blocked:true});b.report('Synthetic report');b.consent();b.button().click();await until(b.hasRelease);b.release();await until(()=>!b.window.PanelAi.working);assert.deepEqual(b.calls,['upload']);assert.match(b.document.querySelector('#aiStatus').textContent,/needs conversion/);
});

test('partial upload failure retains only unsent files and cannot assess an incomplete batch',async t=>{
 const b=await browser(t,{failSecond:true});b.report('Synthetic report');b.files(['attachment.txt']);b.consent();b.button().click();await until(b.hasRelease);b.release();await until(()=>!b.window.PanelAi.working);assert.deepEqual(b.calls,['upload','upload']);assert.match(b.document.querySelector('#pendingActivityFiles').textContent,/attachment.txt/);assert.equal(b.document.querySelector('#activityReport').value,'');
 b.consent();b.button().click();await until(()=>b.uploads.length===3&&!b.window.PanelAi.working);assert.deepEqual(b.calls,['upload','upload','upload']);assert.equal(b.document.querySelector('#pendingActivityFiles').textContent,'');
});

test('other viewers and in-flight reviews cannot start the unified action',async t=>{
 const other=await browser(t,{existing:true,owner:false});assert.equal(other.button().hidden,true);assert.equal(other.button().parentElement.hidden,true);
 const busy=await browser(t,{existing:true,active:true});busy.consent();assert.equal(busy.button().disabled,true);busy.button().click();assert.equal(busy.calls.length,0);
});

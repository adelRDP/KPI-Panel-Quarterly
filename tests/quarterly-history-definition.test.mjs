import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {JSDOM,VirtualConsole} from 'jsdom';
const source=await readFile('src/ai-ui.js','utf8'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(check())return;await pause(5);}assert.fail('History detail did not settle');}
async function fixture(t){
 const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div class="app-shell"><nav class="main-nav"></nav><main></main></div>',{url:'http://localhost:4273',runScripts:'outside-only',virtualConsole:console}),{window}=dom,doc=window.document;
 t.after(()=>{window.close();assert.deepEqual(errors,[]);});
 const activity={id:'a',kind:'routine',ownerId:'person',title:'CURRENT TITLE',description:'CURRENT DESCRIPTION',period:'1405-Q3',criteria:[{id:'C1',text:'CURRENT CRITERION'}]};
 const snapshots={old:{...activity,title:'OLD TITLE',description:'OLD DESCRIPTION',criteria:[{id:'C1',text:'OLD CRITERION'}],dueDate:'2026-11-05T12:00:00Z',frequency:'هفتگی',targetVolume:8,targetUnit:'گزارش',designVersion:1,documentFormat:'xlsx'},new:{...activity,title:'NEW TITLE',description:'NEW DESCRIPTION',criteria:[{id:'C1',text:'NEW CRITERION'}],designVersion:2}};
 const result={summary:'Synthetic analysis',decision:'completed',qualityScore:100,finalForActivity:true,coverage:{totalChunks:0,omittedChunks:0,bytes:0},criteria:[{id:'C1',status:'met',score:100,reason:'Evidence checked',citations:[]}]};
 const data={activity,documents:[],reviews:['new','old'].map(id=>({id,status:'done',summaryOnly:true,reportVersion:'1',documentHashes:[],result})),history:[{id:'h-new',reviewId:'new',kind:'upload',status:'completed'},{id:'h-old',reviewId:'old',kind:'upload',status:'completed'},{id:'h-unreviewed',kind:'upload',status:'blocked'}],reviewMatchesCurrentEvidence:true};
 const calls=[];let fail=false,hold=false,release;
 window.escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.icon=()=>'<svg></svg>';window.fa=new Intl.NumberFormat('fa-IR');window.documents=[];window.showView=()=>{};window.PanelDate={formatDateTime:v=>v||'',hourOnly:v=>v||''};
 window.PanelWorkflow={user:{id:'person',role:'personnel'},accounts:[],monthLabel:v=>v,api:async(path,options={})=>{
  calls.push({path,method:options.method||'GET'});
  if(path==='/api/providers')return {defaultProvider:'codex',providers:[{provider:'codex',ready:true,message:'Synthetic only'}]};
  if(path==='/api/activity-human-reviews')return [];
  if(path==='/api/activities/a?summary=1')return structuredClone(data);
  const id=path.match(/\/reviews\/(old|new)$/)?.[1];
  if(id){if(hold)await new Promise(resolve=>release=resolve);if(fail)throw Error('Synthetic read error');return {id,status:'done',provider:'codex',activitySnapshot:structuredClone(snapshots[id]),result};}
  throw Error('Unexpected API path '+path);
 }};
 new Script(source).runInContext(dom.getInternalVMContext());window.PanelAi.open('a');await until(()=>!!doc.querySelector('[data-history-definition]'));
 return {window,doc,data,snapshots,calls,open:index=>doc.querySelector('[data-history-definition="'+index+'"]').click(),close:()=>doc.querySelector('#activityAnalysisDialog [data-close-activity-analysis]').click(),fail:value=>fail=value,hold:()=>hold=true,release:()=>release?.(),waiting:()=>!!release};
}

test('each round opens its recorded definition and criteria, never the latest activity or a new AI job',async t=>{
 const f=await fixture(t);assert.equal(f.doc.querySelectorAll('[data-history-definition]').length,3);
 f.open(1);await until(()=>f.doc.querySelector('#activityAnalysisDialog').textContent.includes('OLD CRITERION'));
 const text=f.doc.querySelector('#activityAnalysisDialog').textContent;assert.ok(text.includes('OLD TITLE'));assert.ok(text.includes('OLD DESCRIPTION'));assert.ok(!text.includes('CURRENT CRITERION'));assert.ok(text.includes('xlsx'));assert.ok(text.includes('هفتگی'));assert.equal(f.doc.querySelector('#activityAnalysisTitle').textContent,'جزئیات شاخص');
 assert.equal(f.doc.querySelector('#activityDialog').inert,true);f.close();assert.equal(f.doc.querySelector('#activityDialog').inert,false);assert.equal(f.doc.activeElement,f.doc.querySelector('[data-history-definition="1"]'));
 f.open(0);await until(()=>f.doc.querySelector('#activityAnalysisDialog').textContent.includes('NEW CRITERION'));assert.ok(f.calls.every(c=>c.method==='GET'));assert.equal(f.calls.filter(c=>c.path.endsWith('/reviews/old')).length,1);
});

test('unreviewed history clearly identifies current details instead of inventing a historical version',async t=>{
 const f=await fixture(t);f.open(2);await until(()=>f.doc.querySelector('#activityAnalysisDialog').open);const text=f.doc.querySelector('#activityAnalysisDialog').textContent;assert.ok(text.includes('نسخهٔ تاریخی شاخص برای این نوبت در دسترس نیست'));assert.ok(text.includes('CURRENT CRITERION'));assert.equal(f.calls.filter(c=>c.path.includes('/reviews/')).length,0);
});

test('snapshot text is escaped, including titles, descriptions, criteria and document format',async t=>{
 const f=await fixture(t);for(const key of ['title','description','documentFormat'])f.snapshots.old[key]='<img src=x onerror=alert(1)>';f.snapshots.old.criteria=[{id:'C1',text:'<script>unsafe</script>'}];f.open(1);await until(()=>f.doc.querySelector('.activity-definition-fields'));assert.equal(f.doc.querySelector('#activityAnalysisDialog img,#activityAnalysisDialog script'),null);assert.ok(f.doc.querySelector('#activityAnalysisDialog').textContent.includes('<script>unsafe</script>'));
});

test('late responses cannot replace another round or reappear after switching accounts',async t=>{
 const f=await fixture(t);f.hold();f.open(1);await until(f.waiting);f.close();f.open(2);await until(()=>f.doc.querySelector('#activityAnalysisDialog').textContent.includes('CURRENT CRITERION'));f.release();await pause(10);assert.ok(!f.doc.querySelector('#activityAnalysisDialog').textContent.includes('OLD CRITERION'));
 f.window.dispatchEvent(new f.window.Event('panel:session'));assert.equal(f.doc.querySelector('#activityAnalysisDialog').open,false);assert.equal(f.doc.querySelector('#activityAnalysisDialog .activity-dialog-body').textContent,'');
});

test('failed reads offer a retry; AI analysis still opens with its own title and report',async t=>{
 const f=await fixture(t);f.fail(true);f.open(1);await until(()=>!!f.doc.querySelector('[data-retry-history-definition]'));assert.ok(!f.doc.querySelector('#activityAnalysisDialog').textContent.includes('CURRENT CRITERION'));f.fail(false);f.doc.querySelector('[data-retry-history-definition]').click();await until(()=>f.doc.querySelector('#activityAnalysisDialog').textContent.includes('OLD CRITERION'));f.close();
 f.doc.querySelector('[data-history-analysis="0"]').click();await until(()=>f.doc.querySelector('#activityAnalysisDialog').textContent.includes('Synthetic analysis'));assert.equal(f.doc.querySelector('#activityAnalysisTitle').textContent,'تحلیل هوش مصنوعی گزارش');assert.ok(f.calls.every(c=>c.method==='GET'));
});

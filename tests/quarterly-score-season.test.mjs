import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {Script} from 'node:vm';
import {JSDOM,VirtualConsole} from 'jsdom';
import {openStore} from '../backend/store.mjs';
import {createScoreSettings,scoreRulesAt,defaultScoreRules} from '../backend/score-rules.mjs';
import {periodBounds} from '../backend/quarterly-workflow.mjs';
import {periodAtDate} from '../backend/quarter-period.mjs';
const source=await readFile('src/score-settings-ui.js','utf8');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(check())return;await pause(5);}assert.fail('Score settings UI did not settle');}
const persian=value=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'numeric',day:'numeric',timeZone:'Asia/Tehran'}).formatToParts(new Date(value+'T12:00:00Z')).map(p=>[p.type,p.value]));return [p.year,p.month,p.day].join('/');};
async function fixture(t,today='2026-11-08'){
 const root=await mkdtemp(join(tmpdir(),'quarter-score-season-')),store=openStore(root),actor={id:'test-admin',role:'hr'},clock=()=>today+'T09:00:00Z',settings=createScoreSettings(store,{now:clock});
 const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<main><section id="view-score-settings"></section></main>',{url:'http://localhost:4273',runScripts:'outside-only',virtualConsole:console}),{window}=dom,doc=window.document,calls=[];
 t.after(async()=>{window.close();store.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('quarter-score-season-'));await rm(root,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 window.escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.confirm=()=>true;window.HTMLElement.prototype.scrollIntoView=()=>{};
 window.PanelDate={input:persian,toGregorian:value=>{const [year,month,day]=value.split('/').map(Number);assert.equal(day,1);assert.equal((month-1)%3,0);return periodBounds(year+'-Q'+Math.ceil(month/3)).start;}};
 window.PanelWorkflow={user:actor,roleText:value=>value,api:async()=>settings.state(actor),post:async(path,input)=>{const action=path.split('/').at(-1),plain=JSON.parse(JSON.stringify(input));calls.push({action,input:plain});return settings[action](actor,plain);}};
 new Script(source).runInContext(dom.getInternalVMContext());await window.PanelScoreSettings.refresh();assert.ok(doc.querySelector('#scoreRulesForm'),doc.querySelector('#view-score-settings').textContent);
 const form=()=>doc.querySelector('#scoreRulesForm');
 function select(season,year='1405'){let f=form();f.elements.effectiveYear.value=year;f.elements.effectiveYear.dispatchEvent(new window.Event('change',{bubbles:true}));f.elements.effectiveSeason.value=String(season);f.elements.effectiveSeason.dispatchEvent(new window.Event('change',{bubbles:true}));}
 const submit=()=>{form().elements.reason.value='تغییر آزمایشی برای فصل جاری';form().dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));};
 return {window,doc,store,settings,actor,calls,form,select,submit,clock};
}

test('current autumn can be explicitly selected from today while the future default and past-result protection remain',async t=>{
 const f=await fixture(t);assert.equal(f.form().elements.effectiveSeason.value,'4');assert.equal(f.form().elements.effectiveDate.value,'2026-12-22');assert.deepEqual([...f.form().elements.effectiveSeason.options].map(o=>o.textContent),['پاییز','زمستان']);
 f.select(3);assert.equal(f.form().elements.effectiveDate.value,'2026-11-08');assert.match(f.doc.querySelector('#scoreEffectNote').textContent,/از امروز/);assert.equal(f.calls.length,0);
 const locked=f.store.put('quarter-evaluation',{id:'locked-result',quarter:'1405-Q2',status:'locked',result:{performance:73,earned:123456}}),closed=f.store.put('position-closeout',{id:'closed-slice',status:'locked',earned:54321});
 const lockedBefore=JSON.stringify([locked,closed]);f.form().elements.rule_maxUploads.value='10';f.submit();await until(()=>!f.window.PanelScoreSettings.working);assert.equal(f.store.list('score-rule-draft').length,1);assert.equal(f.calls[0].input.effectiveDate,'2026-11-08');
 f.doc.querySelector('#scorePreview').click();await until(()=>!f.window.PanelScoreSettings.working);assert.equal(f.doc.querySelector('#scorePublish').disabled,false);f.doc.querySelector('#scorePublish').click();await until(()=>!f.window.PanelScoreSettings.working);
 const published=f.store.list('score-rule-version')[0];assert.equal(published.effectiveDate,'2026-11-08');assert.equal(published.values.maxUploads,'10');assert.equal(scoreRulesAt(f.store,{at:'2026-11-08T08:59:59Z'}).version,'score-rules-legacy-v1');assert.equal(scoreRulesAt(f.store,{at:f.clock()}).version,published.id);assert.equal(JSON.stringify([f.store.get(locked.id,'quarter-evaluation'),f.store.get(closed.id,'position-closeout')]),lockedBefore);
});

test('financial changes remain rejected in the current season and work at the next season boundary',async t=>{
 const f=await fixture(t);f.select(3);f.form().elements.rule_incentiveCap.value='30';f.submit();await until(()=>!f.window.PanelScoreSettings.working);assert.match(f.doc.querySelector('#scoreSettingsStatus').textContent,/فصل آینده/);assert.equal(f.store.list('score-rule-draft').length,0);
 f.select(4);f.submit();await until(()=>!f.window.PanelScoreSettings.working);assert.equal(f.store.list('score-rule-draft')[0].effectiveDate,'2026-12-22');assert.equal(f.store.list('score-rule-draft')[0].values.incentiveCap,'30');
 assert.throws(()=>f.settings.save(f.actor,{effectiveDate:'2026-09-23',activityKind:'all',reason:'تاریخ گذشته مجاز نیست',values:defaultScoreRules}),/عطف‌به‌ماسبق/);
});

test('changing season invalidates preview without publishing or changing old stored daily dates',async t=>{
 const f=await fixture(t);f.select(3);f.submit();await until(()=>!f.window.PanelScoreSettings.working);f.doc.querySelector('#scorePreview').click();await until(()=>!f.window.PanelScoreSettings.working);assert.equal(f.doc.querySelector('#scorePublish').disabled,false);const count=f.calls.length;f.select(4);assert.equal(f.doc.querySelector('#scorePublish').disabled,true);assert.equal(f.doc.querySelector('#scorePreview').disabled,true);assert.equal(f.calls.length,count);
 const draft=f.store.list('score-rule-draft')[0];f.store.put('score-rule-draft',{...draft,effectiveDate:'2026-11-07'});await f.window.PanelScoreSettings.refresh();f.doc.querySelector('[data-edit-rule]').click();assert.equal(f.form().elements.effectiveDate.value,'2026-11-07');assert.equal(f.form().elements.effectiveSeason.value,'');assert.match(f.doc.querySelector('#scoreEffectNote').textContent,/تاریخ ثبت‌شده/);f.select(3);assert.equal(f.form().elements.effectiveDate.value,'2026-11-08');
});

test('current-season and future dates stay correct at season, year and leap-day boundaries',async t=>{
 for(const today of ['2025-03-20','2025-03-21','2026-09-23','2026-11-08','2026-12-21','2026-12-22','2027-03-21']){
  const f=await fixture(t,today),current=periodAtDate(today),year=current.slice(0,4),season=current.at(-1),limit=new Date(Date.parse(today+'T12:00:00Z')+366*86400000).toISOString().slice(0,10);
  f.select(season,year);assert.equal(f.form().elements.effectiveDate.value,today,today);const years=[...f.form().elements.effectiveYear.options].map(o=>o.value);
  for(const y of years){f.form().elements.effectiveYear.value=y;f.form().elements.effectiveYear.dispatchEvent(new f.window.Event('change',{bubbles:true}));for(const option of [...f.form().elements.effectiveSeason.options]){f.form().elements.effectiveSeason.value=option.value;f.form().elements.effectiveSeason.dispatchEvent(new f.window.Event('change',{bubbles:true}));const q=y+'-Q'+option.value,date=f.form().elements.effectiveDate.value;assert.ok(date>=today&&date<=limit);assert.equal(date,q===current?today:periodBounds(q).start);}}
  assert.equal(f.calls.length,0);
 }
});

test('row publication previews exactly the saved draft before an explicit final publish',async t=>{
 const f=await fixture(t),saved=(reason,maxUploads)=>f.settings.save(f.actor,{effectiveDate:'2026-11-08',activityKind:'all',reason,values:{...defaultScoreRules,maxUploads}});
 const first=saved('قانون اول برای آزمون','10'),second=saved('قانون دوم برای آزمون','3');await f.window.PanelScoreSettings.refresh();
 assert.equal(f.doc.querySelectorAll('.score-draft-row').length,2);assert.match(f.doc.querySelector('.score-draft-info small').textContent,/آخرین ذخیره/);
 f.doc.querySelector(`[data-publish-rule="${second.id}"]`).click();await until(()=>!f.window.PanelScoreSettings.working);
 assert.deepEqual(f.calls.map(c=>c.action),['preview']);assert.equal(f.calls[0].input.id,second.id);assert.equal(f.store.list('score-rule-version').length,0);assert.equal(f.form().elements.rule_maxUploads.value,'3');assert.equal(f.form().elements.reason.value,second.reason);assert.equal(f.doc.querySelector('#scorePublish').disabled,false);
 f.doc.querySelector('#scorePublish').click();await until(()=>!f.window.PanelScoreSettings.working);
 assert.deepEqual(f.calls.map(c=>c.action),['preview','publish']);assert.equal(f.store.list('score-rule-version')[0].values.maxUploads,'3');assert.deepEqual(f.settings.state(f.actor).drafts.map(d=>d.id),[first.id]);
});

test('deleting a draft requires confirmation, removes only that row and retains audit history',async t=>{
 const f=await fixture(t),draft=f.settings.save(f.actor,{effectiveDate:'2026-11-08',activityKind:'all',reason:'حذف آزمایشی پیش نویس',values:defaultScoreRules});await f.window.PanelScoreSettings.refresh();
 f.window.confirm=()=>false;f.doc.querySelector('[data-discard-rule]').click();assert.equal(f.calls.length,0);assert.equal(f.settings.state(f.actor).drafts.length,1);
 f.window.confirm=()=>true;f.doc.querySelector('[data-discard-rule]').click();await until(()=>!f.window.PanelScoreSettings.working);
 assert.deepEqual(f.calls.map(c=>c.action),['discard']);assert.equal(f.doc.querySelectorAll('.score-draft-row').length,0);assert.equal(f.store.get(draft.id,'score-rule-draft').status,'discarded');assert.ok(f.store.list('audit-event').some(e=>e.action==='score-rules.discarded'&&e.entityId===draft.id));assert.equal(f.store.list('score-rule-version').length,0);
});

test('draft row actions respect unsaved changes, stale revisions and administrator authorization',async t=>{
 const f=await fixture(t),draft=f.settings.save(f.actor,{effectiveDate:'2026-11-08',activityKind:'all',reason:'کنترل همزمانی پیش نویس',values:defaultScoreRules});await f.window.PanelScoreSettings.refresh();
 f.form().elements.reason.value='تغییر محلی هنوز ذخیره نشده';f.form().elements.reason.dispatchEvent(new f.window.Event('input',{bubbles:true}));f.window.confirm=()=>false;f.doc.querySelector('[data-publish-rule]').click();assert.equal(f.calls.length,0);assert.equal(f.form().elements.reason.value,'تغییر محلی هنوز ذخیره نشده');
 f.window.confirm=()=>true;f.settings.save(f.actor,{...draft,reason:'ویرایش همزمان از پنجره دیگر'});f.doc.querySelector('[data-publish-rule]').click();await until(()=>!f.window.PanelScoreSettings.working);assert.match(f.doc.querySelector('#scoreSettingsStatus').textContent,/تغییر کرده/);assert.equal(f.doc.querySelector('#scorePublish').disabled,true);assert.equal(f.store.list('score-rule-version').length,0);
 f.doc.querySelector('[data-discard-rule]').click();await until(()=>!f.window.PanelScoreSettings.working);assert.match(f.doc.querySelector('#scoreSettingsStatus').textContent,/تغییر کرده/);assert.equal(f.settings.state(f.actor).drafts.length,1);
 const count=f.calls.length;f.window.PanelWorkflow.user={id:'employee',role:'employee'};f.doc.querySelector('[data-discard-rule]').click();f.doc.querySelector('[data-publish-rule]').click();assert.equal(f.calls.length,count);assert.throws(()=>f.settings.discard(f.window.PanelWorkflow.user,{id:draft.id,revision:2}));assert.throws(()=>f.settings.publish(f.window.PanelWorkflow.user,{id:draft.id,revision:2}));
});

test('draft log escapes text and discards a delayed preview after session change',async t=>{
 const f=await fixture(t),reason='<img src=x onerror=alert(1)> آزمایش';f.settings.save(f.actor,{effectiveDate:'2026-11-08',activityKind:'all',reason,values:defaultScoreRules});await f.window.PanelScoreSettings.refresh();assert.equal(f.doc.querySelector('.score-draft-reason').textContent,reason);assert.equal(f.doc.querySelector('#scoreDrafts img'),null);
 let finish;const original=f.window.PanelWorkflow.post;f.window.PanelWorkflow.post=async(...args)=>{const result=await original(...args);return new Promise(resolve=>{finish=()=>resolve(result);});};f.doc.querySelector('[data-publish-rule]').click();await until(()=>!!finish);f.window.PanelWorkflow.user={id:'employee',role:'employee'};f.window.dispatchEvent(new f.window.Event('panel:session'));finish();await until(()=>!f.window.PanelScoreSettings.working);assert.equal(f.doc.querySelector('#view-score-settings').children.length,0);assert.equal(f.store.list('score-rule-version').length,0);
});

test('published rule log opens escaped details, restores focus and copies only after discarding local edits',async t=>{
 const f=await fixture(t),reason='<img src=x onerror=alert(1)> دلیل آزمایشی قانون';
 f.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 f.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new f.window.Event('close'));};
 f.store.put('score-rule-version',{id:'score-rules-v1',sequence:1,status:'published',unitId:null,activityKind:'all',effectiveDate:'2026-11-08',publishedAt:f.clock(),publishedBy:f.actor.id,reason,values:{...defaultScoreRules,maxUploads:'10'}});
 await f.window.PanelScoreSettings.refresh();
 const button=f.doc.querySelector('[data-history-rule]'),dialog=f.doc.querySelector('#scoreHistoryDialog');
 assert.ok(button);assert.equal(f.doc.querySelector('details.score-rule-history'),null);assert.equal(dialog.open,false);
 button.click();assert.equal(dialog.open,true);assert.equal(dialog.querySelector('.score-history-reason').textContent,reason);assert.equal(dialog.querySelector('img'),null);assert.equal(dialog.querySelectorAll('.score-history-values > div').length,f.settings.state(f.actor).groups.flatMap(g=>g.fields).filter(field=>!field.locked).length);assert.equal(f.doc.activeElement,dialog.querySelector('[data-close-history]'));
 dialog.dispatchEvent(new f.window.Event('cancel',{cancelable:true}));assert.equal(dialog.open,false);assert.equal(f.doc.activeElement,button);assert.equal(dialog.querySelector('#scoreHistoryBody').childElementCount,0);
 f.form().elements.reason.value='تغییر محلی ذخیره نشده';f.form().elements.reason.dispatchEvent(new f.window.Event('input',{bubbles:true}));button.click();f.window.confirm=()=>false;dialog.querySelector('[data-copy-rule]').click();assert.equal(dialog.open,true);assert.equal(f.form().elements.reason.value,'تغییر محلی ذخیره نشده');
 f.window.confirm=()=>true;dialog.querySelector('[data-copy-rule]').click();assert.equal(dialog.open,false);assert.equal(f.form().elements.reason.value,reason);assert.equal(f.form().elements.rule_maxUploads.value,'10');assert.equal(f.calls.length,0);assert.equal(f.store.list('score-rule-draft').length,0);
 button.click();f.window.dispatchEvent(new f.window.CustomEvent('panel:view',{detail:'quarters'}));assert.equal(dialog.open,false);button.click();f.window.dispatchEvent(new f.window.Event('panel:session'));assert.equal(dialog.open,false);assert.equal(dialog.querySelector('#scoreHistoryBody').childElementCount,0);
});

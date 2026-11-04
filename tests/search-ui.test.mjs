import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {JSDOM} from 'jsdom';
const code=await readFile('src/search-ui.js','utf8'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setup(t,api){
  const dom=new JSDOM('<header class="topbar"><label class="global-search"><svg aria-hidden="true"><path d="M0 0"></path></svg><input id="globalSearch"></label></header><section id="view-chart" class="view"><article data-search-person="person-1"><strong>فرد</strong></article></section><section class="view active" id="view-assignments"></section>',{runScripts:'outside-only',url:'http://localhost'});t.after(()=>dom.window.close());const {window}=dom,doc=window.document,opened=[],events=[];
  const allowed=new Set(['assignments','projectAssignments','chart','appeals','notes','chat','tasks']);window.PanelWorkflow={user:{id:'self'},canView:id=>allowed.has(id),api,go:view=>{opened.push(view);doc.querySelectorAll('.view').forEach(node=>node.classList.toggle('active',node.id==='view-'+view));window.dispatchEvent(new window.CustomEvent('panel:view',{detail:view}));}};window.PanelLifecycle={refresh:async()=>{}};window.PanelAi={open:(id,view)=>opened.push({id,view})};for(const name of ['panel:note-focus','panel:chat-focus'])window.addEventListener(name,event=>events.push([name,event.detail]));new Script(code).runInContext(dom.getInternalVMContext());return {window,doc,input:doc.querySelector('#globalSearch'),opened,events};
}
const result=(title='گزارش',extra={})=>({id:'activity:one',kind:'شاخص روتین',title,description:'مهر ۱۴۰۵',view:'assignments',action:'activity',activityId:'one',...extra});

test('search debounces input, leaves the active page alone, escapes results, filters inaccessible views and supports keyboard opening',async t=>{
  const calls=[],{window,doc,input,opened}=setup(t,async path=>{calls.push(path);return {items:[result('<img src=x onerror=alert(1)>'),result('ممنوع',{view:'organization'})],total:2,limit:40};});
  input.value='گ';input.dispatchEvent(new window.Event('input'));await delay(310);assert.equal(calls.length,0);input.value='گزارش';input.dispatchEvent(new window.Event('input'));input.value='گزارش جدید';input.dispatchEvent(new window.Event('input'));await delay(330);
  assert.equal(calls.length,1);assert.ok(calls[0].includes(encodeURIComponent('گزارش جدید')));assert.equal(opened.length,0);assert.equal(doc.querySelectorAll('.search-result').length,1);assert.equal(doc.querySelector('.search-popover img'),null);assert.match(doc.querySelector('.search-result').textContent,/<img/);assert.equal(input.getAttribute('aria-expanded'),'true');
  input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));assert.equal(doc.querySelector('.search-result').getAttribute('aria-selected'),'true');assert.equal(input.getAttribute('aria-activedescendant'),doc.querySelector('.search-result').id);input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(opened[0],'assignments');assert.deepEqual(opened[1],{id:'one',view:'assignments'});assert.equal(doc.querySelector('.search-popover').hidden,true);
});

test('new queries and account switches discard late results and clear private search text',async t=>{
  const releases=[],{window,doc,input}=setup(t,()=>new Promise(resolve=>releases.push(resolve)));input.value='اول';const first=window.PanelSearch.search();input.value='دوم';const second=window.PanelSearch.search();releases[1]({items:[result('پاسخ جدید')],total:1,limit:40});await second;releases[0]({items:[result('پاسخ دیررس')],total:1,limit:40});await first;assert.ok(doc.querySelector('.search-result').textContent.includes('پاسخ جدید'));
  input.value='خصوصی';const third=window.PanelSearch.search();window.PanelWorkflow.user={id:'other'};window.dispatchEvent(new window.Event('panel:session'));releases[2]({items:[result('داده حساب قبلی')],total:1,limit:40});await third;assert.equal(input.value,'');assert.equal(doc.querySelectorAll('.search-result').length,0);assert.equal(doc.querySelector('.search-popover').hidden,true);
});

test('search opens real note/chat targets and focuses a located person without changing layout',async t=>{
  let current={id:'note:n',kind:'یادداشت',title:'کار من',description:'متن',view:'notes',action:'note',entityId:'n'};const {window,doc,input,opened,events}=setup(t,async()=>({items:[current],total:1,limit:40}));
  input.value='کار';await window.PanelSearch.search();doc.querySelector('.search-result').click();assert.deepEqual(events[0],['panel:note-focus','n']);current={...current,view:'chat',action:'chat',entityId:'peer'};input.value='کار';await window.PanelSearch.search();doc.querySelector('.search-result').click();assert.deepEqual(events[1],['panel:chat-focus','peer']);
  current={id:'person:p',kind:'پرسنل',title:'فرد',description:'واحد',view:'chart',target:{attr:'data-search-person',value:'person-1'}};input.value='فرد';await window.PanelSearch.search();doc.querySelector('.search-result').click();await delay(10);const target=doc.querySelector('[data-search-person]');assert.equal(doc.activeElement,target);assert.ok(target.classList.contains('search-match'));assert.equal(opened.at(-1),'chart');
});

test('empty/error feedback, Escape, busy operations and popup sizing are explicit',async t=>{
  let error=false,empty=true;const {window,doc,input,opened}=setup(t,async()=>{if(error)throw new Error('قطع اتصال');return {items:empty?[]:[result()],total:empty?0:1,limit:40};});Object.defineProperty(window,'innerWidth',{value:320});Object.defineProperty(window,'innerHeight',{value:640});input.closest('label').getBoundingClientRect=()=>({right:300,bottom:80});input.value='گزارش';await window.PanelSearch.search();assert.match(doc.querySelector('#globalSearchStatus').textContent,/پیدا نشد/);assert.equal(doc.querySelector('.search-popover').style.width,'296px');assert.equal(doc.querySelector('.search-popover').style.left,'12px');
  error=true;await window.PanelSearch.search();assert.match(doc.querySelector('#globalSearchStatus').textContent,/دوباره تلاش/);error=false;empty=false;await window.PanelSearch.search();window.PanelAi.working=true;doc.querySelector('.search-result').click();assert.equal(opened.length,0);assert.match(doc.querySelector('#globalSearchStatus').textContent,/پایان عملیات/);input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(input.getAttribute('aria-expanded'),'false');
});

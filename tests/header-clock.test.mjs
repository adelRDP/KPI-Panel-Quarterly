import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {JSDOM} from 'jsdom';

test('header clock uses real Persian Tehran date and 24-hour time, handles midnight and resumes after hiding',async t=>{
  const dom=new JSDOM(await readFile('index.html','utf8'),{url:'http://localhost:4173',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const {window}=dom,doc=window.document,NativeDate=window.Date;
  let now=Date.parse('2026-10-05T20:29:00Z'),hidden=false,nextId=0;const timers=new Map();
  window.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  Object.defineProperty(doc,'hidden',{configurable:true,get:()=>hidden});
  window.setTimeout=(fn,delay)=>{const id=++nextId;timers.set(id,{fn,delay});return id;};
  window.clearTimeout=id=>timers.delete(id);window.indexedDB={open:()=>({})};window.scrollTo=()=>{};
  for(const file of ['src/kpi-dashboard.js','src/app.js'])new Script(await readFile(file,'utf8'),{filename:file}).runInContext(dom.getInternalVMContext());
  const clock=doc.querySelector('#headerClock'),date=doc.querySelector('#headerDate'),time=doc.querySelector('#headerTime');
  assert.equal(doc.querySelectorAll('#headerClock').length,1);assert.equal(clock.parentElement.tagName,'HEADER');assert.ok(clock.getAttribute('aria-label').includes('تهران'));assert.equal(clock.hasAttribute('aria-live'),false);
  assert.equal(date.textContent,'دوشنبه ۱۳ مهر ۱۴۰۵');assert.equal(date.dateTime,'2026-10-05');assert.equal(time.textContent,'۲۳:۵۹');assert.equal(time.dir,'ltr');
  assert.equal([...timers.values()].filter(timer=>timer.delay===60000).length,1);
  now+=60000;const timer=[...timers.values()].find(timer=>timer.delay===60000);timer.fn();
  assert.equal(date.textContent,'سه‌شنبه ۱۴ مهر ۱۴۰۵');assert.equal(date.dateTime,'2026-10-06');assert.equal(time.textContent,'۰۰:۰۰');assert.equal(time.dateTime,'2026-10-05T20:30:00.000Z');
  hidden=true;doc.dispatchEvent(new window.Event('visibilitychange'));assert.equal(timers.size,0);
  now+=125000;hidden=false;doc.dispatchEvent(new window.Event('visibilitychange'));assert.equal(time.textContent,'۰۰:۰۲');assert.equal([...timers.values()][0].delay,55000);
  window.dispatchEvent(new window.Event('pagehide'));assert.equal(timers.size,0);
  now+=60000;window.dispatchEvent(new window.Event('pageshow'));assert.equal(time.textContent,'۰۰:۰۳');assert.equal(timers.size,1);
  now+=60000;window.dispatchEvent(new window.Event('focus'));assert.equal(time.textContent,'۰۰:۰۴');assert.equal(timers.size,1);
});

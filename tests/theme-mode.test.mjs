import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {JSDOM} from 'jsdom';

const html=await readFile('index.html','utf8');
const script=new Script(await readFile('src/theme-mode.js','utf8'),{filename:'src/theme-mode.js'});

test('day/night switch starts in dark mode, persists light mode and stays accessible',()=>{
  const dom=new JSDOM(html,{url:'http://localhost:4173',runScripts:'outside-only'});
  try {
    const {window}=dom;
    script.runInContext(dom.getInternalVMContext());
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const button=window.document.querySelector('#themeToggle');
    assert.equal(window.document.documentElement.dataset.theme,'dark');
    assert.equal(button.getAttribute('aria-pressed'),'true');
    button.click();
    assert.equal(window.document.documentElement.dataset.theme,'light');
    assert.equal(button.getAttribute('aria-label'),'تغییر به حالت شب');
    assert.equal(button.getAttribute('aria-pressed'),'false');
    assert.equal(window.localStorage.getItem('kpi-panel-theme'),'light');
  } finally { dom.window.close(); }

  const reopened=new JSDOM(html,{url:'http://localhost:4173',runScripts:'outside-only'});
  try {
    reopened.window.localStorage.setItem('kpi-panel-theme','light');
    script.runInContext(reopened.getInternalVMContext());
    reopened.window.document.dispatchEvent(new reopened.window.Event('DOMContentLoaded'));
    assert.equal(reopened.window.document.documentElement.dataset.theme,'light');
    reopened.window.document.querySelector('#themeToggle').click();
    assert.equal(reopened.window.document.documentElement.dataset.theme,'dark');
  } finally { reopened.window.close(); }
});

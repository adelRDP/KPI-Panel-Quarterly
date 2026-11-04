import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {Script} from 'node:vm';
async function fixture(t){
 const console=new VirtualConsole(),dom=new JSDOM('<main></main><nav class="main-nav"></nav>',{url:'http://localhost/',runScripts:'outside-only',virtualConsole:console});t.after(()=>dom.window.close());const {window}=dom,calls=[];
 window.escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const state={user:{id:'admin',role:'hr'},demo:false,mustChangePassword:false,accounts:[{id:'staff',name:'<img src=x>',employeeCode:'100'}],api:async path=>{calls.push({path});return [{userId:'staff',username:'staff.login',enabled:true}];},post:async(path,body)=>{calls.push({path,body});return {};},go:()=>{}};window.PanelWorkflow=state;
 new Script(await readFile('src/account-security-ui.js','utf8')).runInContext(dom.getInternalVMContext());window.dispatchEvent(new window.Event('panel:session'));return {window,doc:window.document,state,calls};
}
const settle=async check=>{for(let n=0;n<100;n++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('UI did not settle');};
test('security report escapes event names, cancellation revokes nothing, and switching identities clears private history',async t=>{
 const f=await fixture(t);f.state.api=async()=>({main:{activeSessions:2},accounts:[{name:'<img src=x>',failedAttempts:3}],events:[{name:'<script>bad</script>',action:'login.failure'}]});await f.doc.querySelector('#loadAccountSecurity').onclick();const report=f.doc.querySelector('#accountSecurityReport');assert.equal(report.hidden,false);assert.equal(report.querySelector('img,script'),null);f.window.confirm=()=>false;await f.doc.querySelector('#revokeMainSessions').onclick();assert.equal(f.calls.length,0);f.window.dispatchEvent(new f.window.Event('panel:session'));assert.equal(report.hidden,true);assert.equal(report.textContent,'');
});

test('bulk creation downloads only the new credentials and clears the temporary export on identity change',async t=>{
 const f=await fixture(t);let downloads=0,requests=0;f.window.URL.createObjectURL=()=>{downloads++;return 'blob:synthetic';};f.window.URL.revokeObjectURL=()=>{};f.window.HTMLAnchorElement.prototype.click=()=>{};f.state.post=async path=>{requests++;assert.equal(path,'/api/auth/accounts/defaults');return {created:1,credentials:[{userId:'staff',name:'=Synthetic',role:'personnel',username:'staff.login',password:'Synthetic-secret-only-once'}]};};
 await f.doc.querySelector('#createDefaultAccounts').onclick();assert.equal(requests,1);assert.equal(downloads,1);assert.equal(f.doc.querySelector('#downloadDefaultAccounts').hidden,false);assert.equal(f.doc.body.textContent.includes('Synthetic-secret-only-once'),false);
 f.window.dispatchEvent(new f.window.Event('panel:session'));assert.equal(f.doc.querySelector('#downloadDefaultAccounts').hidden,true);f.doc.querySelector('#downloadDefaultAccounts').click();assert.equal(downloads,1);
 f.state.user={id:'staff',role:'personnel'};await f.doc.querySelector('#createDefaultAccounts').onclick();assert.equal(requests,1);
});

test('main admin can provision individual accounts without exposing a personal password form',async t=>{
 const f=await fixture(t);f.state.demo=true;f.state.canManageAccounts=true;f.window.dispatchEvent(new f.window.Event('panel:session'));f.window.dispatchEvent(new f.window.CustomEvent('panel:view',{detail:'account-security'}));await settle(()=>f.calls.length===1);
 assert.equal(f.doc.querySelector('[data-view="account-security"]').hidden,false);assert.equal(f.doc.querySelector('#accountManagement').hidden,false);assert.equal(f.doc.querySelector('#accountPasswordForm').parentElement.hidden,true);
 f.state.canManageAccounts=false;f.state.user={id:'staff',role:'personnel'};f.window.dispatchEvent(new f.window.Event('panel:session'));assert.equal(f.doc.querySelector('#accountManagement').hidden,true);
});
test('account management is hidden in demo and for personnel, clears secrets on session change, and escapes names',async t=>{
 const f=await fixture(t);f.window.dispatchEvent(new f.window.CustomEvent('panel:view',{detail:'account-security'}));await settle(()=>f.calls.length===1);assert.equal(f.doc.querySelector('#accountManagement').hidden,false);assert.equal(f.doc.querySelector('#accountManagement img'),null);
 const form=f.doc.querySelector('#accountProvisionForm');form.elements.password.value='Synthetic-only-password';f.state.user={id:'staff',role:'personnel'};f.window.dispatchEvent(new f.window.Event('panel:session'));f.window.dispatchEvent(new f.window.CustomEvent('panel:view',{detail:'account-security'}));await settle(()=>f.doc.querySelector('#accountManagement').hidden);assert.equal(form.elements.password.value,'');assert.equal(f.doc.querySelector('#accountCredentialsList').textContent,'');
 f.state.demo=true;f.window.dispatchEvent(new f.window.Event('panel:session'));assert.equal(f.doc.querySelector('[data-view="account-security"]').hidden,true);
});
test('temporary password view exposes only own change form and mismatched confirmation makes no request',async t=>{
 const f=await fixture(t);f.state.mustChangePassword=true;f.window.dispatchEvent(new f.window.Event('panel:password-required'));f.window.dispatchEvent(new f.window.CustomEvent('panel:view',{detail:'account-security'}));assert.equal(f.doc.querySelector('#accountManagement').hidden,true);assert.equal(f.calls.length,0);
 const form=f.doc.querySelector('#accountPasswordForm');form.elements.currentPassword.value='Synthetic-current-password';form.elements.password.value='Synthetic-new-password';form.elements.confirmation.value='Different-synthetic-password';await form.onsubmit({preventDefault(){}});assert.equal(f.calls.length,0);assert.match(f.doc.querySelector('#accountSecurityStatus').textContent,/یکسان/);
});
test('admin saves credentials once without keeping the temporary password in the form',async t=>{
 const f=await fixture(t);f.window.dispatchEvent(new f.window.CustomEvent('panel:view',{detail:'account-security'}));await settle(()=>f.doc.querySelector('#accountProvisionForm').elements.username.value==='staff.login');
 const form=f.doc.querySelector('#accountProvisionForm');form.elements.password.value='Synthetic-temp-password';await form.onsubmit({preventDefault(){}});const request=f.calls.find(c=>c.body);assert.equal(request.path,'/api/auth/accounts');assert.equal(request.body.userId,'staff');assert.equal(form.elements.password.value,'');assert.match(f.doc.querySelector('#accountSecurityStatus').textContent,/ذخیره شد/);
});

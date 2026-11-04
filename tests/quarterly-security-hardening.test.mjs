import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createAuthThrottle} from '../backend/auth-throttle.mjs';
import {createPanelServer} from '../server.mjs';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/quarterly-workflow.mjs';
import {createLocalAccounts} from '../backend/local-accounts.mjs';
import {passwordDigest} from '../backend/demo-login.mjs';
import {zipSync,strToU8} from 'fflate';
import mammoth from 'mammoth';
import {spawnSync} from 'node:child_process';

test('updated DOCX dependency chain preserves text extraction and CLI argument parsing',async()=>{
 const files={
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>آزمون گزارش فصلی</w:t></w:r></w:p></w:body></w:document>'
 };
 const buffer=Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)]))));
 assert.equal((await mammoth.extractRawText({buffer})).value.trim(),'آزمون گزارش فصلی');
 const cli=spawnSync(process.execPath,['node_modules/mammoth/bin/mammoth','--help'],{encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(cli.status,0,cli.stderr);assert.match(cli.stdout,/usage:/i);
});

test('throttle reserves in-flight work, refunds only that attempt and expires without evicting live locks',()=>{
 let now=0;const throttle=createAuthThrottle({limit:2,windowMs:10000,maxKeys:2,now:()=>now});
 const failed=throttle.reserve('a'),success=throttle.reserve('a');
 assert.equal(throttle.reserve('a').retryAfter,10);success.release();success.release();
 assert.equal(throttle.reserve('a').retryAfter,undefined);assert.equal(throttle.reserve('a').retryAfter,10);
 throttle.reserve('b');assert.equal(throttle.reserve('c').retryAfter,10);assert.equal(throttle.reserve('a').retryAfter,10);
 now=10000;throttle.reserve('a');failed.release(); // An old completion cannot remove the new window.
 throttle.reserve('a');assert.equal(throttle.reserve('a').retryAfter,10);
});

test('hybrid login cannot clear other failures; password failures are throttled across sessions and audited without secrets',async t=>{
 const root=mkdtempSync(join(tmpdir(),'quarter-security-'));seedQuarterlyFixture(root);
 const store=openStore(root),workflow=createWorkflow(store),accounts=createLocalAccounts(store,workflow);
 const password='Synthetic-original-password',salt='2'.repeat(32);
 for(const id of ['admin','employee-0'])await accounts.save(workflow.user('admin'),{userId:id,username:id,password});
 const server=createPanelServer({root:process.cwd(),dataRoot:root,authMode:'hybrid',demoLogin:{username:'main-test',salt,digest:passwordDigest(password,salt)},autoAssessment:false,runModel:()=>{throw Error('No live AI');}});
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();rmSync(root,{recursive:true,force:true});});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 for(const path of ['/login.html','/api/health','/api/session','/.env','/src/excel-worker.js']){
  const response=await fetch(base+path);await response.arrayBuffer();
  assert.match(response.headers.get('Content-Security-Policy'),/script-src 'self';/);
  assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.equal(response.headers.get('X-Frame-Options'),'DENY');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 }
 const post=async(path,body,token)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'x-panel-token':token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json(),retry:r.headers.get('retry-after')};};
 const login=(username,access='personal',pw=password)=>post('/api/login',{username,access,password:pw});
 const employee=await login('employee-0'),employeeAgain=await login('employee-0');assert.equal(employee.status,200);
 const admin=await login('admin');assert.equal(admin.status,200);
 const changed=await post('/api/auth/password',{currentPassword:password,password:password+'-new'},admin.body.token);assert.equal(changed.status,200);
 assert.equal((await post('/api/session',{userId:'employee-0'},changed.body.token)).status,403);
 assert.equal((await post('/api/auth/password',null,employee.body.token)).status,400);
 const invalidCurrent='Synthetic-wrong-current';
 for(let i=0;i<5;i++)assert.equal((await post('/api/auth/password',{currentPassword:invalidCurrent,password:password+'-new'},(i%2?employeeAgain:employee).body.token)).status,403);
 const limited=await post('/api/auth/password',{currentPassword:password,password:password+'-new'},employeeAgain.body.token);
 assert.equal(limited.status,429);assert.ok(Number(limited.retry)>0);
 const failures=store.list('auth-event').filter(r=>r.action==='password.change.failure');assert.equal(failures.length,5);
 for(const row of failures){assert.equal(row.userId,'employee-0');assert.ok(!JSON.stringify(row).includes(invalidCurrent));assert.ok(!JSON.stringify(row).includes(employee.body.token));}
 for(let i=0;i<4;i++)assert.equal((await login('admin','personal','wrong')).status,401);
 const shared=await login('main-test','main');assert.equal(shared.status,200);
 assert.equal((await post('/api/session',{userId:'manager'},shared.body.token)).status,200);
 assert.equal((await login('admin','personal','wrong')).status,401);
 const blocked=await login('admin','personal','wrong');assert.equal(blocked.status,429);assert.ok(Number(blocked.retry)>0);
});

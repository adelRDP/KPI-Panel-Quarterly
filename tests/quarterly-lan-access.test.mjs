import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {request} from 'node:http';
import {isLanRequestHost,isLoopbackAddress} from '../backend/lan-access.mjs';
import {createPanelServer} from '../server.mjs';
import {passwordDigest} from '../backend/demo-login.mjs';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';

test('LAN accepts every 192.168 subnet, rejects malformed hosts and non-LAN sources',()=>{
  for(const source of ['127.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(isLoopbackAddress(source),true);
  for(const source of ['192.168.123.23','203.0.113.4','::ffff:203.0.113.4',undefined])assert.equal(isLoopbackAddress(source),false);
  for(const host of ['192.168.0.1:4273','192.168.20.81:4273','192.168.123.23:4273','192.168.255.254:4273']){
    for(const source of ['192.168.1.5','192.168.254.9','::ffff:192.168.20.3','127.0.0.1','::1'])assert.equal(isLanRequestHost(host,source),true);
    for(const source of ['203.0.113.4','10.0.0.2','192.169.1.5',''])assert.equal(isLanRequestHost(host,source),false);
  }
  for(const host of ['192.168.256.1:4273','192.168.01.1:4273','192.168.1.1.evil:4273','192.168.1.1@evil:4273','192.168.1.1:4273/path','evil.example:4273','0.0.0.0:4273','10.0.0.1:4273','192.168.1.1'])assert.equal(isLanRequestHost(host,'192.168.2.3'),false);
});

test('LAN is opt-in and preserves login, session, port and cross-origin protections',async t=>{
  const root=mkdtempSync(join(tmpdir(),'quarter-lan-')),servers=[];
  t.after(async()=>{for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r));}rmSync(root,{recursive:true,force:true});});
  const salt='2'.repeat(32),password='Synthetic-LAN-password',demoLogin={username:'lan-test',salt,digest:passwordDigest(password,salt)};
  async function instance(name,lanAccess){
    const dataRoot=join(root,name);seedQuarterlyFixture(dataRoot);
    const server=createPanelServer({dataRoot,lanAccess,demoLogin,autoAssessment:false});servers.push(server);
    server.listen(0,'127.0.0.1');await once(server,'listening');
    return {port:server.address().port};
  }
  function call(target,path,{host=`192.168.123.23:${target.port}`,origin,method='GET',body,headers={}}={}){
    return new Promise((resolve,reject)=>{
      const req=request({hostname:'127.0.0.1',port:target.port,path,method,headers:{Host:host,...(origin?{Origin:origin}:{}),...headers}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
      });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
    });
  }
  const off=await instance('off',false),on=await instance('on',true),origin=`http://192.168.123.23:${on.port}`;
  assert.equal((await call(off,'/api/health')).status,403);
  assert.equal((await call(on,'/api/health')).status,200);
  assert.equal((await call(on,'/')).status,302);
  assert.equal((await call(on,'/api/session')).status,401);
  assert.equal((await call(on,'/api/health',{host:'192.168.123.23:1'})).status,403);
  assert.equal((await call(on,'/api/health',{origin:'http://evil.example'})).status,403);
  assert.equal((await call(on,'/api/health',{origin:`http://192.168.20.81:${on.port}`})).status,403);
  assert.equal((await call(on,'/api/health',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await call(on,'/api/health',{host:`127.0.0.1:${on.port}`})).status,200);
  const login=await call(on,'/api/login',{origin,method:'POST',body:{username:'lan-test',password,access:'main'}});
  assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'][0].split(';')[0],token=JSON.parse(login.text).token;
  assert.doesNotMatch(login.headers['set-cookie'][0],/; Secure/);
  assert.match(login.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);
  const session=await call(on,'/api/session',{origin,headers:{Cookie:cookie}});
  assert.equal(session.status,200);assert.equal(JSON.parse(session.text).token,token);
  assert.equal((await call(on,'/api/session',{origin,method:'DELETE',headers:{Cookie:cookie,'x-panel-token':token}})).status,200);
  assert.equal((await call(on,'/api/session',{headers:{Cookie:cookie}})).status,401);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createPanelSupervisor} from '../scripts/panel-supervisor.mjs';
import {panelInstance} from '../backend/panel-health.mjs';
const wait=async fn=>{for(let n=0;n<150;n++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}assert.fail('Supervisor did not settle');};
async function port(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('supervisor restarts its exited process and refuses a duplicate supervisor',async t=>{
 const p=await port(),root=process.cwd(),spawnChild=()=>spawn(process.execPath,['--input-type=module','-e',`import{createServer}from'node:http';createServer((q,r)=>r.end(JSON.stringify({service:'kpi-panel',instance:${JSON.stringify(panelInstance(root))}}))).listen(${p},'127.0.0.1');`],{windowsHide:true,stdio:'ignore'}),s=createPanelSupervisor({root,port:p,lockPort:0,pollMs:30,spawnChild,log:()=>{}});await s.start();t.after(()=>s.stop());await wait(()=>s.health());const first=s.child.pid;s.child.kill();await wait(async()=>s.child.pid!==first&&await s.health());
 const duplicate=createPanelSupervisor({root,port:p,lockPort:s.lockPort,pollMs:30,spawnChild});await assert.rejects(duplicate.start(),/EADDRINUSE/);
});
test('supervisor adopts a healthy external panel and never kills it on shutdown',async t=>{
 const p=await port(),root=process.cwd(),external=spawn(process.execPath,['--input-type=module','-e',`import{createServer}from'node:http';createServer((q,r)=>r.end(JSON.stringify({service:'kpi-panel',instance:${JSON.stringify(panelInstance(root))}}))).listen(${p},'127.0.0.1');`],{windowsHide:true,stdio:'ignore'}),s=createPanelSupervisor({root,port:p,lockPort:0,pollMs:30,spawnChild:()=>{throw Error('Must adopt external process');}});t.after(()=>external.kill());await wait(()=>s.health());await s.start();await new Promise(r=>setTimeout(r,100));assert.equal(s.child,null);await s.stop();assert.equal(external.exitCode,null);
});

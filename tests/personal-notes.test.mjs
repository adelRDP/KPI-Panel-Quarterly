import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createNotificationCenter} from '../backend/notifications.mjs';
import {createPersonalNotes} from '../backend/personal-notes.mjs';
import {createPanelServer} from '../server.mjs';

const payload=(changes={})=>({title:'عنوان خصوصی',text:'متن شخصی محرمانه',color:'yellow',pinned:false,completed:false,remindAt:null,...changes});
test('private notes enforce owner-only access, validation, revisions and real deletion without private audits',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-private-notes-')),store=openStore(dir),workflow=createWorkflow(store),center=createNotificationCenter(store,workflow),service=createPersonalNotes(store,workflow,center);
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const owner=workflow.user('employee-mohammad'),other=workflow.user('employee-sara'),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo');
  const note=service.save(owner,payload({ownerId:other.id}));assert.equal(note.ownerId,owner.id);assert.equal(service.list(other).length,0);
  assert.equal(service.list(hr).length,0);const adminNote=service.save(hr,payload());assert.equal(adminNote.ownerId,hr.id);assert.throws(()=>service.save(hr,payload({revision:1}),note.id),{status:404});assert.throws(()=>service.remove(hr,note.id,1),{status:404});service.remove(hr,adminNote.id,1);
  assert.equal(service.list(manager).length,0);assert.throws(()=>service.save(manager,payload({revision:1}),note.id),{status:404});assert.throws(()=>service.remove(manager,note.id,1),{status:404});
  const managerNote=service.save(manager,payload({ownerId:owner.id}));assert.equal(managerNote.ownerId,manager.id);
  for(const actor of [owner,other,workflow.user('manager-finance')])assert.throws(()=>service.remove(actor,managerNote.id,1),{status:404});
  service.remove(manager,managerNote.id,1);
  assert.throws(()=>service.save(other,{...payload(),revision:note.revision},note.id),{status:404});assert.throws(()=>service.remove(other,note.id,note.revision),{status:404});
  for(const change of [{text:''},{text:'a'.repeat(10001)},{color:'url(https://bad)'},{pinned:'true'},{remindAt:'2020-01-01T00:00:00Z'}])assert.throws(()=>service.save(owner,payload(change)),{status:400});
  const updated=service.save(owner,payload({pinned:true,revision:note.revision}),note.id);assert.equal(updated.revision,2);assert.throws(()=>service.save(owner,payload({revision:1}),note.id),{status:409});assert.throws(()=>service.remove(owner,note.id,1),{status:409});
  assert.ok(!JSON.stringify(store.list('workflow-audit')).includes('متن شخصی محرمانه'));service.remove(owner,note.id,updated.revision);assert.equal(store.get(note.id,'personal-note'),null);assert.equal(service.list(owner).length,0);
});

for(const ownerId of ['employee-mohammad','manager-ops'])test(`${ownerId} reminders survive restart, publish once, remain generic and private, stop on completion and reschedule`,async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-note-reminders-'));let clock=Date.parse('2026-10-03T10:00:00Z'),store=openStore(dir),workflow=createWorkflow(store),center=createNotificationCenter(store,workflow),service=createPersonalNotes(store,workflow,center,{now:()=>clock});
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const owner=workflow.user(ownerId),other=workflow.user('employee-sara');
  let note=service.save(owner,payload({remindAt:'2026-10-03T10:01:00Z'}));service.scan();assert.equal(center.list(owner).items.length,0);
  store.close();store=openStore(dir);workflow=createWorkflow(store);center=createNotificationCenter(store,workflow);service=createPersonalNotes(store,workflow,center,{now:()=>clock});clock+=61000;service.scan();service.scan();
  let notices=center.list(owner);assert.equal(notices.items.length,1);assert.equal(notices.items[0].view,'notes');assert.ok(!JSON.stringify(notices).includes('متن شخصی محرمانه'));assert.ok(!JSON.stringify(notices).includes('عنوان خصوصی'));assert.equal(center.list(other).items.length,0);assert.equal(center.list(workflow.user('hr-demo')).items.length,0);
  note=service.list(owner)[0];note=service.save(owner,payload({...note,completed:true}),note.id);assert.equal(center.list(owner).unreadCount,0);service.scan();assert.equal(center.list(owner).items.length,1);
  note=service.save(owner,payload({...note,completed:false,remindAt:new Date(clock+60000).toISOString()}),note.id);clock+=61000;service.scan();assert.equal(center.list(owner).items.length,2);service.remove(owner,note.id,note.revision);assert.equal(center.list(owner).unreadCount,0);
});

test('HTTP notes allow each role own notes, reject other owners and persist across sessions',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-note-http-')),server=createPanelServer({dataRoot:dir});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;let session=await (await fetch(base+'/api/session')).json();
  const call=(path,method='GET',data)=>fetch(base+path,{method,headers:{'x-panel-token':session.token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
  const account=async userId=>{session=await (await call('/api/session','POST',{userId})).json();};
  await account('employee-mohammad');let response=await call('/api/notes','POST',payload());assert.equal(response.status,201);const note=await response.json();
  await account('employee-sara');assert.deepEqual(await (await call('/api/notes')).json(),[]);assert.equal((await call('/api/notes/'+note.id,'PUT',payload({revision:1}))).status,404);assert.equal((await call('/api/notes/'+note.id,'DELETE',{revision:1})).status,404);
  await account('manager-ops');assert.deepEqual(await (await call('/api/notes')).json(),[]);assert.equal((await call('/api/notes/'+note.id,'PUT',payload({revision:1}))).status,404);
  response=await call('/api/notes','POST',payload({text:'یادداشت خصوصی مدیر'}));assert.equal(response.status,201);let managerNote=await response.json();
  response=await call('/api/notes/'+managerNote.id,'PUT',payload({...managerNote,pinned:true}));assert.equal(response.status,200);managerNote=await response.json();assert.equal(managerNote.revision,2);
  await account('manager-finance');assert.deepEqual(await (await call('/api/notes')).json(),[]);assert.equal((await call('/api/notes/'+managerNote.id,'DELETE',{revision:2})).status,404);
  await account('hr-demo');assert.equal((await call('/api/notes')).status,200);const ownAdmin=await(await call('/api/notes','POST',payload())).json();assert.equal(ownAdmin.ownerId,'hr-demo');assert.equal((await call('/api/notes/'+note.id,'PUT',payload({revision:1}))).status,404);
  await account('manager-ops');assert.equal((await (await call('/api/notes')).json())[0].text,'یادداشت خصوصی مدیر');assert.equal((await call('/api/notes/'+managerNote.id,'DELETE',{revision:2})).status,200);
  await account('employee-mohammad');assert.equal((await (await call('/api/notes')).json())[0].text,payload().text);assert.equal((await call('/api/notes/'+note.id,'DELETE',{revision:1})).status,200);assert.deepEqual(await (await call('/api/notes')).json(),[]);
});

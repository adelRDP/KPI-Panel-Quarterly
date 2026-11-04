import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createNotificationCenter} from '../backend/notifications.mjs';
import {createChat} from '../backend/chat.mjs';
import {createPanelServer} from '../server.mjs';

const payload=(text='پیام خصوصی',changes={})=>({text,clientId:randomUUID(),...changes});
test('Chat uses current direct reporting relationships, denies peers, and grants admin contacts but not third-party history',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-chat-scope-')),store=openStore(dir),workflow=createWorkflow(store),notifications=createNotificationCenter(store,workflow),chat=createChat(store,workflow,notifications);
  createOrganizationWorkflow(store,workflow,{notifications});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const person=workflow.user('employee-mohammad'),peer=workflow.user('employee-sara'),manager=workflow.user('manager-ops'),other=workflow.user('manager-finance'),hr=workflow.user('hr-demo');
  assert.deepEqual(chat.contacts(person).map(p=>p.id).sort(),[manager.id,hr.id].sort());assert.ok(chat.contacts(manager).some(p=>p.id===person.id));assert.ok(!chat.contacts(manager).some(p=>p.id===other.id));
  for(const target of [person.id,peer.id,other.id,'not-real']){assert.throws(()=>chat.conversation(person,target),{status:404});assert.throws(()=>chat.send(person,target,payload()),{status:404});assert.throws(()=>chat.read(person,target,0),{status:404});}
  assert.throws(()=>chat.contacts(null),{status:403});assert.throws(()=>chat.send({...person,managerId:other.id},other.id,payload()),{status:404});
  const message=chat.send(person,manager.id,payload('محتوای محرمانه', {senderId:peer.id}));assert.equal(message.senderId,person.id);assert.equal(chat.conversation(manager,person.id).messages[0].text,'محتوای محرمانه');
  assert.ok(!JSON.stringify(chat.contacts(hr)).includes('محتوای محرمانه'));assert.equal(chat.conversation(hr,person.id).messages.length,0);assert.equal(chat.contacts(hr).length,workflow.accounts().length-1);
  chat.send(hr,person.id,payload('گفتگوی ادمین'));assert.equal(chat.conversation(person,hr.id).messages[0].text,'گفتگوی ادمین');
  store.put('workflow-user',{id:'employee-child',name:'زیرمجموعه مستقیم',role:'personnel',managerId:person.id});assert.ok(chat.contacts(person).some(row=>row.id==='employee-child'));assert.ok(!chat.contacts(manager).some(row=>row.id==='employee-child'));
  const position=store.list('position-assignment',person.id).find(row=>row.status==='published');store.put('position-assignment',{...position,managerId:other.id,unitId:other.unitId},person.id);
  assert.throws(()=>chat.conversation(person,manager.id),{status:404});assert.throws(()=>chat.send(manager,person.id,payload()),{status:404});assert.throws(()=>chat.read(manager,person.id,message.seq),{status:404});assert.ok(!JSON.stringify(chat.contacts(manager)).includes('محتوای محرمانه'));assert.equal(chat.conversation(person,other.id).messages.length,0);
});

test('Chat persists messages, prevents duplicate retries, paginates, tracks reads and batches generic notifications',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-chat-history-'));let store=openStore(dir),workflow=createWorkflow(store),notifications=createNotificationCenter(store,workflow),clock=Date.now(),chat=createChat(store,workflow,notifications,{now:()=>clock});
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});const person=workflow.user('employee-mohammad'),manager=workflow.user('manager-ops'),input=payload('<img src=x> پیام اول');
  const first=chat.send(person,manager.id,input);assert.equal(chat.send(person,manager.id,input).id,first.id);assert.equal(chat.send(person,manager.id,{...input,clientId:input.clientId.toUpperCase()}).id,first.id);assert.throws(()=>chat.send(person,manager.id,{...input,text:'متن متفاوت'}),{status:409});
  chat.send(person,manager.id,payload('پیام دوم'));assert.equal(chat.contacts(manager).find(row=>row.id===person.id).unread,2);assert.equal(notifications.list(manager).items.filter(row=>row.view==='chat').length,1);assert.ok(!JSON.stringify(notifications.list(manager)).includes('پیام اول'));assert.equal(notifications.list(person).unreadCount,0);
  chat.read(manager,person.id,1);assert.equal(chat.contacts(manager).find(row=>row.id===person.id).unread,1);assert.equal(notifications.list(manager).unreadCount,1);chat.read(manager,person.id,2);assert.equal(notifications.list(manager).unreadCount,0);chat.read(manager,person.id,0);assert.equal(chat.conversation(person,manager.id).peerReadThrough,2);
  for(const input of [payload(''),payload('a'.repeat(4001)),payload('a',{clientId:'bad'})])assert.throws(()=>chat.send(person,manager.id,input),{status:400});assert.throws(()=>chat.read(person,manager.id,999),{status:400});assert.throws(()=>chat.conversation(person,manager.id,NaN),{status:400});
  for(let i=0;i<63;i++){clock+=61000;chat.send(person,manager.id,payload('پیام '+i));}const latest=chat.conversation(manager,person.id);assert.equal(latest.messages.length,60);assert.equal(latest.hasOlder,true);const older=chat.conversation(manager,person.id,latest.messages[0].seq);assert.equal(older.messages.length,5);assert.equal(older.hasOlder,false);assert.ok(older.messages.at(-1).seq<latest.messages[0].seq);
  store.close();store=openStore(dir);workflow=createWorkflow(store);notifications=createNotificationCenter(store,workflow);chat=createChat(store,workflow,notifications);assert.equal(chat.conversation(manager,person.id).lastSeq,65);assert.equal(chat.conversation(person,manager.id).peerReadThrough,2);assert.equal(chat.contacts(workflow.user('employee-sara')).some(p=>p.lastMessage?.text.includes('پیام اول')),false);
});

test('Chat HTTP enforces scope regardless of forged identity, supports admin replies, and rate-limits text sends',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-chat-http-')),server=createPanelServer({dataRoot:dir});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;let session=await (await fetch(base+'/api/session')).json();const call=(path,method='GET',data)=>fetch(base+path,{method,headers:{'x-panel-token':session.token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}),account=async userId=>{session=await (await call('/api/session','POST',{userId})).json();};
  await account('employee-mohammad');assert.equal((await call('/api/chat/employee-sara/messages','POST',payload())).status,404);assert.equal((await call('/api/chat/employee-sara/read','POST',{through:0})).status,404);
  let response=await call('/api/chat/manager-ops/messages','POST',payload('HTTP privé',{senderId:'hr-demo',recipientId:'employee-sara'}));assert.equal(response.status,201);assert.equal((await response.json()).senderId,'employee-mohammad');
  await account('employee-sara');assert.equal((await call('/api/chat/employee-mohammad/messages')).status,404);assert.equal((await (await call('/api/chat/manager-ops/messages')).json()).messages.length,0);
  await account('hr-demo');assert.ok((await (await call('/api/chat/contacts')).json()).some(p=>p.id==='employee-sara'));assert.equal((await (await call('/api/chat/employee-mohammad/messages')).json()).messages.length,0);assert.equal((await call('/api/chat/employee-sara/messages','POST',payload('پیام ادمین'))).status,201);
  await account('employee-sara');assert.equal((await (await call('/api/chat/hr-demo/messages')).json()).messages[0].text,'پیام ادمین');for(let i=0;i<30;i++)assert.equal((await call('/api/chat/manager-ops/messages','POST',payload(String(i)))).status,201);assert.equal((await call('/api/chat/manager-ops/messages','POST',payload('بیشتر'))).status,429);
  assert.equal((await fetch(base+'/api/chat/contacts')).status,403);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createNotificationCenter} from '../backend/notifications.mjs';
import {createChat} from '../backend/chat.mjs';
import {createPanelSearch,normalizeSearch} from '../backend/panel-search.mjs';
import {createPanelServer} from '../server.mjs';

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'kpi-search-')),store=openStore(dir),workflow=createWorkflow(store),notifications=createNotificationCenter(store,workflow),organization=createOrganizationWorkflow(store,workflow,{notifications}),chat=createChat(store,workflow,notifications),search=createPanelSearch(store,workflow,organization,chat).search;
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {store,workflow,organization,search};
}

test('global search normalizes Persian/Arabic characters and digits and returns bounded whitelisted results',async t=>{
  const {store,workflow,search}=await setup(t),actor=workflow.user('employee-mohammad');assert.equal(normalizeSearch(' كِتاب يک ۱۲٣ '),'کتاب یک 123');
  const settings=search(workflow.user('hr-demo'),'تنظیمات مدل محاسبه').items.find(item=>item.view==='evaluation-settings');assert.equal(settings?.title,'تنظیمات مدل محاسبه');assert.equal(search(actor,'تنظیمات مدل محاسبه').items.some(item=>item.view==='evaluation-settings'),false);
  store.put('activity',{id:'search-task',ownerId:actor.id,kind:'routine',title:'کتاب یک ۱۲۳',description:'خروجی مورد انتظار',period:'1405-07',criteria:[{text:'ملاک دقیق پذیرش'}],path:'PRIVATE-PATH',baseSalary:'PRIVATE-PAY'},actor.id);
  store.put('document',{id:'search-doc',name:'مستند تست اکسل',path:'PRIVATE-FILE',extraction:{chunks:[{text:'PRIVATE-EXTRACT'}]}},'search-task');
  assert.equal(search(actor,'كتاب يک 123').items[0].id,'activity:search-task');assert.ok(search(actor,'ملاک دقیق').items.some(row=>row.id==='activity:search-task'));assert.ok(search(actor,'مستند تست').items.some(row=>row.id==='document:search-doc'));
  const result=JSON.stringify(search(actor,'کتاب'));assert.doesNotMatch(result,/PRIVATE-PATH|PRIVATE-PAY|path|baseSalary/);assert.equal(search(actor,'PRIVATE-EXTRACT').total,0);assert.equal(search(actor,'PRIVATE-FILE').total,0);
  for(let i=0;i<55;i++)store.put('activity',{id:'bulk-search-'+i,ownerId:actor.id,kind:'routine',title:'همسان '+i,period:'1405-07'},actor.id);
  const bounded=search(actor,'همسان');assert.equal(bounded.total,55);assert.equal(bounded.items.length,40);assert.equal(bounded.limit,40);assert.equal(search(actor,' ').total,0);assert.throws(()=>search(actor,'x'.repeat(121)),{status:400});
});

test('search honors self/team/admin scope, private notes and drafts without writing data or exposing votes, pay or third-party messages',async t=>{
  const {store,workflow,search}=await setup(t),person=workflow.user('employee-mohammad'),peer=workflow.user('employee-sara'),other=workflow.user('employee-maryam'),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo');
  store.put('activity',{id:'other-private-task',ownerId:other.id,kind:'project',title:'نشان محرمانه مالی',period:'1405-07'},other.id);
  store.put('activity',{id:'peer-task',ownerId:peer.id,kind:'routine',title:'نشان شاخص همکار',period:'1405-07'},peer.id);
  store.put('personal-note',{id:'own-note',ownerId:person.id,title:'خصوصی من',text:'متن یادداشت اختصاصی',remindAt:'2020-01-01T00:00:00.000Z'},person.id);
  store.put('personal-note',{id:'peer-note',ownerId:peer.id,title:'خصوصی همکار',text:'متن دیگران'},peer.id);
  store.put('personal-note',{id:'manager-note',ownerId:manager.id,title:'نشان‌مدیریتی‌یکتا',text:'محتوای‌یادداشت‌مدیریتی‌یکتا'},manager.id);
  store.put('kpi-design',{id:'manager-draft-search',employeeId:person.id,status:'draft',period:'1405-07',tasks:[{id:'t',title:'پیش نویس محرمانه',category:'routine'}]},person.id);
  store.put('chat-message',{id:'private-message',senderId:peer.id,recipientId:manager.id,text:'گفتگوی محرمانه ثالث'},'thread');store.put('service-survey-response',{id:'private-vote',score:73,comment:'رأی محرمانه'},'campaign');
  const before=JSON.stringify(['notification','audit-event','personal-note'].map(kind=>store.list(kind)));
  assert.equal(search(person,'نشان محرمانه مالی').total,0);assert.equal(search(person,'نشان شاخص همکار').total,0);assert.ok(search(manager,'نشان شاخص همکار').total>0);assert.equal(search(manager,'نشان محرمانه مالی').total,0);assert.ok(search(hr,'نشان محرمانه مالی').total>0);
  assert.ok(search(person,'خصوصی من').items.some(row=>row.id==='note:own-note'));for(const actor of [manager,hr,peer])assert.equal(search(actor,'متن یادداشت اختصاصی').total,0);
  assert.ok(search(manager,'محتوای‌یادداشت‌مدیریتی‌یکتا').items.some(row=>row.id==='note:manager-note'));for(const actor of [person,hr,workflow.user('manager-finance')])assert.equal(search(actor,'محتوای‌یادداشت‌مدیریتی‌یکتا').total,0);
  assert.ok(search(manager,'پیش نویس محرمانه').total>0);assert.equal(search(hr,'پیش نویس محرمانه').total,0);assert.equal(search(person,'پیش نویس محرمانه').total,0);assert.equal(search({...person,role:'hr'},'مدیریت ساختار').total,0);
  for(const actor of [person,manager,hr]){assert.equal(search(actor,'گفتگوی محرمانه ثالث').total,0);assert.equal(search(actor,'رأی محرمانه').total,0);}
  assert.equal(JSON.stringify(['notification','audit-event','personal-note'].map(kind=>store.list(kind))),before);
  assert.equal(search(person,'سارا احمدی').total,0);assert.ok(search(manager,'سارا احمدی').total>0);assert.ok(search(hr,'سارا احمدی').total>0);
  const activity=store.get('peer-task','activity');store.put('activity',{...activity,removedAt:new Date().toISOString()},peer.id);assert.equal(search(manager,'نشان شاخص همکار').total,0);
});

test('search indexes scoped appeals, survey titles, organizational data and files without archived documents',async t=>{
  const {store,workflow,search}=await setup(t),actor=workflow.user('employee-mohammad'),hr=workflow.user('hr-demo');
  store.put('quarter-appeal',{id:'appeal-search',employeeId:actor.id,quarter:'1405-Q3',reason:'بازبینی مدارک انجام کار',status:'manager_review'},actor.id);
  store.put('quarter-appeal-file',{id:'appeal-file-search',name:'رسید بازبینی.pdf'},'appeal-search');
  store.put('service-survey-campaign',{id:'survey-search',employeeId:actor.id,unitId:actor.unitId,period:workflow.currentPeriod,status:'completed',title:'سنجش خدمات ویژه'},actor.id);
  store.put('org-section',{id:'section-search',unitId:'ops',name:'بخش برنامه ریزی ویژه'});
  assert.ok(search(actor,'بازبینی مدارک').items.some(row=>row.id==='appeal:appeal-search'));assert.ok(search(actor,'رسید بازبینی').items.some(row=>row.id==='appeal-file:appeal-file-search'));assert.ok(search(actor,'خدمات ویژه').items.some(row=>row.id==='survey:survey-search'));assert.ok(search(hr,'برنامه ریزی').items.some(row=>row.id==='section:section-search'));
  assert.equal(search(hr,'بازبینی مدارک').items.find(row=>row.id==='appeal:appeal-search').view,'incoming');assert.equal(search(hr,'رسید بازبینی').items.find(row=>row.id==='appeal-file:appeal-file-search').view,'incoming');assert.equal(search(actor,'بازبینی مدارک').items.find(row=>row.id==='appeal:appeal-search').view,'appeals');
  const own=store.list('activity').find(row=>row.ownerId===actor.id);store.put('document',{id:'archived-search-doc',name:'حذفشده ویژه',archivedAt:new Date().toISOString()},own.id);assert.equal(search(actor,'حذفشده ویژه').total,0);
});

test('search HTTP requires a session, ignores forged scope parameters and serves the new search asset',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-search-http-')),server=createPanelServer({dataRoot:join(dir,'db')});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(base+'/api/search?q=مدیریت')).status,403);const session=await(await fetch(base+'/api/session')).json(),call=q=>fetch(base+'/api/search?'+q,{headers:{'x-panel-token':session.token}});
  let response=await call('q=مدیریت%20ساختار&role=hr&userId=hr-demo');assert.equal(response.status,200);assert.equal((await response.json()).total,0);response=await call('q=شاخص');assert.ok((await response.json()).items.some(row=>row.view==='assignments'));assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await call('q='+'x'.repeat(121))).status,400);assert.equal((await fetch(base+'/src/search-ui.js')).status,200);
});

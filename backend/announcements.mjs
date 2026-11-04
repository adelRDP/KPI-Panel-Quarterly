import {createHash,randomUUID} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,publicMessage:message});};
const digest=value=>createHash('sha256').update(value).digest('hex');
export const announcementNoticeId=(id,userId)=>digest(`announcement:${id}:${userId}`);
export function createAnnouncements(store,workflow,{now=Date.now}={}){
 let chatDelivery=null;
 const actorOf=actor=>workflow.user(actor?.id),requireHr=actor=>{const user=actorOf(actor);if(user?.role!=='hr')fail('ثبت و مدیریت اطلاعیه فقط برای ادمین مجاز است.',403);return user;};
 const time=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)||!Number.isFinite(Date.parse(value)))fail('تاریخ و ساعت اطلاعیه معتبر نیست.');const date=value.slice(0,10),[y,m,d]=date.split('-').map(Number);if(new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)!==date)fail('تاریخ اطلاعیه معتبر نیست.');return new Date(value).toISOString();};
 const phase=(row,clock)=>row.deletedAt?'deleted':clock<Date.parse(row.startsAt)?'scheduled':clock<Date.parse(row.endsAt)?'active':'ended';
 const publicRow=row=>{const {recipientIds,payloadHash,requestId,...safe}=row;return {...safe,recipientCount:recipientIds.length,chatDeliveredCount:store.list('announcement-chat-delivery',row.id).length,status:phase(row,now())};};
 function create(actor,input){
  const user=requireHr(actor);if(!input||typeof input!=='object')fail('اطلاعات اطلاعیه معتبر نیست.');
  const title=typeof input.title==='string'?input.title.trim():'',body=typeof input.body==='string'?input.body.trim():'';
  if(!title||title.length>200||!body||body.length>5000)fail('عنوان تا ۲۰۰ نویسه و متن اطلاعیه تا ۵۰۰۰ نویسه الزامی است.');
  if(!['all','managers'].includes(input.audience))fail('مخاطب اطلاعیه معتبر نیست.');
  if(typeof input.requestId!=='string'||!/^[\w-]{8,100}$/.test(input.requestId))fail('شناسه ارسال اطلاعیه معتبر نیست.');
  const startsAt=time(input.startsAt),endsAt=time(input.endsAt);if(endsAt<=startsAt)fail('پایان اطلاعیه باید پس از شروع باشد.');
  const values={title,body,audience:input.audience,startsAt,endsAt},payloadHash=digest(JSON.stringify(values));
  const saved=store.transaction(()=>{
   const rows=store.list('announcement'),previous=rows.find(r=>r.createdBy===user.id&&r.requestId===input.requestId);
   if(previous){if(previous.payloadHash!==payloadHash)fail('این ارسال قبلاً با اطلاعات متفاوت ثبت شده است.',409);return publicRow(previous);}
   if(Date.parse(endsAt)<=now())fail('زمان پایان باید در آینده باشد.');
   const recipientIds=store.list('workflow-user').map(p=>workflow.user(p.id)).filter(p=>p&&(input.audience==='managers'?p.role==='manager':['personnel','manager'].includes(p.role))).map(p=>p.id);
   if(!recipientIds.length)fail('مخاطبی برای این گروه وجود ندارد.');
   const number=Math.max(store.get('announcement-counter','announcement-counter')?.nextNumber||1,...rows.map(r=>r.number+1)),createdAt=new Date(now()).toISOString();
   const row=store.put('announcement',{id:'announcement-'+randomUUID(),number,...values,recipientIds,createdBy:user.id,createdAt,requestId:input.requestId,payloadHash,version:1});
   store.put('announcement-counter',{id:'announcement-counter',nextNumber:number+1});
   store.put('audit-event',{actorId:user.id,action:'announcement.created',entityType:'announcement',entityId:row.id,details:{number,audience:row.audience,recipientCount:recipientIds.length,startsAt,endsAt},createdAt});return publicRow(row);
  });
  scanChat();return publicRow(store.get(saved.id,'announcement'));
 }
 function list(actor){requireHr(actor);return store.list('announcement').sort((a,b)=>b.number-a.number).map(publicRow);}
 function remove(actor,id){const user=requireHr(actor);return store.transaction(()=>{const row=store.get(id,'announcement');if(!row)fail('اطلاعیه پیدا نشد.',404);if(row.deletedAt)return publicRow(row);const deletedAt=new Date(now()).toISOString(),deleted=store.put('announcement',{...row,deletedAt,deletedBy:user.id});store.put('audit-event',{actorId:user.id,action:'announcement.deleted',entityType:'announcement',entityId:row.id,details:{number:row.number,recipientCount:row.recipientIds.length},createdAt:deletedAt});return publicRow(deleted);});}
 function notices(actor){
  const user=actorOf(actor);if(!user)fail('دسترسی مجاز نیست.',403);const clock=now(),rows=store.list('announcement').filter(r=>!r.deletedAt&&r.recipientIds.includes(user.id));
  const boundaries=rows.flatMap(r=>[Date.parse(r.startsAt),Date.parse(r.endsAt)]).filter(t=>t>clock).sort((a,b)=>a-b);
  return {refreshAfterMs:boundaries.length?Math.min(30000,Math.max(0,boundaries[0]-clock)):null,items:rows.filter(r=>Date.parse(r.startsAt)<=clock).map(r=>{
   const id=announcementNoticeId(r.id,user.id);return {id,recipientId:user.id,kind:'announcement',title:r.title,description:r.body,number:r.number,view:'announcements',entityId:r.id,createdAt:r.createdAt,pinned:clock<Date.parse(r.endsAt),readAt:store.get(id,'announcement-read')?.readAt||null};
  })};
 }
 function markRead(actor,id){const item=notices(actor).items.find(r=>r.id===id);if(!item)fail('اعلان پیدا نشد.',404);if(!item.readAt)store.put('announcement-read',{id,recipientId:actor.id,announcementId:item.entityId,readAt:new Date(now()).toISOString()},actor.id);return {...item,readAt:store.get(id,'announcement-read').readAt};}
 function scanChat(){
  const clock=now(),rows=store.list('announcement').filter(r=>!r.deletedAt),future=rows.filter(r=>Date.parse(r.startsAt)>clock).map(r=>Date.parse(r.startsAt));let delivered=0,failed=0;
  if(chatDelivery)for(const row of rows.filter(r=>phase(r,clock)==='active')){
   const done=new Set(store.list('announcement-chat-delivery',row.id).map(r=>r.recipientId));
   for(const recipient of row.recipientIds)if(!done.has(recipient)&&workflow.user(recipient)){try{const result=chatDelivery(row.id,recipient);if(!result.duplicate)delivered++;}catch{failed++;}}
  }
  return {delivered,failed,nextStartAt:future.length?Math.min(...future):null};
 }
 return {create,list,remove,notices,markRead,scanChat,setChatDelivery:fn=>{chatDelivery=fn;}};
}

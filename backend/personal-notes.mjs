import { randomUUID } from 'node:crypto';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,publicMessage:message});};
const colors=new Set(['yellow','green','blue','pink']);
export function createPersonalNotes(store,workflow,notifications,{now=()=>Date.now()}={}){
  const eligible=actor=>['personnel','manager','hr'].includes(actor?.role);
  const authorize=actor=>{if(!eligible(actor))fail('یادداشت شخصی برای این حساب در دسترس نیست.',403);};
  function owned(actor,id){authorize(actor);const note=store.get(id,'personal-note');if(!note||note.ownerId!==actor.id)fail('یادداشت پیدا نشد.',404);return note;}
  function retireReminder(note){if(note.notificationId)notifications.markRead({id:note.ownerId},note.notificationId);}
  function save(actor,input,id=null){
    authorize(actor);if(!input||typeof input!=='object'||Array.isArray(input))fail('اطلاعات یادداشت معتبر نیست.');
    const previous=id?owned(actor,id):null;
    if(previous&&input.revision!==previous.revision)fail('یادداشت در جای دیگری تغییر کرده؛ فهرست را تازه کنید.',409);
    const title=typeof input.title==='string'?input.title.trim():'',text=typeof input.text==='string'?input.text.trim():'';
    if(title.length>120||!text||text.length>10000)fail('متن یادداشت لازم است (حداکثر ۱۰٬۰۰۰ نویسه)؛ عنوان حداکثر ۱۲۰ نویسه است.');
    if(!colors.has(input.color)||typeof input.pinned!=='boolean'||typeof input.completed!=='boolean')fail('رنگ یا وضعیت یادداشت معتبر نیست.');
    let remindAt=null;
    if(input.remindAt!==null&&input.remindAt!==undefined){
      if(typeof input.remindAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.remindAt)||!Number.isFinite(Date.parse(input.remindAt)))fail('تاریخ و ساعت یادآوری معتبر نیست.');
      if(new Date(input.remindAt.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==input.remindAt.slice(0,10))fail('روز انتخاب‌شده در تقویم وجود ندارد.');
      remindAt=new Date(input.remindAt).toISOString();
      if(remindAt!==previous?.remindAt&&Date.parse(remindAt)<=now())fail('زمان یادآوری جدید باید در آینده باشد.');
    }
    if(!previous&&store.list('personal-note',actor.id).length>=200)fail('حداکثر ۲۰۰ یادداشت قابل نگهداری است.');
    const reset=remindAt!==previous?.remindAt||input.completed!==previous?.completed;
    return store.transaction(()=>{
      if(previous&&reset)retireReminder(previous);
      const timestamp=new Date(now()).toISOString();
      return store.put('personal-note',{id:previous?.id||randomUUID(),ownerId:actor.id,title,text,color:input.color,pinned:input.pinned,completed:input.completed,remindAt,reminderKey:reset?randomUUID():previous?.reminderKey||randomUUID(),remindedAt:reset?null:previous?.remindedAt||null,notificationId:reset?null:previous?.notificationId||null,createdAt:previous?.createdAt||timestamp,updatedAt:timestamp,revision:(previous?.revision||0)+1},actor.id);
    });
  }
  function remove(actor,id,revision){const note=owned(actor,id);if(revision!==note.revision)fail('یادداشت تغییر کرده؛ فهرست را تازه کنید.',409);return store.transaction(()=>{retireReminder(note);store.remove(id,'personal-note',actor.id);return {deleted:true};});}
  function scan(ownerId=null){
    const rows=ownerId?store.list('personal-note',ownerId):store.list('personal-note');
    for(const note of rows){
      if(!note.remindAt||note.completed||note.remindedAt||Date.parse(note.remindAt)>now()||!eligible(workflow.user(note.ownerId)))continue;
      store.transaction(()=>{
        const [notice]=notifications.publish({eventKey:`private-note:${note.id}:${note.reminderKey}`,recipientIds:[note.ownerId],kind:'action',title:'یادآوری یادداشت شخصی',description:'زمان یادآوری یکی از یادداشت‌های شما رسیده است؛ یادداشت‌ها را باز کنید.',view:'notes',entityId:note.id});
        store.put('personal-note',{...note,remindedAt:new Date(now()).toISOString(),notificationId:notice?.id||null},note.ownerId);
      });
    }
  }
  function list(actor){authorize(actor);scan(actor.id);return store.list('personal-note',actor.id).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));}
  return {save,remove,list,scan};
}

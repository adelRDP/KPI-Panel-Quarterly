import { createHash, randomUUID } from 'node:crypto';

const allowedViews=new Set(['case-review','dashboard','assignments','projectAssignments','incoming','team','surveys','tasks','quarters','organization','position-review','data','appeals','chart','notes','chat']);
const notificationId=(eventKey,recipientId)=>createHash('sha256').update(`${eventKey}:${recipientId}`).digest('hex');

export function createNotificationCenter(store,workflow,{announcements}={}){
  const hrIds=()=>store.list('workflow-user').filter(person=>person.role==='hr').map(person=>person.id);
  function publish({eventKey=randomUUID(),recipientIds=[],actorId=null,kind='info',title,description='',view,entityId=null}){
    if(!allowedViews.has(view)||!['action','info'].includes(kind)||!title)throw new Error('Invalid notification');
    const created=[];
    for(const recipientId of new Set(recipientIds)){
      if(!recipientId||recipientId===actorId||!workflow.user(recipientId))continue;
      const id=notificationId(eventKey,recipientId);
      if(store.get(id,'notification'))continue;
      created.push(store.put('notification',{id,recipientId,kind,title,description,view,entityId,createdAt:new Date().toISOString(),readAt:null},recipientId));
    }
    return created;
  }
  function list(actor){
    if(!actor?.id)throw Object.assign(new Error('دسترسی مجاز نیست.'),{status:403,publicMessage:'دسترسی مجاز نیست.'});
    const extra=announcements?.notices(actor)||{items:[]},all=[...store.list('notification',actor.id),...extra.items].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.createdAt.localeCompare(a.createdAt)||(b.number||0)-(a.number||0)),pinned=all.filter(item=>item.pinned),other=all.filter(item=>!item.pinned);
    return {items:[...pinned,...other.slice(0,Math.max(0,100-pinned.length))],unreadCount:all.filter(item=>!item.readAt).length,refreshAfterMs:extra.refreshAfterMs??null};
  }
  function markRead(actor,id){
    const item=store.get(id,'notification');
    if(!item&&announcements)return announcements.markRead(actor,id);
    if(!item||item.recipientId!==actor?.id)throw Object.assign(new Error('اعلان پیدا نشد.'),{status:404,publicMessage:'اعلان پیدا نشد.'});
    return item.readAt?item:store.put('notification',{...item,readAt:new Date().toISOString()},actor.id);
  }
  function markAllRead(actor){
    let count=0;
    for(const item of store.list('notification',actor.id))if(!item.readAt){markRead(actor,item.id);count++;}
    for(const item of announcements?.notices(actor).items||[])if(!item.readAt){announcements.markRead(actor,item.id);count++;}
    return {count};
  }
  function fromAudit(event,{record,serviceRespondents}={}){
    const {action,actorId,entityId}=event,personId=record?.employeeId||record?.ownerId;
    const person=personId?workflow.user(personId):null,managerId=record?.managerId||person?.managerId;
    const emit=(recipientIds,kind,title,description,view)=>publish({eventKey:event.id,recipientIds,actorId,kind,title,description,view,entityId});
    switch(action){
      case 'person.created':emit([record?.managerId,record?.id],'action','پرسنل جدید ثبت شد','اطلاعات و سمت جدید نیازمند پیگیری است.','chart');break;
      case 'position.proposed':emit([managerId],'action','پیشنهاد سمت جدید','یک سمت برای بازبینی شما ارسال شده است.','position-review');break;
      case 'position.manager-review':emit(hrIds(),'action',record?.status==='hr_approval'?'سمت در انتظار تصویب HR':'سمت برای اصلاح برگشت خورد','وضعیت پیشنهاد سمت تغییر کرد.','organization');break;
      case 'position.published':emit([record?.employeeId,managerId],'info','سمت تأیید و منتشر شد','اطلاعات پرسنلی و چارت سازمانی به‌روز شد.','chart');break;
      case 'kpi-design.ai-reviewed':emit([managerId],'action','بررسی شاخص آماده است','پیشنهاد شاخص را بازبینی کنید.','tasks');break;
      case 'kpi-design.manager-review':if(record?.status==='hr_review')emit(hrIds(),'action','شاخص در انتظار تصویب HR','طرح KPI برای بررسی نهایی ارسال شد.','organization');break;
      case 'kpi-design.published':emit([record?.employeeId],'info','شاخص جدید منتشر شد','شاخص‌های مصوب دوره به‌روز شدند.','assignments');publish({eventKey:`${event.id}:manager`,recipientIds:[managerId],actorId,kind:'info',title:'شاخص واحد منتشر شد',description:'طرح KPI تأیید و به پرسنل تخصیص داده شد.',view:'tasks',entityId});break;
      case 'kpi-design.returned':emit([managerId],'action','شاخص برای اصلاح برگشت خورد','طرح KPI نیازمند اصلاح است.','tasks');break;
      case 'task-deadline.reminder':emit([managerId],'action','یادآوری تعریف شاخص','مهلت تعریف شاخص برای یک سمت نزدیک است.','tasks');break;
      case 'task-deadline.escalation':emit([managerId],'action','مهلت تعریف شاخص گذشته است','برای یک سمت هنوز پیشنهاد شاخص ثبت نشده است.','tasks');publish({eventKey:`${event.id}:hr`,recipientIds:hrIds(),kind:'action',title:'مهلت تعریف شاخص گذشته است',description:'برای یک سمت هنوز پیشنهاد شاخص ثبت نشده است.',view:'organization',entityId});break;
      case 'service-survey.opened':emit(serviceRespondents?.(record.period,record.unitId).map(p=>p.id)||[],'action','نظرسنجی همکاران فعال شد','یک نظرسنجی تازه برای ثبت نظر شما باز است.','surveys');break;
      case 'service-survey.completed':emit([record?.employeeId],'info','نتیجهٔ نظرسنجی همکاران آماده شد','مشارکت لازم تکمیل و نتیجهٔ تجمیعی ثبت شد.','surveys');break;
      case 'service-survey.insufficient':emit([record?.employeeId],'info','نظرسنجی بدون امتیاز بسته شد','مشارکت لازم تکمیل نشد.','surveys');break;
      case 'quarter.submitted-for-hr':emit([...hrIds(),record?.employeeId],'action','ارزیابی فصل به HR ارسال شد','نتیجهٔ فصل در انتظار بررسی نهایی است.','quarters');break;
      case 'quarter.locked':emit([record?.employeeId,managerId],'info','نتیجهٔ فصل نهایی شد','ارزیابی فصل قفل شده و از پنل قابل مشاهده است.','quarters');break;
      case 'quarter.returned':emit([record?.employeeId,managerId],'action','ارزیابی فصل برگشت خورد','داده‌ها یا مستندات فصل نیازمند بازبینی است.','quarters');break;
      case 'quarter.appeal-submitted':emit([managerId],'action','اعتراض جدید ثبت شد','درخواست بازبینی نتیجه در انتظار نظر شماست.','appeals');break;
      case 'quarter.appeal-file-added':emit([record?.employeeId,managerId],'info','مستند اعتراض اضافه شد','فایل تازه‌ای به درخواست بازبینی پیوست شد.','appeals');break;
      case 'quarter.appeal-manager-review':emit(record?.status==='hr_review'?hrIds():[record?.employeeId],'action','وضعیت اعتراض تغییر کرد','درخواست بازبینی به مرحلهٔ بعد رفت.','appeals');break;
      case 'quarter.appeal-hr-review':emit([record?.employeeId],'info','به اعتراض رسیدگی شد','نتیجهٔ بررسی درخواست در پنل قابل مشاهده است.','appeals');break;
      default:break;
    }
  }
  return {publish,list,markRead,markAllRead,fromAudit};
}

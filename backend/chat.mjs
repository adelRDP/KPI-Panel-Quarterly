import {createHash,randomUUID} from 'node:crypto';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,publicMessage:message});};
const roles=new Set(['personnel','manager','hr']);
const threadId=(a,b)=>createHash('sha256').update(JSON.stringify([a,b].sort())).digest('hex');
export function createChat(store,workflow,notifications,{now=()=>Date.now()}={}){
  function actorFor(actor){const current=typeof actor?.id==='string'?workflow.user(actor.id):null;if(!current||!roles.has(current.role))fail('دسترسی Chat مجاز نیست.',403);return current;}
  const related=(a,b)=>a.id!==b.id&&roles.has(b.role)&&(a.role==='hr'||b.role==='hr'||a.managerId===b.id||b.managerId===a.id);
  function pair(actor,peerId){const current=actorFor(actor),peer=typeof peerId==='string'?workflow.user(peerId):null;if(!peer||!related(current,peer))fail('گفتگو در محدودهٔ دسترسی شما نیست.',404);return {current,peer,id:threadId(current.id,peer.id)};}
  const state=id=>store.get(id,'chat-thread')||{id,lastSeq:0,readThrough:{}};
  const person=p=>({id:p.id,name:p.name,jobTitle:p.jobTitle||p.level||'',unitName:p.unitName||''});
  const withdrawn=row=>!!row.announcement&&!!store.get(row.announcement.id,'announcement')?.deletedAt;
  const messages=id=>store.list('chat-message',id).filter(row=>!withdrawn(row)).sort((a,b)=>a.seq-b.seq);
  function contacts(actor){
    const current=actorFor(actor);
    return store.list('workflow-user').map(row=>workflow.user(row.id)).filter(peer=>peer&&related(current,peer)).map(peer=>{
      const id=threadId(current.id,peer.id),thread=state(id),rows=messages(id),read=thread.readThrough[current.id]||0,last=rows.at(-1);
      return {...person(peer),relation:peer.role==='hr'?'ادمین':current.role==='hr'?'مخاطب سازمانی':current.managerId===peer.id?'مافوق مستقیم':'زیرمجموعهٔ مستقیم',unread:rows.filter(row=>row.senderId!==current.id&&row.seq>read).length,lastMessage:last?{text:last.text,sentAt:last.sentAt,mine:last.senderId===current.id}:null};
    }).sort((a,b)=>Number(b.unread>0)-Number(a.unread>0)||(b.lastMessage?.sentAt||'').localeCompare(a.lastMessage?.sentAt||'')||a.name.localeCompare(b.name,'fa'));
  }
  function conversation(actor,peerId,before=null){
    const {current,peer,id}=pair(actor,peerId),thread=state(id);
    if(before!==null&&(!Number.isSafeInteger(before)||before<1))fail('موقعیت پیام معتبر نیست.');
    const rows=messages(id).filter(row=>before===null||row.seq<before),page=rows.slice(-60);
    const withdrawnAnnouncementIds=[...new Set(store.list('chat-message',id).filter(withdrawn).map(row=>row.announcement.id))];
    return {peer:person(peer),messages:page.map(({clientId,announcement,...row})=>({...row,...(announcement?{announcement:{id:announcement.id,number:announcement.number}}:{})})),withdrawnAnnouncementIds,hasOlder:rows.length>page.length,lastSeq:thread.lastSeq,readThrough:thread.readThrough[current.id]||0,peerReadThrough:thread.readThrough[peer.id]||0};
  }
  function send(actor,peerId,input){
    const {current,peer,id}=pair(actor,peerId);
    if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.trim().length>4000||typeof input.clientId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.clientId))fail('متن پیام لازم است (حداکثر ۴۰۰۰ نویسه).');
    const rows=messages(id),previous=rows.find(row=>row.senderId===current.id&&row.clientId===input.clientId.toLowerCase());
    if(previous){if(previous.text!==input.text.trim())fail('شناسهٔ ارسال قبلاً برای پیام دیگری استفاده شده است.',409);return {...previous,duplicate:true};}
    if(rows.filter(row=>!row.announcement&&row.senderId===current.id&&Date.parse(row.sentAt)>now()-60000).length>=30)fail('ارسال پیام زیاد است؛ یک دقیقه بعد دوباره تلاش کنید.',429);
    return store.transaction(()=>{
      const thread=state(id),row={id:randomUUID(),threadId:id,seq:thread.lastSeq+1,senderId:current.id,recipientId:peer.id,text:input.text.trim(),clientId:input.clientId.toLowerCase(),sentAt:new Date(now()).toISOString()};
      store.put('chat-message',row,id);store.put('chat-thread',{...thread,lastSeq:row.seq});
      notifications.publish({eventKey:`chat:${id}:${peer.id}:${thread.readThrough[peer.id]||0}`,recipientIds:[peer.id],actorId:current.id,kind:'info',title:'پیام جدید در Chat',description:'یک پیام جدید از مخاطب مجاز شما رسیده است.',view:'chat',entityId:current.id});
      return row;
    });
  }
  function read(actor,peerId,through){
    const {current,peer,id}=pair(actor,peerId),thread=state(id);
    if(!Number.isSafeInteger(through)||through<0||through>thread.lastSeq)fail('موقعیت خواندن معتبر نیست.');
    return store.transaction(()=>{
      const next=Math.max(thread.readThrough[current.id]||0,through);store.put('chat-thread',{...thread,readThrough:{...thread.readThrough,[current.id]:next}});
      if(!messages(id).some(row=>row.senderId===peer.id&&row.seq>next))for(const notice of store.list('notification',current.id))if(notice.view==='chat'&&notice.entityId===peer.id&&!notice.readAt)notifications.markRead(current,notice.id);
      return {readThrough:next};
    });
  }
  // Internal delivery only: public message input cannot choose a sender or forge this metadata.
  function deliverAnnouncement(announcementId,recipientId){
    const row=store.get(announcementId,'announcement'),clock=now();
    if(!row||row.deletedAt||!row.recipientIds.includes(recipientId)||Date.parse(row.startsAt)>clock||Date.parse(row.endsAt)<=clock)fail('اطلاعیه برای ارسال در Chat فعال نیست.',409);
    const sender=workflow.user('hr-demo');if(sender?.role!=='hr')fail('اکانت ادمین KPI برای ارسال اطلاعیه آماده نیست.',409);
    const {current,peer,id}=pair(sender,recipientId),deliveryId=createHash('sha256').update(`announcement-chat:${row.id}:${peer.id}`).digest('hex');
    return store.transaction(()=>{
      const previous=store.get(deliveryId,'announcement-chat-delivery');if(previous)return {...previous,duplicate:true};
      const thread=state(id),sentAt=new Date(clock).toISOString(),message={id:randomUUID(),threadId:id,seq:thread.lastSeq+1,senderId:current.id,recipientId:peer.id,text:`اطلاعیهٔ ${row.number} · ${row.title}\n\n${row.body}`,clientId:`announcement:${row.id}`,sentAt,announcement:{id:row.id,number:row.number,startsAt:row.startsAt,endsAt:row.endsAt}};
      store.put('chat-message',message,id);store.put('chat-thread',{...thread,lastSeq:message.seq});
      return store.put('announcement-chat-delivery',{id:deliveryId,announcementId:row.id,recipientId:peer.id,senderId:current.id,messageId:message.id,sentAt},row.id);
    });
  }
  return {contacts,conversation,send,read,deliverAnnouncement};
}

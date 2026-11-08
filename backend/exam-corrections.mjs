import {assertQuarterWritable} from './quarter-lock.mjs';
import {requireQuarter} from './quarter-period.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status,publicMessage:message});};
export function createExamCorrections(store,workflow,{audit,notifications}={}){
 const admin=actor=>{if(actor?.role!=='hr')fail('اصلاح آزمون فقط برای ادمین مجاز است.',403);};
 function writable(row){assertQuarterWritable(store,row.employeeId,row.period);if(workflow.user(row.employeeId)?.isSettled||store.list('position-closeout',row.employeeId).some(c=>c.status==='locked'&&c.months.some(m=>m.period===row.period)))fail('بازهٔ این آزمون بسته شده است؛ از گردش اعتراض به نتیجهٔ نهایی استفاده کنید.',409);}
 function list(actor,period){admin(actor);requireQuarter(period);return store.list('exam-result').filter(r=>r.period===period).map(row=>{let blocked=null;try{writable(row);}catch(e){blocked=e.publicMessage;}return {...row,revision:row.revision||1,employeeName:workflow.user(row.employeeId)?.name||row.employeeId,blocked,history:store.list('exam-result-revision',row.id).map(r=>({id:r.id,beforeScore:r.before.score,afterScore:r.after.score,reason:r.reason,createdAt:r.createdAt,actorId:r.actorId}))};});}
 function correct(actor,id,input){admin(actor);return store.transaction(()=>{
  const old=store.get(id,'exam-result');if(!old)fail('نتیجهٔ آزمون پیدا نشد.',404);writable(old);
  if(input?.revision!==(old.revision||1))fail('نتیجه هم‌زمان تغییر کرده است؛ دوباره دریافت کنید.',409);
  if(!Number.isFinite(input.score)||input.score<0||input.score>100)fail('امتیاز باید عددی بین صفر تا صد باشد.');
  if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>2000)fail('دلیل اصلاح را با حداقل پنج نویسه بنویسید.');if(input.score===old.score)fail('امتیاز جدید با امتیاز فعلی یکسان است.');
  const at=new Date().toISOString(),updated={...old,score:input.score,revision:(old.revision||1)+1,correctedAt:at,correctedBy:actor.id};
  store.put('exam-result-revision',{resultId:id,employeeId:old.employeeId,period:old.period,before:old,after:updated,reason:input.reason.trim(),actorId:actor.id,createdAt:at},id);store.put('exam-result',updated,old.employeeId);
  audit?.(actor,'exam.result-corrected','exam-result',id,{employeeId:old.employeeId,period:old.period,revision:updated.revision,reason:input.reason.trim()});notifications?.publish({recipientIds:[old.employeeId,workflow.user(old.employeeId)?.managerId],actorId:actor.id,kind:'info',title:'نمرهٔ آزمون اصلاح شد',description:'نسخهٔ تازهٔ نمرهٔ آزمون با ثبت دلیل در فصل باز اعمال شد.',view:'quarters',entityId:id});return updated;
 });}
 return {list,correct};
}

export const taskWeightVersion = 'relative-task-points-v1';
export const taskFrequencies = ['فصلی','ماهانه','هفتگی','روزانه','ساعتی'];
export const taskTargetUnits = ['عدد','مورد','گزارش','فایل','سند','درخواست','تماس','جلسه','ساعت','دقیقه','صفحه','محصول','پروژه'];
export const taskDocumentFormats=Object.freeze({excel:'اکسل',powerpoint:'پاورپوینت',word:'ورد',pdf:'پی‌دی‌اف',image:'عکس',html:'HTML',powerbi:'Power BI',other:'سایر'});
const fail=message=>{throw Object.assign(new Error(message),{status:400,publicMessage:message});};

// Legacy percentage designs remain readable and are never rewritten implicitly.
export function normalizeTaskWeights(tasks){
  const relative=tasks.some(task=>task.weightPoints!=null);
  if(relative){
    if(tasks.some(task=>!Number.isInteger(Number(task.weightPoints))||Number(task.weightPoints)<1||Number(task.weightPoints)>5))fail('وزن هر تسک باید عدد صحیح بین ۱ تا ۵ باشد.');
    return tasks.map(task=>({...task,weightPoints:Number(task.weightPoints),weightVersion:taskWeightVersion,weight:100*Number(task.weightPoints)/tasks.filter(row=>row.category===task.category).reduce((sum,row)=>sum+Number(row.weightPoints),0)}));
  }
  for(const category of ['routine','project']){
    const rows=tasks.filter(task=>task.category===category);
    if(rows.some(task=>!Number.isFinite(Number(task.weight))||Number(task.weight)<=0||Number(task.weight)>100))fail('وزن درصدی قدیمی معتبر نیست.');
    if(rows.length&&Math.abs(rows.reduce((sum,task)=>sum+Number(task.weight),0)-100)>0.001)fail(`مجموع وزن تسک‌های ${category==='routine'?'روتین':'پروژه'} باید ۱۰۰٪ باشد.`);
  }
  return tasks.map(task=>({...task,weight:Number(task.weight)}));
}

export function validateTaskRecurrence(task,{legacy=false,requireTimeLimit=task.recurrenceVersion==='required-task-time-v2'}={}){
  if(task.category==='project'){
    if(legacy&&task.targetVolume==null&&task.targetUnit==null)return {frequency:null,timeLimit:null,recurrenceVersion:'project-deadline-v1'};
    const targetVolume=Number(task.targetVolume);
    if(!Number.isSafeInteger(targetVolume)||targetVolume<1)fail('تعداد باید عدد صحیح و حداقل یک باشد.');
    if(!taskTargetUnits.includes(task.targetUnit)&&!legacy)fail('واحد هدف را از فهرست مجاز انتخاب کنید.');
    if(typeof task.targetUnit!=='string'||!task.targetUnit.trim()||task.targetUnit.length>80)fail('واحد هدف معتبر نیست.');
    return {targetVolume,targetUnit:task.targetUnit.trim(),frequency:null,timeLimit:null,recurrenceVersion:'project-deadline-v1'};
  }
  if(legacy&&!task.frequency)return {};
  if(!taskFrequencies.includes(task.frequency))fail('تناوب باید فصلی، ماهانه، هفتگی، روزانه یا ساعتی باشد.');
  const targetVolume=Number(task.targetVolume);
  if(!Number.isSafeInteger(targetVolume)||targetVolume<1)fail('تعداد باید عدد صحیح و حداقل یک باشد.');
  if(!taskTargetUnits.includes(task.targetUnit)&&!legacy)fail('واحد هدف را از فهرست مجاز انتخاب کنید.');
  if(typeof task.targetUnit!=='string'||!task.targetUnit.trim()||task.targetUnit.length>80)fail('واحد هدف معتبر نیست.');
  let timeLimit=null;
  if(requireTimeLimit&&task.timeLimit==null)fail('زمان انجام شاخص را متناسب با تناوب تنظیم کنید.');
  if(task.timeLimit!=null){
    const limit=task.timeLimit;
    if(!limit||typeof limit!=='object'||Array.isArray(limit)||typeof limit.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(limit.time))fail('ساعت محدودیت زمانی معتبر نیست.');
    const monthly=task.frequency==='ماهانه',weekly=task.frequency==='هفتگی'||!requireTimeLimit&&monthly&&limit.dayOfWeek!=null;
    const allowed=['time',...(monthly?['dayOfMonth']:[]),...(weekly?['dayOfWeek']:[])];
    if(Object.keys(limit).some(key=>!allowed.includes(key)))fail('گزینه‌های محدودیت زمانی با تناوب مطابقت ندارند.');
    if(monthly&&(!Number.isInteger(Number(limit.dayOfMonth))||Number(limit.dayOfMonth)<1||Number(limit.dayOfMonth)>31))fail('روز ماه باید بین ۱ تا ۳۱ باشد.');
    if(weekly&&(limit.dayOfWeek==null||limit.dayOfWeek===''||!Number.isInteger(Number(limit.dayOfWeek))||Number(limit.dayOfWeek)<0||Number(limit.dayOfWeek)>6))fail('روز هفته معتبر نیست.');
    timeLimit={...(monthly?{dayOfMonth:Number(limit.dayOfMonth)}:{}),...(weekly?{dayOfWeek:Number(limit.dayOfWeek)}:{}),time:limit.time};
  }
  return {frequency:task.frequency,targetVolume,targetUnit:task.targetUnit.trim(),timeLimit,...(task.recurrenceVersion?{recurrenceVersion:task.recurrenceVersion}:{})};
}

import {periodAtDate} from './quarter-period.mjs';
import {createHash,randomUUID} from 'node:crypto';
import PerformanceModel from '../src/performance-model.js';
import {approvedActivityDeadline} from './activity-exceptions.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,publicMessage:message});};
const hr=actor=>{if(actor?.role!=='hr')fail('مدیریت قوانین محاسبه فقط برای ادمین مجاز است.',403);};
const option=(value,label)=>({value:String(value),label});
const numbers=(values,unit='روز')=>values.map(n=>option(n,`${n} ${unit}`));
const field=(key,label,choices,initial,help='')=>({key,label,options:choices,default:String(initial),help});
const fixed=(key,label,value,help)=>({...field(key,label,[option('current',value)],'current',help),locked:true});
const future=(key,label,help)=>({...fixed(key,label,'منطق فعلی؛ گردش کار مستقل ندارد',help),pending:true});
const dayTypes=[option('calendar','روز تقویمی'),option('business','روز کاری؛ جمعه تعطیل')];
const unlimited=values=>[option('unlimited','بدون محدودیت؛ منطق فعلی'),...numbers(values)];

// The registry is also the validation contract. Unimplemented workflows cannot be
// enabled by a crafted API request; fixed safeguards are never merely UI controls.
export const ruleGroups=[
  {id:'deadlines',title:'موعدها',description:'قواعد ارسال روی فعالیت دارای موعد صریح اعمال می‌شوند؛ تناوب روتین به تحویل مستقل هر نوبت تبدیل نمی‌شود.',fields:[
    fixed('taskDeadline','موعد انجام کار','موعد ثبت‌شده در شاخص','تعریف موعد و تناوب هر شاخص در فرم تعریف شاخص باقی می‌ماند.'),
    field('submissionOffset','فاصلهٔ موعد ارسال مستند از موعد کار',numbers([0,1,2,3,5,7]),0),
    field('graceDays','مهلت ارفاق ارسال',numbers([0,1,2,3,5,7]),0),
    field('dayType','مبنای روزهای ارسال و اصلاح',dayTypes,'calendar','تقویم تعطیلات رسمی در سامانه موجود نیست؛ روز کاری فقط جمعه را حذف می‌کند.') ]},
  {id:'delay',title:'کسر تأخیر',description:'کسر به واحد امتیاز از ۱۰۰ و فقط از کیفیت همان تحویل کسر می‌شود؛ نه دوباره از مبلغ یا امتیاز فصل.',fields:[
    field('delayMode','روش کسر تأخیر',[option('off','خاموش؛ منطق فعلی'),option('fixed','کسر ثابت برای هر تحویل دیرهنگام'),option('daily','کسر روزانه'),option('tiered','پلکانی؛ بازه‌های سه‌روزه')],'off'),
    field('delayAmount','مقدار کسر در هر مرحله',numbers([1,2,3,5,10],'امتیاز'),1),
    field('delayCap','سقف کل کسر',numbers([5,10,15,20,30,50,100],'امتیاز'),20),
    fixed('deduplicate','جلوگیری از کسر تکراری','فقط یک کسر روی نمرهٔ کیفیت هر نسخه','بازاجرای AI یا تعداد فایل‌ها کسر جدید ایجاد نمی‌کند.') ]},
  {id:'late',title:'ارسال دیرهنگام',description:'در پنل فصلی، ثبت و اصلاح کار گذشته در همان فصل مجاز است؛ محدودیت زمانی ارسال پس از فصل اعمال می‌شود. سهمیه و قفل نتایج همچنان برقرار است.',fields:[
    field('lateMode','پس از پایان مهلت ارسال',[option('accept','پذیرش؛ کسر فقط در صورت فعال‌بودن'),option('close','بستن ارسال جدید')],'accept'),
    future('lateReview','پذیرش مشروط به بررسی انسانی','صف تأیید ارسال دیرهنگام هنوز وجود ندارد؛ این گزینه قابل فعال‌سازی نیست.'),
    future('extension','شرایط تمدید و مرجع تأیید','تمدید/بازگشایی فردی با دلیل و تأیید نیازمند گردش کار مستقل است.') ]},
  {id:'revisions',title:'اصلاح مستندات',fields:[
    field('maxRevisions','تعداد تحویل اصلاحی',[option('unlimited','نامحدود؛ منطق فعلی'),...numbers([0,1,2,3,5,10],'نسخه')],'unlimited'),
    field('revisionDays','مهلت اصلاح از اولین ارزیابی موفق',unlimited([1,3,5,7,14,30]),'unlimited'),
    field('afterDue','اصلاح پس از موعد',[option('allow','مجاز با قواعد ارسال'),option('close','غیرمجاز پس از مهلت ارسال')],'allow'),
    fixed('revisionScore','اثر اصلاح بر نمره','ارزیابی مستقل نسخهٔ جدید؛ بدون جمع کسرهای قبلی','نسخهٔ جدید باید مجدداً با شواهد معتبر ارزیابی شود.'),
    fixed('finalVersion','ملاک نتیجهٔ نهایی','آخرین ارزیابی موفق منطبق با مستندات فعال','نتیجهٔ قدیمیِ نامنطبق با فایل‌های فعلی نمرهٔ معتبر محسوب نمی‌شود.') ]},
  {id:'attempts',title:'شمارش دفعات',fields:[
    field('maxUploads','سقف کل نوبت‌های تحویل هر شاخص',[option('unlimited','بدون محدودیت'),...numbers([1,2,3,5,10],'نوبت')],5,'شامل ارسال اول و اصلاح‌ها؛ چند فایلِ یک گزارش یک نوبت است. خطای بارگذاری/استخراج/AI و بررسی تکراری همان مجموعه سهمیه تازه مصرف نمی‌کنند.'),
    fixed('countMode','واحد شمارش','مجموعهٔ مستندات در ارزیابی موفق؛ نه تعداد فایل','اولین تحویل اصلاحی نیست؛ تغییر مجموعه و ارزیابی موفق یک تحویل اصلاحی است.'),
    fixed('ignoreFailures','خطای بارگذاری، استخراج و AI','بدون مصرف سهمیهٔ تحویل','تلاش ناموفق یا ارزیابی مجدد همان مجموعه، نسخهٔ اصلاحی تازه نیست.') ]},
  {id:'activityAppeal',title:'اعتراض به فعالیت',fields:[
    fixed('activityAppeals','مسیر اعتراض شاخص','ثبت درخواست ← مدیر مستقیم ← ادمین','نمرهٔ اصلاحی نسخه‌دار است؛ اصل تحلیل AI تغییر نمی‌کند.'),
    field('activityAppealCount','حداکثر اعتراض هر شاخص',numbers([1,2,3,5],'درخواست'),3),field('activityAppealDays','مهلت اعتراض شاخص پس از نتیجه',numbers([3,5,7,10,14,30],'روز کاری'),7) ]},
  {id:'quarterAppeal',title:'اعتراض به فصل',fields:[
    field('quarterAppealCount','تعداد مجاز در هر فصل',numbers([1,2,3,5],'درخواست'),3),
    field('quarterAppealDays','مهلت ثبت پس از قفل نتیجه',numbers([1,3,5,7,10,14,30]),3),
    field('appealDayType','مبنای روزهای اعتراض',dayTypes,'business'),
    field('appealRepeat','اعتراض مجدد',[option('allow','مجاز تا سقف فصل؛ منطق فعلی'),option('closed_only','فقط پس از بسته‌شدن درخواست قبلی')],'allow'),
    field('appealEvidence','مستندات اعتراض',[option('optional','توضیح الزامی؛ فایل اختیاری'),option('required','حداقل یک فایل پیش از تأیید مدیر')],'optional'),
    fixed('appealRoute','مسیر بررسی','مدیر مستقیم ← HR','تغییر قانون، مجوز نقش‌ها را گسترش نمی‌دهد.'),
    fixed('appealResponse','نتیجهٔ اصلاحی فصل','پیشنهاد نمرهٔ مدیر ← پیش‌نمایش اختلاف مبلغ ← تصویب ادمین','نسخهٔ قفل‌شده محفوظ و اصلاح در نسخهٔ جدا ثبت می‌شود.') ]},
  {id:'evidence',title:'شواهد و AI',fields:[
    fixed('evidenceSufficiency','کفایت شاهد','تمام معیارها و استخراج کامل؛ نقص یعنی نمرهٔ نامشخص','نبود شاهد به نمرهٔ صفر تبدیل نمی‌شود.'),
    fixed('citations','الزام ارجاع','نقل‌قول معتبر و قابل تطبیق برای هر تصمیم','برای حفاظت از کیفیت، خاموش‌کردن الزام شاهد مجاز نیست.'),
    fixed('reevaluation','محرک ارزیابی مجدد','تغییر مستندات و درخواست کاربر','نسخهٔ قانون همراه ارزیابی ذخیره می‌شود.'),
    fixed('autoAI','اجرای AI','بررسی خودکار پس از ثبت مستندات کاری مجازِ شاخص مصوب','شروع از ثبت گزارش پرسنل است؛ انتشار تنظیمات یا بازخوانی صفحه مدل را اجرا نمی‌کند.'),
    fixed('humanReview','بررسی انسانی و پیگیری مهلت','گردش انسانی پس از سهمیه و هشدار معوق','نتیجه با پیشنهاد مدیر و تصویب ادمین ثبت می‌شود؛ مهلت هشدار از تنظیمات گردش بررسی است.') ]},
  {id:'exceptions',title:'استثناها',fields:[
    fixed('exceptions','تمدید با دلیل و تأیید','پرسنل ← مدیر مستقیم ← ادمین','درخواست مستند در بخش بازبینی و تمدید مهلت؛ فقط داخل بازهٔ شاخصِ باز.'),field('extensionMaxDays','حداکثر افزایش موعد هر درخواست',numbers([3,5,7,10,14,30],'روز تقویمی'),30) ]},
  {id:'surveys',title:'نظرسنجی‌ها',description:'قانون هنگام ساخت نظرسنجی ذخیره می‌شود؛ انتشار نسخهٔ جدید، نظرسنجیِ ساخته‌شده را تغییر نمی‌دهد.',fields:[
    field('surveyParticipation','پیش‌فرض حداقل مشارکت',numbers([30,40,50,60,70,80,90,100],'درصد'),60,'فرم هر نظرسنجی همچنان می‌تواند درصد مشارکت اختصاصی تعیین کند.'),
    field('surveyResponses','حداقل تعداد پاسخ',[option('0','منطق فعلی؛ فقط درصد از جمعیت مجاز'),...numbers([3,5,7,10],'پاسخ')],0),
    field('surveyDays','مهلت پاسخ پس از پایان فصل',numbers([1,3,5,7,10,14]),5),
    fixed('surveyInsufficient','مشارکت ناکافی','بدون امتیاز؛ نه صفر و نه میانگین ساختگی','حداقل جمعیت مجاز سه نفر باقی می‌ماند.') ]},
  {id:'workflow',title:'گردش بررسی',fields:[
    field('definitionDays','مهلت تعریف شاخص پس از شروع سمت',numbers([3,5,7,10,14]),5),
    field('reminderDays','یادآوری در روز کاری',numbers([1,2,3,4,5,7,10]),4),
    fixed('overdueEscalation','ارجاع موارد معوق','هشدار مدیر و HR؛ بدون صفرسازی خودکار','قواعد این بخش هنگام شروع سمت مؤثر می‌شوند.'),
    fixed('approvalSla','ارجاع معوق','هشدار به مسئول مرحله و ادمین','بدون تأیید خودکار یا صفرسازی؛ برای مراحل جدید پس از فعال‌شدن این نسخه.'),field('approvalSlaDays','مهلت هشدار هر مرحلهٔ تأیید',numbers([3,5,7,10,14],'روز کاری'),7) ]},
  {id:'money',title:'مبلغ KPI',description:'تغییر قواعد مالی فقط از ابتدای یک فصل آینده مجاز است؛ مدل و وزن‌های مؤلفه‌ها در منوی قبلی باقی می‌مانند.',fields:[
    field('incentiveCap','سقف مشوق ماهانه',numbers([10,15,20,25,30],'درصد حقوق پایه'),20,'سقف فصل سه برابر نرخ ماهانه است؛ بازهٔ سمت طبق فرمول موجود تسهیم می‌شود.'),
    fixed('scoreToMoney','تبدیل امتیاز به مبلغ','تبدیل خطی طبق وزن‌های مدل محاسبه','وزن مؤلفه‌ها فقط در منوی تنظیمات مدل محاسبه ویرایش می‌شود.'),
    field('rounding','گردکردن سهم دریافتی',[option('1','نزدیک‌ترین تومان؛ منطق فعلی'),option('100','نزدیک‌ترین ۱۰۰ تومان'),option('1000','نزدیک‌ترین ۱۰۰۰ تومان')],1,'گردکردن نمی‌تواند مبلغ را از سقف سهم بیشتر کند. جمع مبالغ گرد‌شده مبنای پرداخت است.'),
    field('noProject','فرد بدون پروژه',[option('zero','امتیاز پروژه صفر؛ منطق فعلی'),option('pending','امتیاز نامشخص؛ توقف نهایی‌سازی تا تعیین پروژه')],'zero','در هیچ حالت، وزن پروژه میان مؤلفه‌های دیگر توزیع نمی‌شود.') ]},
  {id:'scope',title:'دامنه و انتشار قوانین',fields:[
    fixed('publication','انتشار','پیش‌نویس ← پیش‌نمایش الزامی ← انتشار ادمین','واحد، نوع شاخص و تاریخ اثر در بالای فرم انتخاب می‌شوند؛ انتشار عطف‌به‌ماسبق ندارد.') ]},
  {id:'transparency',title:'کنترل و شفافیت',fields:[
    fixed('dryRun','حالت آزمایشی','پیش‌نمایش بدون تغییر نتایج و بدون اجرای AI','سناریوها نمونه‌اند و پیش‌بینی کل پرداخت سازمان نیستند.'),
    fixed('audit','تاریخچه و دلیل تغییر','نسخهٔ تغییرناپذیر، ثبت دلیل و عامل انتشار','پیش‌نویس با کنترل هم‌زمانی ذخیره می‌شود.'),
    fixed('scoreBreakdown','شفافیت نتیجه','کیفیت، روزهای تأخیر، کسر و امتیاز نهایی','در جزئیات ارزیابی‌های جدید نمایش داده می‌شود.') ]},
  {id:'records',title:'حفظ سوابق',fields:[
    fixed('retention','نسخه‌های تحویل و ارزیابی','پیوست فعال فقط پس از تأیید؛ سایر نتایج بایگانی می‌شوند','تا پایان تحلیل فایل باقی می‌ماند. فایل خام، تاریخچه، امتیاز و شمارش سهمیه حفظ می‌شوند؛ بایگانی قابل بازیابی است.'),
    fixed('lockedResults','نتایج قفل‌شده','عدم بازنویسی؛ بدون بازگشایی مستقیم','تغییر این تضمین از طریق تنظیمات مجاز نیست.') ]}
];
export const ruleFields=ruleGroups.flatMap(group=>group.fields);
export const defaultScoreRules=Object.freeze(Object.fromEntries(ruleFields.map(f=>[f.key,f.default])));
const activityKeys=new Set(ruleGroups.filter(g=>['deadlines','delay','late','revisions','attempts','evidence'].includes(g.id)).flatMap(g=>g.fields.map(f=>f.key)));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const tehranDay=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const validDay=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const persianDate=value=>Object.fromEntries(new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(new Date(value+'T12:00:00Z')).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
const periodStartCache=new Map();
export function amountRulesForPeriod(store,period,unitId){
  if(!store.list('score-rule-version').some(r=>r.status==='published'&&['incentiveCap','rounding','noProject'].some(k=>r.values[k]!==defaultScoreRules[k])))return null;
  const match=/^(14\d{2})-(?:(\d{2})|Q([1-4]))$/.exec(period||'');if(!match)return null;
  const year=Number(match[1]),month=match[2]?Number(match[2]):(Number(match[3])-1)*3+1,key=`${year}-${month}`;
  if(!periodStartCache.has(key)){for(let stamp=Date.UTC(year+621,0,1);stamp<Date.UTC(year+623,0,1);stamp+=86400000){const day=new Date(stamp).toISOString().slice(0,10),p=persianDate(day);if(p.year===year&&p.month===month&&p.day===1){periodStartCache.set(key,day);break;}}}
  const start=periodStartCache.get(key);if(!start)return null;
  const policy=scoreRulesAt(store,{unitId,at:start+'T00:00:00+03:30'}),v=policy.values;
  if(v.incentiveCap===defaultScoreRules.incentiveCap&&v.rounding===defaultScoreRules.rounding&&v.noProject===defaultScoreRules.noProject)return null;
  return {version:policy.version,monthlyRate:Number(v.incentiveCap)/100,rounding:Number(v.rounding),noProject:v.noProject};
}
export function ruleDaysBetween(from,to,type='calendar'){
  if(!validDay(from)||!validDay(to))return 0;
  let days=0;for(let stamp=Date.parse(from+'T12:00:00Z')+86400000;stamp<=Date.parse(to+'T12:00:00Z');stamp+=86400000)if(type!=='business'||new Date(stamp).getUTCDay()!==5)days++;
  return days;
}
export function addRuleDays(from,days,type='calendar'){
  if(!validDay(from)||!Number.isSafeInteger(days)||days<0||days>365)fail('مهلت معتبر نیست.');
  let stamp=Date.parse(from+'T12:00:00Z'),count=0;while(count<days){stamp+=86400000;if(type!=='business'||new Date(stamp).getUTCDay()!==5)count++;}return new Date(stamp).toISOString().slice(0,10);
}
export function scoreRulesAt(store,{unitId=null,kind='all',at=new Date().toISOString()}={}){
  const rows=store.list('score-rule-version').filter(r=>r.status==='published'&&r.effectiveDate<=tehranDay(at)&&Date.parse(r.publishedAt)<=Date.parse(at)&&(!r.unitId||r.unitId===unitId)&&(r.activityKind==='all'||r.activityKind===(kind==='task'?'routine':kind)));
  rows.sort((a,b)=>(Number(!!a.unitId)*2+Number(a.activityKind!=='all'))-(Number(!!b.unitId)*2+Number(b.activityKind!=='all'))||a.effectiveDate.localeCompare(b.effectiveDate)||a.sequence-b.sequence);
  const row=rows.at(-1);return {version:row?.id||'score-rules-legacy-v1',values:{...defaultScoreRules,...row?.values},unitId:row?.unitId||null,activityKind:row?.activityKind||'all'};
}
export function delayBreakdown(policy,qualityScore,lateDays){
  const v=policy.values,days=Math.max(0,lateDays),steps=v.delayMode==='fixed'?Number(days>0):v.delayMode==='daily'?days:v.delayMode==='tiered'?Math.ceil(days/3):0;
  const deduction=qualityScore==null?0:Math.min(qualityScore,Number(v.delayCap),steps*Number(v.delayAmount));
  return {ruleVersion:policy.version,qualityScore,lateDays:days,deduction,finalScore:qualityScore==null?null:Math.max(0,qualityScore-deduction),method:v.delayMode};
}
export const submissionKey=documents=>hash(documents.map(d=>[d.id,d.sha256]).sort((a,b)=>a[0].localeCompare(b[0])));
export function submissionQuota(store,activity,{now=new Date().toISOString()}={}){
  const policy=scoreRulesAt(store,{unitId:activity.unitId,kind:activity.kind,at:now}),v=policy.values;
  const delivered=store.list('review',activity.id).filter(r=>r.status==='done'&&!r.result?.coverage?.incomplete),counted=new Set(delivered.map(r=>r.submissionKey||submissionKey(r.documentHashes||[])));
  const pending=new Set(store.list('review',activity.id).filter(r=>['queued','running'].includes(r.status)&&r.evidenceSnapshot?.incomplete===false).map(r=>r.submissionKey||submissionKey(r.documentHashes||[])).filter(key=>!counted.has(key)));
  const total=v.maxUploads==='unlimited'?Infinity:Number(v.maxUploads),corrections=v.maxRevisions==='unlimited'?Infinity:Number(v.maxRevisions)+1,limit=Math.min(total,corrections);
  return {ruleVersion:policy.version,maxUploads:v.maxUploads,maxRevisions:v.maxRevisions,limit:Number.isFinite(limit)?limit:null,used:counted.size,pending:pending.size,remaining:Number.isFinite(limit)?Math.max(0,limit-counted.size-pending.size):null};
}
export function submissionRules(store,activity,documents,{now=new Date().toISOString(),review=false}={}){
  const policy=scoreRulesAt(store,{unitId:activity.unitId,kind:activity.kind,at:now}),v=policy.values;
  const effectiveDue=approvedActivityDeadline(store,activity)?.dueDate||activity.dueDate;
  const due=validDay(effectiveDue)?addRuleDays(effectiveDue,Number(v.submissionOffset)+Number(v.graceDays),v.dayType):null;
  const done=store.list('review',activity.id).filter(r=>r.status==='done'&&!r.result?.coverage?.incomplete);
  const unique=new Set(done.map(r=>r.submissionKey||hash((r.documentHashes||[]).map(d=>[d.id,d.sha256]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))));
  const key=submissionKey(documents),alreadyCounted=unique.has(key),first=done.map(r=>r.finishedAt||r.startedAt).filter(Boolean).sort()[0];
  const submittedAt=documents.map(d=>d.createdAt).filter(Boolean).sort().at(-1)||now;
  const eventDay=tehranDay(review?submittedAt:now),withinQuarter=/^14\d{2}-Q[1-4]$/.test(activity.period||'')&&periodAtDate(eventDay)===activity.period;
  // Past dates inside the same quarterly period do not close submission; quotas,
  // delay scoring and finalized-result guards still apply. Legacy monthly rules stay intact.
  // Uploads never consume a revision. Validation of the complete delivery occurs
  // only when review is requested; failed AI runs never enter `done`.
  if(!withinQuarter&&due&&eventDay>due&&(v.lateMode==='close'||done.length&&v.afterDue==='close'))fail('مهلت ارسال/اصلاح مستند طبق قانون مؤثر پایان یافته است.',409);
  if(review&&!alreadyCounted){
    const quota=submissionQuota(store,activity,{now}),reserved=store.list('review',activity.id).some(r=>['queued','running'].includes(r.status)&&r.submissionKey===key);
    if(!reserved&&quota.remaining===0)fail('سهمیهٔ تحویل این شاخص به سقف مجاز تنظیمات امتیاز رسیده است.',409);
    if(v.maxRevisions!=='unlimited'&&unique.size>Number(v.maxRevisions))fail('سهمیهٔ تحویل اصلاحی این فعالیت تکمیل شده است.',409);
    if(!withinQuarter&&first&&v.revisionDays!=='unlimited'&&ruleDaysBetween(tehranDay(first),eventDay,v.dayType)>Number(v.revisionDays))fail('مهلت اصلاح از اولین ارزیابی موفق پایان یافته است.',409);
  }
  return {policy,submissionKey:key,dueDate:due,submittedAt,lateDays:due?ruleDaysBetween(due,tehranDay(submittedAt),v.dayType):0,revision:alreadyCounted?Math.max(0,unique.size-1):unique.size};
}

export function createScoreSettings(store,{now=()=>new Date().toISOString()}={}){
  const audit=(actor,action,row)=>store.put('audit-event',{actorId:actor.id,action:`score-rules.${action}`,entityType:'score-rule-version',entityId:row.id,details:{reason:row.reason,unitId:row.unitId,activityKind:row.activityKind,effectiveDate:row.effectiveDate,revision:row.revision},createdAt:now()});
  const baseline=()=>hash(store.list('score-rule-version').map(r=>[r.id,r.sequence]));
  function validate(input){
    if(!input||!validDay(input.effectiveDate)||input.effectiveDate<tehranDay(now()))fail('تاریخ اثر باید امروز یا آینده باشد؛ انتشار عطف‌به‌ماسبق مجاز نیست.');
    if(ruleDaysBetween(tehranDay(now()),input.effectiveDate)>366)fail('تاریخ اثر حداکثر یک سال آینده است.');
const unitId=input.unitId||null;if(unitId&&(typeof unitId!=='string'||!store.get(unitId,'org-unit')||store.get(unitId,'org-unit').removedAt))fail('واحد هدف معتبر نیست.');
    if(!['all','routine','project'].includes(input.activityKind))fail('نوع شاخص معتبر نیست.');
    if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>2000)fail('دلیل تغییر را با حداقل پنج نویسه بنویسید.');
    if(!input.values||Object.keys(input.values).some(k=>!ruleFields.some(f=>f.key===k)))fail('کلید قانون ناشناخته است.');
    const values={};for(const f of ruleFields){const value=['maxUploads','activityAppealCount','activityAppealDays','extensionMaxDays','approvalSlaDays'].includes(f.key)&&input.values[f.key]===undefined?f.default:input.values[f.key];if(!f.options.some(o=>o.value===value))fail(`انتخاب «${f.label}» معتبر نیست.`);values[f.key]=value;
      if(input.activityKind!=='all'&&!activityKeys.has(f.key)&&value!==f.default)fail('تنظیمات عمومی نظرسنجی، اعتراض و گردش کار فقط در دامنهٔ همهٔ شاخص‌ها قابل تغییرند.');}
    if(Number(values.reminderDays)>=Number(values.definitionDays))fail('روز یادآوری باید پیش از پایان مهلت تعریف شاخص باشد.');
    const current=scoreRulesAt(store,{unitId,at:now()}).values;
    if(input.activityKind==='all'&&['incentiveCap','rounding','noProject'].some(key=>values[key]!==current[key])){
      const effect=persianDate(input.effectiveDate),today=persianDate(tehranDay(now()));
      if(effect.day!==1||(effect.month-1)%3!==0||effect.year*4+Math.ceil(effect.month/3)<=today.year*4+Math.ceil(today.month/3))fail('تغییر قواعد مالی فقط از اولین روز یک فصل آینده مجاز است.');
    }
    return {unitId,activityKind:input.activityKind,effectiveDate:input.effectiveDate,reason:input.reason.trim(),values};
  }
  const draftFor=(id,revision)=>{const row=store.get(id,'score-rule-draft');if(row?.status!=='draft')fail('پیش‌نویس پیدا نشد.',404);if(row.revision!==revision)fail('این پیش‌نویس تغییر کرده است؛ نسخهٔ تازه را بارگذاری کنید.',409);return row;};
  function state(actor){hr(actor);return {groups:ruleGroups,activityKeys:[...activityKeys],defaults:defaultScoreRules,today:tehranDay(now()),units:store.list('org-unit').filter(unit=>!unit.removedAt).map(({id,name})=>({id,name})),current:scoreRulesAt(store,{at:now()}),drafts:store.list('score-rule-draft').filter(r=>r.status==='draft'),history:store.list('score-rule-version').sort((a,b)=>b.sequence-a.sequence)};}
  function save(actor,input){hr(actor);const values=validate(input),existing=input.id?draftFor(input.id,input.revision):null;return store.transaction(()=>{const row=store.put('score-rule-draft',{id:existing?.id||randomUUID(),status:'draft',...values,revision:(existing?.revision||0)+1,createdAt:existing?.createdAt||now(),updatedAt:now(),updatedBy:actor.id,previewHash:null});audit(actor,'draft-saved',row);return row;});}
  function preview(actor,input){hr(actor);const original=draftFor(input.id,input.revision),draft={...original,values:validate(original).values};const before=scoreRulesAt(store,{unitId:draft.unitId,kind:draft.activityKind,at:draft.effectiveDate+'T23:59:59+03:30'}),after={version:'draft',values:draft.values};
    const changes=ruleFields.filter(f=>before.values[f.key]!==draft.values[f.key]).map(f=>({key:f.key,label:f.label,before:f.options.find(o=>o.value===before.values[f.key]).label,after:f.options.find(o=>o.value===draft.values[f.key]).label}));
    const amountSample=(policy,hasProjects)=>{const v=policy.values,result=PerformanceModel.calculateMonthly({baseSalary:60000000,hasProjects,scores:{exam:73,manager:73,routine:73,project:73},policy:{...PerformanceModel.demoPolicy,amountRules:{monthlyRate:Number(v.incentiveCap)/100,rounding:Number(v.rounding),noProject:v.noProject}}});return {ceiling:result.ceiling,earned:result.complete?result.earned:null};};
    const result={changes,scenarios:[0,1,3,7,14].map(days=>({days,before:delayBreakdown(before,80,days),after:delayBreakdown(after,80,days),beforeClosed:days>0&&before.values.lateMode==='close',afterClosed:days>0&&after.values.lateMode==='close'})),amountScenarios:[true,false].map(hasProjects=>({hasProjects,before:amountSample(before,hasProjects),after:amountSample(after,hasProjects)})),note:'نمونهٔ آموزشی با کیفیت ۸۰ و تأخیر پس از ارفاق؛ بدون اجرای AI یا تغییر نتیجه. مثال مالی: حقوق فرضی ۶۰ میلیون تومان، نمرهٔ همه مؤلفه‌ها ۷۳ و وزن‌های نمونهٔ ۱۵/۱۵/۳۰/۴۰؛ پیش‌بینی پرداخت سازمان نیست.',baseline:baseline()};
    const previewHash=hash({draft,baseline:result.baseline});store.put('score-rule-draft',{...draft,previewHash,previewBaseline:result.baseline,previewedAt:now()});return {...result,previewHash};
  }
  function publish(actor,input){hr(actor);return store.transaction(()=>{const draft=draftFor(input.id,input.revision);validate(draft);if(!draft.previewHash||draft.previewHash!==input.previewHash||draft.previewBaseline!==baseline())fail('پیش‌نمایش تازهٔ همین پیش‌نویس پیش از انتشار الزامی است.',409);
    const sequence=Math.max(0,...store.list('score-rule-version').map(r=>r.sequence))+1,row=store.put('score-rule-version',{id:`score-rules-v${sequence}`,sequence,status:'published',unitId:draft.unitId,activityKind:draft.activityKind,effectiveDate:draft.effectiveDate,reason:draft.reason,values:draft.values,publishedAt:now(),publishedBy:actor.id});
    store.put('score-rule-draft',{...draft,status:'published',publishedVersion:row.id});audit(actor,'published',row);return row;});}
  function discard(actor,input){hr(actor);const draft=draftFor(input.id,input.revision);store.transaction(()=>{store.put('score-rule-draft',{...draft,status:'discarded',discardedAt:now(),discardedBy:actor.id});audit(actor,'discarded',draft);});return {discarded:true};}
  return {state,save,preview,publish,discard};
}

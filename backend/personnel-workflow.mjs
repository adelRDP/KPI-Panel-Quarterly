import PerformanceModel from '../src/performance-model.js';
import {validateActivity} from './evaluation.mjs';
import {reviewEvidenceMatches} from './review-retention.mjs';
import {activityHumanFinal} from './activity-human-review.mjs';
import {assertQuarterWritable} from './quarter-lock.mjs';
import {policyForPeriod} from './evaluation-settings.mjs';
import {settlementState} from './personnel-settlement.mjs';
import {calculatePositionSlice,positionClosed,quarterFor} from './position-closeout.mjs';

export const currentPeriod=()=>{const parts=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(new Date());return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;};
const tehranDate=()=>{const parts=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}-${parts.find(p=>p.type==='day').value}`;};
export const quarterOf=period=>{const [year,month]=period.split('-').map(Number);return `${year}-Q${Math.ceil(month/3)}`;};
export const quarterMonths=quarter=>{const match=/^(14\d{2})-Q([1-4])$/.exec(quarter);if(!match)throw new Error('فصل باید به شکل 1405-Q3 باشد.');const start=(Number(match[2])-1)*3+1;return [0,1,2].map(offset=>`${match[1]}-${String(start+offset).padStart(2,'0')}`);};
const periodBoundsCache=new Map();
export const periodBounds=period=>{
  if(periodBoundsCache.has(period))return periodBoundsCache.get(period);
  if(!/^14\d{2}-(0[1-9]|1[0-2])$/.test(period))throw new Error('دوره باید به شکل 1405-07 باشد.');
  const formatter=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'2-digit',timeZone:'Asia/Tehran'}),parts=date=>{const p=formatter.formatToParts(date);return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}`;};
  const [year]=period.split('-').map(Number),from=Date.UTC(year+621,0,1),to=Date.UTC(year+623,0,1);let start=null,end=null;
  for(let stamp=from;stamp<to;stamp+=86400000){const date=new Date(stamp);if(parts(date)===period){if(start===null)start=date.toISOString().slice(0,10);}else if(start!==null){end=date.toISOString().slice(0,10);break;}}
  if(!start||!end)throw new Error('تاریخ ماه شمسی قابل تبدیل نیست.');const result={start,end,totalDays:(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000};periodBoundsCache.set(period,result);return result;
};
const fail=(message,status=400)=>{const error=new Error(message);error.publicMessage=message;error.status=status;throw error;};
const periodOf=value=>{if(typeof value!=='string'||!/^14\d{2}-(0[1-9]|1[0-2])$/.test(value))fail('دوره باید به شکل 1405-07 باشد.');return value;};
const scoreOf=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)fail('امتیاز باید عددی بین صفر تا صد باشد.');return value;};
const textOf=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('متن ورودی معتبر نیست.');return value.trim();};
const publicUser=({id,name,role,level,jobTitle,jobFamily,sectionId,unitId,unitName,managerId,isKpiEligible,isSettled,settlementDate})=>({id,name,role,level,jobTitle,jobFamily,sectionId,unitId,unitName,managerId,isKpiEligible,...(isSettled?{isSettled,settlementDate}:{})});

export function createWorkflow(store){
  const period=currentPeriod();
  if(!store.get('workflow-demo-v1','workflow-meta')){
    const users=[
      {id:'manager-ops',name:'نرگس زمانی',role:'manager',unitId:'ops',unitName:'عملیات'},
      {id:'employee-mohammad',name:'محمد رضایی',role:'personnel',level:'کارشناس',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',baseSalary:72000000,bonusCeiling:14400000,hasProjects:true},
      {id:'employee-sara',name:'سارا احمدی',role:'personnel',level:'مسئول',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',baseSalary:65000000,bonusCeiling:13000000,hasProjects:false,approvedProjectExemption:true},
      {id:'employee-reza',name:'رضا کریمی',role:'personnel',level:'سرپرست',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',baseSalary:80000000,bonusCeiling:16000000,hasProjects:true},
      {id:'manager-finance',name:'علی کریمی',role:'manager',unitId:'finance',unitName:'مالی'},
      {id:'employee-maryam',name:'مریم اکبری',role:'personnel',level:'کارشناس',unitId:'finance',unitName:'مالی',managerId:'manager-finance',baseSalary:68000000,bonusCeiling:13600000,hasProjects:false,approvedProjectExemption:true},
      {id:'manager-services',name:'مینا فرهمند',role:'manager',unitId:'services',unitName:'خدمات اجرایی'},
      {id:'hr-demo',name:'ادمین KPI',role:'hr',unitId:'hr',unitName:'منابع انسانی'},
      ...[['employee-service-1','الهام مرادی'],['employee-service-2','رضا نادری'],['employee-service-3','سحر کریمی'],['employee-service-4','مهدی صادقی'],['employee-service-5','نگین احمدی']].map(([id,name])=>({id,name,role:'personnel',level:'کارشناس خدمات',unitId:'services',unitName:'خدمات اجرایی',managerId:'manager-services',baseSalary:60000000,bonusCeiling:12000000,hasProjects:false,approvedProjectExemption:true,isKpiEligible:true}))
    ];
    store.transaction(()=>{
      for(const user of users){store.put('workflow-user',user);if(user.role!=='personnel')continue;
        store.put('exam-result',{employeeId:user.id,period:quarterOf(period),score:84,source:'synthetic',reference:'demo-exam-quarter',createdAt:new Date().toISOString()},user.id);
        for(const month of quarterMonths(quarterOf(period))){
          if(user.id!=='employee-reza')store.put('manager-survey',{employeeId:user.id,managerId:user.managerId,period:month,score:88,note:'ارزیابی نمونه',source:'synthetic',createdAt:new Date().toISOString()},user.id);
          for(const kind of user.hasProjects?['routine','project']:['routine'])store.put('activity',{...validateActivity({kind,title:kind==='routine'?'گزارش و پیگیری کارهای روتین':'پروژه بهبود فرایند',description:'فعالیت نمونه؛ مستندات انجام کار را برای ارزیابی بارگذاری کنید.',period:month,criteria:['خروجی مورد انتظار با شواهد قابل بررسی ارائه شده باشد.']}),ownerId:user.id,unitId:user.unitId,assignmentStatus:'approved',kpiWeight:1,sampleScore:kind==='routine'?90:76,source:'synthetic',createdAt:new Date().toISOString()},user.id);
        }
      }
      store.put('workflow-policy',{id:'active-policy',...PerformanceModel.demoPolicy});
      store.put('workflow-meta',{id:'workflow-demo-v1',createdAt:new Date().toISOString()});
    });
  }
  // Additive migration for existing local demos; obsolete finance accounts remain archived in storage.
  for(const seed of [
    {id:'hr-demo',name:'ادمین KPI',role:'hr',unitId:'hr',unitName:'منابع انسانی'},
    {id:'manager-services',name:'مینا فرهمند',role:'manager',unitId:'services',unitName:'خدمات اجرایی'},
    ...[['employee-service-1','الهام مرادی'],['employee-service-2','رضا نادری'],['employee-service-3','سحر کریمی'],['employee-service-4','مهدی صادقی'],['employee-service-5','نگین احمدی']].map(([id,name])=>({id,name,role:'personnel',level:'کارشناس خدمات',unitId:'services',unitName:'خدمات اجرایی',managerId:'manager-services',baseSalary:60000000,bonusCeiling:12000000,hasProjects:false,approvedProjectExemption:true,isKpiEligible:true}))
  ])if(!store.get(seed.id,'workflow-user'))store.put('workflow-user',seed);
  const extraPeople=[
    {id:'employee-ops-4',name:'آوا موسوی',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',level:'کارشناس',jobTitle:'کارشناس برنامه‌ریزی',phone:'09120000004'},
    {id:'employee-ops-5',name:'کیان صادقی',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',level:'کارشناس',jobTitle:'کارشناس کنترل کیفیت',phone:'09120000005'},
    {id:'employee-ops-6',name:'نیکی بهرامی',unitId:'ops',unitName:'عملیات',managerId:'manager-ops',level:'مسئول',jobTitle:'مسئول هماهنگی',phone:'09120000006'},
    {id:'employee-finance-2',name:'پارسا حیدری',unitId:'finance',unitName:'مالی',managerId:'manager-finance',level:'کارشناس',jobTitle:'کارشناس گزارشگری',phone:'09120000007'},
    {id:'employee-finance-3',name:'رها نادری',unitId:'finance',unitName:'مالی',managerId:'manager-finance',level:'کارشناس',jobTitle:'کارشناس داده',phone:'09120000008'},
    {id:'employee-finance-4',name:'سام شریفی',unitId:'finance',unitName:'مالی',managerId:'manager-finance',level:'مسئول',jobTitle:'مسئول تحلیل',phone:'09120000009'}
  ];
  for(const seed of extraPeople)if(!store.get(seed.id,'workflow-user'))store.transaction(()=>{
    const person={...seed,role:'personnel',jobFamily:seed.unitName,baseSalary:68000000,bonusCeiling:13600000,hasProjects:false,approvedProjectExemption:true,isKpiEligible:true};store.put('workflow-user',person);
    store.put('exam-result',{employeeId:person.id,period:quarterOf(period),score:84,source:'synthetic',reference:'demo-exam-quarter',createdAt:new Date().toISOString()},person.id);
    for(const month of quarterMonths(quarterOf(period))){store.put('manager-survey',{employeeId:person.id,managerId:person.managerId,period:month,score:88,note:'ارزیابی نمونه',source:'synthetic',createdAt:new Date().toISOString()},person.id);store.put('activity',{...validateActivity({kind:'routine',title:'گزارش و پیگیری کارهای روتین',description:'فعالیت نمونه؛ مستندات انجام کار را برای ارزیابی بارگذاری کنید.',period:month,criteria:['خروجی مورد انتظار با شواهد قابل بررسی ارائه شده باشد.']}),ownerId:person.id,unitId:person.unitId,assignmentStatus:'approved',kpiWeight:1,sampleScore:90,source:'synthetic',createdAt:new Date().toISOString()},person.id);}
  });
  const demoProfiles={
    'manager-ops':{phone:'09120000010',jobTitle:'مدیر عملیات'},'manager-finance':{phone:'09120000011',jobTitle:'مدیر واحد مالی'},'manager-services':{phone:'09120000012',jobTitle:'مدیر خدمات اجرایی'},
    'employee-mohammad':{phone:'09120000001',jobTitle:'کارشناس عملیات'},'employee-sara':{phone:'09120000002',jobTitle:'مسئول عملیات'},'employee-reza':{phone:'09120000003',jobTitle:'سرپرست عملیات'},'employee-maryam':{phone:'09120000013',jobTitle:'کارشناس مالی'},
    ...Object.fromEntries([1,2,3,4,5].map(index=>[`employee-service-${index}`,{phone:`091200000${13+index}`,jobTitle:'کارشناس خدمات اجرایی'}]))
  };
  for(const [id,profile] of Object.entries(demoProfiles)){const current=store.get(id,'workflow-user');if(current&&Object.entries(profile).some(([key,value])=>!current[key]&&value))store.put('workflow-user',{...current,...Object.fromEntries(Object.entries(profile).filter(([key])=>!current[key]))});}
  const demoCodeIds=['employee-mohammad','employee-sara','employee-reza','employee-maryam','employee-ops-4','employee-ops-5','employee-ops-6','employee-finance-2','employee-finance-3','employee-finance-4',...Array.from({length:5},(_,index)=>`employee-service-${index+1}`),'manager-ops','manager-finance','manager-services'];
  for(const [index,id] of demoCodeIds.entries()){const current=store.get(id,'workflow-user'),employeeCode=String(100001+index);if(current&&!current.employeeCode&&!store.list('workflow-user').some(person=>person.id!==id&&person.employeeCode===employeeCode))store.put('workflow-user',{...current,employeeCode});}
  const existingHr=store.get('hr-demo','workflow-user');if(existingHr&&existingHr.name!=='ادمین KPI')store.put('workflow-user',{...existingHr,name:'ادمین KPI'});
  const savedGeneralPolicy=store.get('active-policy','workflow-policy');
  if(!savedGeneralPolicy||savedGeneralPolicy.version==='demo-four-part-v1')store.put('workflow-policy',{id:'active-policy',...PerformanceModel.demoPolicy});
  // Former per-person classifications and service policies in persisted history are not active defaults.
  for(const employee of store.list('workflow-user').filter(u=>u.role==='personnel'&&u.isKpiEligible!==false)){
    if(!Number.isSafeInteger(employee.bonusCeiling)||employee.bonusCeiling!==Math.round(employee.baseSalary*PerformanceModel.monthlyRate))
      store.put('workflow-user',{...employee,bonusCeiling:Math.round(employee.baseSalary*PerformanceModel.monthlyRate)});
  }
  const positionAt=(id,onDate=tehranDate())=>store.list('position-assignment',id).find(p=>p.status==='published'&&p.effectiveFrom<=onDate&&(!p.effectiveTo||onDate<p.effectiveTo))||null;
  const assessmentPosition=(id,p)=>{const b=periodBounds(p),now=tehranDate();return store.list('position-assignment',id).filter(row=>row.status==='published'&&row.effectiveFrom<b.end&&(!row.effectiveTo||row.effectiveTo>b.start)&&(p!==currentPeriod()||row.effectiveFrom<=now)).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0]||null;};
  const mergePosition=(record,onDate)=>{if(!record||!['personnel','manager','hr'].includes(record.role))return null;const p=positionAt(record.id,onDate);return p?{...record,level:p.jobLevel,jobTitle:p.jobTitle,jobFamily:p.jobFamily,sectionId:p.sectionId??record.sectionId??null,unitId:p.unitId,unitName:p.unitName,managerId:p.managerId,isKpiEligible:p.isKpiEligible,hasProjects:p.hasProjects,approvedProjectExemption:p.approvedProjectExemption,baseSalary:p.baseSalary??record.baseSalary}:record;};
  const user=id=>settlementState(store,mergePosition(store.get(id,'workflow-user')),tehranDate());
  const userAt=(id,period)=>{
    const {start,end}=periodBounds(period),lastDay=new Date(Date.parse(end+'T00:00:00Z')-86400000).toISOString().slice(0,10),today=tehranDate();
    // Select the current assessment segment; closed earlier segments are replayed
    // from their snapshots. A dated exit still never applies early today.
    const exitAt=start>today?start:lastDay<today?lastDay:today;
    const selected=assessmentPosition(id,period);
    return settlementState(store,mergePosition(store.get(id,'workflow-user'),selected?.effectiveFrom>start?selected.effectiveFrom:start),exitAt);
  };
  const manages=(actor,employee)=>actor?.role==='manager'&&employee?.role==='personnel'&&employee.unitId===actor.unitId;
  const canRead=(actor,ownerId)=>actor?.role==='hr'||actor?.id===ownerId||manages(actor,user(ownerId));
  const requireEmployee=(actor,id,write=false)=>{const employee=user(id);if(!employee||employee.role!=='personnel'||(write?!manages(actor,employee):!canRead(actor,id)))fail('دسترسی به این پرسنل مجاز نیست.',403);return employee;};
  const latest=(kind,id,p)=>store.list(kind,id).find(r=>r.period===p);
  const peerAggregate=(id,p)=>store.list('service-survey-aggregate',id).find(row=>row.period===p&&(!row.campaignId||(()=>{const campaign=store.get(row.campaignId,'service-survey-campaign');return campaign?.employeeId===id&&!campaign.removedAt;})()));
  const activitiesFor=id=>store.list('activity').filter(a=>a.ownerId===id&&!a.removedAt&&a.assignmentStatus==='approved');
  function activityScore(activity){
    const human=activityHumanFinal(store,activity);if(human)return human.result.finalScore;
    const allDocs=store.list('document',activity.id);
    if(!allDocs.length&&Number.isFinite(activity.sampleScore))return activity.sampleScore;
    const review=store.list('review',activity.id).find(r=>r.status==='done');
    if(!review?.result.finalForActivity||!Number.isFinite(review.result.qualityScore)||!reviewEvidenceMatches(store,activity,review))return null;
    return review.result.finalScore??review.result.qualityScore;
  }
  function snapshotCore(actor,id,p,system=false,selectedPositionId=null){
    periodOf(p);if(!system)requireEmployee(actor,id);const employee=userAt(id,p);if(!employee||employee.role!=='personnel')fail('پرسنل معتبر نیست.');
    const frozen=selectedPositionId&&positionClosed(store,selectedPositionId)?.months.find(m=>m.period===p);if(frozen)return frozen;
    if(!system&&!canRead(actor,id))fail('دسترسی به این پرسنل مجاز نیست.',403);
    if(employee.isKpiEligible===false)return {employee:publicUser(employee),period:p,source:'local-demo',notApplicable:true,status:'not_applicable',exam:null,survey:null,assignments:[],policy:policyForPeriod(store,p,null,employee.unitId),positionId:positionAt(id,periodBounds(p).start)?.id||null,positionVersion:positionAt(id,periodBounds(p).start)?.version||null,positionReviewRequired:false,projectExemptionRequired:false,hasProjects:false,components:[],baseSalary:employee.baseSalary,performance:null,ceiling:null,earned:null,knownTotal:employee.baseSalary,finalSalary:null,maxFinalSalary:null,complete:false};
    const bounds=periodBounds(p),position=selectedPositionId?store.get(selectedPositionId,'position-assignment'):assessmentPosition(id,p),baseline=positionAt(id,bounds.start),overlapping=store.list('position-assignment',id).filter(row=>row.status==='published'&&row.effectiveFrom<bounds.end&&(!row.effectiveTo||row.effectiveTo>bounds.start));
    if(selectedPositionId&&(!position||position.employeeId!==id))fail('سمت انتخاب‌شده معتبر نیست.');
    const legacyPosition=baseline||[...overlapping].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
    const belongs=row=>row.positionId?row.positionId===position?.id:!position||legacyPosition?.id===position.id;
    const periodActivities=activitiesFor(id).filter(a=>a.period===p&&belongs(a)),designedKinds=new Set(store.list('activity').filter(a=>a.ownerId===id&&a.period===p&&belongs(a)&&a.source==='approved-design').map(a=>a.kind)),assignments=periodActivities.filter(a=>a.source!=='synthetic'||!designedKinds.has(a.kind)).map(a=>({...a,score:activityScore(a)}));
    for(const kind of ['routine','project']){
      const rows=assignments.filter(a=>a.kind===kind||(kind==='routine'&&a.kind==='task'));
      if(rows.length&&rows.every(a=>Number.isInteger(a.weightPoints)&&a.weightPoints>=1&&a.weightPoints<=5)){
        const total=rows.reduce((sum,a)=>sum+a.weightPoints,0);
        for(const a of rows)a.kpiWeight=100*a.weightPoints/total;
      }
    }
    const exam=latest('exam-result',id,p)||latest('exam-result',id,quarterOf(p)),survey=store.list('manager-survey',id).find(r=>r.period===p&&belongs(r));
    const grouped=kind=>{const rows=assignments.filter(a=>a.kind===kind||(kind==='routine'&&a.kind==='task'));return !rows.length||rows.some(a=>a.score===null)?null:rows.reduce((sum,a)=>sum+a.score*(a.kpiWeight||1),0)/rows.reduce((sum,a)=>sum+(a.kpiWeight||1),0);};
    // Publishing a real project assigns it for this month, without rewriting the position or other months.
    const hasProjects=(position?position.hasProjects===true:employee.hasProjects===true)||assignments.some(a=>a.kind==='project'&&a.source==='approved-design');
    const policy=policyForPeriod(store,p,null,position?.unitId||employee.unitId),peer=store.list('service-survey-aggregate',id).find(r=>r.period===p&&belongs(r)&&(!r.campaignId||(()=>{const campaign=store.get(r.campaignId,'service-survey-campaign');return campaign?.employeeId===id&&!campaign.removedAt;})()));
    const scores={exam:exam?.score??null,manager:survey?.score??null,routine:grouped('routine'),project:grouped('project'),peer:peer?.score??null};
    const projectExemptionRequired=false; // Compatibility field; no-project scores are zero, not exempted.
    const calculation=PerformanceModel.calculateMonthly({baseSalary:position?.baseSalary??employee.baseSalary,hasProjects,policy,scores});
    return {employee:publicUser(position?{...employee,...position,id:employee.id,role:employee.role}:employee),period:p,source:'synthetic',exam:exam||null,survey:survey||null,assignments,policy,positionId:position?.id||null,positionVersion:position?.version||null,positionReviewRequired:overlapping.some(row=>row.id!==position?.id&&!positionClosed(store,row.id)),projectExemptionRequired,hasProjects,...calculation,quarterlyPayment:false};
  }
  function monthSnapshot(actor,id,p,system=false){
    const live=snapshotCore(actor,id,p,system),frozen=store.list('position-closeout',id).filter(r=>r.status==='locked').flatMap(r=>r.months.filter(m=>m.period===p).map(m=>({...m,closed:true,closeoutId:r.id})));
    if(!frozen.length)return live;
    const bounds=periodBounds(p),position=assessmentPosition(id,p),segments=[...frozen];
    if(position&&!positionClosed(store,position.id)){const start=position.effectiveFrom>bounds.start?position.effectiveFrom:bounds.start,end=position.effectiveTo&&position.effectiveTo<bounds.end?position.effectiveTo:bounds.end;if(start<end)segments.push(calculatePositionSlice(live,{start,end,bounds,positionId:position.id}));}
    segments.sort((a,b)=>a.start.localeCompare(b.start));
    const complete=segments.every(s=>s.complete),ceiling=segments.reduce((n,s)=>n+s.ceiling,0),earned=segments.reduce((n,s)=>n+s.earned,0),baseSalary=segments.reduce((n,s)=>n+s.baseSalary,0);
    const components=ModelComponents(segments,ceiling);
    return {...live,notApplicable:segments.every(s=>s.notApplicable),segments,currentPolicy:live.policy,policy:{...live.policy,version:'position-closeout-v1',name:'ترکیب بازه‌های مستقل سمت',weights:Object.fromEntries(components.map(c=>[c.id,c.weight]))},assignments:segments.flatMap(s=>s.assignments.map(a=>({...a,positionClosed:!!s.closed}))),components,complete,ceiling,earned,baseSalary,knownTotal:baseSalary+earned,maxFinalSalary:baseSalary+ceiling,performance:complete&&ceiling?segments.reduce((n,s)=>n+s.performance*s.ceiling,0)/ceiling:null,positionReviewRequired:segments.some(s=>s.positionReviewRequired),formulaVersion:'position-closeout-v1'};
  }
  function ModelComponents(segments,totalCeiling){return ['exam','manager','routine','project','peer'].map(id=>{const rows=segments.map(s=>s.components.find(c=>c.id===id)).filter(Boolean),ceiling=rows.reduce((n,c)=>n+c.ceiling,0),complete=rows.every(c=>!c.applicable||c.score!==null),score=complete&&ceiling?rows.reduce((n,c)=>n+(c.score??0)*c.ceiling,0)/ceiling:null;return {...rows[0],id,applicable:rows.some(c=>c.applicable),ceiling,earned:complete?rows.reduce((n,c)=>n+(c.earned??0),0):null,weight:totalCeiling?ceiling/totalCeiling*100:0,score,status:complete?'scored':'pending'};});}
  const managerSafeSnapshot=data=>({...data,baseSalary:undefined,monthlyBaseSalary:undefined,bonusCeiling:undefined,earned:undefined,ceiling:undefined,knownTotal:undefined,finalSalary:undefined,maxFinalSalary:undefined,segments:data.segments?.map(managerSafeSnapshot),components:data.components.map(component=>({...component,ceiling:undefined,earned:undefined}))});
  const snapshot=(actor,id,p=currentPeriod())=>{const data=monthSnapshot(actor,id,p,false);return actor.role==='manager'?managerSafeSnapshot(data):data;};
  const authorizedSnapshot=snapshot;
  function saveSurvey(actor,input){
    const employee=requireEmployee(actor,input.employeeId,true),p=periodOf(input.period),score=scoreOf(input.score),note=textOf(input.note||'',2000);
    if(employee.isSettled||userAt(employee.id,p).isKpiEligible===false)fail('این فرد خارج از فرایند KPI است.',409);
    if(!policyForPeriod(store,p,null,userAt(employee.id,p).unitId).weights.manager)fail('نظر مدیر در مدل ارزیابی این واحد و دوره سهمی ندارد.');
    const position=assessmentPosition(employee.id,p);if(positionClosed(store,position?.id)||store.list('quarter-evaluation',employee.id).some(q=>q.quarter===quarterFor(p)&&q.status==='locked'))fail('این بازه نهایی و بسته شده است.',409);
    if(position&&position.managerId!==actor.id)fail('نظر این بازه فقط توسط مدیر همان سمت ثبت می‌شود.',403);
    const previous=store.list('manager-survey',employee.id).find(r=>r.period===p&&r.positionId===position?.id);
    return store.put('manager-survey',{employeeId:employee.id,positionId:position?.id||null,managerId:actor.id,period:p,score,note,supersedes:previous?.id||null,createdAt:new Date().toISOString()},employee.id);
  }
  function submitProposal(actor,input){
    const employee=requireEmployee(actor,input.employeeId,true),p=periodOf(input.period);
    assertQuarterWritable(store,employee.id,p);
    if(employee.isSettled||userAt(employee.id,p).isKpiEligible===false)fail('این فرد خارج از فرایند KPI است.',409);
    if(!['task','indicator'].includes(input.type)||!['routine','project'].includes(input.category))fail('نوع پیشنهاد یا دسته KPI معتبر نیست.');
    if(!policyForPeriod(store,p,null,userAt(employee.id,p).unitId).weights[input.category])fail('این مؤلفه در مدل ارزیابی واحد و دوره سهمی ندارد.');
    const title=textOf(input.title,200,true),description=textOf(input.description,4000,true),criteria=textOf(input.criteria,4000,true);
    validateActivity({kind:input.category,title,description,period:p,criteria:criteria.split('\n').map(x=>x.trim()).filter(Boolean)});
    return store.put('kpi-proposal',{employeeId:employee.id,managerId:actor.id,unitId:employee.unitId,period:p,type:input.type,category:input.category,title,description,criteria,status:'pending',createdAt:new Date().toISOString(),events:[{status:'pending',at:new Date().toISOString(),actorId:actor.id}]},employee.id);
  }
  // Internal harness boundary; managers/personnel cannot approve their own proposals.
  function resolveProposal(id,{status,reason,reference}){
    const proposal=store.get(id,'kpi-proposal');if(!proposal)fail('پیشنهاد پیدا نشد.',404);
    if(!['approved','rejected','needs_revision'].includes(status))fail('وضعیت بررسی معتبر نیست.');
    textOf(reason,2000,true);textOf(reference,200,true);
    if(proposal.status!=='pending'){if(proposal.status===status&&proposal.reviewReference===reference)return proposal;fail('پیشنهاد قبلاً تعیین وضعیت شده است.',409);}
    return store.transaction(()=>{
      let activityId=null;
      assertQuarterWritable(store,proposal.employeeId,proposal.period);
      if(status==='approved'){
        const person=userAt(proposal.employeeId,proposal.period),policy=policyForPeriod(store,proposal.period,null,person.unitId);if(!policy.weights[proposal.category])fail('این مؤلفه دیگر در مدل واحد و دوره سهمی ندارد.',409);
        if(user(person.id)?.isSettled||person.isKpiEligible===false)fail('این فرد خارج از فرایند KPI است.',409);
        const activity=validateActivity({kind:proposal.category,title:proposal.title,period:proposal.period,description:proposal.description,criteria:proposal.criteria.split('\n').map(x=>x.trim()).filter(Boolean)});
        activityId=store.put('activity',{...activity,ownerId:proposal.employeeId,unitId:proposal.unitId,proposalId:proposal.id,assignmentStatus:'approved',kpiWeight:1,createdAt:new Date().toISOString()}).id;
      }
      return store.put('kpi-proposal',{...proposal,status,reason,reviewReference:reference,activityId,resolvedAt:new Date().toISOString(),events:[...proposal.events,{status,at:new Date().toISOString(),reference,reason}]},proposal.employeeId);
    });
  }
  function recordExamResult({employeeId,period:p,score,reference,source='import'}){
    if(user(employeeId)?.role!=='personnel')fail('پرسنل معتبر نیست.');if(!/^14\d{2}-(?:(0[1-9]|1[0-2])|Q[1-4])$/.test(p))fail('دوره آزمون باید ماه یا فصل معتبر باشد.');scoreOf(score);textOf(reference,200,true);
    const existing=store.list('exam-result',employeeId).find(r=>r.period===p);
    if(user(employeeId)?.isSettled||(p.includes('-Q')?quarterMonths(p):[p]).every(period=>userAt(employeeId,period)?.isKpiEligible===false))fail('این فرد در دورهٔ آزمون خارج از فرایند KPI است.',409);
    if(existing&&existing.reference===reference&&existing.score===score)return existing;
    assertQuarterWritable(store,employeeId,p);
    if(existing){if(existing.source==='synthetic'&&source==='import')return store.put('exam-result',{...existing,score,reference,source,updatedAt:new Date().toISOString()},employeeId);fail('برای این دوره قبلاً یک نتیجهٔ آزمون ثبت شده است؛ نتیجهٔ متعارض نیازمند اصلاحیهٔ نسخه‌دار است.',409);}
    return store.put('exam-result',{employeeId,period:p,score,reference,source,createdAt:new Date().toISOString()},employeeId);
  }
  return {user,canRead,manages,publicUser,positionAt,assessmentPosition,userAt,get currentPeriod(){return currentPeriod();},defaultUserId:'employee-mohammad',accounts:()=>store.list('workflow-user').map(e=>user(e.id)).filter(Boolean).map(publicUser),snapshot,snapshotForSystem:(id,p)=>monthSnapshot(null,id,p,true),snapshotForPosition:(id,p,positionId)=>snapshotCore(null,id,p,true,positionId),saveSurvey,submitProposal,resolveProposal,recordExamResult,
team:(actor,p=currentPeriod())=>{if(actor.role!=='manager')fail('این بخش مخصوص مدیر واحد است.',403);return store.list('workflow-user').map(e=>user(e.id)).filter(e=>manages(actor,e)&&userAt(e.id,p)?.isKpiEligible!==false).map(e=>authorizedSnapshot(actor,e.id,p));},
    proposals:actor=>{if(actor.role!=='manager')fail('این بخش مخصوص مدیر واحد است.',403);return store.list('kpi-proposal').filter(p=>p.managerId===actor.id&&manages(actor,user(p.employeeId)));}
  };
}

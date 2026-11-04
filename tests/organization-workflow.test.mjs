import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import Model from '../src/performance-model.js';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,quarterMonths,quarterOf,periodBounds} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {validateActivity} from '../backend/evaluation.mjs';
import {roleReply} from './ai-role-fixture.mjs';
import {createPanelServer} from '../server.mjs';
import {seedPeerUnitModel} from './unit-model-fixture.mjs';
import {unzipSync,strFromU8} from 'fflate';
const XLSX=createRequire(import.meta.url)('../src/vendor/xlsx.full.min.js');

async function setup(t,runModel){
  const dir=await mkdtemp(join(tmpdir(),'kpi-org-workflow-')),store=openStore(dir),workflow=createWorkflow(store),organization=createOrganizationWorkflow(store,workflow,{runModel});
  seedPeerUnitModel(store);
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {store,workflow,organization};
}
const nextDay=value=>new Date(Date.parse(value+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const draftInput=period=>({employeeId:'employee-mohammad',period,tasks:[{category:'routine',title:'شاخص آزمایشی',description:'خروجی قابل بررسی',criteria:['ثبت خروجی'],weightPoints:3,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',recurrenceVersion:'required-task-time-v2',timeLimit:{dayOfMonth:15,time:'09:30'}}]});
const alignmentResult=input=>roleReply(input);

test('project format and deadline survive save, publish and approvals without requiring recurring timing',async t=>{
  let calls=0;const {store,workflow,organization:org}=await setup(t,async input=>{calls++;return alignmentResult(input);}),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo'),period=workflow.currentPeriod,deadline=periodBounds(period).end;
  const input={employeeId:'employee-mohammad',period,tasks:[{category:'project',title:'گزارش پروژه',description:'خروجی مشخص',criteria:['خروجی ثبت شده باشد'],weightPoints:3,targetVolume:1,targetUnit:'گزارش',documentFormat:'pdf',deadline,milestones:[{name:'تحویل نهایی',dueDate:deadline}]}]};
  const draft=org.saveDesignDraft(manager,input);assert.equal(calls,0);assert.equal(draft.tasks[0].frequency,null);assert.equal(draft.tasks[0].timeLimit,null);assert.equal(draft.tasks[0].documentFormat,'pdf');
  for(const documentFormat of ['', 'exe','toString'])assert.throws(()=>org.saveDesignDraft(manager,{...input,tasks:[{...input.tasks[0],documentFormat}]},draft.id),error=>error.status===400);
  assert.throws(()=>org.saveDesignDraft(manager,{...input,tasks:[{...input.tasks[0],deadline:'2026-02-30'}]},draft.id),error=>error.status===400);assert.equal(calls,0);
  const sent=await org.publishDesignDraft(manager,draft.id);assert.equal(calls,2);assert.equal(sent.status,'manager_review');assert.equal(sent.tasks[0].documentFormat,'pdf');assert.equal(sent.tasks[0].timeLimit,null);org.managerReviewDesign(manager,draft.id,{decision:'approve'});const published=org.hrReviewDesign(hr,draft.id,{decision:'approve'}),activity=store.get(published.activityIds[0],'activity');assert.equal(activity.documentFormat,'pdf');assert.equal(activity.dueDate,deadline);assert.equal(activity.frequency,null);assert.equal(activity.timeLimit,null);
});

test('saving appends all categories to one draft per person/month, while sent versions and other months stay separate',async t=>{
  let calls=0;const {store,workflow,organization:org}=await setup(t,async input=>{calls++;return alignmentResult(input);}),manager=workflow.user('manager-ops'),period=workflow.currentPeriod,input=draftInput(period);
  const first=org.saveDesignDraft(manager,input),second=org.saveDesignDraft(manager,{...input,tasks:[{...input.tasks[0],title:'شاخص دوم',weightPoints:2}]});assert.equal(first.id,second.id);assert.deepEqual(second.tasks.map(task=>task.weightPoints),[3,2]);assert.deepEqual(second.tasks.map(task=>task.weight),[60,40]);assert.equal(new Set(second.tasks.map(task=>task.id)).size,2);assert.equal(org.listDesigns(manager).filter(row=>row.status==='draft'&&row.employeeId===input.employeeId&&row.period===period).length,1);assert.equal(calls,0);
  const edited=org.saveDesignDraft(manager,{...input,draftRevision:second.draftRevision,tasks:second.tasks.map((task,index)=>index===1?{...task,title:'دوم اصلاح شده'}:task)},second.id);assert.equal(edited.tasks.length,2);assert.equal(edited.tasks[0].title,first.tasks[0].title);
  assert.throws(()=>org.saveDesignDraft(manager,{...input,tasks:[edited.tasks[0],{...edited.tasks[1],id:edited.tasks[0].id}]},edited.id),/یکتا/);assert.equal(store.get(edited.id,'kpi-design').tasks.length,2);
  const project=org.saveDesignDraft(manager,{...input,tasks:[{...input.tasks[0],category:'project',title:'پروژهٔ همان نسخه',weightPoints:5,deliverable:'گزارش نهایی',deadline:periodBounds(period).end,milestones:[{name:'تحویل نهایی',dueDate:periodBounds(period).end}]}]});assert.equal(project.id,first.id);assert.deepEqual(project.tasks.map(task=>task.weight),[60,40,100]);assert.equal(new Set(project.tasks.map(task=>task.id)).size,3);
  const next=org.saveDesignDraft(manager,{...input,period:nextMonth(period)});assert.notEqual(next.id,first.id);const person=org.saveDesignDraft(manager,{...input,employeeId:'employee-reza'});assert.notEqual(person.id,first.id);
  await org.publishDesignDraft(manager,first.id);const another=org.saveDesignDraft(manager,input);assert.notEqual(another.id,first.id);assert.equal(store.get(first.id,'kpi-design').tasks.length,3);assert.equal(calls,2);
});

test('existing separate drafts consolidate idempotently with source history and normalized unique task IDs',async t=>{
  const {store,workflow,organization:org}=await setup(t),manager=workflow.user('manager-ops'),input=draftInput(workflow.currentPeriod),first=org.saveDesignDraft(manager,input);
  const old=store.put('kpi-design',{...first,id:'old-separate-draft',version:2,tasks:[{...first.tasks[0],title:'قدیمی دیگر',weightPoints:2}]},first.employeeId),sent=store.put('kpi-design',{...first,id:'already-sent',version:3,status:'manager_review'},first.employeeId);
  assert.equal(org.consolidateDesignDrafts().merged,1);const combined=store.get(first.id,'kpi-design');assert.equal(combined.tasks.length,2);assert.deepEqual(combined.tasks.map(task=>task.weight),[60,40]);assert.equal(new Set(combined.tasks.map(task=>task.id)).size,2);assert.deepEqual(combined.consolidationSources.find(row=>row.id===old.id).tasks,old.tasks);assert.equal(store.get(old.id,'kpi-design').mergedInto,first.id);assert.deepEqual(store.get(sent.id,'kpi-design'),sent);assert.equal(org.consolidateDesignDrafts().merged,0);assert.equal(org.listDesigns(manager).filter(row=>row.status==='draft').length,1);
});

test('new timing is mandatory and monthly timing drops the historical weekday without running AI for incomplete drafts',async t=>{
  let calls=0;const {store,workflow,organization:org}=await setup(t,async input=>{calls++;return alignmentResult(input);}),manager=workflow.user('manager-ops'),input=draftInput(workflow.currentPeriod);
  assert.throws(()=>org.saveDesignDraft(manager,{...input,tasks:[{...input.tasks[0],timeLimit:null}]}),error=>error.status===400);assert.equal(calls,0);
  const old=org.saveDesignDraft(manager,{...input,tasks:[{...input.tasks[0],recurrenceVersion:undefined,timeLimit:null}]});await assert.rejects(org.publishDesignDraft(manager,old.id),error=>error.status===400);assert.equal(store.get(old.id,'kpi-design').status,'draft');assert.equal(calls,0);
  const updated=org.saveDesignDraft(manager,{...input,draftRevision:old.draftRevision,tasks:[{...input.tasks[0],recurrenceVersion:undefined,timeLimit:{dayOfMonth:15,dayOfWeek:0,time:'09:30'}}]},old.id);const result=await org.publishDesignDraft(manager,updated.id);assert.deepEqual(result.tasks[0].timeLimit,{dayOfMonth:15,time:'09:30'});assert.equal(calls,2);
});

test('drafts are private editable records; publishing directly runs AI and retains human approval gates',async t=>{
  let calls=0;const {store,workflow,organization:org}=await setup(t,async input=>{calls++;return alignmentResult(input);}),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo'),person=workflow.user('employee-mohammad'),input=draftInput(workflow.currentPeriod);
  const draft=org.saveDesignDraft(manager,input);assert.equal(draft.status,'draft');assert.equal(calls,0);assert.equal(store.list('ai-design-attempt',draft.id).length,0);assert.ok(org.listDesigns(manager).some(row=>row.id===draft.id));assert.ok(!org.listDesigns(hr).some(row=>row.id===draft.id));assert.ok(!org.listDesigns(person).some(row=>row.id===draft.id));
  const edited=org.saveDesignDraft(manager,{...input,draftRevision:draft.draftRevision,employeeId:'employee-reza',period:'1406-01',tasks:[{...input.tasks[0],title:'اصلاح شده',weightPoints:5}]},draft.id);assert.equal(edited.id,draft.id);assert.equal(edited.period,input.period);assert.equal(edited.employeeId,input.employeeId);assert.equal(edited.draftRevision,2);assert.equal(edited.version,1);assert.equal(calls,0);
  assert.throws(()=>org.saveDesignDraft(manager,{...input,tasks:[{...input.tasks[0],weightPoints:6}]},draft.id),error=>error.status===400);assert.equal(store.get(draft.id,'kpi-design').draftRevision,2);
  const sent=await org.publishDesignDraft(manager,draft.id);assert.equal(sent.status,'manager_review');assert.equal(calls,2);assert.ok(sent.aiReview);assert.equal(store.list('activity').filter(row=>row.designId===draft.id).length,0);assert.throws(()=>org.saveDesignDraft(manager,input,draft.id),error=>error.status===409);await assert.rejects(org.publishDesignDraft(manager,draft.id),error=>error.status===409);assert.equal(calls,2);
  assert.throws(()=>org.hrReviewDesign(hr,draft.id,{decision:'approve'}),error=>error.status===409);org.managerReviewDesign(manager,draft.id,{decision:'approve'});org.hrReviewDesign(hr,draft.id,{decision:'approve'});assert.equal(store.list('activity').filter(row=>row.designId===draft.id).length,1);
  const assignment=store.list('activity').find(row=>row.designId===draft.id),document=store.put('document',{activityId:assignment.id,name:'evidence.txt'},assignment.id),locked=store.put('quarter-result',{employeeId:person.id,quarter:quarterOf(input.period),status:'locked',earned:12345},person.id);
  assert.ok(workflow.snapshot(person,person.id,input.period).assignments.some(row=>row.id===assignment.id));
  assert.throws(()=>org.removeDesign(hr,draft.id),error=>error.status===403);assert.throws(()=>org.removeDesign(workflow.user('manager-services'),draft.id),error=>error.status===404);
  const removed=org.removeDesign(manager,draft.id);assert.ok(removed.removedAt);assert.equal(store.get(assignment.id,'activity').assignmentStatus,'removed');assert.deepEqual(store.get(document.id,'document'),document);assert.deepEqual(store.get(locked.id,'quarter-result'),locked);assert.equal(store.list('ai-design-attempt',draft.id)[0].status,'done');assert.ok(!org.listDesigns(manager).some(row=>row.id===draft.id));
  const snapshot=workflow.snapshot(person,person.id,input.period);assert.ok(!snapshot.assignments.some(row=>row.id===assignment.id));assert.equal(snapshot.assignments.filter(row=>row.kind==='routine').length,0,'Archived real assignments must not resurrect demo seed tasks');assert.equal(org.removeDesign(manager,draft.id).removedAt,removed.removedAt);
  await assert.rejects(org.analyzeDesign(manager,draft.id),error=>error.status===404);
});

test('publishing locks a draft against duplicate submission and deletion while AI is running',async t=>{
  let release,calls=0;const gate=new Promise(resolve=>release=resolve),{store,workflow,organization:org}=await setup(t,async input=>{calls++;await gate;return alignmentResult(input);}),manager=workflow.user('manager-ops'),draft=org.saveDesignDraft(manager,draftInput(workflow.currentPeriod));
  const pending=org.publishDesignDraft(manager,draft.id);assert.equal(store.get(draft.id,'kpi-design').status,'ai_pending');assert.equal(store.list('ai-design-attempt',draft.id)[0].status,'running');assert.throws(()=>org.removeDesign(manager,draft.id),error=>error.status===409);await assert.rejects(org.publishDesignDraft(manager,draft.id),error=>error.status===409);release();assert.equal((await pending).status,'manager_review');assert.equal(calls,2);assert.ok(org.removeDesign(manager,draft.id).removedAt);
});

test('a failed publish remains visible as failed and can retry without silently assigning tasks',async t=>{
  let calls=0;const {store,workflow,organization:org}=await setup(t,async input=>{if(++calls===1)throw new Error('Test provider unavailable');return alignmentResult(input);}),manager=workflow.user('manager-ops'),draft=org.saveDesignDraft(manager,draftInput(workflow.currentPeriod));
  await assert.rejects(org.publishDesignDraft(manager,draft.id),/Test provider unavailable/);assert.equal(store.get(draft.id,'kpi-design').status,'ai_failed');assert.equal(store.list('activity').filter(row=>row.designId===draft.id).length,0);assert.equal(store.list('ai-design-attempt',draft.id)[0].status,'failed');assert.equal((await org.analyzeDesign(manager,draft.id)).status,'manager_review');assert.equal(calls,3);
  const second=org.saveDesignDraft(manager,draftInput(workflow.currentPeriod));await assert.rejects(org.publishDesignDraft(manager,second.id,'invalid-provider'));assert.equal(store.get(second.id,'kpi-design').status,'ai_failed');assert.ok(org.removeDesign(manager,second.id).removedAt);
});
const previousMonth=period=>{const [year,month]=period.split('-').map(Number);return month===1?`${year-1}-12`:`${year}-${String(month-1).padStart(2,'0')}`;};
const nextMonth=period=>{const [year,month]=period.split('-').map(Number);return month===12?`${year+1}-01`:`${year}-${String(month+1).padStart(2,'0')}`;};
const tehranToday=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return `${parts.find(part=>part.type==='year').value}-${parts.find(part=>part.type==='month').value}-${parts.find(part=>part.type==='day').value}`;};
const businessDaysElapsed=(from,to)=>{let days=0;for(let stamp=Date.parse(from+'T00:00:00Z')+86400000;stamp<=Date.parse(to+'T00:00:00Z');stamp+=86400000)if(new Date(stamp).getUTCDay()!==5)days++;return days;};
const dateForElapsed=days=>{const today=tehranToday();for(let offset=1;offset<20;offset++){const candidate=new Date(Date.parse(today+'T00:00:00Z')-offset*86400000).toISOString().slice(0,10);if(businessDaysElapsed(candidate,today)===days)return candidate;}throw new Error('Test date not found');};
function previousQuarter(period){const [year,month]=period.split('-').map(Number),q=Math.ceil(month/3);return q===1?`${year-1}-Q4`:`${year}-Q${q-1}`;}
function completeQuarter(store,employeeId,quarter,{exam=84,manager=88,routine=90,project=76}={}){
  const employee=store.get(employeeId,'workflow-user');store.put('exam-result',{employeeId,period:quarter,score:exam,reference:`exam-${quarter}`,source:'test'},employeeId);
  for(const period of quarterMonths(quarter)){
    store.put('manager-survey',{employeeId,period,score:manager,managerId:employee.managerId,source:'test'},employeeId);
    for(const [kind,sampleScore] of [['routine',routine],...(employee.hasProjects?[['project',project]]:[])]){
      const activity=validateActivity({kind,title:`${kind} ${period}`,description:'test source',period,criteria:['record has evidence']});
      store.put('activity',{...activity,ownerId:employeeId,unitId:employee.unitId,assignmentStatus:'approved',kpiWeight:1,sampleScore,source:'test'},employeeId);
    }
  }
}

test('quarter aggregation uses one exam result and exactly one-third of each monthly component',()=>{
  assert.deepEqual(quarterMonths('1405-Q2'),['1405-04','1405-05','1405-06']);assert.equal(quarterOf('1405-07'),'1405-Q3');
  const months=quarterMonths('1405-Q2'),bounds=periodBounds(months[0]),parts=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(new Date(bounds.start+'T00:00:00Z'));assert.equal(`${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`,'1405-04');assert.ok(bounds.totalDays>=29&&bounds.totalDays<=32);
  const general=Model.aggregateQuarterScores({modelType:'general',monthlyScores:[{manager:60,routine:0,project:60},{manager:90,routine:90,project:60},{manager:90,routine:90,project:60}],examScore:100});
  assert.deepEqual(general.scores,{exam:100,manager:80,routine:60,project:60});assert.equal(general.aggregationVersion,'exam-once-monthly-thirds-v1');
  const quarter=Model.calculateQuarter({baseSalary:72000000,modelType:'general',monthlyScores:[{manager:60,routine:0,project:60},{manager:90,routine:90,project:60},{manager:90,routine:90,project:60}],examScore:100});
  assert.equal(quarter.performance,69);assert.equal(quarter.ceiling,43200000);assert.equal(quarter.earned,29808000);assert.equal(quarter.finalSalary,null);
  const service=Model.aggregateQuarterScores({modelType:'services',policy:Model.servicePolicy,monthlyScores:[{manager:100,peer:80},{manager:90,peer:70},{manager:80,peer:60}]});assert.deepEqual(service.scores,{manager:90,peer:70});
  assert.equal(Model.calculateQuarter({baseSalary:60000000,modelType:'services',monthlyScores:[{manager:100,peer:80},{manager:90,peer:70},{manager:80,peer:60}]}).performance,78);
  const monthlyReplay=Model.calculateQuarterly({totalDays:90,policyVersion:'monthly-replay-test',intervals:[{startDay:0,endDay:30,periodDays:30,baseSalary:60000000,score:50},{startDay:30,endDay:60,periodDays:30,baseSalary:90000000,score:100},{startDay:60,endDay:90,periodDays:30,baseSalary:60000000,score:0}]});assert.equal(monthlyReplay.ceiling,42000000);assert.equal(monthlyReplay.earned,24000000);assert.equal(monthlyReplay.formulaVersion,'quarter-cap-20-monthly-replay-v2');
  const examOnce=Model.calculateQuarterly({totalDays:90,intervals:[{startDay:0,endDay:30,periodDays:30,baseSalary:60000000,score:5},{startDay:30,endDay:60,periodDays:30,baseSalary:60000000,score:10},{startDay:60,endDay:90,periodDays:30,baseSalary:60000000,score:15}],oneTimeContribution:{weight:15,score:100}});assert.equal(examOnce.breakdown.reduce((sum,row)=>sum+row.earned,0),3600000);assert.equal(examOnce.oneTimeContribution.earned,5400000);assert.equal(examOnce.earned,9000000);assert.equal(examOnce.formulaVersion,'quarter-cap-20-monthly-thirds-exam-once-v3');
  const salaryChangeExam=Model.calculateQuarterly({totalDays:90,intervals:[{startDay:0,endDay:30,periodDays:30,baseSalary:60000000,score:0},{startDay:30,endDay:60,periodDays:30,baseSalary:90000000,score:0},{startDay:60,endDay:90,periodDays:30,baseSalary:60000000,score:0}],oneTimeContribution:{weight:15,score:100}});assert.equal(salaryChangeExam.ceiling,42000000);assert.equal(salaryChangeExam.oneTimeContribution.earned,6300000);assert.equal(salaryChangeExam.earned,6300000);
});

test('position change and KPI design require the specified human review chain and keep prior versions',async t=>{
  const modelRunner=async input=>roleReply(input);
  const {store,workflow,organization}=await setup(t,modelRunner),hr=workflow.user('hr-demo'),manager=workflow.user('manager-finance'),employee=workflow.user('employee-sara');
  const old=organization.activePosition(employee.id),transferDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const proposal=organization.proposePosition(hr,{employeeId:employee.id,jobTitle:'تحلیلگر خدمات',jobFamily:'عملیات',jobLevel:'کارشناس ارشد',unitId:'finance',unitName:'مالی',managerId:manager.id,duties:'ثبت و تحلیل داده‌های مالی و کنترل مغایرت‌ها',modelType:'general',hasProjects:false,approvedProjectExemption:true,projectExemptionRef:'HR-EX-17',baseSalary:70000000,transferDate});
  assert.equal(proposal.effectiveFrom,transferDate);assert.equal(proposal.status,'manager_review');assert.throws(()=>organization.approvePosition(hr,proposal.id,{decision:'approve'}),/بازبینی مدیر/);
  organization.reviewPosition(manager,proposal.id,{decision:'approve'});const preview=organization.positionCloseoutPreview(hr,proposal.id);assert.equal(preview.ready,true,preview.blockers.join('\n'));const published=organization.approvePosition(hr,proposal.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});assert.equal(published.status,'published');
  assert.equal(organization.positionAt(employee.id,new Date(Date.parse(transferDate+'T00:00:00Z')-86400000).toISOString().slice(0,10)).id,old.id);assert.equal(organization.positionAt(employee.id,published.effectiveFrom).id,published.id);
  assert.equal(store.get(old.id,'position-assignment').status,'published');assert.equal(store.get(old.id,'position-assignment').effectiveTo,published.effectiveFrom);
  assert.equal(organization.listPositions(hr).find(p=>p.id===published.id).baseSalary,70000000);
  const noProjectProposal=organization.proposePosition(hr,{employeeId:employee.id,jobTitle:'کارشناس',jobFamily:'x',jobLevel:'x',unitId:'finance',unitName:'مالی',managerId:manager.id,duties:'duties',modelType:'general',hasProjects:false,effectiveFrom:published.effectiveFrom});assert.equal(noProjectProposal.hasProjects,false);assert.equal(noProjectProposal.approvedProjectExemption,false);

  const period=workflow.currentPeriod,design=organization.submitDesign(manager,{employeeId:'employee-maryam',period,tasks:[{category:'routine',title:'کنترل ماهانهٔ مغایرت',description:'مغایرت‌های ثبت‌شده را بررسی و برای موارد باز مستند فراهم کن.',criteria:['گزارش تطبیق کامل ثبت شده باشد.'],weight:100,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',responsible:'مریم اکبری',evidenceTypes:['گزارش']} ]});
  assert.equal(design.status,'ai_pending');assert.equal(store.list('activity').some(row=>row.designId===design.id),false);
  const reviewed=await organization.analyzeDesign(manager,design.id,'codex');assert.equal(reviewed.status,'manager_review');assert.equal(reviewed.aiReview.result.reviews[0].recommendation,'retain');
  organization.managerReviewDesign(manager,design.id,{decision:'approve'});const publishedDesign=organization.hrReviewDesign(hr,design.id,{decision:'approve'});
  assert.equal(publishedDesign.status,'published');assert.equal(publishedDesign.activityIds.length,1);assert.equal(store.list('activity').find(row=>row.id===publishedDesign.activityIds[0]).assignmentStatus,'approved');
  assert.throws(()=>organization.managerReviewDesign(workflow.user('manager-ops'),design.id,{decision:'approve'}),/طرح پیدا نشد|بیرون از محدوده/);
});

test('manager-defined task weights survive approval and affect the routine score',async t=>{
  const runModel=async input=>roleReply(input);
  const {store,workflow,organization}=await setup(t,runModel),manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo'),employee=workflow.user('employee-mohammad'),period=workflow.currentPeriod;
  const task=(title,weight)=>({category:'routine',title,description:'خروجی قابل سنجش و مستند ارائه شود.',criteria:['گزارش تأییدشده ارائه شده باشد.'],weight,frequency:'ماهانه',targetVolume:1,targetUnit:'گزارش',responsible:employee.name,evidenceTypes:['گزارش']});
  assert.throws(()=>organization.submitDesign(manager,{employeeId:employee.id,period,tasks:[task('الف',60)]}),/مجموع وزن/);
  assert.throws(()=>organization.submitDesign(manager,{employeeId:employee.id,period,tasks:[task('الف',60),task('ب',50)]}),/مجموع وزن/);
  const design=organization.submitDesign(manager,{employeeId:employee.id,period,tasks:[task('الف',60),task('ب',40)]});
  assert.deepEqual(design.tasks.map(row=>row.weight),[60,40]);
  await organization.analyzeDesign(manager,design.id,'codex');organization.managerReviewDesign(manager,design.id,{decision:'approve'});
  const published=organization.hrReviewDesign(hr,design.id,{decision:'approve'});
  assert.deepEqual(published.activityIds.map(id=>store.get(id,'activity').kpiWeight),[60,40]);
  for(const [index,id] of published.activityIds.entries()){const activity=store.get(id,'activity');store.put('activity',{...activity,sampleScore:index===0?80:100},employee.id);}
  const snapshot=workflow.snapshot(employee,employee.id,period),routine=snapshot.components.find(component=>component.id==='routine');
  assert.equal(routine.score,88);assert.equal(snapshot.assignments.filter(row=>row.kind==='routine').length,2);
});

test('relative task points and recurrence survive review, work with every model and normalize across monthly designs',async t=>{
  const runModel=async input=>roleReply(input);
  const {store,workflow,organization}=await setup(t,runModel),manager=workflow.user('manager-services'),hr=workflow.user('hr-demo'),employee=workflow.user('employee-service-1'),period=workflow.currentPeriod;
  const task=(category,weightPoints,title)=>({category,title,description:'خروجی قابل بررسی',criteria:['خروجی ثبت شود'],weightPoints,frequency:'ماهانه',targetVolume:2,targetUnit:'گزارش',timeLimit:{dayOfMonth:15,dayOfWeek:0,time:'09:30'},...(category==='project'?{deliverable:'گزارش پروژه',deadline:periodBounds(period).end,milestones:[{name:'تحویل',dueDate:periodBounds(period).end}]}:{})});
  const originalPosition=organization.activePosition(employee.id),original=workflow.snapshot(employee,employee.id,period);assert.equal(original.hasProjects,false);
  const design=organization.submitDesign(manager,{employeeId:employee.id,period,tasks:[task('routine',2,'الف'),task('routine',3,'ب'),task('project',4,'پروژه')]});
  assert.deepEqual(design.tasks.map(row=>row.weight),[40,60,100]);assert.deepEqual(design.tasks.map(row=>row.weightPoints),[2,3,4]);
  await organization.analyzeDesign(manager,design.id);organization.managerReviewDesign(manager,design.id,{decision:'approve'});const published=organization.hrReviewDesign(hr,design.id,{decision:'approve'});
  for(const [index,id] of published.activityIds.entries()){const activity=store.get(id,'activity');assert.deepEqual(activity.timeLimit,activity.kind==='project'?null:{dayOfMonth:15,dayOfWeek:0,time:'09:30'});assert.equal(activity.weightVersion,'relative-task-points-v1');store.put('activity',{...activity,sampleScore:index===0?50:100},employee.id);}
  const snapshot=workflow.snapshot(employee,employee.id,period);assert.equal(snapshot.hasProjects,true);assert.deepEqual(snapshot.policy.weights,original.policy.weights);assert.equal(snapshot.components.find(row=>row.id==='project').weight,original.policy.weights.project);assert.deepEqual(store.get(originalPosition.id,'position-assignment'),originalPosition);
  assert.equal(workflow.snapshot(employee,employee.id,nextMonth(period)).hasProjects,false,'Publishing a project must not change other months');
  const extra=organization.submitDesign(manager,{employeeId:employee.id,period,tasks:[task('routine',5,'ج')]});await organization.analyzeDesign(manager,extra.id);organization.managerReviewDesign(manager,extra.id,{decision:'approve'});const extraPublished=organization.hrReviewDesign(hr,extra.id,{decision:'approve'});
  const extraActivity=store.get(extraPublished.activityIds[0],'activity');store.put('activity',{...extraActivity,sampleScore:0},employee.id);
  const routines=workflow.snapshot(employee,employee.id,period).assignments.filter(row=>row.kind==='routine').sort((a,b)=>a.weightPoints-b.weightPoints);assert.deepEqual(routines.map(row=>row.kpiWeight),[20,30,50]);
  assert.equal(workflow.snapshot(employee,employee.id,period).components.find(row=>row.id==='routine').weight,0);
  const ops=workflow.user('employee-mohammad'),opsManager=workflow.user('manager-ops');
  const scored=organization.submitDesign(opsManager,{employeeId:ops.id,period,tasks:[task('routine',2,'اول'),task('routine',3,'دوم')]});await organization.analyzeDesign(opsManager,scored.id);organization.managerReviewDesign(opsManager,scored.id,{decision:'approve'});const approved=organization.hrReviewDesign(hr,scored.id,{decision:'approve'});
  for(const [index,id] of approved.activityIds.entries())store.put('activity',{...store.get(id,'activity'),sampleScore:index?100:50},ops.id);
  assert.equal(workflow.snapshot(ops,ops.id,period).components.find(row=>row.id==='routine').score,80);
  assert.throws(()=>organization.submitDesign(opsManager,{employeeId:employee.id,period,tasks:[task('project',1,'نامجاز')]}),error=>error.status===403);
});

test('task definition allows five full business days with a fourth-day reminder',async t=>{
  const {store,workflow,organization}=await setup(t),person=workflow.user('employee-mohammad'),manager=workflow.user('manager-ops'),positions=[];
  for(const elapsed of [4,5,6])positions.push(store.put('position-assignment',{employeeId:person.id,managerId:manager.id,unitId:person.unitId,version:elapsed,status:'published',isKpiEligible:true,effectiveFrom:dateForElapsed(elapsed),effectiveTo:null,events:[{by:'hr-demo',state:'published'}]},person.id));
  const oldId=`deadline-${positions[0].id}-day3`;store.put('task-deadline',{id:oldId,positionId:positions[0].id,managerId:manager.id,day:3,state:'escalation'},positions[0].id);
  const events=organization.scanDeadlines();
  assert.deepEqual(events.filter(row=>row.positionId===positions[0].id).map(row=>row.day),[4]);
  assert.deepEqual(events.filter(row=>row.positionId===positions[1].id).map(row=>row.day),[4]);
  assert.deepEqual(events.filter(row=>row.positionId===positions[2].id).map(row=>row.day),[4,5]);
  assert.ok(store.get(oldId,'task-deadline').clearedAt);
  assert.equal(organization.scanDeadlines().length,0);
  assert.equal(organization.taskDeadlines(manager).some(row=>row.id===oldId),false);
  store.put('kpi-design',{employeeId:person.id,positionId:positions[2].id,status:'ai_pending',tasks:[]},person.id);
  assert.equal(organization.taskDeadlines(manager).some(row=>row.positionId===positions[2].id),false);
});

test('HR maintains units and people; charts expose only the correct reporting scope',async t=>{
  const {store,workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),manager=workflow.user('manager-ops'),employee=workflow.user('employee-mohammad');
  assert.deepEqual(organization.chart(employee).people.map(person=>person.id).sort(),[employee.id,manager.id].sort());
  assert.equal(organization.chart(manager).people.length,7);
  assert.equal(organization.chart(employee).people.find(person=>person.id===employee.id).phone,'09120000001');
  assert.equal(organization.chart(employee).people.find(person=>person.id===manager.id).phone,undefined);
  assert.equal(organization.chart(hr).people.find(person=>person.id===employee.id).phone,'09120000001');
  assert.equal(organization.chart(manager).people.every(person=>person.unitId==='ops'),true);
  assert.equal(organization.chart(hr).units.some(unit=>unit.id==='services'),true);
  assert.throws(()=>organization.units(employee),/مجوز/);
  organization.createUnit(hr,{id:'research',name:'پژوهش'});
  const lead=organization.createPerson(hr,{role:'manager',name:'مدیر پژوهش',jobTitle:'مدیر پژوهش',jobFamily:'پژوهش',jobLevel:'مدیر',unitId:'research',unitName:'پژوهش',baseSalary:90000000,duties:'مدیریت واحد پژوهش',effectiveFrom:'2020-01-01'}).employee;
  const staff=organization.createPerson(hr,{role:'personnel',name:'کارشناس پژوهش',employeeCode:'R100',jobTitle:'کارشناس پژوهش',jobFamily:'پژوهش',jobLevel:'کارشناس',unitId:'research',unitName:'پژوهش',managerId:lead.id,baseSalary:60000000,modelType:'general',hasProjects:true,duties:'انجام وظایف پژوهشی',effectiveFrom:'2020-01-01'}).employee;
  assert.equal(organization.listPositions(hr).find(position=>position.employeeId===staff.id).employeeCode,'R100');
  assert.throws(()=>organization.listPositions(workflow.user('employee-mohammad')),/مجوز/);
  assert.throws(()=>organization.createPerson(hr,{role:'personnel',name:'کارشناس تکراری',employeeCode:'R100',jobTitle:'کارشناس پژوهش',jobFamily:'پژوهش',jobLevel:'کارشناس',unitId:'research',unitName:'پژوهش',managerId:lead.id,baseSalary:60000000,modelType:'general',hasProjects:true,duties:'انجام وظایف پژوهشی',effectiveFrom:'2020-01-01'}),/کد پرسنلی قبلاً ثبت شده/);
  const internInput={role:'personnel',name:'مسئول داده',jobTitle:'مسئول داده',jobFamily:'پژوهش',jobLevel:'کارشناس',unitId:'research',unitName:'پژوهش',managerId:staff.id,baseSalary:60000000,modelType:'general',hasProjects:true,duties:'مدیریت داده',effectiveFrom:'2020-01-01'};
  assert.throws(()=>organization.createPerson(hr,internInput),/مدیر مجاز همان واحد/);
  const intern=organization.createPerson(hr,{...internInput,managerId:lead.id}).employee;
  // Historical hierarchies remain readable; the new policy must not rewrite them.
  store.put('workflow-user',{...store.get(intern.id,'workflow-user'),managerId:staff.id});
  assert.deepEqual(organization.chart(workflow.user(staff.id)).people.map(person=>person.id).sort(),[lead.id,staff.id,intern.id].sort());
  assert.equal(organization.chart(workflow.user(lead.id)).people.length,3);
  assert.equal(organization.chart(manager).people.some(person=>person.id===staff.id),false);
});

test('HR sections belong to units and flow into new personnel and position records',async t=>{
  const {workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),personnel=workflow.user('employee-mohammad');
  assert.throws(()=>organization.sections(personnel),/مجوز/);
  assert.throws(()=>organization.createSection(hr,{id:'missing-section',name:'بخش نامعتبر',unitId:'missing'}),/واحد سازمانی/);
  organization.createUnit(hr,{id:'new-unit',name:'واحد جدید'});
  const section=organization.createSection(hr,{id:'new-section',name:'تحلیل داده',unitId:'new-unit'});
  assert.equal(organization.sections(hr).find(row=>row.id===section.id).unitId,'new-unit');
  assert.throws(()=>organization.createSection(hr,{id:'new-section',name:'تکراری',unitId:'new-unit'}),/قبلاً ثبت شده/);
  const lead=organization.createPerson(hr,{role:'manager',name:'مدیر واحد جدید',employeeCode:'U-LEAD',jobTitle:'مدیر تحلیل',jobLevel:'مدیر',unitId:'new-unit',unitName:'واحد جدید',effectiveFrom:'2020-01-01'}).employee;
  const input={role:'personnel',managerId:lead.id,name:'پرسنل واحد جدید',employeeCode:'U100',jobTitle:'کارشناس تحلیل',jobLevel:'کارشناس',unitId:'new-unit',unitName:'واحد جدید',sectionId:'new-section',baseSalary:80000000,duties:'تحلیل داده',effectiveFrom:'2020-01-01'};
  assert.throws(()=>organization.createPerson(hr,{...input,sectionId:'section-missing'}),/بخش انتخاب‌شده/);
  const created=organization.createPerson(hr,input);
  assert.equal(created.employee.sectionId,'new-section');assert.equal(created.position.sectionId,'new-section');assert.equal(created.position.jobFamily,'تحلیل داده');
  assert.throws(()=>organization.createPerson(hr,{...input,employeeCode:'U101',sectionId:organization.sections(hr).find(row=>row.unitId==='ops').id}),/بخش انتخاب‌شده/);
});

test('HR configures per-person service surveys; only non-service staff and managers vote',async t=>{
  const {store,workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),period=workflow.currentPeriod,target='employee-service-1';
  const campaign=organization.createServiceCampaign(hr,{period,employeeId:target,question:'کیفیت خدمت فرد؟'});assert.ok(campaign.population>=5);assert.equal(campaign.status,'draft');assert.equal('minResponses' in campaign,false);assert.equal(campaign.dueAt,new Date(Date.parse(periodBounds(period).end+'T00:00:00Z')+4*86400000).toISOString().slice(0,10));
  assert.equal(organization.serviceCampaigns(workflow.user('employee-mohammad')).some(row=>row.id===campaign.id),false);
  organization.publishServiceCampaign(hr,campaign.id);
  assert.throws(()=>organization.createServiceCampaign(workflow.user('manager-services'),{period,employeeId:'employee-service-2'}),/مجوز/);
  assert.throws(()=>organization.submitServiceResponse(workflow.user(target),campaign.id,{score:100}),/در دسترس/);
  assert.throws(()=>organization.submitServiceResponse(workflow.user('manager-services'),campaign.id,{score:100}),/در دسترس/);
  assert.throws(()=>organization.submitServiceResponse(hr,campaign.id,{score:100}),/مجوز/);
  const people=['employee-mohammad','employee-sara','employee-reza','employee-maryam','manager-ops','employee-ops-4','employee-ops-5','employee-ops-6'];
  const required=Math.ceil(campaign.population*campaign.minParticipation);assert.equal(required,8);
  for(let index=0;index<required-1;index++){const response=organization.submitServiceResponse(workflow.user(people[index]),campaign.id,{score:80+index});assert.equal(response.published,false);}
  assert.equal(organization.serviceCampaigns(hr)[0].responseCount,required-1);
  assert.equal(organization.serviceCampaigns(workflow.user(target))[0].ownCampaign,true);
  assert.equal(organization.serviceCampaigns(workflow.user(target))[0].aggregate,undefined);
  assert.equal(organization.serviceCampaigns(workflow.user(people[0])).some(row=>row.id===campaign.id),false);
  assert.equal(organization.serviceCampaigns(workflow.user('manager-services'))[0].aggregate,undefined);
  const final=organization.submitServiceResponse(workflow.user(people[required-1]),campaign.id,{score:90});assert.equal(final.published,true);assert.equal(final.aggregate,83.9);
  const raw=store.list('service-survey-response',campaign.id);assert.equal(raw.length,required);assert.equal('employeeId' in raw[0],false);assert.equal(store.list('service-survey-ballot',campaign.id).length,required);
  assert.throws(()=>organization.submitServiceResponse(workflow.user(people[0]),campaign.id,{score:75}),/قبلاً پاسخ/);
  assert.equal(workflow.snapshotForSystem(target,period).components.find(c=>c.id==='peer').score,83.9);
  assert.equal(organization.serviceCampaigns(workflow.user(target))[0].aggregate,83.9);
  assert.equal(workflow.snapshotForSystem('employee-service-2',period).components.find(c=>c.id==='peer').score,null);
  organization.removeServiceCampaign(hr,campaign.id);assert.equal(organization.serviceCampaigns(hr).some(row=>row.id===campaign.id),false);assert.equal(workflow.snapshotForSystem(target,period).components.find(c=>c.id==='peer').score,null);
});

test('HR drafts separate surveys for each service employee and publishes individually',async t=>{
  const {workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),period=workflow.currentPeriod;
  organization.createServiceCampaign(hr,{period,employeeId:'employee-service-1'});
  const bulk=organization.createServiceCampaign(hr,{period,employeeId:'all',question:'کیفیت خدمت همکار را ارزیابی کنید.'});assert.equal(bulk.createdCount,4);assert.equal(bulk.skippedCount,1);assert.equal(organization.serviceCampaigns(hr).length,5);
  assert.equal(new Set(organization.serviceCampaigns(hr).map(c=>c.employeeId)).size,5);
  const repeat=organization.createServiceCampaign(hr,{period,employeeId:'all'});assert.equal(repeat.createdCount,0);assert.equal(repeat.skippedCount,5);
  assert.equal(organization.serviceCampaigns(workflow.user('employee-service-2')).filter(c=>c.ownCampaign).length,0);
  const first=organization.serviceCampaigns(hr)[0];organization.publishServiceCampaign(hr,first.id);assert.equal(organization.serviceCampaigns(workflow.user(first.employeeId)).filter(c=>c.ownCampaign).length,1);
  const closed=organization.closeServiceCampaign(hr,first.id);assert.equal(closed.status,'insufficient');assert.equal(organization.serviceCampaigns(hr).find(c=>c.id===first.id).status,'insufficient');
});

test('published survey closes without participation and deletion keeps audit but removes the active record',async t=>{
  const {store,workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),period=workflow.currentPeriod,campaign=organization.createServiceCampaign(hr,{period,employeeId:'employee-service-1'});
  assert.throws(()=>organization.closeServiceCampaign(workflow.user('manager-ops'),campaign.id),/مجوز/);
  assert.throws(()=>organization.publishServiceCampaign(workflow.user('manager-ops'),campaign.id),/مجوز/);
  organization.publishServiceCampaign(hr,campaign.id);assert.throws(()=>organization.publishServiceCampaign(hr,campaign.id),/پیش‌نویس/);
  const closed=organization.closeServiceCampaign(hr,campaign.id);assert.equal(closed.status,'insufficient');assert.equal(closed.aggregate,null);assert.equal(organization.serviceCampaigns(hr)[0].responseCount,0);
  assert.throws(()=>organization.submitServiceResponse(workflow.user('employee-mohammad'),campaign.id,{score:80}),/پایان یافته/);
  assert.throws(()=>organization.createServiceCampaign(hr,{period,employeeId:'employee-service-1'}),/قبلاً نظرسنجی/);
  assert.throws(()=>organization.createServiceCampaign(hr,{period:previousMonth(period),employeeId:'employee-service-1'}),/ماه‌های گذشته/);
  organization.removeServiceCampaign(hr,campaign.id);assert.equal(organization.serviceCampaigns(hr).some(row=>row.id===campaign.id),false);assert.equal(store.get(campaign.id,'service-survey-campaign').removedBy,hr.id);
  assert.throws(()=>organization.removeServiceCampaign(workflow.user('manager-ops'),campaign.id),/مجوز/);
});

test('future service surveys remain drafts; current-month drafts publish together',async t=>{
  const {workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),period=workflow.currentPeriod,future=nextMonth(period);
  const futureDraft=organization.createServiceCampaign(hr,{period:future,employeeId:'employee-service-1'});
  assert.equal(futureDraft.status,'draft');
  assert.throws(()=>organization.publishServiceCampaign(hr,futureDraft.id),/آغاز همان ماه/);
  assert.throws(()=>organization.publishServiceCampaignMonth(hr,future),/آغاز همان ماه/);
  const first=organization.createServiceCampaign(hr,{period,employeeId:'employee-service-1'}),second=organization.createServiceCampaign(hr,{period,employeeId:'employee-service-2'});
  const batch=organization.publishServiceCampaignMonth(hr,period);
  assert.equal(batch.publishedCount,2);assert.deepEqual(new Set(batch.campaigns.map(row=>row.id)),new Set([first.id,second.id]));
  assert.equal(organization.serviceCampaigns(hr).filter(row=>row.period===period&&row.status==='open').length,2);
  assert.throws(()=>organization.publishServiceCampaignMonth(hr,period),/پیش‌نویسی/);
  assert.throws(()=>organization.removeServiceCampaignMonth(workflow.user('manager-ops'),period),/مجوز/);
  const removed=organization.removeServiceCampaignMonth(hr,period);assert.equal(removed.removedCount,2);
  assert.equal(organization.serviceCampaigns(hr).filter(row=>row.period===period).length,0);
  assert.equal(organization.serviceCampaigns(hr).some(row=>row.id===futureDraft.id),true);
  for(const row of removed.campaigns)assert.ok(row.removedAt);
  assert.throws(()=>organization.removeServiceCampaignMonth(hr,period),/قابل حذف/);
});

test('legacy unit-wide service scores do not carry into individual survey results',async t=>{
  const {store,workflow,organization}=await setup(t),period=workflow.currentPeriod,hr=workflow.user('hr-demo'),employeeId='employee-service-1';
  const old=store.put('service-survey-campaign',{unitId:'services',period,status:'completed',aggregate:90});store.put('service-survey-aggregate',{employeeId,period,score:90,campaignId:old.id,source:'peer-survey'},employeeId);
  assert.equal(workflow.snapshotForSystem(employeeId,period).components.find(c=>c.id==='peer').score,null);
  assert.equal(organization.serviceCampaigns(hr).some(c=>c.id===old.id),false);
});

test('locked quarter is exported by HR as a real Excel workbook; appeals preserve the snapshot',async t=>{
  const {store,workflow,organization}=await setup(t),quarter=previousQuarter(workflow.currentPeriod);completeQuarter(store,'employee-mohammad',quarter);
  const manager=workflow.user('manager-ops'),hr=workflow.user('hr-demo'),employee=workflow.user('employee-mohammad');
  const result=organization.quarterResult(manager,quarter,employee.id);assert.equal(result.status,'ready');assert.equal(result.canFinalize,true);assert.equal(result.calculation.baseSalary,undefined);
  const sent=organization.submitQuarter(manager,quarter,employee.id);assert.equal(sent.status,'hr_review');
  const locked=organization.approveQuarter(hr,sent.id,{decision:'approve'});assert.equal(locked.status,'locked');assert.equal(locked.lockedSnapshot.aggregationVersion,'exam-once-monthly-thirds-v1');
  assert.equal(workflow.user('finance-demo'),null);assert.equal(workflow.accounts().some(a=>a.role==='finance'),false);
  assert.equal(organization.quarterTeam(employee,quarter)[0].status,'locked');assert.equal(organization.quarterTeam(employee,quarter)[0].quarterPay.earned,locked.lockedSnapshot.quarterPay.earned);
  const managerLocked=organization.quarterTeam(manager,quarter).find(row=>row.employee.id===employee.id);assert.equal(managerLocked.status,'locked');assert.equal(managerLocked.quarterPay.earned,undefined);assert.equal(managerLocked.quarterPay.ceiling,undefined);assert.equal(managerLocked.quarterPay.breakdown.every(row=>row.earned===undefined&&row.ceiling===undefined),true);assert.equal(managerLocked.quarterPay.oneTimeContribution.earned,undefined);assert.equal(managerLocked.calculation.baseSalary,undefined);assert.equal(managerLocked.calculation.components.every(row=>row.earned===undefined&&row.ceiling===undefined),true);assert.equal(managerLocked.monthRows.every(month=>month.components.every(row=>row.earned===undefined&&row.ceiling===undefined)),true);
  assert.throws(()=>organization.finalExcel(manager,quarter),/مجوز/);
  const output=organization.finalExcel(hr,quarter),files=unzipSync(output.data),sheet=strFromU8(files['xl/worksheets/sheet1.xml']);assert.match(output.filename,/\.xlsx$/);assert.match(sheet,/محمد رضایی/);assert.match(sheet,/KPI دریافتی/);assert.match(sheet,new RegExp(String(locked.lockedSnapshot.quarterPay.earned)));const workbook=XLSX.read(Buffer.from(output.data),{type:'buffer'}),values=XLSX.utils.sheet_to_json(workbook.Sheets['Final KPI']);assert.equal(values[0]['شناسه پرسنل'],employee.id);assert.equal(values[0]['KPI دریافتی (تومان)'],locked.lockedSnapshot.quarterPay.earned);
  const appeal=organization.submitAppeal(employee,{quarter,type:'payroll',reason:'مبنای رقم نیازمند تطبیق است.'});organization.reviewAppeal(manager,appeal.id,{decision:'approve'});const accepted=organization.reviewAppeal(hr,appeal.id,{decision:'approve'});assert.equal(accepted.status,'approved');
  assert.equal(store.get(locked.id,'quarter-evaluation').lockedSnapshot.quarterPay.earned,locked.lockedSnapshot.quarterPay.earned);assert.equal(organization.listAppeals(employee)[0].status,'approved');
});

test('quarter payroll stores monthly one-third shares separately from the single quarterly exam contribution',async t=>{
  const {store,workflow,organization}=await setup(t),quarter=previousQuarter(workflow.currentPeriod),employeeId='employee-mohammad';completeQuarter(store,employeeId,quarter,{exam:100,manager:0,routine:0,project:0});
  const hr=workflow.user('hr-demo'),result=organization.quarterResult(hr,quarter,employeeId),examWeight=result.calculation.components.find(component=>component.id==='exam').weight,expectedExam=Math.round(result.quarterPay.ceiling*examWeight*result.exam.score/10000);
  assert.equal(result.status,'ready');assert.equal(result.calculation.performance,15);assert.equal(result.quarterPay.breakdown.every(interval=>interval.score===0&&interval.earned===0),true);assert.equal(result.quarterPay.oneTimeContribution.score,100);assert.equal(result.quarterPay.oneTimeContribution.earned,expectedExam);assert.equal(result.quarterPay.earned,expectedExam);assert.equal(result.quarterPay.formulaVersion,'quarter-cap-20-monthly-thirds-exam-once-v3');
  completeQuarter(store,'employee-sara',quarter,{exam:0,manager:100,routine:100,project:100});const noProject=organization.quarterResult(hr,quarter,'employee-sara');assert.equal(noProject.status,'ready');assert.equal(noProject.calculation.performance,45);assert.equal(noProject.quarterPay.oneTimeContribution.earned,0);assert.equal(noProject.quarterPay.breakdown.every(interval=>interval.score===45),true);assert.equal(noProject.quarterPay.earned,noProject.calculation.earned);assert.equal(noProject.calculation.components.find(c=>c.id==='project').score,0);assert.deepEqual(noProject.calculation.components.map(c=>c.weight),[15,15,30,40,0]);
  const serviceId='employee-service-1';for(const period of quarterMonths(quarter)){store.put('manager-survey',{employeeId:serviceId,period,score:100,source:'test'},serviceId);store.put('service-survey-aggregate',{employeeId:serviceId,period,score:100,status:'published',source:'test'},serviceId);}const service=organization.quarterResult(hr,quarter,serviceId);assert.equal(service.status,'ready');assert.equal(service.modelType,'unified');assert.equal(service.calculation.performance,100);assert.equal(service.quarterPay.breakdown.every(interval=>interval.score===100),true);assert.equal(service.quarterPay.earned,service.quarterPay.ceiling);
  const manager=workflow.user('manager-ops'),managerResult=organization.quarterResult(manager,quarter,employeeId);assert.equal(managerResult.monthRows.every(month=>month.components.every(component=>component.earned===undefined&&component.ceiling===undefined)),true);assert.equal(managerResult.quarterPay.oneTimeContribution.earned,undefined);assert.equal(managerResult.calculation.components.every(component=>component.earned===undefined&&component.ceiling===undefined),true);
});

test('personnel quarter preview counts only selected elapsed months and keeps the full quarter ceiling',async t=>{
  const {workflow,organization}=await setup(t),person=workflow.user('employee-mohammad'),quarter=quarterOf(workflow.currentPeriod),months=quarterMonths(quarter),progress=organization.quarterProgress(person,quarter,workflow.currentPeriod);
  assert.equal(progress.monthsCount,months.filter(month=>month<=workflow.currentPeriod).length);
  assert.equal(progress.throughPeriod,workflow.currentPeriod);
  assert.equal(progress.maxQuarterSalary,progress.fullBaseSalary+progress.ceiling);
  assert.equal(progress.finalToDate,progress.baseSalaryToDate+progress.earned);
  assert.ok(progress.earned<=progress.ceiling);
  if(months[2]>workflow.currentPeriod)assert.deepEqual(organization.quarterProgress(person,quarter,months[2]),progress);
  assert.throws(()=>organization.quarterProgress(workflow.user('hr-demo'),quarter,workflow.currentPeriod),/مجوز/);
});

test('exam import is idempotent by batch content and replaces only synthetic seed data',async t=>{
  const {store,workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),quarter=quarterOf(workflow.currentPeriod),batch={quarter,batchKey:'hr-file-001',source:'local-csv',rows:[{employeeId:'employee-mohammad',score:91,reference:`exam-${quarter}-official`}]};
  const first=organization.importExamBatch(hr,batch);assert.equal(first.importedCount,1);assert.equal(store.list('exam-result','employee-mohammad').find(row=>row.period===quarter).score,91);
  assert.equal(organization.importExamBatch(hr,batch).id,first.id);assert.throws(()=>organization.importExamBatch(hr,{...batch,rows:[{...batch.rows[0],score:92}]}),/محتوای متفاوت/);
  const invalid={quarter,batchKey:'hr-file-invalid',rows:[{employeeId:'unknown-person',score:80,reference:'missing-id'},{employeeId:'employee-sara',score:'',reference:'missing-score'}]},quarantined=organization.importExamBatch(hr,invalid);assert.equal(quarantined.status,'quarantined');assert.equal(quarantined.quarantined.length,2);assert.equal(organization.importExamBatch(hr,{...invalid,rows:[...invalid.rows].reverse()}).id,quarantined.id);
  assert.throws(()=>organization.importExamBatch(workflow.user('manager-ops'),batch),/مجوز/);
});

test('exam entry and two-column Excel need no reference and preserve real-score conflict protection',async t=>{
  const {store,workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),quarter=quarterOf(workflow.currentPeriod);
  const batch={quarter,batchKey:'manual-no-reference',source:'local-json',rows:[{employeeCode:'۱۰۰۰۰۱',score:'0'}]};
  const imported=organization.importExamBatch(hr,batch);assert.equal(imported.importedCount,1);
  const saved=store.list('exam-result','employee-mohammad').find(row=>row.period===quarter);assert.equal(saved.score,0);assert.equal(saved.reference,`exam:${quarter}:employee-mohammad`);
  assert.equal(organization.importExamBatch(hr,batch).id,imported.id);
  const repeat=organization.importExamBatch(hr,{...batch,batchKey:'manual-repeat',rows:[{employeeCode:'100001',score:0}]});assert.equal(repeat.importedCount,1);assert.equal(store.list('exam-result','employee-mohammad').find(row=>row.period===quarter).id,saved.id);
  const conflict=organization.importExamBatch(hr,{...batch,batchKey:'manual-conflict',rows:[{employeeCode:'100001',score:10}]});assert.equal(conflict.importedCount,0);assert.equal(conflict.quarantined.length,1);assert.equal(store.get(saved.id,'exam-result').score,0);
  const legacy=organization.importExamBatch(hr,{quarter,batchKey:'legacy-reference',rows:[{employeeCode:'100002',score:100,reference:'old-exam-reference'}]});assert.equal(legacy.importedCount,1);
  const excel=organization.importExamBatch(hr,{quarter,batchKey:'xlsx-no-reference',source:'local-xlsx',fileName:'scores.xlsx',rows:[{employeeCode:'100002',score:100}]});assert.equal(excel.importedCount,1);assert.equal(store.list('exam-result','employee-sara').find(row=>row.period===quarter).reference,'old-exam-reference');
  for(const [index,invalidScore] of ['',-1,101,'not-a-score'].entries()){
    const rejected=organization.importExamBatch(hr,{quarter,batchKey:`invalid-no-reference-${index}`,rows:[{employeeCode:'100003',score:invalidScore}]});assert.equal(rejected.importedCount,0);assert.equal(rejected.quarantined.length,1);
  }
  const unknown=organization.importExamBatch(hr,{quarter,batchKey:'unknown-no-reference',rows:[{employeeCode:'999999',score:80}]});assert.equal(unknown.importedCount,0);assert.match(unknown.quarantined[0].reason,/کد پرسنلی پیدا نشد/);
});

test('exam import resolves personnel codes and quarantines unknown or ambiguous codes',async t=>{
  const {store,workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),quarter=quarterOf(workflow.currentPeriod);
  assert.equal(workflow.user('employee-mohammad').employeeCode,'100001');
  const batch={quarter,batchKey:'personnel-code-001',rows:[{employeeCode:'۱۰۰۰۰۱',score:'91',reference:'official-code-result'}]};
  const imported=organization.importExamBatch(hr,batch);assert.equal(imported.importedCount,1);assert.equal(store.list('exam-result','employee-mohammad').find(row=>row.period===quarter).score,91);
  assert.equal(organization.importExamBatch(hr,{...batch,rows:[{...batch.rows[0],employeeCode:'100001'}]}).id,imported.id);
  const invalid=organization.importExamBatch(hr,{quarter,batchKey:'personnel-code-invalid',rows:[{employeeCode:'999999',score:80,reference:'unknown'},{employeeCode:'100002',score:'',reference:'missing-score'}]});
  assert.equal(invalid.status,'quarantined');assert.equal(invalid.quarantined.length,2);assert.match(invalid.quarantined[0].reason,/کد پرسنلی پیدا نشد/);assert.equal(invalid.quarantined[1].employeeCode,'100002');
  const oversized=organization.importExamBatch(hr,{quarter,batchKey:'personnel-code-oversized',rows:[{employeeCode:'100001'+'x'.repeat(60),score:85,reference:'too-long'}]});assert.match(oversized.quarantined[0].reason,/بیش از حد مجاز/);
  const corrected=organization.importExamBatch(hr,{quarter,batchKey:'personnel-code-corrected',rows:[{employeeCode:'100003',score:'',reference:'invalid-first'},{employeeCode:'100003',score:87,reference:'valid-second'}]});assert.equal(corrected.importedCount,1);assert.equal(corrected.quarantined.length,1);
  const duplicate=store.get('employee-sara','workflow-user');store.put('workflow-user',{...duplicate,employeeCode:'100001'});
  const ambiguous=organization.importExamBatch(hr,{quarter,batchKey:'personnel-code-ambiguous',rows:[{employeeCode:'100001',score:85,reference:'duplicate'}]});
  assert.equal(ambiguous.importedCount,0);assert.match(ambiguous.quarantined[0].reason,/کد پرسنلی تکراری/);
});

test('exam Excel batches can be removed from the HR archive without deleting scores or audit history',async t=>{
  const {store,workflow,organization}=await setup(t),hr=workflow.user('hr-demo'),quarter=quarterOf(workflow.currentPeriod);
  const batch=organization.importExamBatch(hr,{quarter,batchKey:'excel-archive-001',source:'local-xlsx',fileName:'exam-results.xlsx',rows:[{employeeCode:'100001',score:88,reference:'exam-sheet'}]});
  assert.equal(batch.importedCount,1);assert.equal(batch.rowCount,1);assert.equal(batch.fileName,'exam-results.xlsx');
  assert.equal(organization.listExamImports(hr).find(row=>row.id===batch.id)?.source,'local-xlsx');
  assert.throws(()=>organization.listExamImports(workflow.user('manager-ops')),/مجوز/);
  assert.throws(()=>organization.removeExamImport(workflow.user('manager-ops'),batch.id),/مجوز/);
  organization.removeExamImport(hr,batch.id);assert.equal(organization.listExamImports(hr).some(row=>row.id===batch.id),false);
  assert.equal(store.list('exam-result','employee-mohammad').find(row=>row.period===quarter).score,88);
  assert.equal(store.get(batch.id,'exam-import-batch').removedBy,hr.id);
  assert.equal(organization.importExamBatch(hr,{quarter,batchKey:'excel-archive-001',source:'local-xlsx',fileName:'exam-results.xlsx',rows:[{employeeCode:'100001',score:88,reference:'exam-sheet'}]}).id,batch.id);
  assert.throws(()=>organization.importExamBatch(hr,{quarter,batchKey:'bad-file-name',source:'local-xlsx',fileName:'../exam.xlsx',rows:[{employeeCode:'100001',score:88,reference:'exam-sheet'}]}),/نام فایل/);
});

test('draft HTTP routes preserve scope and removed published activities are inaccessible',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-draft-http-')),dataRoot=join(dir,'db'),server=createPanelServer({dataRoot,runModel:async input=>alignmentResult(input)});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;
  async function session(userId){const value=await(await fetch(base+'/api/session')).json();return (await fetch(base+'/api/session',{method:'POST',headers:{'x-panel-token':value.token,'Content-Type':'application/json'},body:JSON.stringify({userId})})).json();}
  const request=(actor,path,method='GET',data)=>fetch(base+path,{method,headers:{'x-panel-token':actor.token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const manager=await session('manager-ops'),hr=await session('hr-demo'),person=await session('employee-mohammad'),outsider=await session('manager-services'),input=draftInput(manager.period);
  assert.equal((await request(hr,'/api/org/designs/drafts','POST',input)).status,403);assert.equal((await request(person,'/api/org/designs/drafts','POST',input)).status,403);const created=await request(manager,'/api/org/designs/drafts','POST',input);assert.equal(created.status,201);const draft=await created.json();
  assert.equal((await request(outsider,`/api/org/designs/${draft.id}/draft`,'POST',input)).status,404);assert.equal((await request(outsider,`/api/org/designs/${draft.id}/delete`,'POST',{})).status,404);
  assert.equal((await request(manager,`/api/org/designs/${draft.id}/publish`,'POST',{draftRevision:draft.draftRevision})).status,200);assert.equal((await request(manager,`/api/org/designs/${draft.id}/draft`,'POST',input)).status,409);assert.equal((await request(manager,`/api/org/designs/${draft.id}/review`,'POST',{decision:'approve'})).status,200);const approval=await request(hr,`/api/org/designs/${draft.id}/approval`,'POST',{decision:'approve'});assert.equal(approval.status,200);const activityId=(await approval.json()).activityIds[0];
  assert.equal((await request(person,`/api/activities/${activityId}`)).status,200);assert.equal((await request(manager,`/api/org/designs/${draft.id}/delete`,'POST',{})).status,200);assert.equal((await request(person,`/api/activities/${activityId}`)).status,404);assert.equal((await request(person,`/api/activities/${activityId}/reviews`,'POST',{provider:'codex'})).status,404);assert.ok(!(await(await request(person,'/api/activities')).json()).some(row=>row.id===activityId));
  const store=openStore(dataRoot);assert.ok(store.get(activityId,'activity').removedAt);store.close();
});

test('HTTP panel routes enforce self, manager and HR scopes without a finance panel',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-org-http-')),server=createPanelServer({dataRoot:join(dir,'db')});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function session(userId){let response=await fetch(base+'/api/session'),value=await response.json();if(!userId||value.user.id===userId)return value;response=await fetch(base+'/api/session',{method:'POST',headers:{'x-panel-token':value.token,'Content-Type':'application/json'},body:JSON.stringify({userId})});assert.equal(response.status,200);return response.json();}
  const request=(active,path,method='GET',data)=>fetch(base+path,{method,headers:{'x-panel-token':active.token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const employee=await session('employee-mohammad'),quarter=quarterOf(employee.period),own=await(await request(employee,`/api/org/quarters/${quarter}`)).json();assert.equal(own.length,1);assert.equal(own[0].employee.id,employee.user.id);assert.equal((await request(employee,'/api/org/payroll')).status,404);assert.equal((await request(employee,`/api/org/export/final/${quarter}`)).status,403);
  const progressResponse=await request(employee,`/api/org/quarters/${quarter}/progress?period=${employee.period}`);assert.equal(progressResponse.status,200);const progress=await progressResponse.json();assert.equal(progress.finalToDate,progress.baseSalaryToDate+progress.earned);
  const manager=await session('manager-ops'),team=await(await request(manager,`/api/workflow/team?period=${employee.period}`)).json();assert.equal(team.length,6);assert.equal(team[0].baseSalary,undefined);assert.equal(team[0].components[0].earned,undefined);assert.equal(team[0].quarterPay,undefined);const managerQuarter=await(await request(manager,`/api/org/quarters/${quarter}`)).json(),managedPerson=managerQuarter.find(row=>row.employee.id===employee.user.id);assert.equal(managedPerson.monthRows.every(month=>month.components.every(component=>component.earned===undefined&&component.ceiling===undefined)),true);assert.equal(managedPerson.calculation.components.every(component=>component.earned===undefined&&component.ceiling===undefined),true);assert.equal(managedPerson.quarterPay.ceiling,undefined);assert.equal(managedPerson.quarterPay.breakdown.every(row=>row.earned===undefined&&row.ceiling===undefined),true);const detail=await(await request(manager,'/api/workflow/employees/employee-sara')).json();assert.equal(detail.baseSalary,undefined);assert.equal(detail.maxFinalSalary,undefined);assert.equal((await request(manager,'/api/org/people','POST',{name:'test'})).status,403);
  const peerStore=openStore(join(dir,'db'));seedPeerUnitModel(peerStore);peerStore.close();const hr=await session('hr-demo'),positions=await(await request(hr,'/api/org/positions')).json();assert.equal(positions.some(row=>Number.isFinite(row.baseSalary)),true);assert.equal((await request(hr,'/api/org/sources')).status,200);assert.equal((await request(hr,'/api/org/chart')).status,200);assert.equal((await request(hr,'/api/org/units')).status,200);assert.equal((await request(hr,`/api/org/quarters/${quarter}/progress?period=${employee.period}`)).status,403);
  const bulkResponse=await request(hr,'/api/org/surveys/service','POST',{employeeId:'all',period:employee.period});assert.equal(bulkResponse.status,201);const bulk=await bulkResponse.json();assert.equal(bulk.createdCount,5);assert.equal(bulk.skippedCount,0);
  const listed=await(await request(hr,'/api/session')).json();assert.equal(listed.accounts.some(a=>a.role==='finance'),false);
  assert.equal((await request(hr,'/api/org/payroll')).status,404);
});

test('appeal files upload, download and remain scoped to the employee, manager and HR',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-appeal-files-')),dataRoot=join(dir,'db'),uploadRoot=join(dir,'raw');let server=createPanelServer({dataRoot,uploadRoot});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  let base=`http://127.0.0.1:${server.address().port}`;
  async function session(userId){const initial=await(await fetch(base+'/api/session')).json();return userId===initial.user.id?initial:(await fetch(base+'/api/session',{method:'POST',headers:{'x-panel-token':initial.token,'Content-Type':'application/json'},body:JSON.stringify({userId})})).json();}
  const request=(active,path,method='GET',payload)=>fetch(base+path,{method,headers:{'x-panel-token':active.token,...(payload&&!(payload instanceof Uint8Array)?{'Content-Type':'application/json'}:{})},...(payload===undefined?{}:{body:payload instanceof Uint8Array?payload:JSON.stringify(payload)})});
  const employee=await session('employee-mohammad'),manager=await session('manager-ops'),outsider=await session('employee-sara'),otherManager=await session('manager-finance'),hr=await session('hr-demo'),quarter=previousQuarter(employee.period);
  const store=openStore(dataRoot);store.put('quarter-evaluation',{employeeId:employee.user.id,quarter,status:'locked',lockedAt:new Date().toISOString()},employee.user.id);store.close();
  const createdResponse=await request(employee,'/api/org/appeals','POST',{quarter,type:'score',reason:'گزارش و شواهد نیازمند بازبینی است.'});assert.equal(createdResponse.status,201);const appeal=await createdResponse.json(),filePath=`/api/org/appeals/${appeal.id}/files`,fileName='گزارش عملکرد.pdf',content=new TextEncoder().encode('sample appeal evidence');
  assert.equal((await request(outsider,`${filePath}?name=${encodeURIComponent(fileName)}`,'POST',content)).status,403);
  const upload=await request(employee,`${filePath}?name=${encodeURIComponent(fileName)}`,'POST',content);assert.equal(upload.status,201);const file=await upload.json();assert.equal(file.name,fileName);assert.equal(file.size,content.length);assert.equal('path' in file,false);
  assert.equal((await(await request(manager,'/api/notifications')).json()).items.some(item=>item.title==='مستند اعتراض اضافه شد'),true);
  assert.equal((await request(employee,`${filePath}?name=duplicate.pdf`,'POST',content)).status,409);
  const own=await(await request(employee,'/api/org/appeals')).json();assert.equal(own[0].files[0].id,file.id);assert.equal('path' in own[0].files[0],false);
  assert.equal((await request(outsider,`${filePath}/${file.id}`)).status,403);assert.equal((await request(otherManager,`${filePath}/${file.id}`)).status,403);
  for(const viewer of [employee,manager,hr]){const response=await request(viewer,`${filePath}/${file.id}`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),content);}
  assert.equal((await request(hr,`${filePath}?name=hr.pdf`,'POST',new TextEncoder().encode('HR file'))).status,403);
  const managerUpload=await request(manager,`${filePath}?name=manager.txt`,'POST',new TextEncoder().encode('manager evidence'));assert.equal(managerUpload.status,201);assert.equal((await(await request(manager,'/api/org/appeals')).json())[0].files.length,2);
  assert.equal((await(await request(employee,'/api/notifications')).json()).items.some(item=>item.title==='مستند اعتراض اضافه شد'),true);
  assert.equal((await request(employee,`${filePath}?name=..%2Fbad.txt`,'POST',new TextEncoder().encode('invalid name'))).status,400);
  for(let index=0;index<3;index++)assert.equal((await request(employee,`${filePath}?name=extra-${index}.txt`,'POST',new TextEncoder().encode(`extra-${index}`))).status,201);
  assert.equal((await request(employee,`${filePath}?name=overflow.txt`,'POST',new TextEncoder().encode('overflow'))).status,409);
  assert.equal((await request(manager,'/api/org/appeals','POST',{quarter,type:'score',reason:'manager own appeal'})).status,403);
  assert.equal((await request(manager,`/api/org/appeals/${appeal.id}/review`,'POST',{decision:'approve'})).status,200);
  assert.equal((await request(manager,`${filePath}?name=late.txt`,'POST',new TextEncoder().encode('late'))).status,403);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=createPanelServer({dataRoot,uploadRoot});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
  const afterRestart=await session('employee-mohammad'),persisted=await request(afterRestart,`${filePath}/${file.id}`);assert.equal(persisted.status,200);assert.deepEqual(new Uint8Array(await persisted.arrayBuffer()),content);
});

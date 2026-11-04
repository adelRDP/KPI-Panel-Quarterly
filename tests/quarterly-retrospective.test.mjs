import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,periodBounds} from '../backend/quarterly-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createAutomaticReview} from '../backend/automatic-review.mjs';
import {quarterlyEvidenceWindow} from '../backend/quarterly-evidence-window.mjs';
import {submissionRules,delayBreakdown} from '../backend/score-rules.mjs';
import {roleReply} from './ai-role-fixture.mjs';

const period='1405-Q3',importDate='2026-11-04',mehrDate='2026-10-10',now=importDate+'T12:00:00Z';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'quarter-retrospective-')),store=openStore(root),calls=[];
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 store.put('org-unit',{id:'u',name:'واحد آزمایشی'});
 for(const p of [{id:'a',role:'hr'},{id:'m',role:'manager'},{id:'e',role:'personnel',managerId:'m',baseSalary:60000000}])store.put('workflow-user',{name:p.id,unitId:'u',unitName:'واحد آزمایشی',jobTitle:'گزارشگری',...p});
 store.put('project-meta',{id:'quarterly-project',startDate:importDate,startQuarter:period});
 store.put('position-assignment',{id:'p',employeeId:'e',status:'published',unitId:'u',unitName:'واحد آزمایشی',managerId:'m',baseSalary:60000000,isKpiEligible:true,isManager:false,hasProjects:true,jobTitle:'گزارشگری',jobFamily:'اداری',jobLevel:'کارشناس',duties:'تهیه گزارش و ثبت خروجی برای مدیر',effectiveFrom:importDate,effectiveTo:null,createdBy:'organization-import',version:1,events:[]},'e');
 store.put('workflow-policy',{id:'active-policy',version:'test',weights:{exam:0,manager:0,routine:50,project:50,peer:0}});
 const w=createWorkflow(store),org=createOrganizationWorkflow(store,w,{runModel:input=>roleReply(input,{mutate:(result,envelope)=>calls.push(envelope)})});
 const task={category:'routine',title:'گزارش مهر',description:'تهیه گزارش و ثبت خروجی برای مدیر',criteria:['گزارش کامل ثبت شود'],weightPoints:1,frequency:'فصلی',targetVolume:1,targetUnit:'گزارش',timeLimit:{time:'09:00'},dueDate:mehrDate};
 return {store,w,org,calls,task,manager:w.user('m'),hr:w.user('a'),input:{employeeId:'e',period,tasks:[task]}};
}

test('Mehr task passes design, AI and approvals during import quarter without extending financial interval',async t=>{
 const {store,w,org,calls,input,manager,hr}=fixture(t),before=w.snapshotForSystem('e',period),position=structuredClone(store.get('p','position-assignment'));
 const draft=org.saveDesignDraft(manager,input);await org.publishDesignDraft(manager,draft.id,'codex',draft.revision);org.managerReviewDesign(manager,draft.id,{decision:'approve'});org.hrReviewDesign(hr,draft.id,{decision:'approve'});
 const activity=store.list('activity')[0];assert.equal(activity.dueDate,mehrDate);assert.equal(activity.assessmentStart,periodBounds(period).start);assert.equal(activity.assessmentEnd,periodBounds(period).end);
 const alignment=calls.find(c=>c.stage==='kpi-alignment-v4');assert.ok(alignment);assert.equal(alignment.scope.effectiveInterval.from,periodBounds(period).start);assert.match(alignment.stagePayload.datePolicy,/Past dates/);
 const after=w.snapshotForSystem('e',period);assert.equal(after.start,importDate);assert.equal(after.start,before.start);assert.equal(after.baseSalary,before.baseSalary);assert.deepEqual(store.get('p','position-assignment'),position);
 const people=org.evaluationModels(manager,period).people;assert.equal(people[0].assessmentStart,importDate);assert.equal(people[0].evidenceStart,periodBounds(period).start);
});

test('project milestone in Mehr is allowed, dates outside the quarter are rejected',t=>{
 const {org,manager,input,task}=fixture(t),project={...task,category:'project',deadline:mehrDate,milestones:[{name:'تحویل گزارش',dueDate:mehrDate}],deliverable:'گزارش خروجی'};
 assert.equal(org.saveDesignDraft(manager,{...input,tasks:[project]}).tasks[0].deadline,mehrDate);
 for(const at of ['2026-09-01',periodBounds(period).end]){
  assert.throws(()=>org.saveDesignDraft(manager,{...input,tasks:[{...task,dueDate:at}]}),{status:409});
  assert.throws(()=>org.saveDesignDraft(manager,{...input,tasks:[{...project,milestones:[{name:'تحویل',dueDate:at}]}]}),{status:409});
 }
});

test('real hire, transfer, closed position and locked quarter do not acquire retrospective permission',t=>{
 const {store,org,manager,input}=fixture(t),position=store.get('p','position-assignment');
 for(const patch of [{createdBy:'a'},{supersedes:'prior-position'}]){
  store.put('position-assignment',{...position,...patch},'e');assert.throws(()=>org.saveDesignDraft(manager,input),{status:409});
 }
 store.put('position-assignment',position,'e');
 store.put('position-assignment',{...position,id:'prior-position',effectiveFrom:'2026-09-01',effectiveTo:importDate},'e');
 assert.equal(quarterlyEvidenceWindow(store,position,period).start,importDate);
 store.put('position-assignment',{...store.get('prior-position','position-assignment'),status:'draft'},'e');
 store.put('position-closeout',{id:'closed-position',employeeId:'e',positionId:'p',status:'locked',months:[]},'e');
 assert.throws(()=>org.saveDesignDraft(manager,input),{status:409});
 store.put('position-closeout',{id:'closed-position',employeeId:'e',positionId:'p',status:'draft',months:[]},'e');
 store.put('quarter-evaluation',{employeeId:'e',quarter:period,status:'locked'},'e');
 assert.throws(()=>org.saveDesignDraft(manager,input),{status:409});
});

test('same-quarter late upload and correction remain allowed while quotas and delay scoring survive',t=>{
 const {store}=fixture(t),activity={id:'task',period,kind:'routine',unitId:'u',dueDate:mehrDate};
 store.put('score-rule-version',{id:'rules',status:'published',effectiveDate:'2026-01-01',publishedAt:'2026-01-01T00:00:00Z',activityKind:'all',sequence:1,values:{lateMode:'close',afterDue:'close',revisionDays:'1',maxUploads:'5',maxRevisions:'4',delayMode:'fixed',delayAmount:'5',delayCap:'20'}});
 const docs=[{id:'new-doc',sha256:'new',createdAt:now}];
 assert.doesNotThrow(()=>submissionRules(store,activity,docs,{now}));
 for(let i=0;i<4;i++)store.put('review',{status:'done',submissionKey:'old-'+i,finishedAt:'2026-10-12T12:00:00Z',result:{coverage:{incomplete:false}}},activity.id);
 const rule=submissionRules(store,activity,docs,{now,review:true});assert.ok(rule.lateDays>0);assert.equal(delayBreakdown(rule.policy,90,rule.lateDays).finalScore,85);
 store.put('review',{status:'done',submissionKey:'old-4',finishedAt:now,result:{coverage:{incomplete:false}}},activity.id);
 assert.throws(()=>submissionRules(store,activity,docs,{now,review:true}),/سهمیه/);
 assert.throws(()=>submissionRules(store,activity,docs,{now:'2026-12-23T12:00:00Z'}),/مهلت/);
 assert.throws(()=>submissionRules(store,{...activity,period:'1405-07'},docs,{now}),/مهلت/);
});

test('existing imported activity accepts Mehr evidence with an expanded AI snapshot, without rewriting activity',async t=>{
 const {store,w}=fixture(t),activity=store.put('activity',{id:'task',ownerId:'e',positionId:'p',period,unitId:'u',assignmentStatus:'approved',kind:'routine',title:'گزارش مهر',description:'خروجی کار مهر',criteria:[{id:'C1',text:'گزارش مهر ثبت شود'}],assessmentStart:importDate,assessmentEnd:periodBounds(period).end},'e'),original=structuredClone(activity),prompts=[];
 store.put('document',{id:'d',name:'mehr.txt',sha256:'synthetic',createdAt:now,extraction:{status:'ready',chunks:[{id:'c',text:'گزارش خروجی مهر ۱۴۰۵؛ ثبت کامل عملیات روز ۱۴۰۵/۰۷/۱۸.'}],warnings:[]}},activity.id);
 const worker=createAutomaticReview(store,w,{enabled:false,archiveRejectedEvidence:false,busy:new Set(),notifications:{publish(){}},runModel:async({prompt})=>{
  prompts.push(prompt);const evidence=JSON.parse(prompt.split('UNTRUSTED EVIDENCE:\n')[1]);return {result:{summary:'گزارش آزمایشی',criteria:[{id:'C1',status:'met',score:90,reason:'گزارش مهر ارائه شد',citations:[{chunkId:evidence.chunks[0].id,quote:evidence.chunks[0].text.slice(0,12)}]}]}};
 }});t.after(()=>worker.stop());
 const queued=await worker.queue(w.user('e'),activity,'codex');assert.equal(queued.activitySnapshot.assessmentStart,periodBounds(period).start);
 const done=await worker.execute(queued);assert.equal(done.status,'done');assert.equal(done.result.finalForActivity,true);assert.ok(prompts.some(p=>p.includes('Past-dated work and evidence inside this interval are allowed')));
 assert.deepEqual(store.get('task','activity'),original);
 const cached=await worker.queue(w.user('e'),activity,'codex');assert.equal(cached.id,done.id);assert.equal(cached.cached,true);
 store.put('quarter-evaluation',{employeeId:'e',quarter:period,status:'locked'},'e');await assert.rejects(worker.queue(w.user('e'),activity,'codex'),{status:409});
});

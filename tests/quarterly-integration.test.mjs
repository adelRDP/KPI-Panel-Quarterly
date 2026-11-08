import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,periodBounds} from '../backend/quarterly-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createPanelServer} from '../server.mjs';
import {roleReply} from './ai-role-fixture.mjs';
import {createActivityHumanReview,activityHumanFinal} from '../backend/activity-human-review.mjs';
import {submissionQuota} from '../backend/score-rules.mjs';
import {sha256} from '../backend/evaluation.mjs';
import {createLocalAccounts} from '../backend/local-accounts.mjs';
const q='1404-Q3';
const XLSX=createRequire(import.meta.url)('../src/vendor/xlsx.full.min.js');
const exportRows=(org,actor)=>{const book=XLSX.read(org.finalExcel(actor,q).data,{type:'buffer'});return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});};
function fixture(t,{routine=false}={}){
 const root=mkdtempSync(join(tmpdir(),'quarter-integration-')),store=openStore(root),servers=[];t.after(async()=>{for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r));}store.close();rmSync(root,{recursive:true,force:true});});
 for(const id of ['u','v'])store.put('org-unit',{id,name:id});
 for(const p of [{id:'a',role:'hr',unitId:'u'},{id:'m',role:'manager',unitId:'u'},{id:'n',role:'manager',unitId:'v'},{id:'e',role:'personnel',unitId:'u',managerId:'m',baseSalary:60000000}])store.put('workflow-user',{name:p.id,unitName:p.unitId,jobTitle:'گزارشگری',...p});
 store.put('position-assignment',{id:'p',employeeId:'e',status:'published',unitId:'u',unitName:'u',managerId:'m',baseSalary:60000000,isKpiEligible:true,isManager:false,hasProjects:false,jobTitle:'گزارشگری',jobFamily:'اداری',jobLevel:'کارشناس',duties:'تهیه گزارش و ثبت خروجی برای مدیر',effectiveFrom:periodBounds(q).start,effectiveTo:null,version:1,events:[]},'e');
 store.put('workflow-policy',{id:'active-policy',version:'test',weights:{exam:50,manager:routine?0:50,routine:routine?50:0,project:0,peer:0}});
 const w=createWorkflow(store),org=createOrganizationWorkflow(store,w,{runModel:roleReply});return {root,store,servers,w,org,hr:w.user('a'),manager:w.user('m')};
}
test('quarter approval requires complete scores, rejects stale approval, locks sources and exports',t=>{
 const {store,w,org,hr,manager}=fixture(t);assert.throws(()=>org.submitQuarter(manager,q,'e'),{status:409});
 w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});w.saveSurvey(manager,{employeeId:'e',period:q,score:80});
 const sent=org.submitQuarter(manager,q,'e');assert.equal(sent.status,'hr_review');
 w.saveSurvey(manager,{employeeId:'e',period:q,score:90});assert.throws(()=>org.approveQuarter(hr,sent.id,{decision:'approve'}),{status:409});
 const fresh=org.submitQuarter(manager,q,'e'),locked=org.approveQuarter(hr,fresh.id,{decision:'approve'});assert.equal(locked.lockedSnapshot.calculation.performance,95);assert.equal(locked.lockedSnapshot.quarterPay.earned,34200000);
 assert.throws(()=>w.saveSurvey(manager,{employeeId:'e',period:q,score:0}),{status:409});assert.throws(()=>org.submitQuarter(manager,q,'e'),{status:409});assert.ok(org.finalExcel(hr,q).data.length>0);assert.equal(org.quarterTeam(manager,q)[0].quarterPay.earned,undefined);
 assert.equal(store.list('quarter-evaluation').filter(r=>r.status==='locked').length,1);
});
test('quarterly draft passes AI fixture and manager/admin approval into one assigned activity',async t=>{
 const {store,w,org,hr,manager}=fixture(t,{routine:true});const input={employeeId:'e',period:q,tasks:[{category:'routine',title:'گزارش فصل',description:'تهیه گزارش و ثبت خروجی برای مدیر',criteria:['گزارش کامل ثبت شود'],weightPoints:1,frequency:'فصلی',targetVolume:1,targetUnit:'گزارش',timeLimit:{time:'09:00'}}]};
 const draft=org.saveDesignDraft(manager,input);assert.equal(draft.period,q);await org.publishDesignDraft(manager,draft.id,'codex',draft.revision);org.managerReviewDesign(manager,draft.id,{decision:'approve'});org.hrReviewDesign(hr,draft.id,{decision:'approve'});
 const acts=store.list('activity');assert.equal(acts.length,1);assert.equal(acts[0].period,q);assert.equal(acts[0].assessmentEnd,periodBounds(q).end);assert.equal(acts[0].frequency,'فصلی');assert.equal(w.snapshot(w.user('e'),'e',q).assignments.length,1);
 assert.throws(()=>org.saveDesignDraft(manager,{...input,period:'1404-08'}));
 assert.equal(acts[0].dueDate,new Date(Date.parse(periodBounds(q).end+'T00:00:00Z')-86400000).toISOString().slice(0,10));
 assert.throws(()=>org.saveDesignDraft(manager,{...input,tasks:[{...input.tasks[0],dueDate:periodBounds(q).end}]}),{status:409});
});

test('final Excel uses frozen employee identity after a later-quarter transfer',t=>{
 const {store,w,org,hr,manager}=fixture(t);w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});w.saveSurvey(manager,{employeeId:'e',period:q,score:80});
 const sent=org.submitQuarter(manager,q,'e'),locked=org.approveQuarter(hr,sent.id,{decision:'approve'}),before=exportRows(org,hr)[1];
 const proposal=org.proposePosition(hr,{employeeId:'e',jobTitle:'سمت جدید',jobFamily:'اداری',jobLevel:'کارشناس',unitId:'v',unitName:'v',managerId:'n',duties:'تهیه گزارش جدید',hasProjects:false,baseSalary:90000000,transferDate:periodBounds('1404-Q4').start});org.reviewPosition(w.user('n'),proposal.id,{decision:'approve'});
 const preview=org.positionCloseoutPreview(hr,proposal.id);assert.equal(preview.ready,true);org.approvePosition(hr,proposal.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});
 assert.equal(w.user('e').unitId,'v');store.put('workflow-user',{...store.get('e','workflow-user'),name:'نام جدید'},null);
 assert.deepEqual(exportRows(org,hr)[1],before);assert.equal(before[2],locked.lockedSnapshot.employee.unitName);assert.equal(before[3],locked.lockedSnapshot.employee.jobTitle);
});

test('legacy exports use historical manager snapshot or explicit missing metadata, never current identity',t=>{
 const {store,w,org,hr,manager}=fixture(t);w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});w.saveSurvey(manager,{employeeId:'e',period:q,score:100});
 const sent=org.submitQuarter(manager,q,'e'),row=org.approveQuarter(hr,sent.id,{decision:'approve'}),legacy=JSON.parse(JSON.stringify(row));delete legacy.lockedSnapshot.employee;
 store.put('quarter-evaluation',legacy,'e');assert.equal(exportRows(org,hr)[1][2],row.snapshot.employee.unitName);
 delete legacy.snapshot.employee;store.put('quarter-evaluation',legacy,'e');const output=exportRows(org,hr)[1];assert.deepEqual(output.slice(0,4),['e','ثبت نشده در سابقه','ثبت نشده در سابقه','ثبت نشده در سابقه']);assert.equal(output[6],row.lockedSnapshot.quarterPay.earned);
});
test('transfer closes the old quarter slice only after scores and keeps new scores independent',t=>{
 const {store,w,org,hr,manager}=fixture(t),cutoff='2025-11-01';
 const proposal=org.proposePosition(hr,{employeeId:'e',jobTitle:'سمت جدید',jobFamily:'اداری',jobLevel:'کارشناس',unitId:'v',unitName:'v',managerId:'n',duties:'تهیه گزارش جدید',hasProjects:false,baseSalary:90000000,transferDate:cutoff});org.reviewPosition(w.user('n'),proposal.id,{decision:'approve'});
 assert.equal(org.positionCloseoutPreview(hr,proposal.id).ready,false);w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});w.saveSurvey(manager,{employeeId:'e',period:q,score:100});
 const preview=org.positionCloseoutPreview(hr,proposal.id);assert.equal(preview.ready,true,preview.blockers.join('\n'));
 const next=org.approvePosition(hr,proposal.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});const frozen=structuredClone(store.list('position-closeout')[0]);
 assert.equal(w.snapshotForSystem('e',q).finalSalary,null);assert.equal(w.snapshotForSystem('e',q).complete,false);
 assert.equal(w.snapshotForPosition('e',q,next.id).components.find(c=>c.id==='manager').score,null);w.saveSurvey(w.user('n'),{employeeId:'e',period:q,score:0});
 const combined=w.snapshotForSystem('e',q);assert.equal(combined.finalSalary,combined.baseSalary+combined.earned);assert.equal(combined.finalSalary,261900000);assert.equal(w.snapshot(w.user('n'),'e',q).finalSalary,undefined);assert.equal(combined.segments.length,2);assert.equal(combined.segments[0].end,combined.segments[1].start);assert.equal(combined.segments[0].performance,100);assert.equal(combined.segments[1].performance,50);assert.equal(combined.earned,combined.segments.reduce((n,s)=>n+s.earned,0));assert.deepEqual(store.list('position-closeout')[0],frozen);
 assert.equal(org.quarterResult(hr,q,'e').canFinalize,true);assert.throws(()=>w.saveSurvey(manager,{employeeId:'e',period:q,score:50}),{status:403});
});
test('HTTP server uses quarterly workflow and an independent cookie with no demo seeding',async t=>{
 const f=fixture(t),server=createPanelServer({root:process.cwd(),dataRoot:f.root,demoLogin:false,autoAssessment:false,runModel:roleReply});f.servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`,res=await fetch(base+'/api/session'),s=await res.json();assert.equal(s.period.includes('-Q'),true);assert.match(res.headers.get('set-cookie'),/^quarterly-panel-session=/);assert.equal(s.accounts.length,4);
 const get=async path=>{const r=await fetch(base+path,{headers:{'x-panel-token':s.token}});return {status:r.status,data:await r.json()};};
 assert.equal((await get('/api/org/quarters/'+q)).status,200);assert.equal((await get('/api/org/evaluation-models?period='+q)).status,200);assert.equal((await get('/api/org/evaluation-models?period=1404-07')).status,400);assert.equal(f.store.list('activity').length,0);
});

test('quarter read cache preserves results, refreshes scores and locks, and isolates roles',async t=>{
 const f=fixture(t),{w,org,hr,manager}=f,accounts=createLocalAccounts(f.store,w),password='Synthetic-Cache-Test-Password';
 for(const id of ['a','m','n','e']){await accounts.save(hr,{userId:id,username:"cache-"+id,password});await accounts.changePassword(w.user(id),{currentPassword:password,password:password+'-changed'});}
 const server=createPanelServer({root:process.cwd(),dataRoot:f.root,authMode:'local',autoAssessment:false,runModel:roleReply});f.servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,tokens={};
 for(const id of ['a','m','n','e']){const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:"cache-"+id,password:password+'-changed',access:id==='a'?'admin':w.user(id).role})});assert.equal(response.status,200);tokens[id]=(await response.json()).token;}
 const get=async id=>{const r=await fetch(base+'/api/org/quarters/'+q,{headers:{'x-panel-token':tokens[id]}});assert.equal(r.status,200);return r.json();};
 const compare=async()=>{for(const id of ['a','m','n','e'])assert.deepEqual(await get(id),JSON.parse(JSON.stringify(org.quarterTeam(w.user(id),q))));};
 await compare();assert.equal((await get('a'))[0].status,'incomplete');
 w.recordExamResult({employeeId:'e',period:q,score:100,reference:'cache-test'});w.saveSurvey(manager,{employeeId:'e',period:q,score:80});await compare();assert.equal((await get('a'))[0].calculation.performance,90);
 w.saveSurvey(manager,{employeeId:'e',period:q,score:0});await compare();assert.equal((await get('a'))[0].calculation.performance,50);
 const sent=org.submitQuarter(manager,q,'e');org.approveQuarter(hr,sent.id,{decision:'approve'});await compare();assert.equal((await get('a'))[0].status,'locked');
 assert.equal((await get('m'))[0].quarterPay.earned,undefined);assert.equal((await get('a'))[0].quarterPay.earned,18000000);assert.deepEqual(await get('n'),[]);
});

test('transfer waits for queued and running snapshot-based reviews even with a previous final score',t=>{
 const {store,w,org,hr,manager}=fixture(t);
 w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});w.saveSurvey(manager,{employeeId:'e',period:q,score:100});
 const activity=store.put('activity',{ownerId:'e',positionId:'p',period:q,assignmentStatus:'approved',kind:'routine',title:'Synthetic task'},'e');
 const extraction={status:'ready',chunks:[{id:'c',text:'Synthetic evidence'}]};store.put('document',{id:'doc',sha256:'hash',extraction},activity.id);
 store.put('review',{status:'done',activitySnapshot:activity,documentHashes:[{id:'doc',sha256:'hash',extractionHash:sha256(JSON.stringify(extraction))}],result:{finalForActivity:true,qualityScore:100,finalScore:100}},activity.id);
 const proposal=org.proposePosition(hr,{employeeId:'e',jobTitle:'سمت جدید',jobFamily:'اداری',jobLevel:'کارشناس',unitId:'v',unitName:'v',managerId:'n',duties:'تهیه گزارش جدید',hasProjects:false,baseSalary:60000000,transferDate:'2025-11-01'});
 org.reviewPosition(w.user('n'),proposal.id,{decision:'approve'});
 const ready=org.positionCloseoutPreview(hr,proposal.id);assert.equal(ready.ready,true);
 for(const status of ['queued','running']){
  store.put('review',{id:'pending-review',status,activitySnapshot:activity},activity.id);
  const pending=org.positionCloseoutPreview(hr,proposal.id);assert.equal(pending.ready,false);assert.ok(pending.blockers.some(b=>b.includes('بررسی شاخص')));
  assert.throws(()=>org.approvePosition(hr,proposal.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:ready.fingerprint}),{status:409});
  assert.equal(store.list('position-closeout').length,0);assert.equal(store.get('p','position-assignment').effectiveTo,null);
 }
 store.put('review',{id:'pending-review',status:'failed',activitySnapshot:activity},activity.id);
 assert.equal(org.positionCloseoutPreview(hr,proposal.id).ready,true);
});
test('five quarterly submissions unlock personnel → manager → admin without altering AI results',t=>{
 const {store,w,hr,manager}=fixture(t,{routine:true}),a=store.put('activity',{id:'task',kind:'routine',title:'گزارش فصل',description:'شرح',criteria:[{id:'C1',text:'خروجی'}],period:q,ownerId:'e',unitId:'u',positionId:'p',assignmentStatus:'approved',kpiWeight:100});
 for(let i=0;i<5;i++)store.put('review',{status:'done',activitySnapshot:a,actorId:'e',submissionKey:'delivery-'+i,documentHashes:[{id:'d'+i,sha256:'hash'+i}],finishedAt:'2025-12-01T12:00:00Z',result:{decision:'insufficient',qualityScore:null,finalForActivity:false,coverage:{incomplete:false}}},a.id);
 assert.equal(submissionQuota(store,a).used,5);const reviews=structuredClone(store.list('review')),human=createActivityHumanReview(store,w);
 assert.equal(human.state(w.user('e'),a).canSubmit,true);let row=human.submit(w.user('e'),a.id,{explanation:'توضیحات نهایی برای بررسی'});
 assert.throws(()=>human.decide(hr,a.id,{requestId:row.id,revision:row.revision,decision:'approve',reason:'بررسی شده است'}),{status:403});
 row=human.decide(manager,a.id,{requestId:row.id,revision:row.revision,decision:'approve',qualityScore:90,reason:'بررسی مستندات تکمیل شد'});assert.equal(activityHumanFinal(store,a),null);
 human.decide(hr,a.id,{requestId:row.id,revision:row.revision,decision:'approve',reason:'تصویب نتیجه بررسی مدیر'});assert.equal(activityHumanFinal(store,a).result.finalScore,90);assert.equal(w.snapshotForSystem('e',q).assignments[0].score,90);assert.deepEqual(store.list('review'),reviews);
 store.put('quarter-evaluation',{employeeId:'e',quarter:q,status:'locked'},'e');assert.match(human.state(w.user('e'),a).blockedReason,/قفل/);
});
test('quarterly peer survey accepts three independent respondents and respects the quarter lock',t=>{
 const {store,w,org,hr}=fixture(t),period=w.currentPeriod;
 store.put('workflow-policy',{id:'active-policy',version:'peer-test',weights:{exam:0,manager:0,routine:0,project:0,peer:100}});
 for(let i=0;i<3;i++){const id='peer'+i;store.put('workflow-user',{id,name:id,role:'personnel',unitId:'v',managerId:'n',isKpiEligible:true,baseSalary:60000000});store.put('position-assignment',{id:'position-'+id,employeeId:id,status:'published',unitId:'v',managerId:'n',isKpiEligible:true,baseSalary:60000000,effectiveFrom:periodBounds(period).start,version:1},id);}
 const draft=org.createServiceCampaign(hr,{employeeId:'e',period,question:'کیفیت خروجی فصل چگونه بود؟'});assert.equal(draft.period,period);org.publishServiceCampaign(hr,draft.id);
 org.submitServiceResponse(w.user('peer0'),draft.id,{score:80});org.submitServiceResponse(w.user('peer1'),draft.id,{score:90});assert.equal(store.list('service-survey-aggregate','e').length,0);org.submitServiceResponse(w.user('peer2'),draft.id,{score:100});assert.equal(store.list('service-survey-aggregate','e').length,0);org.closeServiceCampaign(hr,draft.id);assert.equal(w.snapshotForSystem('e',period).components.find(c=>c.id==='peer').score,90);
 store.put('quarter-evaluation',{employeeId:'e',quarter:period,status:'locked'},'e');assert.throws(()=>org.removeServiceCampaign(hr,draft.id),{status:409});assert.equal(store.list('service-survey-aggregate','e').length,1);
});

test('incomplete settlement is rejected atomically, leaving scores open for completion',t=>{
 const {store,w,org,hr,manager}=fixture(t),positions=structuredClone(store.list('position-assignment')),audit=store.list('audit-event').length;
 const input={employeeId:'e',settlementDate:'2025-11-01'};
 assert.throws(()=>org.registerSettlement(manager,input),{status:403});
 assert.throws(()=>org.registerSettlement(hr,input),{status:409});
 assert.equal(store.list('personnel-settlement').length,0);assert.equal(store.list('audit-event').length,audit);assert.deepEqual(store.list('position-assignment'),positions);assert.notEqual(w.user('e').isSettled,true);
 w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});
 assert.throws(()=>org.registerSettlement(hr,input),{status:409});
 w.saveSurvey(manager,{employeeId:'e',period:q,score:100});
 assert.equal(w.snapshotForSystem('e',q).complete,true);
});

test('settlement also requires earlier unclosed quarters and zero-weight assigned tasks to be complete',t=>{
 const {store,w,org,hr,manager}=fixture(t),input={employeeId:'e',settlementDate:'2025-11-01'};
 store.put('position-assignment',{...store.get('p','position-assignment'),effectiveFrom:periodBounds('1404-Q2').start},'e');
 w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});w.saveSurvey(manager,{employeeId:'e',period:q,score:100});
 assert.throws(()=>org.registerSettlement(hr,input),/1404-Q2/);
 w.recordExamResult({employeeId:'e',period:'1404-Q2',score:0,reference:'prior-exam'});w.saveSurvey(manager,{employeeId:'e',period:'1404-Q2',score:0});
 const activity=store.put('activity',{ownerId:'e',positionId:'p',period:q,assignmentStatus:'approved',kind:'routine',title:'Synthetic ungraded task'},'e');
 assert.equal(w.snapshotForSystem('e',q).complete,true);assert.throws(()=>org.registerSettlement(hr,input),/شاخص‌ها/);
 assert.equal(store.list('personnel-settlement').length,0);assert.ok(store.get(activity.id,'activity'));
});

const completeScores=({w,manager})=>{w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});w.saveSurvey(manager,{employeeId:'e',period:q,score:100});};
function settle(f,settlementDate='2025-11-01'){
 const input={employeeId:'e',settlementDate},preview=f.org.settlementPreview(f.hr,input);assert.equal(preview.ready,true,preview.blockers.join('\n'));
 return f.org.registerSettlement(f.hr,{...input,closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});
}
test('settlement includes its last day, freezes exact amounts and remains in quarter approval and export',t=>{
 const f=fixture(t),{store,w,org,hr,manager}=f;completeScores(f);
 const saved=settle(f);assert.equal(saved.assessmentEnd,'2025-11-02');assert.equal(saved.earned,16000000);assert.equal(saved.baseSalary,80000000);
 const result=w.snapshotForSystem('e',q),frozen=structuredClone(store.list('position-closeout'));
 assert.equal(result.segments.length,1);assert.equal(result.segments[0].days,40);assert.equal(result.earned,16000000);assert.equal(w.user('e').isSettled,true);
 for(const actor of [hr,manager])assert.ok(org.quarterTeam(actor,q).some(r=>r.employee.id==='e'));
 assert.equal(org.quarterTeam(manager,q)[0].quarterPay.earned,undefined);
 assert.throws(()=>org.settlementPreview(manager,{employeeId:'e',settlementDate:'2025-11-01'}),{status:403});
 assert.throws(()=>w.saveSurvey(manager,{employeeId:'e',period:q,score:0}),{status:409});
 assert.throws(()=>org.proposePosition(hr,{employeeId:'e'}),{status:409});
 const sent=org.submitQuarter(manager,q,'e'),locked=org.approveQuarter(hr,sent.id,{decision:'approve'});
 assert.equal(locked.lockedSnapshot.quarterPay.earned,16000000);assert.ok(org.finalExcel(hr,q).data.length);
 const auditCount=store.list('audit-event').length;assert.equal(org.registerSettlement(hr,{employeeId:'e',settlementDate:'2025-11-01'}).id,saved.id);assert.equal(store.list('audit-event').length,auditCount);
 assert.throws(()=>org.registerSettlement(hr,{employeeId:'e',settlementDate:'2025-11-02'}),{status:409});
 store.put('workflow-policy',{id:'active-policy',version:'later-policy',weights:{exam:100,manager:0,routine:0,project:0,peer:0}});
 assert.deepEqual(store.list('position-closeout'),frozen);assert.equal(w.snapshotForSystem('e',q).earned,16000000);
 const future=w.snapshotForSystem('e','1404-Q4');assert.equal(future.notApplicable,true);assert.equal(future.earned,0);assert.equal(future.baseSalary,0);assert.equal(org.quarterTeam(hr,'1404-Q4').length,0);
 assert.equal(createWorkflow(store).snapshotForSystem('e',q).earned,16000000);
});

test('settlement after a transfer preserves both slices, uses the final manager and does not count the old payout twice',t=>{
 const f=fixture(t),{store,w,org,hr}=f;completeScores(f);
 const proposal=org.proposePosition(hr,{employeeId:'e',jobTitle:'سمت جدید',jobFamily:'اداری',jobLevel:'کارشناس',unitId:'v',unitName:'v',managerId:'n',duties:'تهیه گزارش جدید',hasProjects:false,baseSalary:60000000,transferDate:'2025-11-01'});
 org.reviewPosition(w.user('n'),proposal.id,{decision:'approve'});const preview=org.positionCloseoutPreview(hr,proposal.id);org.approvePosition(hr,proposal.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});
 const before=structuredClone(store.list('position-closeout')[0]);w.saveSurvey(w.user('n'),{employeeId:'e',period:q,score:0});
 const saved=settle(f,'2025-12-01'),snapshot=w.snapshotForSystem('e',q);
 assert.equal(saved.earned,6200000);assert.equal(snapshot.earned,21800000);assert.equal(snapshot.segments.length,2);assert.equal(snapshot.segments[0].end,snapshot.segments[1].start);assert.equal(snapshot.segments[1].end,'2025-12-02');
 assert.deepEqual(store.get(before.id,'position-closeout'),before);assert.equal(w.user('e').unitId,'v');
 assert.equal(org.quarterTeam(w.user('n'),q).length,1);assert.equal(org.quarterTeam(w.user('m'),q).length,0);
 assert.equal(org.submitQuarter(w.user('n'),q,'e').status,'hr_review');
});

test('settlement rejects a stale preview and rolls all financial locks back on a write failure',t=>{
 const f=fixture(t),{store,w,org,hr,manager}=f;completeScores(f);
 const input={employeeId:'e',settlementDate:'2025-11-01'},preview=org.settlementPreview(hr,input);
 assert.throws(()=>org.registerSettlement(hr,input),{status:409});
 w.saveSurvey(manager,{employeeId:'e',period:q,score:80});
 assert.throws(()=>org.registerSettlement(hr,{...input,closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint}),{status:409});
 assert.equal(store.list('position-closeout').length,0);
 const positions=structuredClone(store.list('position-assignment')),events=structuredClone(store.list('audit-event')),originalPut=store.put;
 store.put=(kind,...args)=>{if(kind==='personnel-settlement')throw Error('Synthetic storage failure');return originalPut(kind,...args);};
 try{assert.throws(()=>settle(f),/Synthetic storage failure/);}finally{store.put=originalPut;}
 assert.equal(store.list('position-closeout').length,0);assert.equal(store.list('personnel-settlement').length,0);assert.deepEqual(store.list('position-assignment'),positions);assert.deepEqual(store.list('audit-event'),events);
});

test('settlement rejects future dates, pending work and retroactive changes to a locked quarter',t=>{
 const f=fixture(t),{store,w,org,hr,manager}=f;completeScores(f);
 assert.equal(org.settlementPreview(hr,{employeeId:'e',settlementDate:'2099-01-01'}).ready,false);
 const activity=store.put('activity',{ownerId:'e',positionId:'p',period:q,assignmentStatus:'approved',kind:'routine',title:'Synthetic task'},'e');
 store.put('review',{id:'pending',activitySnapshot:activity,status:'queued'},activity.id);
 let plan=org.settlementPreview(hr,{employeeId:'e',settlementDate:'2025-11-01'});assert.ok(plan.blockers.some(s=>s.includes('بررسی AI')));
 store.remove('pending','review',activity.id);store.remove(activity.id,'activity','e');
 const sent=org.submitQuarter(manager,q,'e'),locked=org.approveQuarter(hr,sent.id,{decision:'approve'});
 plan=org.settlementPreview(hr,{employeeId:'e',settlementDate:'2025-11-01'});assert.equal(plan.ready,false);assert.ok(plan.blockers.some(s=>s.includes('فصل نهایی')));
 const quarterEnd=new Date(Date.parse(periodBounds(q).end+'T00:00:00Z')-86400000).toISOString().slice(0,10),saved=settle(f,quarterEnd);
 assert.equal(w.snapshotForSystem('e',q).finalSalary,w.snapshotForSystem('e',q).knownTotal);assert.equal(saved.earned,0);assert.equal(JSON.stringify(store.get(locked.id,'quarter-evaluation')),JSON.stringify(locked));assert.equal(org.quarterTeam(hr,q)[0].quarterPay.earned,36000000);
});

test('quarterly settlement preview and registration work through HTTP using only the temporary database',async t=>{
 const f=fixture(t);completeScores(f);const server=createPanelServer({root:process.cwd(),dataRoot:f.root,demoLogin:false,autoAssessment:false,runModel:roleReply});f.servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`,session=await (await fetch(base+'/api/session')).json(),input={employeeId:'e',settlementDate:'2025-11-01'};
 const post=async(path,data)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-panel-token':session.token},body:JSON.stringify(data)});return {status:response.status,data:await response.json()};};
 const preview=await post('/api/org/settlements/preview',input);assert.equal(preview.status,200);assert.equal(preview.data.ready,true);assert.equal(f.store.list('personnel-settlement').length,0);
 const saved=await post('/api/org/settlements',{...input,closeoutAcknowledgment:true,closeoutFingerprint:preview.data.fingerprint});assert.equal(saved.status,201);assert.equal(saved.data.earned,16000000);assert.equal(f.store.list('personnel-settlement').length,1);
});

test('settlement on the first day, month end and quarter end includes exactly those eligible days',async t=>{
 const bounds=periodBounds(q);
 for(const [date,days] of [[bounds.start,1],['2025-10-22',30],['2025-12-21',90]])await t.test(date,child=>{
  const f=fixture(child);completeScores(f);const saved=settle(f,date),result=f.w.snapshotForSystem('e',q);
  assert.equal(result.segments[0].days,days);assert.equal(saved.earned,days*400000);assert.equal(saved.baseSalary,days*2000000);
  assert.equal(f.w.snapshotForSystem('e','1404-Q4').baseSalary,0);
 });
});

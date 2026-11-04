import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,periodBounds} from '../backend/quarterly-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createPanelServer} from '../server.mjs';
import {roleReply} from './ai-role-fixture.mjs';
import {createActivityHumanReview,activityHumanFinal} from '../backend/activity-human-review.mjs';
import {submissionQuota} from '../backend/score-rules.mjs';
const q='1404-Q3';
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
test('transfer closes the old quarter slice only after scores and keeps new scores independent',t=>{
 const {store,w,org,hr,manager}=fixture(t),cutoff='2025-11-01';
 const proposal=org.proposePosition(hr,{employeeId:'e',jobTitle:'سمت جدید',jobFamily:'اداری',jobLevel:'کارشناس',unitId:'v',unitName:'v',managerId:'n',duties:'تهیه گزارش جدید',hasProjects:false,baseSalary:90000000,transferDate:cutoff});org.reviewPosition(w.user('n'),proposal.id,{decision:'approve'});
 assert.equal(org.positionCloseoutPreview(hr,proposal.id).ready,false);w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});w.saveSurvey(manager,{employeeId:'e',period:q,score:100});
 const preview=org.positionCloseoutPreview(hr,proposal.id);assert.equal(preview.ready,true,preview.blockers.join('\n'));
 const next=org.approvePosition(hr,proposal.id,{decision:'approve',closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});const frozen=structuredClone(store.list('position-closeout')[0]);
 assert.equal(w.snapshotForPosition('e',q,next.id).components.find(c=>c.id==='manager').score,null);w.saveSurvey(w.user('n'),{employeeId:'e',period:q,score:0});
 const combined=w.snapshotForSystem('e',q);assert.equal(combined.segments.length,2);assert.equal(combined.segments[0].end,combined.segments[1].start);assert.equal(combined.segments[0].performance,100);assert.equal(combined.segments[1].performance,50);assert.equal(combined.earned,combined.segments.reduce((n,s)=>n+s.earned,0));assert.deepEqual(store.list('position-closeout')[0],frozen);
 assert.equal(org.quarterResult(hr,q,'e').canFinalize,true);assert.throws(()=>w.saveSurvey(manager,{employeeId:'e',period:q,score:50}),{status:403});
});
test('HTTP server uses quarterly workflow and an independent cookie with no demo seeding',async t=>{
 const f=fixture(t),server=createPanelServer({root:process.cwd(),dataRoot:f.root,demoLogin:false,autoAssessment:false,runModel:roleReply});f.servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`,res=await fetch(base+'/api/session'),s=await res.json();assert.equal(s.period.includes('-Q'),true);assert.match(res.headers.get('set-cookie'),/^quarterly-panel-session=/);assert.equal(s.accounts.length,4);
 const get=async path=>{const r=await fetch(base+path,{headers:{'x-panel-token':s.token}});return {status:r.status,data:await r.json()};};
 assert.equal((await get('/api/org/quarters/'+q)).status,200);assert.equal((await get('/api/org/evaluation-models?period='+q)).status,200);assert.equal((await get('/api/org/evaluation-models?period=1404-07')).status,400);assert.equal(f.store.list('activity').length,0);
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
 org.submitServiceResponse(w.user('peer0'),draft.id,{score:80});org.submitServiceResponse(w.user('peer1'),draft.id,{score:90});assert.equal(store.list('service-survey-aggregate','e').length,0);org.submitServiceResponse(w.user('peer2'),draft.id,{score:100});assert.equal(w.snapshotForSystem('e',period).components.find(c=>c.id==='peer').score,90);
 store.put('quarter-evaluation',{employeeId:'e',quarter:period,status:'locked'},'e');assert.throws(()=>org.removeServiceCampaign(hr,draft.id),{status:409});assert.equal(store.list('service-survey-aggregate','e').length,1);
});

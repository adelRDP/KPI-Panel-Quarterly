import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {defaultScoreRules} from '../backend/score-rules.mjs';
import {seedPeerUnitModel} from './unit-model-fixture.mjs';

function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,parent TEXT,value TEXT)');t.after(()=>db.close());
 const store={get:(id,k)=>{const r=db.prepare('SELECT value FROM records WHERE id=? AND kind=?').get(id,k);return r?JSON.parse(r.value):null;},list:(k,p)=>(p===undefined?db.prepare('SELECT value FROM records WHERE kind=? ORDER BY rowid DESC').all(k):db.prepare('SELECT value FROM records WHERE kind=? AND parent=? ORDER BY rowid DESC').all(k,p)).map(r=>JSON.parse(r.value)),put:(k,v,p=null)=>{v={...v,id:v.id||randomUUID()};db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?)').run(v.id,k,p,JSON.stringify(v));return v;},transaction:fn=>{db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{runModel:async()=>{throw Error('No real model in regression tests');}});
 return {store,workflow,org,owner:workflow.user('employee-mohammad'),manager:workflow.user('manager-ops'),hr:workflow.user('hr-demo')};
}
function lockedAppeal(f){
 const evaluation=f.store.put('quarter-evaluation',{employeeId:f.owner.id,quarter:'1405-Q2',status:'locked',lockedAt:new Date().toISOString(),lockedSnapshot:{unchanged:true},scoreRulesSnapshot:{version:'test-only',values:{...defaultScoreRules,quarterAppealCount:1,appealRepeat:'closed_only'}}},f.owner.id);
 return {evaluation,appeal:f.org.submitAppeal(f.owner,{quarter:'1405-Q2',reason:'توضیحات اولیه'})};
}
for(const returnedBy of ['manager','hr'])test(`returned appeal resubmits after ${returnedBy} return without consuming allowance or changing locked result`,t=>{
 const f=fixture(t),{evaluation,appeal}=lockedAppeal(f),original=JSON.stringify(f.store.get(evaluation.id,'quarter-evaluation'));
 if(returnedBy==='hr')f.org.reviewAppeal(f.manager,appeal.id,{decision:'approve'});
 f.org.reviewAppeal(f[returnedBy],appeal.id,{decision:'return',reason:'تکمیل مستند لازم است'});
 const revised=f.org.resubmitAppeal(f.owner,appeal.id,{reason:'توضیحات اصلاح‌شده'});
 assert.equal(revised.id,appeal.id);assert.equal(revised.status,'manager_review');assert.equal(revised.revision,1);assert.equal(revised.managerReview,undefined);assert.equal(revised.hrReview,undefined);assert.equal(revised.events.at(-1).previousReason,'توضیحات اولیه');
 assert.equal(f.store.list('quarter-appeal',f.owner.id).length,1);assert.throws(()=>f.org.resubmitAppeal(f.owner,appeal.id,{reason:'ارسال تکراری'}),e=>e.status===409);
 f.org.reviewAppeal(f.manager,appeal.id,{decision:'approve'});assert.equal(f.org.reviewAppeal(f.hr,appeal.id,{decision:'approve'}).status,'approved');assert.equal(JSON.stringify(f.store.get(evaluation.id,'quarter-evaluation')),original);
});
test('peer survey cannot publish a single vote or two votes even at 30 percent participation',t=>{
 const f=fixture(t);seedPeerUnitModel(f.store);
 for(const p of f.store.list('workflow-user'))if(!['manager-ops','employee-mohammad','employee-sara','employee-service-1'].includes(p.id)&&p.role!=='hr')f.store.put('workflow-user',{...p,role:'hr'});
 const campaign=f.org.createServiceCampaign(f.hr,{employeeId:'employee-service-1',period:f.workflow.currentPeriod,minParticipation:30});assert.equal(campaign.population,3);f.org.publishServiceCampaign(f.hr,campaign.id);
 let r=f.org.submitServiceResponse(f.manager,campaign.id,{score:90});assert.equal(r.required,3);assert.equal(r.published,false);assert.equal(f.store.list('service-survey-aggregate','employee-service-1').length,0);
 r=f.org.submitServiceResponse(f.owner,campaign.id,{score:60});assert.equal(r.published,false);
 r=f.org.submitServiceResponse(f.workflow.user('employee-sara'),campaign.id,{score:75});assert.equal(r.published,true);assert.equal(r.aggregate,75);assert.equal(f.org.serviceCampaigns(f.hr)[0].requiredCount,3);
});
test('closing an under-threshold peer survey never publishes an aggregate; historical results stay untouched',t=>{
 const f=fixture(t);seedPeerUnitModel(f.store);const c=f.org.createServiceCampaign(f.hr,{employeeId:'employee-service-1',period:f.workflow.currentPeriod,minParticipation:30});f.org.publishServiceCampaign(f.hr,c.id);f.org.submitServiceResponse(f.manager,c.id,{score:90});
 const closed=f.org.closeServiceCampaign(f.hr,c.id);assert.equal(closed.status,'insufficient');assert.equal(closed.aggregate,null);
 const old=f.store.put('service-survey-campaign',{employeeId:'employee-service-1',period:f.workflow.currentPeriod,status:'completed',population:3,minParticipation:.3,aggregate:90,responseCount:1});assert.equal(f.org.serviceCampaigns(f.hr).find(r=>r.id===old.id).requiredCount,1);assert.equal(f.store.get(old.id,'service-survey-campaign').aggregate,90);
});
test('appeal correction rejects other identities, invalid input and terminal states while keeping attachments',t=>{
 const f=fixture(t),{appeal}=lockedAppeal(f);f.org.reviewAppeal(f.manager,appeal.id,{decision:'return',reason:'تکمیل'});
 const file=f.org.addAppealFile(f.owner,appeal.id,{id:randomUUID(),name:'synthetic.txt',size:5,sha256:'a'.repeat(64)});
 for(const actor of [f.manager,f.hr,f.workflow.user('employee-sara')])assert.throws(()=>f.org.resubmitAppeal(actor,appeal.id,{reason:'اصلاح'}),e=>e.status===403);
 assert.throws(()=>f.org.resubmitAppeal(f.owner,appeal.id,{reason:''}));assert.throws(()=>f.org.resubmitAppeal(f.owner,appeal.id,{reason:'x'.repeat(2001)}));
 f.org.resubmitAppeal(f.owner,appeal.id,{reason:'تکمیل شد'});assert.equal(f.org.listAppeals(f.owner)[0].files[0].id,file.id);
 f.org.reviewAppeal(f.manager,appeal.id,{decision:'reject',reason:'رد نهایی'});assert.throws(()=>f.org.resubmitAppeal(f.owner,appeal.id,{reason:'اصلاح'}),e=>e.status===409);
});

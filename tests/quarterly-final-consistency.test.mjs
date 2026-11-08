import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFixture} from './quarterly-audit-fixture.mjs';
import {createEvaluationSettings} from '../backend/evaluation-settings.mjs';
test('every finalized-quarter display retains its frozen money and scores after a model withdrawal',async t=>{
 const f=await auditFixture(t),{store,workflow:w,org,q,hr,manager,employee}=f;
 store.put('evaluation-settings',{id:'evaluation-policy-v1',version:'evaluation-policy-v1',status:'published',effectiveQuarter:q,unitId:null,weights:{exam:50,manager:50,routine:0,project:0,peer:0}});
 w.recordExamResult({employeeId:'e',period:q,score:100,reference:'exam'});w.saveSurvey(manager,{employeeId:'e',period:q,score:90});const sent=org.submitQuarter(manager,q,'e'),lock=org.approveQuarter(hr,sent.id,{decision:'approve'}),before=JSON.stringify(lock);
 createEvaluationSettings(store).deletePublished(hr,'evaluation-policy-v1');
 for(const legacy of [false,true]){
  if(legacy){const row=structuredClone(lock);delete row.lockedSnapshot.sourceSnapshot;store.put('quarter-evaluation',row,'e');}
  const official=org.quarterTeam(employee,q)[0],dashboard=w.snapshot(employee,'e',q),summary=org.quarterProgress(employee,q,q),direct=org.quarterResult(employee,q,'e');
  assert.equal(official.calculation.performance,95);assert.equal(dashboard.performance,95);assert.equal(summary.performance,95);assert.equal(summary.earned,34200000);assert.equal(direct.quarterPay.earned,34200000);assert.equal(dashboard.finalSalary,214200000);assert.equal(direct.canFinalize,false);
  const safe=org.quarterResult(manager,q,'e');assert.equal(safe.sourceSnapshot,undefined);assert.equal(safe.quarterPay.earned,undefined);assert.equal(w.snapshot(manager,'e',q).earned,undefined);
 }
 store.put('quarter-evaluation',lock,'e');assert.equal(JSON.stringify(store.get(lock.id,'quarter-evaluation')),before);assert.throws(()=>org.quarterResult(w.user('n'),q,'e'),{status:403});
});

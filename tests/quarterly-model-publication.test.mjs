import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFixture} from './quarterly-audit-fixture.mjs';
import {currentPeriod} from '../backend/quarterly-workflow.mjs';
import {createEvaluationSettings} from '../backend/evaluation-settings.mjs';
test('model publication requires a preview of exactly the revision and current policy baseline',async t=>{
 const f=await auditFixture(t,currentPeriod()),s=createEvaluationSettings(f.store),values={effectiveQuarter:f.q,weights:{exam:100,manager:0,routine:0,project:0,peer:0}},a=s.saveDraft(f.hr,values);
 assert.throws(()=>s.publish(f.hr,{id:a.id,revision:a.revision}),{status:409});const proof=s.preview(f.hr,a);
 assert.throws(()=>s.saveDraft(f.hr,values),{status:409});const b=s.saveDraft(f.hr,{...values,id:a.id,revision:a.revision,weights:{...values.weights,exam:0,manager:100}});
 assert.throws(()=>s.publish(f.hr,proof),{status:409});assert.throws(()=>s.preview(f.hr,a),{status:409});const fresh=s.preview(f.hr,b);
 f.store.put('workflow-policy',{id:'active-policy',version:'changed',weights:values.weights});assert.throws(()=>s.publish(f.hr,fresh),{status:409});
 const current=s.preview(f.hr,b),published=s.publish(f.hr,current);assert.equal(published.weights.manager,100);assert.equal(published.sourceRevision,2);assert.equal(f.store.list('evaluation-settings').filter(r=>r.status==='published').length,1);assert.throws(()=>s.publish(f.hr,current));
 assert.throws(()=>s.saveDraft(f.employee,values),{status:403});
});

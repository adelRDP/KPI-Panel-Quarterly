import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFixture} from './quarterly-audit-fixture.mjs';
import {createExamCorrections} from '../backend/exam-corrections.mjs';
test('admin corrects an open exam with immutable history; stale, unauthorized and closed corrections fail',async t=>{
 const f=await auditFixture(t),c=createExamCorrections(f.store,f.workflow,{audit:f.org.audit}),old=f.workflow.recordExamResult({employeeId:'e',period:f.q,score:10,reference:'original'}),input={revision:1,score:90,reason:'اصلاح مستند نمرهٔ اشتباه'};
 assert.throws(()=>c.correct(f.manager,old.id,input),{status:403});const row=c.correct(f.hr,old.id,input);assert.equal(row.score,90);assert.equal(row.revision,2);assert.equal(row.reference,'original');assert.equal(f.store.list('exam-result-revision',old.id)[0].before.score,10);assert.equal(f.workflow.snapshotForSystem('e',f.q).performance,90);assert.throws(()=>c.correct(f.hr,old.id,input),{status:409});
 const sent=f.org.submitQuarter(f.manager,f.q,'e');f.org.approveQuarter(f.hr,sent.id,{decision:'approve'});assert.ok(c.list(f.hr,f.q)[0].blocked);assert.throws(()=>c.correct(f.hr,old.id,{...input,revision:2,score:95}),{status:409});assert.equal(f.store.list('exam-result-revision').length,1);
});

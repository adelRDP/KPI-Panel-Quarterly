import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,periodBounds} from '../backend/personnel-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {planDemoDuties,applyDemoDuties} from '../scripts/apply-demo-duties.mjs';

async function fixture(t){
  const path=await mkdtemp(join(tmpdir(),'kpi-demo-duties-')),store=openStore(path),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow);
  const people=store.list('workflow-user').filter(p=>p.role==='personnel');
  const rows=[['کد پرسنلی','نام و نام خانوادگی','سمت فعلی','واحد','مافوق مستقیم','شرح وظایف پیشنهادی','شناسه فرد در پنل','نسخه مبنای سمت'],...people.map(p=>{const pos=org.activePosition(p.id);return [p.employeeCode,p.name,pos.jobTitle,pos.unitName,workflow.user(pos.managerId).name,'تهیه گزارش کارهای منتسب و ثبت خروجی قابل ردیابی برای مدیر مستقیم.\nپیگیری کارهای منتسب در موعد مصوب و اعلام موانع خارج از اختیار.',p.id,pos.version];})];
  const effectiveFrom=periodBounds(workflow.currentPeriod).start;store.close();const db=new DatabaseSync(join(path,'panel.sqlite'));
  t.after(async()=>{db.close();await rm(path,{recursive:true,force:true});});return {db,input:{rows,sourceHash:'a'.repeat(64),effectiveFrom}};
}
const snapshot=db=>db.prepare('SELECT * FROM records ORDER BY id').all();
test('local demo import preserves identities, money, past duties and non-position records and is idempotent',async t=>{
  const {db,input}=await fixture(t),before=snapshot(db),plan=planDemoDuties(db,input);assert.equal(plan.changes.length,15);assert.deepEqual(snapshot(db),before);
  const result=applyDemoDuties(db,input);assert.equal(result.updated,15);
  const after=snapshot(db);for(const previous of before){const next=after.find(r=>r.id===previous.id);if(previous.kind!=='position-assignment'){assert.deepEqual(next,previous);continue;}const old=JSON.parse(previous.value),updated=JSON.parse(next.value);assert.equal(updated.duties,old.duties);assert.equal(updated.version,old.version);assert.equal(updated.baseSalary,old.baseSalary);if(old.employeeId.startsWith('employee-'))assert.equal(updated.effectiveTo,input.effectiveFrom);else assert.deepEqual(next,previous);}
  const fresh=after.filter(r=>r.kind==='position-assignment'&&!before.some(p=>p.id===r.id)).map(r=>JSON.parse(r.value));assert.equal(fresh.length,15);for(const pos of fresh){assert.equal(pos.version,2);assert.equal(pos.effectiveFrom,input.effectiveFrom);assert.equal(pos.status,'published');assert.equal(pos.managerReview,undefined);assert.equal(pos.hrReview,undefined);assert.equal(pos.testDataSource.notOrganizationalApproval,true);assert.equal(pos.duties,input.rows.find(row=>row[6]===pos.employeeId)[5]);}
  const repeated=applyDemoDuties(db,input);assert.equal(repeated.alreadyApplied,true);assert.deepEqual(snapshot(db),after);
});
test('every row validates before writes: stale, duplicate, wrong identity, incomplete, blank, locked and running inputs are rejected',async t=>{
  for(const scenario of ['stale','duplicate','identity','incomplete','blank','lock','running']){
    const {db,input}=await fixture(t);if(scenario==='stale')input.rows[1][7]=99;if(scenario==='duplicate')input.rows[2][6]=input.rows[1][6];if(scenario==='identity')input.rows[1][0]='999999';if(scenario==='incomplete')input.rows.pop();if(scenario==='blank')input.rows[1][5]='';
    if(scenario==='lock'||scenario==='running'){const row=scenario==='lock'?{id:'guard',employeeId:input.rows[1][6],status:'locked'}:{id:'guard',status:'running'};db.prepare('INSERT INTO records VALUES (?,?,?,?)').run(row.id,scenario==='lock'?'quarter-evaluation':'ai-role-run',null,JSON.stringify(row));}
    const before=snapshot(db);assert.throws(()=>applyDemoDuties(db,input));assert.deepEqual(snapshot(db),before);
  }
});

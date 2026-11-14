import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/quarterly-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'quarterly-personnel-fields-'));seedQuarterlyFixture(root);
 const store=openStore(root),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow);
 t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 return {store,workflow,org,admin:workflow.user('admin')};
}
test('new mobile numbers are optional or exactly eleven digits and Persian/Arabic digits normalize on the server',async t=>{
 const {store,org,admin}=await fixture(t);
 const input={role:'personnel',name:'پرسنل آزمایشی',unitId:'u',unitName:'واحد آزمایشی u',jobTitle:'کارشناس آزمایش',jobLevel:'کارشناس',jobFamily:'اداری',managerId:'manager',baseSalary:60000000,duties:'تهیه گزارش قابل بررسی',effectiveFrom:'2026-11-14'};
 const count=store.list('workflow-user').length;
 for(const phone of ['123456','091234567890','0912345678','09abcdefgh1','+989123456789'])assert.throws(()=>org.createPerson(admin,{...input,phone}),/۱۱ رقم/);
 assert.equal(store.list('workflow-user').length,count);
 const persian=org.createPerson(admin,{...input,phone:'۰۹۱۲۳۴۵۶۷۸۹',employeeCode:'phone-fa'});
 assert.equal(store.get(persian.employee.id,'workflow-user').phone,'09123456789');
 const arabic=org.createPerson(admin,{...input,phone:'٠٩١٢٣٤٥٦٧٨٩',employeeCode:'phone-ar'});
 assert.equal(store.get(arabic.employee.id,'workflow-user').phone,'09123456789');
 assert.ok(org.createPerson(admin,{...input,phone:'',employeeCode:'phone-empty'}).employee.id);
});
test('same-name sections have one stable choice while legacy references remain valid and deletion checks every alias',async t=>{
 const {store,workflow,org,admin}=await fixture(t);
 store.put('org-section',{id:'a-support',unitId:'u',name:'پشتیبانی'});
 store.put('org-section',{id:'z-support',unitId:'u',name:'پشتیباني'});
 store.put('org-section',{id:'other-unit-support',unitId:'v',name:'پشتیبانی'});
 const person=store.get('employee-0','workflow-user');store.put('workflow-user',{...person,sectionId:'z-support',jobFamily:'پشتیبانی'});
 const position=store.get('position-employee-0','position-assignment');store.put('position-assignment',{...position,sectionId:'z-support',jobFamily:'پشتیبانی'},'employee-0');
 const sections=org.sections(admin),canonical=sections.find(s=>s.id==='a-support');
 assert.deepEqual(canonical.aliasIds,['z-support']);assert.equal(canonical.deletion.allowed,false);
 assert.equal(sections.filter(s=>s.unitId==='u'&&s.name==='پشتیبانی').length,1);
 assert.ok(sections.some(s=>s.id==='other-unit-support'));
 assert.throws(()=>org.createSection(admin,{unitId:'u',name:' پشتیبانی '}),e=>e.status===409);
 assert.throws(()=>org.removeSection(admin,'a-support'),e=>e.status===409);
 assert.equal(store.get('a-support','org-section').removedAt,undefined);
 assert.equal(workflow.user('employee-0').sectionId,'z-support');
 store.put('org-section',{id:'free-one',unitId:'u',name:'آزمایش خالی'});
 store.put('org-section',{id:'free-two',unitId:'u',name:'آزمایش خالی'});
 org.removeSection(admin,'free-two');
 assert.ok(store.get('free-one','org-section').removedAt);assert.ok(store.get('free-two','org-section').removedAt);
});

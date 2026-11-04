import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createRequire} from 'node:module';
import {openStore} from '../backend/store.mjs';import {createWorkflow} from '../backend/personnel-workflow.mjs';import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
const words=createRequire(import.meta.url)('../src/persian-money.js');
test('toman amount words handle integers, zero, Persian digits and reject incomplete or unsafe amounts',()=>{
 for(const [input,expected] of [['',''],[null,''],[0,'صفر تومان'],[1,'یک تومان'],[19,'نوزده تومان'],[21,'بیست و یک تومان'],[101,'صد و یک تومان'],[999,'نهصد و نود و نه تومان'],[1000,'یک هزار تومان'],[1000001,'یک میلیون و یک تومان'],[90000000,'نود میلیون تومان'],['۶۰۰۰۰۰۰۰','شصت میلیون تومان'],['۱۲۳۴۵۶۷۸۹','صد و بیست و سه میلیون و چهارصد و پنجاه و شش هزار و هفتصد و هشتاد و نه تومان'],['١٢','دوازده تومان'],[1000000000000,'یک تریلیون تومان']])assert.equal(words(input),expected);
 for(const input of [-1,'abc',1.5,'1e5','9007199254740992'])assert.equal(words(input),'مبلغ معتبر نیست');
 assert.ok(words(Number.MAX_SAFE_INTEGER).endsWith('تومان'));
});
test('new manager has no department, duties, salary or supervisor even with forged legacy fields; section IDs are server-generated',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kpi-onboarding-')),store=openStore(dir),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{aiDesignV2:true,runModel:async()=>{throw Error('Model forbidden');}});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const hr=workflow.user('hr-demo'),legacy=structuredClone(store.list('position-assignment','manager-ops'));
 org.createUnit(hr,{id:'manager-only-test',name:'واحد ساختگی مدیر'});
 const section=org.createSection(hr,{name:'بخش ساختگی',unitId:'manager-only-test'});assert.match(section.id,/^section-[\da-f-]{36}$/);assert.equal(section.unitId,'manager-only-test');
 assert.throws(()=>org.createSection(hr,{name:section.name,unitId:section.unitId}),e=>e.status===409);assert.throws(()=>org.createSection(workflow.user('manager-ops'),{name:'غیرمجاز',unitId:section.unitId}),e=>e.status===403);
 const created=org.createPerson(hr,{role:'manager',name:'مدیر ساختگی',employeeCode:'MANAGER-FAKE-001',jobTitle:'مدیر واحد ساختگی',jobLevel:'مدیر',unitId:section.unitId,unitName:'واحد ساختگی مدیر',effectiveFrom:'2020-01-01',sectionId:'invalid-section',jobFamily:'نباید ذخیره شود',baseSalary:'invalid',duties:'نباید ذخیره شود',managerId:'manager-ops',hasProjects:true});
 const person=store.get(created.employee.id,'workflow-user');for(const key of ['sectionId','jobFamily','baseSalary','bonusCeiling','managerId'])assert.equal(person[key],null);for(const key of ['sectionId','jobFamily','baseSalary','duties','managerId'])assert.equal(created.position[key],null);assert.equal(person.isKpiEligible,false);assert.equal(person.hasProjects,false);
 assert.throws(()=>org.updatePositionDuties(hr,created.position.id,{duties:'غیرمجاز',expectedVersion:1}),e=>e.status===409);assert.throws(()=>org.jobAnalysisState(hr,created.position.id),e=>e.status===409);assert.deepEqual(store.list('position-assignment','manager-ops'),legacy);
 assert.throws(()=>org.createPerson(hr,{role:'manager',name:'تکراری',jobTitle:'مدیر',jobLevel:'مدیر',unitId:section.unitId,unitName:'واحد ساختگی مدیر'}),e=>e.status===400);
 const staffInput={role:'personnel',name:'پرسنل ساختگی',jobTitle:'کارشناس',jobLevel:'کارشناس',managerId:person.id,unitId:section.unitId,unitName:'واحد ساختگی مدیر',sectionId:section.id,duties:'تهیه گزارش',effectiveFrom:'2020-01-01'};
 assert.throws(()=>org.createPerson(hr,staffInput),/حقوق پایه/);const staff=org.createPerson(hr,{...staffInput,baseSalary:60000000});assert.equal(staff.position.sectionId,section.id);assert.equal(staff.position.baseSalary,60000000);assert.equal(staff.position.duties,staffInput.duties);assert.equal(staff.position.status,'manager_review');
});

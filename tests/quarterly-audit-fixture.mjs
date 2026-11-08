import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createWorkflow,periodBounds} from '../backend/quarterly-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
export async function auditFixture(t,q='1404-Q3'){
 const root=await mkdtemp(join(tmpdir(),'kpi-remediation-')),store=openStore(root);
 t.after(async()=>{store.close();if(dirname(resolve(root))!==resolve(tmpdir())||!basename(root).startsWith('kpi-remediation-'))throw Error('Unexpected cleanup target');await rm(root,{recursive:true,force:true});});
 for(const id of ['u','v'])store.put('org-unit',{id,name:id});
 for(const p of [{id:'a',role:'hr',unitId:'u'},{id:'m',role:'manager',unitId:'u'},{id:'n',role:'manager',unitId:'v'},{id:'e',role:'personnel',unitId:'u',managerId:'m'}])store.put('workflow-user',{name:p.id,unitName:p.unitId,jobTitle:'گزارشگری',baseSalary:60000000,...p});
 store.put('position-assignment',{id:'p',employeeId:'e',status:'published',unitId:'u',unitName:'u',managerId:'m',baseSalary:60000000,isKpiEligible:true,isManager:false,hasProjects:false,jobTitle:'گزارشگری',jobFamily:'اداری',jobLevel:'کارشناس',duties:'تهیه گزارش و ثبت خروجی برای مدیر',effectiveFrom:periodBounds(q).start,effectiveTo:null,version:1,events:[]},'e');
 store.put('workflow-policy',{id:'active-policy',version:'test-base',weights:{exam:100,manager:0,routine:0,project:0,peer:0}});
 const workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{runModel:()=>{throw Error('No live model in remediation tests');}});
 return {root,store,workflow,org,q,hr:workflow.user('a'),manager:workflow.user('m'),employee:workflow.user('e')};
}

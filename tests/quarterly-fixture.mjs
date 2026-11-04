import {openStore} from '../backend/store.mjs';
import {currentPeriod,periodBounds} from '../backend/quarterly-workflow.mjs';
export function seedQuarterlyFixture(root){
 const s=openStore(root),period=currentPeriod(),start=periodBounds(period).start;
 for(const id of ['u','v'])s.put('org-unit',{id,name:'واحد آزمایشی '+id});
 const people=[{id:'admin',name:'ادمین آزمایشی',role:'hr',unitId:'u'},{id:'manager',name:'مدیر آزمایشی',role:'manager',unitId:'u'},{id:'other-manager',name:'مدیر دوم آزمایشی',role:'manager',unitId:'v'},...Array.from({length:5},(_,i)=>({id:'employee-'+i,name:'پرسنل آزمایشی '+i,role:'personnel',unitId:i<2?'u':'v',managerId:i<2?'manager':'other-manager'}))];
 for(const p of people){s.put('workflow-user',{...p,unitName:'واحد آزمایشی '+p.unitId,jobTitle:'گزارشگری',level:'کارشناس',baseSalary:60000000,hasProjects:false,isKpiEligible:p.role==='personnel'});if(p.role==='hr')continue;s.put('position-assignment',{id:'position-'+p.id,employeeId:p.id,status:'published',unitId:p.unitId,unitName:'واحد آزمایشی '+p.unitId,managerId:p.managerId||null,baseSalary:60000000,jobTitle:'گزارشگری',jobFamily:'اداری',jobLevel:'کارشناس',duties:'تهیه گزارش و ثبت خروجی قابل بررسی برای مدیر',isKpiEligible:p.role==='personnel',isManager:p.role==='manager',hasProjects:false,effectiveFrom:start,effectiveTo:null,version:1,events:[]},p.id);}
 s.close();return {period,people};
}

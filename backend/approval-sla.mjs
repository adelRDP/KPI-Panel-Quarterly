import {createHash} from 'node:crypto';
import {scoreRulesAt,addRuleDays,tehranDay} from './score-rules.mjs';
const stages={ 'position-assignment':['manager_review','hr_approval'],'kpi-design':['manager_review','hr_review'],'quarter-evaluation':['hr_review'],'quarter-appeal':['manager_review','hr_review'],'activity-human-review':['manager_review','hr_review'],'review-case':['manager_review','hr_review'] };
const entered=row=>row.events?.filter(e=>(e.state||e.status)===row.status).at(-1)?.at||row.managerReview?.at||row.createdAt||row.submittedAt;
export function createApprovalSla(store,workflow,notifications,{now=()=>new Date().toISOString()}={}){
 function observe(kind,id){const row=store.get(id,kind);if(!stages[kind]?.includes(row?.status))return;const startedAt=entered(row);if(!startedAt)return;
  const key='approval-sla-'+createHash('sha256').update(JSON.stringify([kind,id,row.status,startedAt])).digest('hex');if(store.get(key,'approval-deadline'))return;
  const employeeId=row.employeeId||row.ownerId||row.activitySnapshot?.ownerId,unitId=row.unitId||workflow.user(employeeId)?.unitId,rules=scoreRulesAt(store,{unitId,at:now()}),days=Number(rules.values.approvalSlaDays||7);
  store.put('approval-deadline',{id:key,entityType:kind,entityId:id,employeeId,unitId,stage:row.status,startedAt,dueDate:addRuleDays(tehranDay(startedAt),days,'business'),days,scoreRuleVersion:rules.version,state:'pending',createdAt:now()},employeeId||null);
 }
 function recipients(d,row){return d.stage==='manager_review'?[d.entityType==='position-assignment'?row.managerId:workflow.user(d.employeeId)?.managerId||row.managerId]:store.list('workflow-user').filter(p=>p.role==='hr').map(p=>p.id);}
 function scan(){for(const d of store.list('approval-deadline').filter(d=>d.state==='pending')){
   const row=store.get(d.entityId,d.entityType);if(!row||row.status!==d.stage||entered(row)!==d.startedAt){store.put('approval-deadline',{...d,state:'resolved',resolvedAt:now()},d.employeeId||null);continue;}
   if(tehranDay(now())<d.dueDate||d.escalatedAt)continue;
   store.transaction(()=>{notifications?.publish({eventKey:d.id,recipientIds:[...recipients(d,row),...store.list('workflow-user').filter(p=>p.role==='hr').map(p=>p.id)],kind:'action',title:'مهلت بررسی درخواست گذشته است',description:'درخواست نیازمند پیگیری است؛ هیچ تأیید یا تغییر امتیازی خودکار انجام نشده است.',view:'case-review',entityId:d.entityId});store.put('approval-deadline',{...d,escalatedAt:now()},d.employeeId||null);store.put('audit-event',{actorId:'system',action:'approval.sla-escalated',entityType:d.entityType,entityId:d.entityId,details:{days:d.days,dueDate:d.dueDate,stage:d.stage},createdAt:now()});});
  }}
 function list(actor){return store.list('approval-deadline').filter(d=>{const row=store.get(d.entityId,d.entityType);return row&&row.status===d.stage&&d.state==='pending'&&(actor?.role==='hr'||actor?.id===d.employeeId||actor?.role==='manager'&&recipients(d,row).includes(actor.id));}).map(d=>({...d,employeeName:workflow.user(d.employeeId)?.name||d.employeeId,overdue:tehranDay(now())>=d.dueDate}));}
 return {observe,scan,list};
}

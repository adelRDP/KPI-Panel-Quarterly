// One authoritative read path for a finalized quarter. Never recalculate a
// frozen result using a policy that may since have been withdrawn or replaced.
export function finalQuarterSnapshot(store,employeeId,quarter){
 const row=store.list('quarter-evaluation',employeeId).find(r=>r.quarter===quarter&&r.status==='locked');
 if(!row?.lockedSnapshot)return null;
 const amendment=store.list('quarter-result-amendment',employeeId).filter(r=>r.evaluationId===row.id&&r.status==='approved').sort((a,b)=>b.sequence-a.sequence)[0],snapshot=amendment?.lockedSnapshot||row.lockedSnapshot;
 return {evaluationId:row.id,lockedAt:row.lockedAt,amendmentId:amendment?.id||null,amendmentSequence:amendment?.sequence||0,snapshot:structuredClone({...snapshot,employee:snapshot.employee||row.snapshot?.employee})};
}
export function frozenWorkflowSnapshot(fallback,final){
 const result=final.snapshot,source=result.sourceSnapshot||fallback,c=result.calculation,p=result.quarterPay,baseSalary=c.baseSalary,earned=p.earned,ceiling=p.ceiling;
 return {...source,employee:result.employee||source.employee,policy:result.policy,components:c.components,performance:c.performance,complete:c.complete,baseSalary,earned,ceiling,knownTotal:baseSalary==null||earned==null?null:baseSalary+earned,finalSalary:baseSalary==null||earned==null?null:baseSalary+earned,maxFinalSalary:baseSalary==null||ceiling==null?null:baseSalary+ceiling,finalized:true,finalEvaluationId:final.evaluationId,finalizedAt:final.lockedAt,amendmentVersion:final.amendmentSequence||0};
}

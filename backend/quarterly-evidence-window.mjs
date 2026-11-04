import {quarterBounds} from './quarterly-calculation.mjs';

export const QUARTER_EVIDENCE_POLICY='quarter-evidence-retrospective-v1';

// Import day is a technical cutover, not proof that the employee began work
// that day. Extend work evidence only; financial intervals remain unchanged.
export function quarterlyEvidenceWindow(store,position,period){
 const bounds=quarterBounds(period),meta=store.get('quarterly-project','project-meta');
 const imported=position?.createdBy==='organization-import'&&!position.supersedes&&meta?.startQuarter===period&&position.effectiveFrom===meta.startDate;
 const prior=imported&&store.list('position-assignment',position.employeeId).some(p=>p.id!==position.id&&p.status==='published'&&p.effectiveFrom<position.effectiveFrom);
 const start=imported&&!prior?bounds.start:position?.effectiveFrom>bounds.start?position.effectiveFrom:bounds.start;
 const end=position?.effectiveTo&&position.effectiveTo<bounds.end?position.effectiveTo:bounds.end;
 return {start,end,policy:QUARTER_EVIDENCE_POLICY,importedQuarter:!!imported&&!prior};
}

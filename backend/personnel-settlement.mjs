// A dated HR exit, not a payroll calculation or deletion of personnel/history.
export const settlementFor=(store,id)=>store.list('personnel-settlement',id).find(row=>row.status==='registered')||null;
export const settledAt=(store,id,onDate)=>{const row=settlementFor(store,id);return row&&row.settlementDate<=onDate?row:null;};
export function settlementState(store,person,onDate){
  if(!person)return person;
  const row=settledAt(store,person.id,onDate);
  return row?{...person,isKpiEligible:false,isSettled:true,settlementDate:row.settlementDate}:person;
}

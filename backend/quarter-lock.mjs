// A finalized employee quarter is read-only, including its source evidence.
export function quarterLocked(store,employeeId,period){
 if(!/^14\d{2}-(?:(0[1-9]|1[0-2])|Q[1-4])$/.test(period||''))return false;
 const quarter=period.includes('-Q')?period:`${period.slice(0,4)}-Q${Math.ceil(Number(period.slice(5))/3)}`;
 return store.list('quarter-evaluation',employeeId).some(row=>row.status==='locked'&&row.quarter===quarter);
}
export function assertQuarterWritable(store,employeeId,period){
 if(quarterLocked(store,employeeId,period)){
  const message='نتیجهٔ این فصل نهایی و قفل شده است؛ تغییر امتیاز، شاخص یا مستندات آن مجاز نیست.';
  throw Object.assign(new Error(message),{status:409,publicMessage:message});
 }
}

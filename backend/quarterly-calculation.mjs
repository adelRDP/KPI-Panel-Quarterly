import Model from '../src/performance-model.js';
import {calendarMonths,requireQuarter} from './quarter-period.mjs';
const day=86400000,cache=new Map();
export const daysBetween=(a,b)=>(Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/day;
export function calendarMonthBounds(period){
 if(cache.has(period))return cache.get(period);
 if(!/^14\d{2}-(0[1-9]|1[0-2])$/.test(period))throw Error('Invalid calendar month');
 const year=Number(period.slice(0,4)),format=new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'2-digit',timeZone:'Asia/Tehran'});let start;
 for(let stamp=Date.UTC(year+621,0,1);stamp<Date.UTC(year+623,0,1);stamp+=day){const p=Object.fromEntries(format.formatToParts(new Date(stamp)).map(x=>[x.type,x.value])),at=new Date(stamp).toISOString().slice(0,10);if(`${p.year}-${p.month}`===period){start||=at;}else if(start){const result={start,end:at,totalDays:daysBetween(start,at)};cache.set(period,result);return result;}}
 throw Error('Calendar bounds unavailable');
}
export function quarterBounds(quarter){const months=calendarMonths(requireQuarter(quarter)).map(calendarMonthBounds),start=months[0].start,end=months[2].end;return {start,end,totalDays:daysBetween(start,end)};}
// Preserve the existing financial rate: each full calendar month contributes
// one monthly cap. Calendar months here are money intervals, not evaluations.
// Cumulative integer allocation gives every split day/currency unit one owner.
export function quarterAmounts({quarter,start,end,monthlySalary,monthlyRate=Model.monthlyRate}){
 const bounds=quarterBounds(quarter);
 if(!Number.isSafeInteger(monthlySalary)||monthlySalary<0||!Number.isFinite(monthlyRate)||monthlyRate<0||monthlyRate>1)throw Error('Invalid compensation input');
 if(start<bounds.start||end>bounds.end||start>=end||!Number.isSafeInteger(daysBetween(start,end)))throw Error('Invalid quarterly interval');
 let baseSalary=0,ceiling=0;
 for(const period of calendarMonths(quarter)){
  const b=calendarMonthBounds(period),from=start>b.start?start:b.start,to=end<b.end?end:b.end;if(from>=to)continue;
  const portion=amount=>Number(BigInt(amount)*BigInt(daysBetween(b.start,to))/BigInt(b.totalDays)-BigInt(amount)*BigInt(daysBetween(b.start,from))/BigInt(b.totalDays));
  baseSalary+=portion(monthlySalary);ceiling+=portion(Math.round(monthlySalary*monthlyRate));
 }
 return {baseSalary,ceiling};
}
export function calculateQuarterSlice({quarter,start,end,monthlySalary,policy,scores,hasProjects=true,eligible=true}){
 const amounts=quarterAmounts({quarter,start,end,monthlySalary,monthlyRate:policy.amountRules?.monthlyRate??Model.monthlyRate});
 const calculation=Model.calculate({baseSalary:amounts.baseSalary,bonusCeiling:eligible?amounts.ceiling:0,scores:eligible?scores:Object.fromEntries(Object.keys(policy.weights).map(k=>[k,0])),policy,hasProjects});
 return {...calculation,notApplicable:!eligible,quarter,period:quarter,start,end,days:daysBetween(start,end),monthlySalary,quarterlyPayment:true,estimatedMonthly:false,formulaVersion:'quarterly-direct-v1'};
}

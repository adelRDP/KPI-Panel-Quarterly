// Calendar months are used only for date/rate arithmetic, never assessment storage.
export const isQuarter=value=>/^14\d{2}-Q[1-4]$/.test(value||'');
export function requireQuarter(value){if(!isQuarter(value))throw Object.assign(Error('دورهٔ این پروژه باید فصل باشد؛ مانند 1405-Q3.'),{status:400});return value;}
export function quarterOf(value){if(isQuarter(value))return value;if(!/^14\d{2}-(0[1-9]|1[0-2])$/.test(value||''))return requireQuarter(value);return `${value.slice(0,4)}-Q${Math.ceil(Number(value.slice(5))/3)}`;}
export function calendarMonths(value){requireQuarter(value);return [0,1,2].map(i=>`${value.slice(0,4)}-${String((Number(value.at(-1))-1)*3+1+i).padStart(2,'0')}`);}
export function periodAtDate(value=new Date()){const date=typeof value==='string'&&value.length===10?new Date(value+'T12:00:00Z'):new Date(value);const p=Object.fromEntries(new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn',{year:'numeric',month:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(date).map(x=>[x.type,x.value]));return quarterOf(`${p.year}-${p.month}`);}
export function nextQuarter(value){requireQuarter(value);const q=Number(value.at(-1)),y=Number(value.slice(0,4));return `${q===4?y+1:y}-Q${q===4?1:q+1}`;}

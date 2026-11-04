const fail=(message,status=400)=>{throw Object.assign(new Error(message),{publicMessage:message,status});};
const kinds={position:'position-assignment',design:'kpi-design',quarter:'quarter-evaluation',appeal:'quarter-appeal'};
const actions={'position.published':'position','kpi-design.published':'design','quarter.locked':'quarter','quarter.appeal-hr-review':'appeal'};
const normalize=value=>String(value??'').normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/\u200c/g,' ').toLowerCase().trim();

// Approval audit events are the archive index; no copies, moves or workflow writes.
export function createIncomingArchive(store,workflow){
  const authorize=actor=>{if(actor?.role!=='hr')fail('آرشیو درخواست‌های ورودی فقط برای ادمین مجاز است.',403);};
  function entries(){
    const seen=new Set(),rows=[];
    for(const event of store.list('audit-event').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))){
      const type=Object.hasOwn(actions,event.action)?actions[event.action]:null;if(!type||event.entityType!==kinds[type]||type==='appeal'&&event.details?.decision!=='approve')continue;
      const key=type+':'+event.entityId;if(seen.has(key))continue;seen.add(key);
      const record=store.get(event.entityId,kinds[type]);if(!record)continue;
      const person=workflow.user(record.employeeId),approver=workflow.user(event.actorId);
      rows.push({id:record.id,type,employeeId:record.employeeId,name:record.snapshot?.employee?.name||person?.name||record.employeeId,employeeCode:record.employeeCode||person?.employeeCode||null,unitName:record.unitName||record.snapshot?.employee?.unitName||person?.unitName||'',period:record.period||record.quarter||record.effectiveFrom,version:record.version||null,title:type==='position'?record.jobTitle:type==='design'?'طرح شاخص‌های KPI':type==='quarter'?'ارزیابی فصلی':record.type==='payroll'?'اعتراض به مبلغ':'اعتراض به امتیاز',taskCount:type==='design'?(record.tasks||[]).length:null,approvedAt:event.createdAt,approvedBy:event.actorId,approverName:approver?.name||event.actorId,status:record.status,removed:!!record.removedAt});
    }
    return rows.sort((a,b)=>String(b.approvedAt).localeCompare(String(a.approvedAt))||(a.type+':'+a.id).localeCompare(b.type+':'+b.id));
  }
  function list(actor,{type='all',search='',page='1'}={}){
    authorize(actor);if(type!=='all'&&!Object.hasOwn(kinds,type))fail('نوع درخواست معتبر نیست.');
    if(typeof search!=='string'||search.length>160||!/^\d{1,6}$/.test(String(page))||Number(page)<1)fail('فیلتر آرشیو معتبر نیست.');
    const tokens=normalize(search).split(/\s+/).filter(Boolean),filtered=entries().filter(row=>(type==='all'||row.type===type)&&tokens.every(token=>normalize([row.name,row.employeeCode,row.unitName,row.period,row.title,row.approverName].join(' ')).includes(token)));
    const pageSize=25,total=filtered.length,pages=Math.max(1,Math.ceil(total/pageSize)),currentPage=Math.min(Number(page),pages);
    return {items:filtered.slice((currentPage-1)*pageSize,currentPage*pageSize),total,page:currentPage,pages,pageSize};
  }
  function detail(actor,type,id){
    authorize(actor);if(!Object.hasOwn(kinds,type))fail('درخواست آرشیوی پیدا نشد.',404);
    const item=entries().find(row=>row.type===type&&row.id===id);if(!item)fail('درخواست تأییدشده در آرشیو پیدا نشد.',404);
    const source=store.get(id,kinds[type]);
    const fields={position:['id','status','employeeId','employeeCode','jobTitle','unitName','jobFamily','jobLevel','managerId','effectiveFrom','effectiveTo','baseSalary','hasProjects','duties','version','events'],design:['id','status','employeeId','period','version','tasks','removedAt','events'],quarter:['id','status','employeeId','quarter','events'],appeal:['id','status','employeeId','quarter','type','reason','files','events']}[type];
    const record=Object.fromEntries(fields.filter(field=>Object.hasOwn(source,field)).map(field=>[field,source[field]]));
    if(type==='design'&&source.aiReview)record.aiReview=Object.fromEntries(['contractVersion','result','jobAnalysis','runId'].filter(field=>Object.hasOwn(source.aiReview,field)).map(field=>[field,source.aiReview[field]]));
    if(type==='quarter')record.snapshot={employee:{name:item.name},calculation:{performance:source.snapshot?.calculation?.performance??null},quarterPay:{earned:source.snapshot?.quarterPay?.earned??null}};
    record.managerReview=source.managerReview;record.hrReview=source.hrReview;
    return {...item,record};
  }
  return {list,detail};
}

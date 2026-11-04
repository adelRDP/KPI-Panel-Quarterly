const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,publicMessage:message});};
export const normalizeSearch=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[\u064b-\u065f\u0670\u0640\u200c\u200d]/g,'').replace(/\s+/g,' ').trim();
const pages=[
  ['announcements','اطلاعیه‌ها ثبت و زمان‌بندی اطلاعیه سازمانی',['hr']],
  ['incoming-archive','آرشیو درخواست‌های ورودی',['hr']],
  ['dashboard','پیشخوان و عملکرد فردی',['personnel']],['team','عملکرد واحد',['manager']],['assignments','شاخص‌های روتین',['personnel']],['projectAssignments','شاخص‌های پروژه‌ای',['personnel']],
['quarters','ارزیابی فصلی KPI',['personnel','manager','hr']],['chart','اطلاعات پرسنلی و چارت سازمانی',['personnel','manager','hr']],['surveys','نظرسنجی و رضایت‌سنجی پرسنل',['personnel','manager','hr']],['appeals','درخواست‌های اعتراض',['personnel']],['chat','Chat گفتگو چت',['personnel','manager','hr']],['notes','یادداشت‌ها و یادآوری‌های شخصی',['personnel','manager','hr']],
['tasks','تعریف شاخص‌ها',['manager']],['position-review','درخواست‌های پرسنلی',['manager']],['personnel-requests-archive','آرشیو درخواست‌ها',['manager']],['organization','مدیریت پرسنل',['hr']],['updates','لیست آپدیت پرسنل',['hr']],['duties','شرح وظایف پرسنل',['hr']],['incoming','درخواست‌های ورودی و پیگیری اعتراض‌ها',['hr']],['evaluation-settings','تنظیمات مدل محاسبه',['hr']],['score-settings','تنظیمات محاسبه امتیاز قوانین تأخیر اعتراض',['hr']],['data','آزمون فصلی پرسنل',['hr']],['ai','AI سوابق هوش مصنوعی',['hr']]
];
const short=(value,size=180)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,size);

// Search only whitelisted fields of records already authorized by their source workflow.
// No file contents, pay, votes, model inputs, credentials, or third-party messages are indexed.
export function createPanelSearch(store,workflow,organization,chat){
  function search(actor,query){
    actor=workflow.user(actor?.id);if(!actor||!['personnel','manager','hr'].includes(actor.role))fail('دسترسی به جست‌وجو مجاز نیست.',403);
    if(typeof query!=='string'||query.length>120)fail('عبارت جست‌وجو حداکثر ۱۲۰ نویسه است.');
    const q=normalizeSearch(query),tokens=q.split(' ').filter(Boolean);if(q.length<2)return {items:[],total:0,limit:40};
    const matches=[],compact=value=>normalizeSearch(value).replace(/ /g,'');
    function add(id,kind,title,description,view,extra={},fields=[]){
      const titleText=short(title,160),body=compact([title,kind,description,...fields].join(' '));if(!tokens.every(token=>body.includes(compact(token))))return;
      const at=normalizeSearch(description).indexOf(tokens[0]),start=at>90?at-50:0,descriptionText=(start?'… ':'')+short(String(description??'').slice(start));
      const key=compact(q),name=compact(titleText),rank=name===key?0:name.startsWith(key)?1:name.includes(key)?2:3;
      matches.push({id,kind,title:titleText,description:descriptionText,view,...extra,rank});
    }
    for(const [view,title,roles] of pages)if(roles.includes(actor.role))add('page:'+view,'بخش پنل',title,'باز کردن بخش',view);
    const chart=organization.chart(actor),names=new Map(chart.people.map(p=>[p.id,p.name]));
    const name=id=>names.get(id)||workflow.user(id)?.name||'پرسنل';
    for(const person of chart.people)add('person:'+person.id,'پرسنل',person.name,[person.jobTitle,person.unitName,person.employeeCode].filter(Boolean).join(' · '),'chart',{target:{attr:'data-search-person',value:person.id}});
    for(const unit of chart.units)add('unit:'+unit.id,'واحد سازمانی',unit.name,'چارت سازمانی','chart',{target:{attr:'data-search-unit',value:unit.id}});
    const activities=store.list('activity').filter(a=>!a.removedAt&&workflow.canRead(actor,a.ownerId));
    const activityView=a=>actor.role==='personnel'?(a.kind==='project'?'projectAssignments':'assignments'):actor.role==='manager'?'team':'incoming';
    for(const activity of activities){
      const context=[name(activity.ownerId),activity.period,activity.description].filter(Boolean).join(' · '),action={action:'activity',activityId:activity.id};
      add('activity:'+activity.id,activity.kind==='project'?'شاخص پروژه‌ای':'شاخص روتین',activity.title,context,activityView(activity),action,(activity.criteria||[]).map(c=>typeof c==='string'?c:c.text));
      for(const document of store.list('document',activity.id))if(!document.archivedAt)add('document:'+document.id,'مستند',document.name,[activity.title,name(activity.ownerId),activity.period].join(' · '),activityView(activity),action);
    }
    // Personnel sees published activities, not manager drafts or review-only design versions.
    if(actor.role!=='personnel')for(const design of organization.listDesigns(actor))for(const task of design.tasks||[])add('design:'+design.id+':'+task.id,design.status==='draft'?'پیش‌نویس شاخص':'تعریف شاخص',task.title,[name(design.employeeId),design.period,task.description].filter(Boolean).join(' · '),actor.role==='manager'?'tasks':'incoming',{target:{attr:'data-design-id',value:design.id}},task.criteria||[]);
    for(const appeal of organization.listAppeals(actor)){
      const view=actor.role==='hr'?'incoming':actor.role==='manager'?(appeal.status==='approved'||appeal.managerReview?.decision==='approve'&&!['manager_review','needs_revision'].includes(appeal.status)?'personnel-requests-archive':'position-review'):'appeals',extra={target:{attr:'data-search-appeal',value:appeal.id}},title='درخواست اعتراض · '+name(appeal.employeeId);
      add('appeal:'+appeal.id,'اعتراض',title,[appeal.quarter,appeal.reason].filter(Boolean).join(' · '),view,extra);
      for(const file of appeal.files||[])add('appeal-file:'+file.id,'مستند اعتراض',file.name,title+' · '+appeal.quarter,view,extra);
    }
    for(const campaign of organization.serviceCampaigns(actor))add('survey:'+campaign.id,'نظرسنجی',campaign.title||'نظرسنجی '+name(campaign.employeeId),[campaign.period,campaign.description].filter(Boolean).join(' · '),'surveys',{target:{attr:'data-service-detail',value:campaign.id}});
    if(['personnel','manager','hr'].includes(actor.role))for(const note of store.list('personal-note',actor.id))add('note:'+note.id,'یادداشت خصوصی',note.title||'یادداشت بدون عنوان',note.text,'notes',{action:'note',entityId:note.id});
    for(const contact of chat.contacts(actor))add('chat:'+contact.id,'Chat',contact.name,[contact.relation,contact.unitName,contact.jobTitle].filter(Boolean).join(' · '),'chat',{action:'chat',entityId:contact.id});
    if(actor.role==='hr'){
      for(const section of organization.sections(actor))add('section:'+section.id,'بخش سازمانی',section.name,'مدیریت پرسنل','organization');
      for(const position of organization.listPositions(actor))add('position:'+position.id,'سمت پرسنلی',position.jobTitle,[name(position.employeeId),position.unitName,position.jobFamily,position.duties].filter(Boolean).join(' · '),'updates');
      for(const batch of organization.listExamImports(actor))add('exam:'+batch.id,'فایل آزمون',batch.fileName||batch.batchKey,batch.quarter,'data');
    }
    if(actor.role==='manager')for(const position of organization.positionProposals(actor))add('position:'+position.id,'تغییر سمت',position.jobTitle,[name(position.employeeId),position.unitName,position.duties].filter(Boolean).join(' · '),'position-review');
    matches.sort((a,b)=>a.rank-b.rank||a.title.localeCompare(b.title,'fa')||a.id.localeCompare(b.id));
    return {items:matches.slice(0,40).map(({rank,...item})=>item),total:matches.length,limit:40};
  }
  return {search};
}

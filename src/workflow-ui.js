(() => {
  const $=selector=>document.querySelector(selector),escape=escapeHtml;
  let session=null,snapshot=null,quarterProgress=null,team=[],proposals=[],teamPeriod='',period='',busy=false,loading=true,refreshVersion=0,dashboardLevel='operations';
  const money=value=>Number.isFinite(value)?faMoney.format(value)+' تومان':'N/A';
  const percent=value=>value===null?'در انتظار':Number.isFinite(value)?faPercent.format(value)+'٪':'N/A';
  const quarterPercentFormat=new Intl.NumberFormat('fa-IR',{maximumFractionDigits:0});
  const quarterPercent=value=>value===null?'در انتظار':Number.isFinite(value)?quarterPercentFormat.format(value)+'٪':'N/A';
  const accountName=account=>account.role==='hr'&&account.id==='hr-demo'?'ادمین KPI':account.name;
  const roleText=value=>String(value??'').replace(/\bHR\b/g,'ادمین').replaceAll('دسترسی منابع انسانی','دسترسی ادمین').replaceAll('ادمین منابع انسانی','ادمین').replaceAll('مدیر واحد','مدیر');
  const persianYear=year=>new Intl.NumberFormat('fa-IR',{useGrouping:false}).format(year);
  const monthNames=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const seasonNames=['بهار','تابستان','پاییز','زمستان'];
  const monthLabel=value=>{if(/-Q[1-4]$/.test(value))return quarterLabel(value);const [year,month]=value.split('-').map(Number);return `${monthNames[month-1]||value} ${persianYear(year)}`;};
  const quarterLabel=value=>{const match=/^(\d{4})-Q([1-4])$/.exec(value);return match?`${seasonNames[Number(match[2])-1]} ${persianYear(Number(match[1]))}`:value;};
  function fillMonthOptions(selected){
    const match=/^(14\d{2})-Q([1-4])$/.exec(selected),year=Number(match?.[1]||1405),season=Number(match?.[2]||3);
    const years=$('#workflowYear'),quarters=$('#workflowQuarter');
    years.innerHTML=Array.from({length:Math.max(11,year-1400+6)},(_,i)=>`<option value="${1400+i}">${persianYear(1400+i)}</option>`).join('');years.value=String(year);
    quarters.innerHTML=seasonNames.map((name,i)=>`<option value="${i+1}">${name}</option>`).join('');quarters.value=String(season);
    $('#workflowPeriod').value=`${years.value}-Q${quarters.value}`;
  }
  const statusLabels={pending:'در انتظار بررسی هارنس',approved:'تأیید و تخصیص داده شد',rejected:'رد شده',needs_revision:'نیازمند اصلاح'};
  const sources={exam:'نتیجه واردشده از آزمون پرسنلی',manager:'امتیاز ثبت‌شده توسط مدیر مستقیم',routine:'ارزیابی مستندات وظایف روتین',project:'ارزیابی جداگانه مستندات پروژه',peer:'میانگین محرمانهٔ نظرسنجی معتبر همکاران'};
  async function api(path,options={}){
    if(!session)await ready;
    if(!session)throw new Error('از حساب خارج شده‌اید؛ دوباره وارد پنل شوید.');
    let response,result;
    try{response=await fetch(path,{...options,headers:{'x-panel-token':session.token,...options.headers}});}catch{throw new Error('ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید.');}
    try{result=await response.json();}catch{throw new Error('پاسخ معتبر از سرور دریافت نشد؛ دوباره تلاش کنید.');}
    if(!response.ok){if(result.loginRequired)window.location.replace('/login.html');throw new Error(roleText(result.error||'درخواست ناموفق بود؛ دوباره تلاش کنید.'));}return result;
  }
  const post=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  async function download(path,suggestedName){const response=await fetch(path,{headers:{'x-panel-token':session.token}});if(!response.ok){let result={};try{result=await response.json();}catch{}throw new Error(result.error||'دانلود ناموفق بود.');}const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=suggestedName||response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'export.csv';link.click();URL.revokeObjectURL(url);}
  function canView(name){return !loading&&(session?.mustChangePassword?name==='account-security':name==='account-security'?session?.demo===false||session?.canManageAccounts===true:window.PanelLifecycle?window.PanelLifecycle.canView(name):['dashboard','reviews',...(session?.user.role==='manager'?['team','surveys','proposals']:[])].includes(name));}
  function homeView(role){return role==='personnel'?'dashboard':role==='manager'?'manager-dashboard':'quarters';}
  let statusTimer=null;
  function message(text,error=false){const status=$('#workflowStatus');status.textContent=text;status.classList.toggle('warning-text',error);status.hidden=false;window.clearTimeout(statusTimer);statusTimer=window.setTimeout(()=>status.hidden=true,error?8000:4500);}
  const lockedControls=new Map();
  function setBusy(value){
    busy=value;
    if(value){for(const el of document.querySelectorAll('#demoRole,#demoAccount,#periodToggle,#workflowYear,#workflowQuarter,#workflowMonth,#periodForm button,.workflow-view button,.workflow-view input,.workflow-view textarea,.workflow-view select')){if(!lockedControls.has(el))lockedControls.set(el,el.disabled);el.disabled=true;}}
    else{for(const [el,disabled] of lockedControls)if(el.isConnected)el.disabled=disabled;lockedControls.clear();window.PanelAiLog?.syncControls();}
  }
  window.PanelWorkflow={api,post,download,roleText,canView,renderDashboard,monthLabel,quarterLabel,get user(){return session?.user;},get accounts(){return session?.accounts||[];},get demo(){return session?.demo!==false;},get canManageAccounts(){return session?.canManageAccounts===true;},get mustChangePassword(){return session?.mustChangePassword===true;},get loginProtected(){return session?.credentialLogin===true;},get working(){return busy||loading;},refresh,go:name=>showView(name),signOut};
  async function signOut(){
    if(!session)return;const token=session.token,response=await fetch('/api/session',{method:'DELETE',headers:{'x-panel-token':token}});
    if(!response.ok&&response.status!==403)throw new Error('خروج از حساب کامل نشد؛ دوباره تلاش کنید.');
    session=null;loading=true;refreshVersion++;snapshot=null;quarterProgress=null;team=[];proposals=[];teamPeriod='';managerReports.clear();
    window.PanelLifecycle?.applySession(null);window.dispatchEvent(new Event('panel:session'));
    document.querySelectorAll('.view').forEach(view=>view.classList.remove('active'));document.querySelectorAll('.profile-card strong,.profile-card small,.profile-card .avatar').forEach(el=>el.textContent='');
  }
  const headerControls=document.createElement('div');headerControls.className='header-controls';
  while($('.topbar').firstChild)headerControls.append($('.topbar').firstChild);$('.topbar').append(headerControls);
  const toolbar=document.createElement('div');toolbar.className='workflow-toolbar';
  toolbar.innerHTML='<label class="demo-account-label"><span>دسترسی</span><select id="demoRole" aria-label="انتخاب نوع دسترسی" disabled><option value="personnel">پرسنلی</option><option value="manager">مدیر</option><option value="hr">ادمین</option></select></label><label class="demo-account-label"><span>نام فرد</span><select id="demoAccount" aria-label="انتخاب نام فرد" disabled></select></label><span id="workflowRole" class="header-role-description"></span>';
  headerControls.insertBefore(toolbar,$('#headerClock')||$('.top-actions'));$('.global-search').hidden=false;
  document.querySelectorAll('[data-open-upload],[data-view="documents"],[data-view="users"],[data-view="activity"],[data-view="settings"]').forEach(el=>el.hidden=true);
  const periodControl=document.createElement('div');periodControl.id='workflowPeriodControl';periodControl.innerHTML='<button type="button" id="periodToggle" class="period-toggle" aria-expanded="false" aria-controls="periodForm" disabled>'+icon('i-calendar')+'<span>دوره KPI: <strong id="periodLabel">—</strong></span><span class="period-chevron" aria-hidden="true">⌄</span></button>';
  headerControls.insertBefore(periodControl,$('#headerClock'));
  const periodTimeGroup=document.createElement('div');periodTimeGroup.className='header-period-time';
  headerControls.insertBefore(periodTimeGroup,periodControl);
  const periodDivider=document.createElement('span');periodDivider.id='headerPeriodDivider';periodDivider.className='header-period-divider';periodDivider.setAttribute('aria-hidden','true');
  periodTimeGroup.append(periodControl,periodDivider,$('#headerClock'));
  const periodForm=document.createElement('form');periodForm.id='periodForm';periodForm.className='period-popover';periodForm.hidden=true;periodForm.setAttribute('aria-label','انتخاب دوره ارزیابی');periodForm.innerHTML='<div class="period-popover-heading"><strong>دورهٔ ارزیابی</strong><button type="button" id="closePeriod" class="icon-button" aria-label="بستن انتخاب دوره">×</button></div><div class="period-fields"><label>سال<select id="workflowYear" aria-label="سال ارزیابی" required></select></label><label>فصل<select id="workflowQuarter" aria-label="فصل ارزیابی" required></select></label><label hidden>ماه<select id="workflowMonth" aria-label="ماه تقویمی" disabled></select></label></div><input id="workflowPeriod" type="hidden"><div class="period-popover-footer"><small>یک ارزیابی مستقل برای کل فصل</small><button type="submit" class="primary-button" id="applyPeriod">اعمال</button></div>';
  document.body.append(periodForm);
  const workflowStatus=document.createElement('p');workflowStatus.id='workflowStatus';workflowStatus.className='workflow-toast';workflowStatus.setAttribute('role','status');workflowStatus.setAttribute('aria-live','polite');workflowStatus.hidden=true;document.body.append(workflowStatus);
  new MutationObserver(()=>{if(!workflowStatus.textContent)return;workflowStatus.hidden=false;window.clearTimeout(statusTimer);statusTimer=window.setTimeout(()=>workflowStatus.hidden=true,workflowStatus.classList.contains('warning-text')?8000:4500);}).observe(workflowStatus,{childList:true,subtree:true});
  function updatePeriodLabel(){if(!period)return;const view=document.querySelector('.view.active')?.id.slice(5),quarterly=view==='quarters'||view==='dashboard'&&dashboardLevel==='quarter';const label=quarterly?quarterLabel(period):monthLabel(period);$('#periodLabel').textContent=label;$('#periodToggle').setAttribute('aria-label','دوره KPI: '+label);$('#periodToggle').title='انتخاب دوره KPI: '+label;}
  function positionPeriod(){if(periodForm.hidden)return;const rect=$('#periodToggle').getBoundingClientRect(),width=Math.min(320,window.innerWidth-24);periodForm.style.width=width+'px';periodForm.style.left=Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12))+'px';periodForm.style.top=rect.bottom+10+'px';periodForm.style.maxHeight=Math.max(120,window.innerHeight-rect.bottom-22)+'px';}
  function closePeriod(focus=false){periodForm.hidden=true;$('#periodToggle').setAttribute('aria-expanded','false');if(period&&!busy)fillMonthOptions(period);if(focus)$('#periodToggle').focus();}
  $('#periodToggle').onclick=()=>{if(!periodForm.hidden)return closePeriod();if(busy||!period)return;fillMonthOptions(period);periodForm.hidden=false;$('#periodToggle').setAttribute('aria-expanded','true');positionPeriod();$('#workflowYear').focus();};
  $('#closePeriod').onclick=()=>closePeriod(true);
  window.addEventListener('panel:utility',event=>{if(event.detail.open)closePeriod();});
  document.addEventListener('pointerdown',event=>{if(!periodForm.hidden&&!periodForm.contains(event.target)&&!periodControl.contains(event.target))closePeriod();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!periodForm.hidden){event.preventDefault();closePeriod(true);}});
  window.addEventListener('resize',positionPeriod);headerControls.addEventListener('scroll',positionPeriod);
  function updatePeriodVisibility(view){closePeriod();periodControl.hidden=['announcements','chat','notes','duties','incoming-archive','personnel-requests-archive','position-review','manager-personnel','score-settings'].includes(view)||session?.user.role==='personnel'&&view==='chart';periodDivider.hidden=periodControl.hidden;updatePeriodLabel();}
  for(const [id,title,iconId] of [['assignments','شاخص‌های روتین','i-file'],['projectAssignments','شاخص‌های پروژه‌ای','i-folder'],['team','عملکرد واحد','i-users'],['surveys','رضایت‌سنجی پرسنل','i-pulse'],['proposals','پیشنهاد تسک و شاخص','i-plus']]){
    const navIcon=({assignments:'i-checklist',team:'i-chart-bars',surveys:'i-checklist'})[id]||iconId;
    const nav=document.createElement('button');nav.className='nav-item';nav.dataset.view=id;nav.title=title;nav.setAttribute('aria-label',title);nav.hidden=true;nav.innerHTML=icon(navIcon)+`<span>${title}</span>`;nav.onclick=()=>showView(id);$('.main-nav').append(nav);
    const view=document.createElement('section');view.className='view workflow-view';view.id='view-'+id;$('main').append(view);
  }
  $('#view-team').innerHTML='<div class="page-heading"><div><p class="eyebrow">پنل مدیر</p><h1>عملکرد واحد</h1><p>امتیاز مؤلفه‌های مدل هر فرد؛ اطلاعات حقوق و مبالغ پرداختی فقط در نقش‌های مجاز</p></div><span class="demo-badge">پنل فصلی مستقل</span></div><p id="teamPeriodNote" class="workflow-muted lifecycle-note" role="status" aria-live="polite"></p><div id="teamSummary" class="workflow-summary"></div><div class="panel workflow-table-wrap"><table class="workflow-table"><thead><tr></tr></thead><tbody id="teamRows"></tbody></table></div>';
  $('#view-surveys').innerHTML='<div class="page-heading"><div><p class="eyebrow">ارزیابی مدیر مستقیم</p><h1>رضایت‌سنجی پرسنل</h1><p>درصد رضایت شما مستقیماً در بخش ارزیابی مدیرِ همان دوره ثبت می‌شود.</p></div></div><div class="settings-grid"><form id="surveyForm" class="panel settings-card"><h2>ثبت امتیاز رضایت</h2><label>پرسنل<select name="employeeId" id="surveyEmployee" required></select></label><label>درصد رضایت (۰ تا ۱۰۰)<input name="score" type="number" min="0" max="100" step="0.1" required></label><label>توضیح ارزیابی<textarea name="note" maxlength="2000" rows="4"></textarea></label><button class="primary-button">ثبت رضایت‌سنجی</button></form><section class="panel settings-card"><h2>وضعیت ارزیابی این دوره</h2><div id="surveyList"></div></section></div>';
  $('#view-proposals').innerHTML='<div class="page-heading"><div><p class="eyebrow">پیشنهاد مدیر</p><h1>پیشنهاد تسک و شاخص</h1><p>پیشنهاد پس از تعیین وضعیت و تأیید، در پنل پرسنل قرار می‌گیرد.</p></div></div><div class="proposal-flow"><span>۱. پیشنهاد مدیر</span><span>۲. بررسی هارنس</span><span>۳. تخصیص نهایی به پرسنل</span></div><div class="settings-grid"><form id="proposalForm" class="panel settings-card"><h2>پیشنهاد جدید</h2><label>پرسنل<select name="employeeId" id="proposalEmployee" required></select></label><div class="form-grid"><label>نوع پیشنهاد<select name="type"><option value="task">تسک</option><option value="indicator">شاخص</option></select></label><label>بخش عملکرد<select name="category"><option value="routine">KPI روتین</option><option value="project">KPI پروژه‌ای</option></select></label></div><label>عنوان<input name="title" maxlength="200" required></label><label>شرح وظیفه و خروجی مورد انتظار<textarea name="description" rows="3" maxlength="4000" required></textarea></label><label>معیار سنجش و مستند مورد نیاز؛ هر معیار در یک خط<textarea name="criteria" rows="3" maxlength="4000" required></textarea></label><button class="primary-button">ثبت و ارسال به صف بررسی</button><p class="formula-note">اتصال هارنس در مرحله بعد انجام می‌شود. پیشنهادهای فعلی با وضعیت «در انتظار بررسی» ذخیره می‌شوند.</p></form><section class="panel settings-card"><h2>پیگیری پیشنهادهای این دوره</h2><div id="proposalList"></div></section></div>';
  const assignmentViews=[{view:'assignments',panel:'assignedActivities',category:'routine',title:'شاخص‌های روتین',iconId:'i-file'},{view:'projectAssignments',panel:'projectAssignedActivities',category:'project',title:'شاخص‌های پروژه‌ای',iconId:'i-folder'}];
  for(const {view,panel,title} of assignmentViews){
    $('#view-'+view).innerHTML=`<div class="page-heading"><div><p class="eyebrow">تسک‌های مصوب همین دوره</p><h1>${title}</h1><p>شرح وظایف، معیارهای پذیرش و مستندات شاخص‌های این بخش را اینجا ببینید.</p></div></div><section class="panel settings-card lifecycle-section" id="${panel}" data-assignment-category="${view==='assignments'?'routine':'project'}"></section>`;
  }
  const dashboardNote=document.createElement('p');dashboardNote.id='fourPartNote';dashboardNote.className='formula-note';$('#view-dashboard .performance-stats').after(dashboardNote);
  const dashboardView=$('#view-dashboard'),dashboardHeading=dashboardView.querySelector('.page-heading'),levelSwitch=document.createElement('div'),quarterOverview=document.createElement('section'),monthlyDetail=document.createElement('div');
  const operationsOverview=document.createElement('section');operationsOverview.id='operationsOverview';operationsOverview.hidden=true;
  let pendingManagerDashboardFocus=null;
  function scrollDashboardTarget(selector){
    const target=document.querySelector(selector),view=document.querySelector('.view.active');if(!target||!view?.contains(target)||target.closest('[hidden]'))return;
    document.querySelectorAll('.dashboard-scroll-target').forEach(el=>el.classList.remove('dashboard-scroll-target'));
    target.classList.add('dashboard-scroll-target');target.style.setProperty('--dashboard-header-height',(document.querySelector('.topbar')?.getBoundingClientRect().height||0)+'px');
    if(!target.hasAttribute('tabindex'))target.tabIndex=-1;
    target.scrollIntoView?.({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});target.focus({preventScroll:true});
  }
  function dashboardShortcut(element,destination,label){
    if(!element)return;element.dataset.dashboardNav=destination;element.setAttribute('role','button');element.tabIndex=0;element.setAttribute('aria-label','نمایش '+label);element.title='نمایش '+label;
  }
  function clearDashboardShortcuts(){for(const el of dashboardView.querySelectorAll('[data-dashboard-nav]')){delete el.dataset.dashboardNav;for(const attr of ['role','tabindex','aria-label','title'])el.removeAttribute(attr);}}
  function bindDashboardShortcuts(data){
    const manager=session?.user.role==='manager';
    dashboardShortcut($('#monthlyDetail .metric-card.performance'),'kpi','جزئیات امتیاز عملکرد');
    if(manager){for(const id of ['completed','pending'])dashboardShortcut($('#managerDetail-'+id)?.closest('article'),'kpi','وضعیت مؤلفه‌های عملکرد');dashboardShortcut($('#managerDetail-assignments')?.closest('article'),'manager-tasks','شاخص‌های مصوب این پرسنل');}
    else{
      for(const key of ['base','final'])dashboardShortcut($('#monthlyDetail .metric-card.'+key),'pay','جزئیات دریافتی فصل');
      dashboardShortcut($('#monthlyDetail .metric-card.incentive'),'composition','ترکیب دریافتی عملکرد');
      [...quarterOverview.querySelectorAll('.quarter-summary-card')].forEach((el,i)=>dashboardShortcut(el,i===0?'quarter-result':'quarter-pay',i===0?'ارزیابی عملکرد فصل':'جزئیات دریافتی فصل'));
    }
    for(const el of $('#kpiList').querySelectorAll('[data-component]')){const component=data.components.find(c=>c.id===el.dataset.component);if(component?.applicable!==false)dashboardShortcut(el,'component:'+el.dataset.component,'جزئیات '+(component?.name||'مؤلفه'));}
  }
  function navigateDashboard(destination){
    if(busy||loading||!snapshot||snapshot.notApplicable||!['personnel','manager'].includes(session?.user.role))return;
    const manager=session.user.role==='manager',selectors={kpi:'#view-dashboard .kpi-panel',pay:'#view-dashboard .pay-panel',composition:'#view-dashboard .insight-panel:has(#kpiComposition)','quarter-pay':'#quarterPayDetails'};
    if(selectors[destination]){if(manager&&destination!=='kpi')return;scrollDashboardTarget(selectors[destination]);return;}
    const component=destination.startsWith('component:')?destination.slice(10):null;
    if(component&&!snapshot.components.some(c=>c.id===component&&c.applicable!==false))return;
    if(destination==='manager-tasks'||manager&&['routine','project'].includes(component)){
      if(!manager||!team.some(p=>p.employee.id===snapshot.employee.id))return;
      managerPersonFilter=snapshot.employee.id;managerTaskFilter='all';managerTaskPage=1;pendingManagerDashboardFocus={actor:session.user.id,period};showView('manager-dashboard');return;
    }
    let view=destination==='quarter-result'?'quarters':component?({routine:'assignments',project:'projectAssignments',exam:'quarters',manager:manager?'surveys':'quarters',peer:manager?'quarters':'surveys'}[component]):null;
    if(!view||!canView(view))return;
    if(view==='quarters'&&manager){const search=$('#quarterPersonnelSearch'),unit=$('#quarterUnitFilter');if(search&&unit){search.value=snapshot.employee.name;unit.value='all';search.dispatchEvent(new Event('input'));}}
    if(view==='surveys'&&manager&&component==='manager'){const field=$('#surveyEmployee');if([...field.options].some(o=>o.value===snapshot.employee.id)){field.value=snapshot.employee.id;fillSurvey();}}
    showView(view);
  }
  dashboardView.addEventListener('click',event=>{const card=event.target.closest('[data-dashboard-nav]');if(!card||!dashboardView.classList.contains('active')||event.target.closest('button,a,input,textarea,select'))return;navigateDashboard(card.dataset.dashboardNav);});
  dashboardView.addEventListener('keydown',event=>{const card=event.target.closest('[data-dashboard-nav]');if(card&&event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();card.click();}});
  window.addEventListener('panel:session',()=>{pendingManagerDashboardFocus=null;clearDashboardShortcuts();});
  window.addEventListener('panel:view',event=>{if(event.detail!=='manager-dashboard')pendingManagerDashboardFocus=null;});
  levelSwitch.className='dashboard-level-switch';levelSwitch.setAttribute('aria-label','نوع نمایش پیشخوان');levelSwitch.innerHTML=[['showOperations','داشبورد پرسنل','i-home'],['showQuarter','نمای عملکرد فصلی','i-chart-bars'],['showMonth','جزئیات عملکرد فصل','i-report']].map(([id,title,iconId])=>`<button type="button" class="secondary-button" id="${id}"><svg aria-hidden="true"><use href="#${iconId}"/></svg><span>${title}</span></button>`).join('');quarterOverview.id='quarterOverview';monthlyDetail.id='monthlyDetail';
  while(dashboardHeading.nextElementSibling)monthlyDetail.append(dashboardHeading.nextElementSibling);dashboardView.prepend(levelSwitch);dashboardHeading.after(operationsOverview,quarterOverview,monthlyDetail);$('#todayLabel').hidden=true;
  function setDashboardLevel(level){dashboardLevel=level;const personnel=session?.user.role==='personnel',quarterly=personnel&&level==='quarter',operations=personnel&&level==='operations';levelSwitch.hidden=!personnel;dashboardHeading.querySelector('h1').hidden=personnel&&!snapshot?.notApplicable;quarterOverview.hidden=!quarterly;operationsOverview.hidden=!operations;monthlyDetail.hidden=quarterly||operations;for(const [id,on] of [['showOperations',operations],['showQuarter',quarterly],['showMonth',!quarterly&&!operations]]){$('#'+id).classList.toggle('is-active',on);$('#'+id).setAttribute('aria-pressed',String(on));}updatePeriodLabel();}
  $('#showOperations').onclick=()=>{setDashboardLevel('operations');renderDashboard();loadOperations();};
  $('#showQuarter').onclick=()=>{setDashboardLevel('quarter');renderDashboard();};$('#showMonth').onclick=()=>{setDashboardLevel('month');renderDashboard();};
  let operationsVersion=0,operationsReports=new Map(),operationsLoading=false,operationsFilter='all',operationsReportsKey='';
  const isoDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
  const shiftDay=(day,count)=>new Date(Date.parse(day+'T12:00:00Z')+count*86400000).toISOString().slice(0,10);
  function taskDue(task,selectedPeriod,now=new Date()){
    try{
      if(task.dueDate){const day=/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)&&Number.isFinite(Date.parse(task.dueDate))?task.dueDate:window.PanelDate.toGregorian(task.dueDate);return {day,time:task.timeLimit?.time||null,recurring:false};}
      const limit=task.timeLimit;if(!limit?.time)return null;
      const [year,season]=selectedPeriod.split('-Q').map(Number),month=(season-1)*3+1,start=window.PanelDate.toGregorian(`${year}/${month}/1`),next=window.PanelDate.toGregorian(`${season===4?year+1:year}/${season===4?1:month+3}/1`),end=shiftDay(next,-1),today=isoDay(now);
      let day=today<start?start:today>end?end:today;
      if(task.frequency==='فصلی')day=end;else if(task.frequency==='ماهانه'){
        const requested=Number(limit.dayOfMonth);if(!Number.isInteger(requested)||requested<1||requested>31)return null;
        const [dueYear,dueMonth]=window.PanelDate.input(day).split('/').map(Number);
        const nextMonth=window.PanelDate.toGregorian(`${dueMonth===12?dueYear+1:dueYear}/${dueMonth===12?1:dueMonth+1}/1`);
        const lastDay=Number(window.PanelDate.input(shiftDay(nextMonth,-1)).split('/')[2]);
        day=window.PanelDate.toGregorian(`${dueYear}/${dueMonth}/${Math.min(requested,lastDay)}`);
      }
      else if(task.frequency==='هفتگی'){
        if(!Number.isInteger(limit.dayOfWeek))return null;
        const weekday=(new Date(day+'T12:00:00Z').getUTCDay()+1)%7,delta=(weekday-limit.dayOfWeek+7)%7;
        day=shiftDay(day,-delta);if(day<start)day=shiftDay(day,7);
      }else if(!['روزانه','ساعتی'].includes(task.frequency))return null;
      if(day<start||day>end)return null;
      return {day,time:limit.time,recurring:true};
    }catch{return null;}
  }
  function operationsSummary(assignments,reports,campaigns,selectedPeriod,now=new Date()){
    const today=isoDay(now),rows=assignments.map(task=>{
      const report=reports.get(task.id),reviewed=Number.isFinite(task.score),unknown=!reviewed&&(!report||report.failed),submitted=!unknown&&(report?.count||0)>0;
      const due=taskDue(task,selectedPeriod,now),dueAt=due?Date.parse(`${due.day}T${due.time||'23:59:59'}+03:30`):null;
      const state=reviewed?'reviewed':unknown?'unknown':submitted?'submitted':'missing';
      const overdue=state==='missing'&&dueAt!==null&&dueAt<now.getTime(),dueToday=state==='missing'&&!overdue&&due?.day===today;
      const delayHours=overdue?Math.floor((now.getTime()-dueAt)/3600000):0;
      return {task,due,dueAt,state,overdue,dueToday,delayHours,upcoming:state==='missing'&&due?.day>today&&due.day<=shiftDay(today,7)};
    });
    const pendingSurveys=campaigns.filter(c=>c.period===selectedPeriod&&c.canRespond===true&&c.status==='open'&&!c.ownCampaign&&!c.responded&&c.dueAt>=today);
    return {rows,pendingSurveys,overdue:rows.filter(r=>r.overdue),dueToday:rows.filter(r=>r.dueToday),missing:rows.filter(r=>r.state==='missing'),unknown:rows.filter(r=>r.state==='unknown')};
  }
  window.PanelWorkflow.operationsSummary=operationsSummary;
  function renderOperations(force=false){
    if(session?.user.role!=='personnel'||!snapshot){operationsOverview.replaceChildren();return;}
    const key=snapshot.employee.id+'|'+period;
    operationsOverview.setAttribute('aria-busy',String(operationsLoading));
    if(!force&&operationsLoading&&operationsOverview.dataset.loadedKey===key&&operationsOverview.querySelector('.operations-cards'))return;
    const model=operationsSummary(snapshot.assignments.filter(a=>!a.positionClosed),operationsReportsKey===key?operationsReports:new Map(),window.PanelLifecycle?.dashboardCampaigns||[],period),stateNames={missing:'فاقد گزارش',submitted:'منتظر بررسی',reviewed:'بررسی‌شده',unknown:'وضعیت نامشخص'};
    const cards=[['overdue','کارهای معوق',model.overdue.length,'موعد گذشته · فاقد گزارش','i-clock','error'],['today','سررسید امروز',model.dueToday.length,'هنوز فرصت ثبت گزارش دارید','i-checklist','warning'],['surveys','نظرسنجی‌های انجام‌نشده',model.pendingSurveys.length,'قابل پاسخ برای شما','i-users','warning'],['missing','تسک‌های فاقد گزارش',model.missing.length,'معوق و موعدهای آینده','i-report','neutral']];
    const selected=model.rows.filter(r=>operationsFilter==='overdue'?r.overdue:operationsFilter==='today'?r.dueToday:operationsFilter==='missing'?r.state==='missing':true).sort((a,b)=>Number(b.overdue)-Number(a.overdue)||(a.dueAt??Infinity)-(b.dueAt??Infinity));
    const dueLabel=r=>r.due?`${window.PanelDate.format(r.due.day)}${r.due.time?' · ساعت '+window.PanelDate.hourOnly(r.due.time):''}`:'موعد ثبت نشده';
    const delayLabel=r=>r.overdue?r.delayHours>=24?`${fa.format(Math.floor(r.delayHours/24))} روز تأخیر`:r.delayHours?`${fa.format(r.delayHours)} ساعت تأخیر`:'کمتر از یک ساعت تأخیر':'';
    const openButton=r=>`<button type="button" class="secondary-button" data-operation-task="${escape(r.task.id)}">${r.state==='missing'?'ثبت گزارش':'جزئیات'}</button>`;
    const counts=['reviewed','submitted','missing','unknown'].map(state=>({state,count:model.rows.filter(r=>r.state===state).length}));
    operationsOverview.innerHTML=`<div class="operations-cards">${cards.map(([id,title,count,hint,ico,tone])=>`<button type="button" class="panel operations-card" data-operation-filter="${id}" data-tone="${tone}" aria-pressed="${operationsFilter===id}"><span>${icon(ico)}${title}</span><strong>${fa.format(count)}</strong><small>${hint}</small></button>`).join('')}</div>
      ${model.unknown.length?`<p class="lifecycle-note warning-text" role="status">وضعیت گزارش ${fa.format(model.unknown.length)} شاخص خوانده نشد؛ این موارد در شمارندهٔ فاقد گزارش و معوق محاسبه نشده‌اند. دریافت اطلاعات به‌صورت خودکار دوباره تلاش می‌شود.</p>`:''}
      <div class="operations-layout"><section class="panel settings-card"><h3>وضعیت ثبت گزارش‌ها</h3><div class="operations-distribution" role="img" aria-label="${escape(counts.map(c=>stateNames[c.state]+': '+c.count).join('، '))}">${counts.filter(c=>c.count).map(c=>`<span data-state="${c.state}" style="flex-grow:${c.count}" title="${escape(stateNames[c.state])}: ${fa.format(c.count)}"></span>`).join('')}</div><div class="operations-legend">${counts.map(c=>`<span data-state="${c.state}">${stateNames[c.state]} <b>${fa.format(c.count)}</b></span>`).join('')}</div>${!model.rows.length?'<p class="workflow-muted">شاخص منتشرشده‌ای برای این فصل وجود ندارد.</p>':''}</section>
      <section class="panel settings-card"><h3>نظرسنجی‌های در انتظار پاسخ</h3>${model.pendingSurveys.length?model.pendingSurveys.map(c=>`<div class="operations-survey"><span><strong>${escape(c.employeeName||c.unitName||'نظرسنجی همکاران')}</strong><small>مهلت: ${escape(window.PanelDate.format(c.dueAt))}</small></span><button type="button" class="secondary-button" data-operation-survey="${escape(c.id)}">پاسخ‌دادن</button></div>`).join(''):'<p class="workflow-muted">نظرسنجی قابل پاسخی برای شما در این فصل باقی نمانده است.</p>'}</section></div>
      <section class="panel settings-card operations-tasks"><div class="panel-heading"><h3>کارها و تأخیرها</h3><div class="operations-filters">${[['all','همه'],['overdue','معوق'],['today','سررسید امروز'],['missing','فاقد گزارش']].map(([id,title])=>`<button type="button" class="secondary-button${operationsFilter===id?' is-active':''}" data-operation-filter="${id}" aria-pressed="${operationsFilter===id}">${title}</button>`).join('')}</div></div><div class="workflow-table-wrap"><table class="workflow-table"><thead><tr><th>شاخص</th><th>موعد / آخرین نوبت برنامه</th><th>وضعیت</th><th>تأخیر</th><th>اقدام</th></tr></thead><tbody>${selected.map(r=>`<tr><td><strong>${escape(r.task.title)}</strong><small>${r.task.kind==='project'?'پروژه‌ای':'روتین'}${r.task.frequency?' · '+escape(r.task.frequency):''}</small></td><td>${escape(dueLabel(r))}${r.upcoming?'<small>هفت روز آینده</small>':''}</td><td><span class="operations-state" data-state="${r.overdue?'overdue':r.state}">${r.overdue?'معوق · فاقد گزارش':stateNames[r.state]}</span></td><td>${escape(delayLabel(r))||'—'}</td><td>${openButton(r)}</td></tr>`).join('')||'<tr><td colspan="5">موردی در این فیلتر وجود ندارد.</td></tr>'}</tbody></table></div></section>
      <section class="panel settings-card operations-timeline"><h3>تایم‌لاین شاخص‌های پروژه‌ای</h3><p class="workflow-muted">نقاط تحویل، موعدهای برنامه هستند؛ عبور از تاریخ به‌تنهایی به معنی انجام یا رد مرحله نیست.</p>${model.rows.filter(r=>r.task.kind==='project').map(r=>{const checkpoints=[...(r.task.milestones||[]).map(m=>({name:m.name,date:m.dueDate})),...(r.task.dueDate?[{name:'تحویل نهایی',date:r.task.dueDate}]:[])].sort((a,b)=>String(a.date).localeCompare(String(b.date)));return `<article class="operations-project"><div class="panel-heading"><h4>${escape(r.task.title)}</h4>${openButton(r)}</div><ol>${checkpoints.map(m=>`<li data-past="${m.date<isoDay(new Date())}"><strong>${escape(m.name)}</strong><time datetime="${escape(m.date)}">${escape(window.PanelDate.format(m.date))}</time><small>${m.date<isoDay(new Date())?'موعد گذشته':m.date===isoDay(new Date())?'امروز':'پیش رو'}</small></li>`).join('')||'<li>نقطهٔ تحویل یا موعد ثبت نشده است.</li>'}</ol></article>`;}).join('')||'<p class="workflow-muted">شاخص پروژه‌ای منتشرشده برای این فصل وجود ندارد.</p>'}</section>
      <p class="lifecycle-note">«فاقد گزارش» به معنی نبود مستند فعال است، نه اثبات انجام‌نشدن کار. «بررسی‌شده» به معنی ثبت ارزیابی معتبر است، نه تأیید کیفیت صددرصدی. برای روتین‌های تکرارشونده، ثبت نوبت‌به‌نوبت موجود نیست؛ تأخیر فقط برآورد آخرین موعد برنامه در ماه انتخاب‌شده است و در امتیاز یا حقوق اعمال نمی‌شود.</p>`;
  }
  async function loadOperations(){
    if(session?.user.role!=='personnel'||!snapshot||snapshot.notApplicable)return;
    const token=session.token,requestedPeriod=period,owner=snapshot.employee.id,version=++operationsVersion,rows=snapshot.assignments.filter(a=>!a.positionClosed);operationsLoading=true;renderOperations();
    const reports=new Map();let next=0;
    await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{while(next<rows.length){if(version!==operationsVersion||session.token!==token||period!==requestedPeriod)return;const task=rows[next++];if(Number.isFinite(task.score)){reports.set(task.id,{count:0});continue;}try{const detail=await api('/api/activities/'+task.id);reports.set(task.id,{count:(detail.documents||[]).length});}catch{reports.set(task.id,{failed:true});}}}));
    if(version!==operationsVersion||session.token!==token||period!==requestedPeriod||snapshot?.employee.id!==owner)return;
    operationsReports=reports;operationsReportsKey=owner+'|'+requestedPeriod;operationsOverview.dataset.loadedKey=operationsReportsKey;operationsLoading=false;renderOperations();
  }
  operationsOverview.onclick=event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.operationTask){window.PanelAi?.open(button.dataset.operationTask,'dashboard',button);return;}
    if(button.dataset.operationSurvey||button.dataset.operationFilter==='surveys'){showView('surveys');const id=button.dataset.operationSurvey;if(id){const form=[...document.querySelectorAll('[data-survey-response]')].find(el=>el.dataset.surveyResponse===id);form?.scrollIntoView?.({block:'center'});form?.querySelector('input')?.focus();}return;}
    if(button.dataset.operationFilter){operationsFilter=button.dataset.operationFilter;renderOperations(true);scrollDashboardTarget('#operationsOverview .operations-tasks');}
  };
  window.addEventListener('panel:session',()=>{operationsVersion++;operationsReports.clear();operationsReportsKey='';delete operationsOverview.dataset.loadedKey;operationsOverview.removeAttribute('aria-busy');operationsLoading=false;operationsFilter='all';operationsOverview.replaceChildren();});
  function renderQuarterOverview(){
    if(!quarterProgress){quarterOverview.innerHTML='<p class="workflow-muted">خلاصهٔ فصل در حال دریافت است.</p>';return;}
    const q=quarterProgress,through=q.throughPeriod?monthLabel(q.throughPeriod):'آغاز فصل',progress=Number.isFinite(q.performance)?Math.min(100,Math.max(0,q.performance)):0;
    quarterOverview.innerHTML=`<div class="quarter-summary">
      <article class="panel quarter-summary-card"><span class="quarter-summary-icon" aria-hidden="true"><svg><use href="#i-pulse"/></svg></span><span>درصد تحقق سقف KPI در این فصل</span><div class="performance-donut" id="quarterPerformanceDonut" role="img" aria-label="${escape('درصد تحقق سقف KPI در این فصل: '+quarterPercent(q.performance))}" style="--progress:${progress}%"><div class="performance-donut-center"><strong>${quarterPercent(q.performance)}</strong><span>تحقق سقف فصل</span></div></div><small>مبلغ KPI محقق‌شده ÷ سقف کل فصل · تا ${through}</small></article>
      <article class="panel quarter-summary-card"><span class="quarter-summary-icon" aria-hidden="true"><svg><use href="#i-wallet"/></svg></span><span>دریافتی KPI در این فصل</span><strong>${money(q.earned)}</strong><small>مبلغ محقق‌شده تا ${through}</small></article>
      <article class="panel quarter-summary-card"><span class="quarter-summary-icon" aria-hidden="true"><svg><use href="#i-target"/></svg></span><span>سقف KPI کل دوره</span><strong>${money(q.ceiling)}</strong><small>حداکثر KPI قابل دریافت در فصل</small></article>
      <article class="panel quarter-summary-card"><span class="quarter-summary-icon" aria-hidden="true"><svg><use href="#i-banknote"/></svg></span><span>سقف دریافتی کل دوره</span><strong>${money(q.maxQuarterSalary)}</strong><small>حقوق ثابت بازه‌های این فصل + سقف KPI فصل</small></article>
      <article class="panel quarter-summary-card quarter-final-card"><div class="quarter-final-info"><div class="quarter-final-heading"><span class="quarter-summary-icon" aria-hidden="true"><svg><use href="#i-banknote"/></svg></span><h2>حقوق نهایی در این فصل</h2></div><dl class="quarter-final-breakdown"><div><dt>حقوق ثابت در این فصل</dt><dd>${money(q.baseSalaryToDate)}</dd></div><div><dt>KPI محقق‌شده</dt><dd>${money(q.earned)}</dd></div></dl></div><strong class="quarter-final-amount">${money(q.finalToDate)}</strong></article>
    </div><p class="formula-note">${q.pendingCount?'برای '+faPercent.format(q.pendingCount)+' مؤلفه هنوز امتیاز ثبت نشده است؛ مبالغ فقط از داده‌های ثبت‌شده محاسبه شده‌اند.':'مبالغ برای فصل انتخاب‌شده بر اساس داده‌های ثبت‌شده محاسبه شده‌اند.'} ارقام نمایشی‌اند.</p><section id="quarterPayDetails" class="panel settings-card"><h2>جزئیات دریافتی فصل</h2><p class="workflow-muted">ارقام نمایشی فصل تا ${escape(through)}؛ این بخش سند پرداخت نیست.</p><dl class="pay-breakdown">${[['حقوق ثابت در این فصل',q.baseSalaryToDate],['KPI محقق‌شده در این فصل',q.earned],['سقف KPI کل فصل',q.ceiling],['سقف دریافتی کل فصل',q.maxQuarterSalary],['حقوق نهایی در این فصل',q.finalToDate]].map(([label,value])=>`<div><dt>${label}</dt><dd>${money(value)}</dd></div>`).join('')}</dl></section>`;
  }
  $('#view-dashboard .kpi-panel h2').textContent='چهار بخش امتیاز عملکرد';
  $('#view-dashboard .kpi-panel .panel-heading p').textContent='امتیاز، ضریب مؤثر، مبلغ محقق‌شده و سقف هر بخش';
  $('#view-dashboard .metric-card.performance .metric-card-header>span:last-child').textContent='امتیاز کلی عملکرد';
  $('#view-dashboard .metric-card.incentive .metric-card-header>span:last-child').textContent='دریافتی عملکرد';
  $('#view-dashboard .metric-card.incentive .metric-progress-label span').textContent='تحقق از سقف عملکرد';
  $('#view-dashboard .insight-panel h2').textContent='ترکیب دریافتی عملکرد';
  $('#view-dashboard .pay-panel .formula-note').textContent='برآورد فصل: مبلغ هر مؤلفه = سقف مشوق فصل × وزن مؤثر × امتیاز مؤلفه. حقوق نهایی نمایشی = حقوق ثابت + مجموع مؤلفه‌های قابل محاسبه.';
  const kpiExclusionNotice=document.createElement('section');kpiExclusionNotice.className='panel settings-card';kpiExclusionNotice.id='kpiExclusionNotice';kpiExclusionNotice.hidden=true;kpiExclusionNotice.innerHTML='<h2>خارج از KPI فردی</h2><p>این سمت مشمول KPI فردی نیست؛ شاخص، امتیاز و مبلغ KPI برای آن محاسبه نمی‌شود.</p>';$('#view-dashboard .page-heading').after(kpiExclusionNotice);const excludedDashboardHidden=new Map();
  const detailStats=[['completed','مؤلفه‌های تکمیل‌شده'],['pending','مؤلفه‌های در انتظار'],['assignments','شاخص‌های مصوب']];
  $('#view-dashboard .performance-stats').insertAdjacentHTML('beforeend',detailStats.map(([id,title])=>`<article class="metric-card manager-detail-card" hidden><div class="metric-card-header"><span>${title}</span></div><div class="metric-card-value"><strong id="managerDetail-${id}">—</strong></div><small>در ماه انتخاب‌شده</small></article>`).join(''));
  const managerDetailBack=document.createElement('button');managerDetailBack.type='button';managerDetailBack.id='managerDetailBack';managerDetailBack.className='secondary-button';managerDetailBack.textContent='بازگشت به عملکرد واحد';managerDetailBack.hidden=true;$('#view-dashboard .page-heading').append(managerDetailBack);managerDetailBack.onclick=()=>{snapshot=null;$('#view-dashboard').hidden=true;showView('team');};
  function managerDetailPresentation(manager){
    $('#view-dashboard').classList.toggle('manager-personnel-detail',manager);managerDetailBack.hidden=!manager;document.querySelectorAll('.manager-detail-card').forEach(card=>card.hidden=!manager);
    $('#view-dashboard .performance-heading p:not(.eyebrow)').firstChild.textContent=manager?'خلاصه امتیازها و وضعیت شاخص‌ها در ':'خلاصه تحقق شاخص‌ها و برآورد دریافتی مبتنی بر KPI در ';
    $('#view-dashboard .performance-stats').setAttribute('aria-label',manager?'خلاصه امتیاز و وضعیت شاخص‌ها':'خلاصه عملکرد و دریافتی');$('#view-dashboard .kpi-panel .panel-heading p').textContent=manager?'امتیاز، ضریب مؤثر و وضعیت هر بخش':'امتیاز، ضریب مؤثر، مبلغ محقق‌شده و سقف هر بخش';
  }
  function renderManagerPersonnelDetail(data){
    const active=data.components.filter(c=>c.applicable);$('#managerDetail-completed').textContent=fa.format(active.filter(c=>Number.isFinite(c.score)).length);$('#managerDetail-pending').textContent=fa.format(active.filter(c=>!Number.isFinite(c.score)).length);$('#managerDetail-assignments').textContent=fa.format(data.assignments.length);
    for(const id of ['baseSalary','kpiAmount','kpiPotential','finalSalary','finalPotential','baseShare','kpiAttainment','finalAttainment','payBase','payMaxKpi','payEarnedKpi','payFinal'])$('#'+id).textContent='—';for(const id of ['kpiComposition','compositionLegend','kpiGapList'])$('#'+id).replaceChildren();
    $('#view-dashboard .kpi-panel h2').textContent=data.policy?.name||'مدل عمومی سازمان';$('#fourPartNote').textContent=(data.complete?'امتیاز همهٔ مؤلفه‌های مشمول تکمیل شده است. ':'امتیاز کلی تا تکمیل مؤلفه‌های در انتظار قطعی نمی‌شود. ')+`نسخهٔ ${data.policy.version} · ضرایب مدل: `+data.components.filter(c=>c.weight>0).map(c=>c.name+' '+percent(c.weight)).join('، ');
    $('#kpiList').innerHTML=data.components.filter(c=>data.policy.weights[c.id]>0).map(c=>`<article class="kpi-item" data-component="${escape(c.id)}"><div class="kpi-title"><div><h3>${escape(c.name)}</h3><p>${escape(c.id==='project'&&!data.hasProjects?'فرد پروژه ندارد؛ نمرهٔ صفر با همان سهم مدل':sources[c.id]||'منبع نیازمند پیکربندی')}</p></div><span class="kpi-score">${c.applicable?percent(c.score):'غیرمشمول'}</span></div><div class="kpi-progress" role="progressbar" aria-label="${escape(c.name)}" aria-valuemin="0" aria-valuemax="100" ${Number.isFinite(c.score)?`aria-valuenow="${c.score}"`:''} aria-valuetext="${c.applicable?percent(c.score):'غیرمشمول'}"><i style="--progress:${c.score||0}%"></i></div><div class="kpi-meta"><span>ضریب مؤثر: <b>${percent(c.weight)}</b></span><span>وضعیت: <b>${!c.applicable?'غیرمشمول':Number.isFinite(c.score)?'ثبت‌شده':'در انتظار ثبت امتیاز'}</b></span></div></article>`).join('');renderAssignments(data);bindDashboardShortcuts(data);
  }
  function renderDashboard(){
    if(!snapshot)return;
    clearDashboardShortcuts();
    $('#view-dashboard').hidden=false;
    managerDetailPresentation(session.user.role==='manager');
    kpiExclusionNotice.hidden=!snapshot.notApplicable;
    if(snapshot.notApplicable){dashboardHeading.querySelector('h1').hidden=false;for(const child of $('#view-dashboard').children)if(child!==kpiExclusionNotice&&!child.classList.contains('page-heading')){if(!excludedDashboardHidden.has(child))excludedDashboardHidden.set(child,child.hidden);child.hidden=true;}$('#view-dashboard .page-heading h1').textContent='پیشخوان '+snapshot.employee.name;$('#kpiList').replaceChildren();for(const id of ['overallPerformance','kpiPotential','kpiEarned','payMaxKpi','payEarnedKpi','finalSalary','payFinal'])if($('#'+id))$('#'+id).textContent='—';renderAssignments(snapshot);return;}
    for(const [child,hidden] of excludedDashboardHidden)child.hidden=hidden;excludedDashboardHidden.clear();
    const data=snapshot,active=data.components.filter(c=>c.applicable);
    setDashboardLevel(session.user.role==='personnel'?dashboardLevel:'month');renderQuarterOverview();if(dashboardLevel==='operations')renderOperations();
    $('#view-dashboard .page-heading h1').textContent=(dashboardLevel==='operations'&&session.user.role==='personnel'?'داشبورد ':dashboardLevel==='quarter'&&session.user.role==='personnel'?'عملکرد فصلی ':'عملکرد فصلی ')+data.employee.name;
    $('#kpiMonth').textContent=dashboardLevel==='quarter'&&session.user.role==='personnel'?quarterLabel(quarterProgress?.quarter||period):monthLabel(period);$('#kpiPeriod').textContent=monthLabel(period);
    $('#overallPerformance').textContent=data.performance===null?'—':quarterPercent(data.performance);
    $('#performanceDonut').style.setProperty('--progress',`${data.performance||0}%`);$('#performanceDonut').setAttribute('aria-label',data.performance===null?'امتیاز کلی در انتظار تکمیل داده‌ها':`امتیاز کلی ${quarterPercent(data.performance)}`);
    if(session.user.role==='manager'){renderManagerPersonnelDetail(data);return;}
    $('#baseSalary').textContent=Number.isFinite(data.baseSalary)?faMoney.format(data.baseSalary):'N/A';$('#kpiAmount').textContent=Number.isFinite(data.earned)?faMoney.format(data.earned):'N/A';$('#kpiPotential').textContent=`از سقف ${money(data.ceiling)}`;
    $('#finalSalary').textContent=Number.isFinite(data.knownTotal)?faMoney.format(data.knownTotal):'N/A';$('#finalPotential').textContent=`سقف قابل دریافت: ${money(data.maxFinalSalary)}`;
    $('#view-dashboard .metric-card.final .metric-card-header>span:last-child').textContent=data.complete?'حقوق نهایی نمایشی':'دریافتی تا این مرحله';
    for(const [label,bar,value] of [['baseShare','baseProgress',Number.isFinite(data.knownTotal)&&Number.isFinite(data.baseSalary)?data.knownTotal?100*data.baseSalary/data.knownTotal:0:NaN],['kpiAttainment','kpiProgress',Number.isFinite(data.ceiling)&&Number.isFinite(data.earned)?data.ceiling?100*data.earned/data.ceiling:0:NaN],['finalAttainment','finalProgress',Number.isFinite(data.maxFinalSalary)&&Number.isFinite(data.knownTotal)?data.maxFinalSalary?100*data.knownTotal/data.maxFinalSalary:0:NaN]]){
      const safeValue=Number.isFinite(value)?value:0;$('#'+label).textContent=percent(value);$('#'+bar).style.setProperty('--progress',safeValue+'%');$('#'+bar).setAttribute('aria-valuenow',String(Math.round(safeValue*10)/10));$('#'+bar).setAttribute('aria-valuetext',percent(value));
    }
    for(const [id,value] of [['payBase',data.baseSalary],['payMaxKpi',data.ceiling],['payEarnedKpi',data.earned],['payFinal',data.knownTotal]])$('#'+id).textContent=money(value);
    $('#payMaxKpi').previousElementSibling.textContent='سقف دریافتی عملکرد';$('#payEarnedKpi').previousElementSibling.textContent='مبلغ عملکرد محقق‌شده';$('#payFinal').previousElementSibling.textContent=data.complete?'حقوق نهایی نمایشی':'دریافتی تا این مرحله';
    $('#view-dashboard .kpi-panel h2').textContent=data.policy?.name||'مدل عمومی سازمان';
    $('#fourPartNote').textContent=(data.complete?'امتیاز همه مؤلفه‌های مشمول تکمیل شده است. ':'امتیاز کلی و حقوق نهایی تا تکمیل مؤلفه‌های در انتظار قطعی نمی‌شوند؛ مبلغ فعلی فقط بخش‌های دارای امتیاز را شامل می‌شود. ')+`نسخهٔ ${data.policy.version} · ضرایب مدل: `+data.components.filter(c=>c.weight>0).map(c=>c.name+' '+percent(c.weight)).join('، ')+(!data.hasProjects&&data.policy.weights.project>0?'؛ فرد پروژه ندارد: نمرهٔ پروژه صفر است و درصدهای مدل بدون بازتوزیع اعمال می‌شوند.':'');
    $('#kpiList').innerHTML=data.components.filter(c=>data.policy.weights[c.id]>0).map(c=>`<article class="kpi-item" data-component="${c.id}"><div class="kpi-title"><div><h3>${c.name}</h3><p>${c.id==='project'&&!data.hasProjects?'فرد پروژه ندارد؛ نمرهٔ صفر با همان سهم مدل':sources[c.id]||'منبع نیازمند پیکربندی'}</p></div><span class="kpi-score">${c.applicable?percent(c.score):'غیرمشمول'}</span></div><div class="kpi-progress" role="progressbar" aria-label="${c.name}" aria-valuemin="0" aria-valuemax="100" ${c.score!==null?`aria-valuenow="${c.score}"`:''} aria-valuetext="${c.applicable?percent(c.score):'غیرمشمول'}"><i style="--progress:${c.score||0}%"></i></div><div class="kpi-meta"><span>ضریب مؤثر: <b>${percent(c.weight)}</b></span><span>سقف: <b>${money(c.ceiling)}</b></span><span>دریافتی: <strong>${c.status==='pending'?'در انتظار':money(c.earned||0)}</strong></span></div></article>`).join('');
    $('#kpiComposition').setAttribute('aria-label','ترکیب مبلغ عملکرد محقق‌شده '+money(data.earned));$('#kpiComposition').innerHTML=data.components.filter(c=>data.policy.weights[c.id]>0).map((c,i)=>`<span class="composition-segment series-${i+1}" style="--share:${Number.isFinite(data.earned)&&data.earned?100*(c.earned||0)/data.earned:0}%"></span>`).join('');
    $('#compositionLegend').innerHTML=data.components.filter(c=>data.policy.weights[c.id]>0).map((c,i)=>`<div class="composition-item"><span class="composition-dot series-${i+1}"></span><span>${c.name}</span><strong>${c.applicable?(c.earned===null?'در انتظار':money(c.earned)):'غیرمشمول'}</strong></div>`).join('');
    const gaps=active.filter(c=>c.score!==null&&Number.isFinite(c.ceiling)&&Number.isFinite(c.earned)).sort((a,b)=>(b.ceiling-b.earned)-(a.ceiling-a.earned)),max=Math.max(0,...gaps.map(c=>c.ceiling-c.earned));
    const gapSeries=new Map(data.components.filter(c=>data.policy.weights[c.id]>0).map((c,i)=>[c.id,i+1]));
    $('#kpiGapList').innerHTML=gaps.map(c=>`<div class="gap-item" data-component="${c.id}"><div class="gap-item-label"><span>${c.name}</span><strong>${money(c.ceiling-c.earned)}</strong></div><div class="gap-track"><i class="series-${gapSeries.get(c.id)||1}" style="--progress:${max?100*(c.ceiling-c.earned)/max:0}%"></i></div></div>`).join('')||'<p>پس از ثبت امتیازها نمایش داده می‌شود.</p>';
    if(active.some(c=>c.score===null))$('#kpiGapList').insertAdjacentHTML('beforeend','<p class="formula-note">بخش‌های در انتظار امتیاز، در نمودار فاصله محاسبه نشده‌اند.</p>');
    renderAssignments(data);bindDashboardShortcuts(data);
  }
  function renderAssignments(data){
    const timeLabel=limit=>[limit.dayOfMonth!=null?'روز '+fa.format(limit.dayOfMonth)+' ماه':'',limit.dayOfWeek!=null?['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'][limit.dayOfWeek]:'','ساعت '+window.PanelDate.hourOnly(limit.time)].filter(Boolean).join(' · ');
    const assignmentQuarter=quarterLabel(data.period);
    for(const {view,panel,category,title,iconId} of assignmentViews){

      const weight=(data.currentPolicy||data.policy).weights[category]||0,closedRows=data.assignments.filter(a=>a.positionClosed&&(category==='project'?a.kind==='project':a.kind==='routine'||a.kind==='task')),rows=data.assignments.filter(a=>!a.positionClosed&&(category==='project'?a.kind==='project':a.kind==='routine'||a.kind==='task')&&(a.source==='approved-design'||weight>0&&(category!=='project'||data.hasProjects)));
      $('#view-'+view+' .page-heading .eyebrow').textContent=`تسک‌های مصوب · ${monthLabel(data.period)}`;
      const columns=[{key:'period',label:'دوره',width:90},{key:'weight',label:'وزن',width:72},{key:'share',label:'سهم',width:72},...(category==='routine'?[{key:'frequency',label:'تناوب',width:80},{key:'target',label:'تعداد',width:100},{key:'timing',label:'زمان انجام',width:160}]:[{key:'target',label:'تعداد',width:100},{key:'format',label:'فرمت مستندات',width:100},{key:'deadline',label:'موعد',width:110}])];
      if(category==='routine'&&rows.some(a=>a.documentFormat))columns.push({key:'format',label:'فرمت مستندات',width:100});if(category==='routine'&&rows.some(a=>a.dueDate))columns.push({key:'deadline',label:'موعد',width:110});if(rows.some(a=>a.deliverable))columns.push({key:'deliverable',label:'تحویل‌دادنی',width:150});columns.push({key:'score',label:'امتیاز',width:110});
      const gridStyle=`--assignment-columns:minmax(250px,1fr) ${columns.map(c=>c.width+'px').join(' ')};--assignment-min-width:${250+columns.reduce((sum,c)=>sum+c.width,0)+columns.length*12+20}px`;
      const groupHeading=`<h3 class="assignment-column-head"><span class="assignment-list-name" data-assignment-column="title">${icon(iconId)}<span class="assignment-group-title">لیست ${title}</span><small class="assignment-group-count" aria-label="${fa.format(rows.length)} شاخص">${fa.format(rows.length)}</small></span>${columns.map(c=>`<span class="assignment-column-label" id="${panel}-column-${c.key}" data-assignment-column="${c.key}">${c.label}</span>`).join('')}</h3>`;
      const empty=category==='project'
        ?`<div class="lifecycle-note" role="status"><h3 class="${weight>0&&!data.hasProjects?'warning-text':''}">پروژه‌ای برای شما تعریف نشده</h3><p>${!weight?'در مدل ارزیابی این فصل سهم پروژه صفر است؛ این بخش در امتیاز عملکرد شما محاسبه نمی‌شود.':!data.hasProjects?`در مدل ارزیابی شما سهم پروژه ${percent(weight)} است؛ چون پروژه ندارید نمرهٔ این بخش صفر است و سهم آن به بخش‌های دیگر منتقل نمی‌شود. برای پیگیری تعریف پروژه با مدیر مستقیم خود هماهنگ کنید.`:'برای ماه انتخاب‌شده هنوز شاخص پروژه‌ای منتشر نشده است. نمرهٔ این بخش تا ثبت ارزیابی در انتظار می‌ماند؛ برای پیگیری با مدیر مستقیم خود هماهنگ کنید.'}</p></div>`
        :`<p class="workflow-muted" role="status">${weight?'شاخص روتین مصوبی برای ماه انتخاب‌شده تعریف نشده است.':'در مدل ارزیابی این فصل سهم روتین صفر است؛ این بخش در امتیاز عملکرد شما محاسبه نمی‌شود.'}</p>`;
      const rowMarkup=a=>{
        const values={period:a.period?monthLabel(a.period):'—',weight:a.weightPoints!=null?fa.format(a.weightPoints)+' از ۵':'—',share:Number.isFinite(a.kpiWeight)?percent(a.kpiWeight):'—',frequency:a.frequency||'—',target:a.targetVolume!=null?[fa.format(a.targetVolume),a.targetUnit||''].filter(Boolean).join(' '):'—',timing:a.timeLimit?timeLabel(a.timeLimit):'—',format:a.documentFormat?window.PanelDocumentFormats[a.documentFormat]||a.documentFormat:'—',deliverable:a.deliverable||'—',deadline:a.dueDate?window.PanelDate.format(a.dueDate):'—',score:percent(a.score)};
        return `<button type="button" class="assignment-item assignment-task-row assignment-column-row" data-assignment-id="${escape(a.id)}" data-workflow-activity="${escape(a.id)}" aria-haspopup="dialog" aria-controls="activityDialog" aria-label="${escape((a.positionClosed?'مشاهدهٔ شاخص بسته‌شده ':'مشاهده و ثبت مستندات ')+a.title)}"><span class="assignment-row-title" data-assignment-column="title"><strong>${escape(a.title)}</strong>${a.description?`<span class="assignment-row-description" title="${escape(a.description)}">${escape(a.description)}</span>`:''}</span>${columns.map(c=>`<span class="${c.key==='score'?'assignment-score-cell':'assignment-meta'}" data-assignment-column="${c.key}" aria-describedby="${panel}-column-${c.key}" title="${escape(values[c.key])}">${c.key==='score'?`<span class="workflow-state">${escape(values[c.key])}</span>`:escape(values[c.key])}</span>`).join('')}</button>`;
      };
      $('#'+panel).innerHTML=`<h2>تسک‌های ${assignmentQuarter}</h2><p class="workflow-muted">${monthLabel(data.period)} · فقط شاخص‌های منتشرشدهٔ همین بخش نمایش داده می‌شوند. برای مشاهدهٔ جزئیات و ثبت مستندات، روی ردیف تسک کلیک کنید.</p><section class="assignment-group assignment-columns" style="${gridStyle}">${groupHeading}${rows.length?rows.map(rowMarkup).join(''):empty}</section>${closedRows.length?`<details class="activity-criteria"><summary>شاخص‌های بسته‌شدهٔ پیش از جابه‌جایی (${fa.format(closedRows.length)}) · فقط مشاهده</summary><section class="assignment-group assignment-columns" style="${gridStyle}">${closedRows.map(rowMarkup).join('')}</section></details>`:''}`;
    }
  }
  function renderManager(){
    $('#view-team').removeAttribute('aria-busy');
    const shownPeriod=teamPeriod||period;$('#view-team').dataset.period=shownPeriod;$('#teamPeriodNote').textContent=shownPeriod?'دورهٔ نمایش اطلاعات: '+monthLabel(shownPeriod)+(team.length&&!team.some(person=>person.components.some(component=>person.policy.weights[component.id]>0&&component.applicable&&Number.isFinite(component.score)&&(component.id!=='project'||person.hasProjects)))?' · هنوز امتیازی برای این فصل ثبت نشده است؛ دادهٔ ناموجود صفر محسوب نمی‌شود.':''):'';
    const componentMap=new Map(team.flatMap(person=>person.components.filter(c=>person.policy.weights[c.id]>0)).map(component=>[component.id,component])),componentRows=['exam','manager','routine','project','peer'].filter(id=>componentMap.has(id)).map(id=>componentMap.get(id));$('#view-team .workflow-table thead').innerHTML=`<tr><th>پرسنل</th>${componentRows.map(c=>`<th>${escape(c.name)}</th>`).join('')}<th>امتیاز کلی</th><th>وضعیت داده</th><th></th></tr>`;
    $('#teamSummary').innerHTML=`<article class="panel"><span>پرسنل واحد</span><strong>${fa.format(team.length)}</strong><small>در محدودهٔ مدیریت شما</small></article><article class="panel"><span>رضایت‌سنجی در انتظار</span><strong>${fa.format(team.filter(p=>p.policy.weights.manager>0&&!p.survey).length)}</strong><small>از ${fa.format(team.length)} نفر</small></article><article class="panel"><span>دادهٔ عملکرد ناقص</span><strong>${fa.format(team.filter(p=>!p.complete).length)}</strong><small>نیازمند تکمیل مؤلفه‌ها</small></article>`;
    $('#teamRows').innerHTML=team.map(p=>`<tr><td><strong>${escape(p.employee.name)}</strong><small>${escape(p.employee.level||'پرسنل')}</small></td>${componentRows.map(column=>{const c=p.components.find(component=>component.id===column.id);return `<td>${c?.applicable?percent(c.score):'غیرمشمول'}</td>`;}).join('')}<td>${percent(p.performance)}</td><td>${p.complete?'تکمیل':'در انتظار تکمیل'}</td><td><button class="secondary-button" data-person="${p.employee.id}">جزئیات</button></td></tr>`).join('')||`<tr><td colspan="${componentRows.length+4}">پرسنلی در واحد شما تعریف نشده است.</td></tr>`;
    for(const id of ['surveyEmployee','proposalEmployee']){const selected=$('#'+id).value,eligible=team.filter(p=>id==='surveyEmployee'?p.policy.weights.manager>0:p.policy.weights.routine>0||p.policy.weights.project>0);$('#'+id).innerHTML=eligible.map(p=>`<option value="${p.employee.id}">${escape(p.employee.name)}</option>`).join('');if(eligible.some(p=>p.employee.id===selected))$('#'+id).value=selected;}
    $('#surveyForm').hidden=!team.some(p=>p.policy.weights.manager>0);
    fillSurvey();$('#surveyList').innerHTML=team.map(p=>`<div class="workflow-list-row"><span>${escape(p.employee.name)}</span><strong>${p.survey?percent(p.survey.score):'ثبت نشده'}</strong></div>`).join('');
    $('#proposalList').innerHTML=proposals.filter(p=>p.period===period).map(p=>`<article class="proposal-item"><div><h3>${escape(p.title)}</h3><span class="workflow-state">${statusLabels[p.status]}</span></div><p>${escape(team.find(t=>t.employee.id===p.employeeId)?.employee.name||'')} · ${p.type==='task'?'تسک':'شاخص'} · ${p.category==='routine'?'روتین':'پروژه'}</p><p>${escape(p.description)}</p>${p.reason?`<p>نتیجه بررسی: ${escape(p.reason)}</p>`:''}</article>`).join('')||'<p class="workflow-muted">هنوز پیشنهادی در این دوره ثبت نشده است.</p>';
  }
  function fillSurvey(){const row=team.find(p=>p.employee.id===$('#surveyEmployee').value);$('#surveyForm').elements.score.value=row?.survey?.score??'';$('#surveyForm').elements.note.value=row?.survey?.note||'';}
  let managerReports=new Map(),managerReportVersion=0,managerReportsLoading=false,managerTaskFilter='all',managerPersonFilter='',managerTaskPage=1;
  function managerTasks(){return team.flatMap(person=>(person.assignments||[]).map(task=>({...task,employeeId:person.employee.id,employeeName:person.employee.name})));}
  function managerDashboardModel(){
    const tasks=managerTasks(),model=operationsSummary(tasks,managerReports,[],period),state=window.PanelLifecycle?.managerDashboardState||{designs:[],positions:[],appeals:[],deadlines:[]};
    const name=id=>team.find(p=>p.employee.id===id)?.employee.name||'پرسنل در محدودهٔ دسترسی';
    const requests=[...state.designs.filter(d=>d.period===period&&d.status==='manager_review').map(d=>({title:'بازبینی طرح KPI',employee:name(d.employeeId),view:'tasks'})),...state.positions.filter(p=>p.status==='manager_review').map(p=>({title:'بررسی تغییر سمت',employee:name(p.employeeId),view:'position-review'})),...state.appeals.filter(a=>a.status==='manager_review').map(a=>({title:'درخواست اعتراض',employee:name(a.employeeId),view:'position-review'}))];
    const deadlines=[...new Map(state.deadlines.map(row=>[row.employeeId,row])).values()];
    return {...model,requests,deadlines,missingEvaluations:team.filter(p=>p.policy?.weights.manager>0&&!p.survey),incomplete:team.filter(p=>!p.complete)};
  }
  function renderManagerDashboard(reportsReady=false){
    const area=$('#managerOperations');if(!area)return;if(session?.user.role!=='manager'){area.replaceChildren();return;}
    $('#view-manager-dashboard .page-heading h1').textContent='داشبورد '+session.user.name;$('#view-manager-dashboard .eyebrow').textContent='مدیر · '+monthLabel(period);
    if(managerReportsLoading){area.innerHTML='<p class="panel settings-card" role="status">در حال خواندن وضعیت گزارش‌های تیم…</p>';return;}
    const model=managerDashboardModel(),stateNames={reviewed:'بررسی‌شده',submitted:'منتظر بررسی',missing:'فاقد گزارش',unknown:'وضعیت نامشخص'};
    const cards=[['team','پرسنل زیرمجموعه',team.length,'در محدودهٔ مدیریت شما','i-users','neutral'],['overdue','کارهای معوق',model.overdue.length,'موعد گذشته · فاقد گزارش','i-clock','error'],['today','سررسید امروز',model.dueToday.length,'نیازمند پیگیری امروز','i-checklist','warning'],['missing','تسک‌های فاقد گزارش',model.missing.length,'معوق و موعدهای آینده','i-report','warning'],['submitted','گزارش‌های منتظر بررسی',model.rows.filter(r=>r.state==='submitted').length,'مستند ثبت‌شده؛ ارزیابی نهایی ندارد','i-inbox','warning'],['requests','تصمیم‌های منتظر مدیر',model.requests.length,'طرح KPI، تغییر سمت و اعتراض','i-appeal','warning'],['evaluations','ارزیابی مدیر ثبت‌نشده',model.missingEvaluations.length,'فقط پرسنل مشمول این مؤلفه','i-person-card','warning'],['definitions','هشدار تعریف تسک',model.deadlines.length,'هشدارهای باز سمت؛ مستقل از ماه','i-bell','error']];
    const counts=['reviewed','submitted','missing','unknown'].map(state=>({state,count:model.rows.filter(r=>r.state===state).length}));
    const selected=model.rows.filter(r=>(!managerPersonFilter||r.task.employeeId===managerPersonFilter)&&(managerTaskFilter==='overdue'?r.overdue:managerTaskFilter==='today'?r.dueToday:managerTaskFilter==='missing'?r.state==='missing':managerTaskFilter==='submitted'?r.state==='submitted':true)).sort((a,b)=>Number(b.overdue)-Number(a.overdue)||(a.dueAt??Infinity)-(b.dueAt??Infinity));
    const pages=Math.max(1,Math.ceil(selected.length/25));managerTaskPage=Math.min(managerTaskPage,pages);const rows=selected.slice((managerTaskPage-1)*25,managerTaskPage*25);
    const taskButton=r=>`<button type="button" class="secondary-button" data-manager-task="${escape(r.task.id)}">جزئیات</button>`;
    area.innerHTML=`<div class="operations-heading"><p class="workflow-muted">آمار از شاخص‌های منتشرشدهٔ ${escape(monthLabel(period))}؛ به وقت تهران</p><button type="button" class="secondary-button" data-manager-refresh>به‌روزرسانی</button></div><div class="operations-cards">${cards.map(([id,title,count,hint,ico,tone])=>`<button type="button" class="panel operations-card" data-manager-card="${id}" data-tone="${tone}" aria-pressed="${managerTaskFilter===id}"><span>${icon(ico)}${title}</span><strong>${fa.format(count)}</strong><small>${hint}</small></button>`).join('')}</div>
      ${model.unknown.length?`<p class="lifecycle-note warning-text" role="status">وضعیت گزارش ${fa.format(model.unknown.length)} شاخص نامشخص است و در شمارندهٔ معوق/فاقد گزارش منظور نشده؛ به‌روزرسانی را بزنید.</p>`:''}
      <div class="operations-layout"><section class="panel settings-card"><h3>وضعیت گزارش‌های تیم</h3><div class="operations-distribution" role="img" aria-label="${escape(counts.map(c=>stateNames[c.state]+': '+c.count).join('، '))}">${counts.filter(c=>c.count).map(c=>`<span data-state="${c.state}" style="flex-grow:${c.count}"></span>`).join('')}</div><div class="operations-legend">${counts.map(c=>`<span data-state="${c.state}">${stateNames[c.state]} <b>${fa.format(c.count)}</b></span>`).join('')}</div><p class="workflow-muted">${fa.format(model.incomplete.length)} نفر هنوز دادهٔ کامل ارزیابی این فصل را ندارند؛ دادهٔ ناموجود صفر محسوب نمی‌شود.</p></section>
      <section class="panel settings-card"><h3>اقدام‌های فوری مدیر</h3>${model.requests.slice(0,8).map(r=>`<div class="operations-survey"><span><strong>${escape(r.employee)}</strong><small>${r.title}</small></span><button type="button" class="secondary-button" data-manager-go="${r.view}">بررسی</button></div>`).join('')||'<p class="workflow-muted">درخواستی منتظر تصمیم شما نیست.</p>'}<div class="operations-filters"><button type="button" class="secondary-button" data-manager-go="surveys">ثبت ارزیابی مدیر (${fa.format(model.missingEvaluations.length)})</button><button type="button" class="secondary-button" data-manager-go="tasks">پیگیری تعریف شاخص</button></div></section></div>
      <section class="panel settings-card operations-tasks" id="managerTaskFollowup"><div class="panel-heading"><h3>پیگیری کارها و تأخیرهای تیم</h3><label>پرسنل <select id="managerTaskPerson" aria-label="فیلتر پرسنل داشبورد"><option value="">همهٔ تیم</option>${team.map(p=>`<option value="${escape(p.employee.id)}"${managerPersonFilter===p.employee.id?' selected':''}>${escape(p.employee.name)}</option>`).join('')}</select></label></div><div class="operations-filters">${[['all','همه'],['overdue','معوق'],['today','امروز'],['missing','فاقد گزارش'],['submitted','منتظر بررسی']].map(([id,title])=>`<button type="button" class="secondary-button${managerTaskFilter===id?' is-active':''}" data-manager-filter="${id}" aria-pressed="${managerTaskFilter===id}">${title}</button>`).join('')}</div><div class="workflow-table-wrap"><table class="workflow-table"><thead><tr><th>پرسنل / شاخص</th><th>موعد / آخرین نوبت برنامه</th><th>وضعیت</th><th>تأخیر</th><th>اقدام</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${escape(r.task.employeeName)}</strong><small>${escape(r.task.title)} · ${r.task.kind==='project'?'پروژه‌ای':'روتین'}</small></td><td>${r.due?escape(window.PanelDate.format(r.due.day)+(r.due.time?' · ساعت '+window.PanelDate.hourOnly(r.due.time):'')):'موعد ثبت نشده'}</td><td><span class="operations-state" data-state="${r.overdue?'overdue':r.state}">${r.overdue?'معوق · فاقد گزارش':stateNames[r.state]}</span></td><td>${r.overdue?r.delayHours>=24?fa.format(Math.floor(r.delayHours/24))+' روز':r.delayHours?fa.format(r.delayHours)+' ساعت':'کمتر از یک ساعت':'—'}</td><td>${taskButton(r)}</td></tr>`).join('')||'<tr><td colspan="5">موردی در این فیلتر وجود ندارد.</td></tr>'}</tbody></table></div><div class="operations-pagination"><button type="button" class="secondary-button" data-manager-page="-1"${managerTaskPage===1?' disabled':''}>قبلی</button><span>صفحه ${fa.format(managerTaskPage)} از ${fa.format(pages)} · ${fa.format(selected.length)} شاخص</span><button type="button" class="secondary-button" data-manager-page="1"${managerTaskPage===pages?' disabled':''}>بعدی</button></div></section>
      <section class="panel settings-card operations-timeline"><h3>موعدهای پروژه‌های تیم</h3><p class="workflow-muted">نقاط تحویل برنامه‌اند؛ رسیدن موعد به معنی تأیید یا انجام مرحله نیست.</p>${model.rows.filter(r=>r.task.kind==='project'&&(!managerPersonFilter||r.task.employeeId===managerPersonFilter)).map(r=>`<article class="operations-project"><div class="panel-heading"><h4>${escape(r.task.employeeName)} · ${escape(r.task.title)}</h4>${taskButton(r)}</div><ol>${[...(r.task.milestones||[]),...(r.task.dueDate?[{name:'تحویل نهایی',dueDate:r.task.dueDate}]:[])].sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate))).map(m=>`<li data-past="${m.dueDate<isoDay(new Date())}"><strong>${escape(m.name)}</strong><time datetime="${escape(m.dueDate)}">${escape(window.PanelDate.format(m.dueDate))}</time><small>${m.dueDate<isoDay(new Date())?'موعد گذشته':m.dueDate===isoDay(new Date())?'امروز':'پیش رو'}</small></li>`).join('')||'<li>موعد ثبت نشده است.</li>'}</ol></article>`).join('')||'<p class="workflow-muted">پروژهٔ منتشرشده‌ای در این محدوده وجود ندارد.</p>'}</section>
      <p class="lifecycle-note">فاقد گزارش به معنی نبود مستند فعال است، نه اثبات انجام‌نشدن. روتین‌ها تاریخچهٔ نوبت‌به‌نوبت ندارند؛ تأخیرشان برآوردی است. اطلاعات حقوق و پاسخ محرمانهٔ همکاران نمایش داده نمی‌شود و هیچ امتیاز یا تصمیمی خودکار تغییر نمی‌کند.</p>`;
    $('#managerTaskPerson').onchange=event=>{managerPersonFilter=event.target.value;managerTaskPage=1;renderManagerDashboard();};
    if(reportsReady&&pendingManagerDashboardFocus){const pending=pendingManagerDashboardFocus;pendingManagerDashboardFocus=null;if(pending.actor===session.user.id&&pending.period===period)scrollDashboardTarget('#managerTaskFollowup');}
  }
  async function loadManagerReports(){
    if(session?.user.role!=='manager')return;const version=++managerReportVersion,token=session.token,requestedPeriod=period,tasks=managerTasks(),reports=new Map();let index=0;managerReportsLoading=true;renderManagerDashboard();
    await Promise.all(Array.from({length:Math.min(4,tasks.length)},async()=>{while(index<tasks.length){if(version!==managerReportVersion||session.token!==token||period!==requestedPeriod)return;const task=tasks[index++];if(Number.isFinite(task.score)){reports.set(task.id,{count:0});continue;}try{const data=await api('/api/activities/'+task.id);reports.set(task.id,{count:(data.documents||[]).length});}catch{reports.set(task.id,{failed:true});}}}));
    if(version!==managerReportVersion||session.token!==token||period!==requestedPeriod)return;managerReports=reports;managerReportsLoading=false;renderManagerDashboard(true);
  }
  document.addEventListener('click',event=>{
    const area=event.target.closest('#managerOperations'),button=event.target.closest('button');if(!area||!button||button.disabled||session?.user.role!=='manager')return;
    if(button.hasAttribute('data-manager-refresh')){button.disabled=true;refresh().catch(error=>{area.innerHTML=`<p class="lifecycle-note warning-text" role="alert">${escape(error.message)}</p><button type="button" class="secondary-button" data-manager-refresh>تلاش دوباره</button>`;});return;}
    if(button.dataset.managerTask){window.PanelAi?.open(button.dataset.managerTask,'manager-dashboard',button);return;}
    if(button.dataset.managerGo){showView(button.dataset.managerGo);return;}
    if(button.dataset.managerPage){managerTaskPage+=Number(button.dataset.managerPage);renderManagerDashboard();return;}
    const filter=button.dataset.managerFilter||button.dataset.managerCard;if(!filter)return;
    if(filter==='requests'){scrollDashboardTarget('#managerOperations .operations-layout');return;}
    const links={team:'team',evaluations:'surveys',definitions:'tasks'};if(links[filter]){showView(links[filter]);return;}
    managerTaskFilter=filter;managerTaskPage=1;renderManagerDashboard();scrollDashboardTarget('#managerTaskFollowup');
  });
  window.addEventListener('panel:session',()=>{managerReportVersion++;managerReports.clear();managerReportsLoading=false;managerTaskFilter='all';managerPersonFilter='';managerTaskPage=1;$('#managerOperations')?.replaceChildren();});
  async function refresh(){
    if(!session)return;
    const version=++refreshVersion,requestedToken=session.token,requestedPeriod=period;
    const stale=()=>!session||version!==refreshVersion||requestedToken!==session.token||requestedPeriod!==period,role=session.user.role;
    try{
      let result=[];
      if(role==='manager'){if(teamPeriod!==requestedPeriod){$('#view-team').setAttribute('aria-busy','true');$('#teamPeriodNote').textContent='در حال خواندن اطلاعات '+monthLabel(requestedPeriod)+'…';$('#teamRows').replaceChildren();$('#teamSummary').replaceChildren();}result=await Promise.all([api('/api/workflow/team?period='+requestedPeriod),api('/api/workflow/proposals')]);}
      else if(role==='personnel'){const quarter=requestedPeriod;result=await Promise.all([api('/api/workflow/me?period='+requestedPeriod),api(`/api/org/quarters/${quarter}/progress?period=${requestedPeriod}`)]);}
      if(stale())return;
      await window.PanelLifecycle?.refresh();if(stale())return;
      if(role==='manager'){const [nextTeam,nextProposals]=result;let nextSnapshot=snapshot&&nextTeam.find(p=>p.employee.id===snapshot.employee.id)||null;if(nextSnapshot&&$('#view-dashboard').classList.contains('active')){nextSnapshot=await api('/api/workflow/employees/'+encodeURIComponent(nextSnapshot.employee.id)+'?period='+requestedPeriod);if(stale())return;}team=nextTeam;teamPeriod=requestedPeriod;proposals=nextProposals;snapshot=nextSnapshot;renderManager();renderManagerDashboard();if(!snapshot&&$('#view-dashboard').classList.contains('active')){$('#view-dashboard').hidden=true;showView('team');}}
      else if(role==='personnel')[snapshot,quarterProgress]=result;
      else{snapshot=null;quarterProgress=null;team=[];proposals=[];}
      renderDashboard();if(role==='personnel'&&dashboardLevel==='operations')await loadOperations();
      if(role==='manager'&&$('#view-manager-dashboard')?.classList.contains('active'))await loadManagerReports();
    }catch(error){if(!stale()){if(role==='manager')renderManager();throw error;}}
  }
  function applySession(){
    for(const id of ['demoRole','demoAccount']){const field=$('#'+id);field.closest('label').hidden=session.demo===false;}
    managerDetailPresentation(false);
    setDashboardLevel(session.user.role==='personnel'?dashboardLevel:'month');
    const photo=$('#personnelPhoto');if(photo){const label=`باز کردن اطلاعات پرسنلی ${accountName(session.user)}`;photo.setAttribute('aria-label',label);photo.title=label;photo.onclick=()=>showView('chart');}
    const role=session.user.role,manager=role==='manager',displayName=accountName(session.user);$('.profile-card strong').textContent=displayName;$('.profile-card small').textContent=role==='hr'?'دسترسی ادمین':`${session.user.unitName||'واحد نامشخص'} · ${session.user.jobTitle||session.user.level||'سمت ثبت نشده'}`;$('.profile-card .avatar').textContent=displayName.split(' ').map(x=>x[0]).join('').slice(0,2);
    $('#workflowRole').textContent=role==='manager'?'پنل مدیر':role==='hr'?'پنل ادمین':'پنل پرسنل';$('#demoRole').value=role;$('#demoAccount').innerHTML=session.accounts.filter(a=>a.role===role).map(a=>`<option value="${escape(a.id)}">${escape(accountName(a))}</option>`).join('');$('#demoAccount').value=session.user.id;$('#demoAccount').title=displayName;
    for(const name of ['team','surveys','proposals'])$(`[data-view="${name}"]`).hidden=!manager;
    $('[data-view="dashboard"]').hidden=role!=='personnel';for(const {view} of assignmentViews)$(`[data-view="${view}"]`).hidden=role!=='personnel';window.PanelLifecycle?.applySession(session.user);updatePeriodVisibility(document.querySelector('.view.active')?.id.slice(5));
  }
  $('#demoAccount').onchange=async e=>{
    if(busy||window.PanelAi?.working||window.PanelAiLog?.working||window.PanelLifecycle?.working||window.PanelNotes?.working||window.PanelScoreSettings?.working||window.PanelChat?.working){applySession();return message('ابتدا منتظر پایان عملیات جاری بمانید.',true);}
    setBusy(true);loading=true;
    try{session=await post('/api/session',{userId:e.target.value});snapshot=null;quarterProgress=null;dashboardLevel='operations';team=[];proposals=[];teamPeriod='';refreshVersion++;for(const {panel} of assignmentViews)$('#'+panel).replaceChildren();document.querySelectorAll('.view').forEach(view=>view.classList.remove('active'));$('#view-dashboard').hidden=true;renderManager();window.dispatchEvent(new Event('panel:session'));applySession();await refresh();loading=false;showView(homeView(session.user.role));message('حساب نمایشی تغییر کرد.');}catch(error){loading=false;applySession();if(!document.querySelector('.view.active'))showView(homeView(session.user.role));message(error.message,true);}finally{loading=false;setBusy(false);}
  };
  $('#demoRole').onchange=()=>{const choices=session.accounts.filter(account=>account.role===$('#demoRole').value),selected=choices[0];if(selected){$('#demoAccount').innerHTML=choices.map(a=>`<option value="${escape(a.id)}">${escape(accountName(a))}</option>`).join('');$('#demoAccount').value=selected.id;$('#demoAccount').onchange({target:$('#demoAccount')});}};
  async function applySelectedPeriod(){if(busy)return false;if(window.PanelAi?.working||window.PanelAiLog?.working||window.PanelLifecycle?.working||window.PanelNotes?.working||window.PanelScoreSettings?.working){fillMonthOptions(period);message('ابتدا منتظر پایان عملیات جاری بمانید.',true);return false;}setBusy(true);const previousPeriod=period;period=`${$('#workflowYear').value}-Q${$('#workflowQuarter').value}`;$('#workflowPeriod').value=period;$('#workflowPeriod').dispatchEvent(new Event('change'));try{await refresh();await window.PanelAiLog?.refresh();message('دوره ارزیابی به‌روز شد.');return true;}catch(error){period=previousPeriod;fillMonthOptions(period);$('#workflowPeriod').dispatchEvent(new Event('change'));await window.PanelAiLog?.refresh();message(error.message,true);return false;}finally{setBusy(false);updatePeriodLabel();}}
  $('#periodForm').onsubmit=async e=>{e.preventDefault();if(await applySelectedPeriod())closePeriod(true);};
  $('#surveyEmployee').onchange=fillSurvey;
  $('#surveyForm').onsubmit=async e=>{e.preventDefault();if(busy)return;const data=Object.fromEntries(new FormData(e.target));setBusy(true);try{await post('/api/workflow/surveys',{...data,score:Number(data.score),period});await refresh();message('رضایت‌سنجی ذخیره شد و امتیاز فرد به‌روز شد.');}catch(error){message(error.message,true);}finally{setBusy(false);}};
  $('#proposalForm').onsubmit=async e=>{e.preventDefault();if(busy)return;const data=Object.fromEntries(new FormData(e.target));setBusy(true);try{await post('/api/workflow/proposals',{...data,period});e.target.reset();await refresh();message('پیشنهاد در صف بررسی ثبت شد.');}catch(error){message(error.message,true);}finally{setBusy(false);}};
  $('#teamRows').onclick=async e=>{const button=e.target.closest('[data-person]');if(!button||busy||session?.user.role!=='manager'||!team.some(p=>p.employee.id===button.dataset.person))return;const token=session.token,selectedPeriod=period,origin=document.querySelector('.view.active');setBusy(true);try{const data=await api('/api/workflow/employees/'+encodeURIComponent(button.dataset.person)+'?period='+selectedPeriod);if(session?.token!==token||period!==selectedPeriod||document.querySelector('.view.active')!==origin)return;snapshot=data;renderDashboard();showView('dashboard');}catch(error){if(session?.token===token)message(error.message,true);}finally{if(session?.token===token)setBusy(false);}};
  for(const {panel,view} of assignmentViews)$('#'+panel).onclick=e=>{const button=e.target.closest('[data-workflow-activity]');if(button)window.PanelAi?.open(button.dataset.workflowActivity,view,button);};
  window.addEventListener('panel:view',e=>{updatePeriodVisibility(e.detail);if(['dashboard','manager-dashboard','team'].includes(e.detail))refresh().catch(error=>{if(e.detail==='manager-dashboard'){$('#managerOperations').innerHTML=`<p class="lifecycle-note warning-text" role="alert">${escape(error.message)}</p><button type="button" class="secondary-button" data-manager-refresh>تلاش دوباره</button>`;}else message(error.message,true);});});
  window.addEventListener('panel:reviewed',()=>refresh().catch(error=>message(error.message,true)));
  async function autoRefreshOperations(){if(document.hidden||busy||loading||operationsLoading||window.PanelLifecycle?.working||window.PanelAi?.working||session?.user.role!=='personnel'||dashboardLevel!=='operations'||!dashboardView.classList.contains('active'))return;try{await refresh();}catch(error){message(error.message,true);}}
  window.setInterval(autoRefreshOperations,60000);window.addEventListener('focus',autoRefreshOperations);document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoRefreshOperations();});
  const ready=(async()=>{
    try{const response=await fetch('/api/session');if(response.status===401){window.location.replace('/login.html');return;}if(!response.ok)throw new Error('دریافت نشست ناموفق بود.');session=await response.json();if(!session.user)throw new Error('سرور را برای فعال شدن گردش جدید مجدداً اجرا کنید.');period=session.period;fillMonthOptions(period);period=$('#workflowPeriod').value;applySession();if(session.mustChangePassword){loading=false;window.dispatchEvent(new Event('panel:password-required'));showView('account-security');return;}window.dispatchEvent(new Event('panel:session'));await refresh();loading=false;$('#demoRole').disabled=false;$('#demoAccount').disabled=false;$('#periodToggle').disabled=false;showView(homeView(session.user.role));message(session.demo?'محیط نمایشی · اطلاعات و ضرایب نسخه‌دار':'ورود به حساب شخصی انجام شد.');}
    catch(error){message(error.message,true);$('#view-dashboard').classList.remove('active');}
  })();
})();

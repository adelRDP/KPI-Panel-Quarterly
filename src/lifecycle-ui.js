(() => {
  const $=selector=>document.querySelector(selector),esc=escapeHtml,api=(path,options)=>window.PanelWorkflow.api(path,options),post=(path,data)=>window.PanelWorkflow.post(path,data);
const roleViews={announcements:['hr'],managerDashboard:['manager'],managerPersonnel:['manager'],peerSurveys:['manager'],chat:['personnel','manager','hr'],notes:['personnel','manager','hr'],quarters:['personnel','manager','hr'],tasks:['manager'],positionReview:['manager'],personnelRequestsArchive:['manager'],organization:['hr'],evaluationSettings:['hr'],scoreSettings:['hr'],updates:['hr'],duties:['hr'],incoming:['hr'],incomingArchive:['hr'],ai:['hr'],aiArchive:['hr'],chart:['personnel','manager','hr'],data:['hr'],appeals:['personnel','hr']};
  const labels={ai_pending:'در انتظار بررسی AI',ai_failed:'تحلیل AI ناموفق؛ آماده تلاش دوباره',manager_review:'در انتظار بازبینی مدیر',hr_review:'در انتظار بازبینی ادمین',published:'منتشرشده',draft:'پیش‌نویس',needs_revision:'نیازمند اصلاح',rejected:'ردشده',manager_review_position:'در انتظار مدیر مقصد',hr_approval:'در انتظار تصویب ادمین',locked:'قفل‌شده',incomplete:'ناقص؛ بدون صفرسازی',ready:'آماده بررسی',approved:'تأییدشده',returned:'برگشت‌خورده',completed:'تکمیل‌شده',complete:'کامل',partial:'بخشی',quarantined:'قرنطینه‌شده',open:'باز',insufficient:'مشارکت ناکافی؛ بدون امتیاز',collecting:'در حال جمع‌آوری پاسخ'};
  const money=value=>value===null||value===undefined?'—':Number.isFinite(value)?faMoney.format(value)+' تومان':'N/A',pct=value=>value===null||value===undefined?'در انتظار':Number.isFinite(value)?faPercent.format(value)+'٪':'N/A';
  let user=null,positions=[],positionRequests=[],managerRequestsData={positions:[],appeals:[]},designs=[],deadlines=[],quarterRows=[],evaluations=[],appeals=[],campaigns=[],examImports=[],orgChart=null,orgUnits=[],orgSections=[],evaluationSettingsData=null,evaluationModelsData=null,selectedSettingsUnitId=null,selectedServiceCampaignId=null,stagedDesignTasks=[],designDraftEmployeeId=null;
  const expandedSurveyMonths=new Set();let refreshVersion=0,activeWrites=0,personnelImportPreview=null;
  let aiCapabilities={jobAnalysis:false,alignment:false};const jobAnalysisResults=new Map();
  let correctionEditor=null;
  let editingClarifications=[],clarificationWrite=false;
  let incomingArchiveVersion=0,incomingArchivePage=1;
  const quarterNow=()=>{const period=$('#workflowPeriod')?.value||window.PanelWorkflow.user?.period||'';return period;};
  function makeView(id,title,iconId,roles){
    iconId=({notes:'i-note',chat:'i-chat',quarters:'i-chart-bars','position-review':'i-person-card',updates:'i-person-card',duties:'i-checklist',incoming:'i-inbox',ai:'i-ai',chart:'i-org-chart',data:'i-checklist',appeals:'i-appeal'})[id]||iconId;
    const nav=document.createElement('button');nav.className='nav-item';nav.dataset.view=id;nav.dataset.lifecycleView='true';nav.title=title;nav.setAttribute('aria-label',title);nav.hidden=true;nav.innerHTML=`<svg><use href="#${iconId}"/></svg><span>${title}</span>`;nav.onclick=()=>window.PanelWorkflow.go(id);$('.main-nav').append(nav);
    const view=document.createElement('section');view.className='view workflow-view';view.id='view-'+id;view.dataset.lifecycleRoles=roles.join(',');$('main').append(view);return view;
  }
  makeView('notes','یادداشت‌ها','i-file',roleViews.notes);
  makeView('chat','Chat','i-users',roleViews.chat);
  makeView('announcements','اطلاعیه‌ها','i-megaphone',roleViews.announcements);
  const managerDashboardView=makeView('manager-dashboard','داشبورد','i-home',roleViews.managerDashboard);
  managerDashboardView.innerHTML='<div class="page-heading"><div><p class="eyebrow">مدیر · پیگیری تیم</p><h1>داشبورد مدیریتی</h1><p>موعدها، وضعیت گزارش‌ها و تصمیم‌های در انتظار در محدودهٔ دسترسی شما</p></div></div><div id="managerOperations"><p class="workflow-muted" role="status">در حال دریافت اطلاعات تیم…</p></div>';
  const quarterView=makeView('quarters','ارزیابی فصلی','i-pulse',roleViews.quarters);
  quarterView.innerHTML='<div class="page-heading"><div><p class="eyebrow">چرخهٔ ارزیابی و جبران خدمات</p><h1>ارزیابی فصلی KPI</h1><p id="quarterIntro">ارزیابی مستقیم فصل، یک نمره برای هر مؤلفه و تأیید مدیر و ادمین</p></div><span class="demo-badge">پنل فصلی مستقل</span></div><section id="quarterCards" class="panel settings-card"><p class="workflow-muted">در حال بارگذاری فصل…</p></section><section id="quarterInbox" class="panel settings-card lifecycle-section"></section>';
  const taskView=makeView('tasks','تعریف شاخص‌ها','i-target',roleViews.tasks);
  quarterView.insertAdjacentHTML('beforeend','<section id="positionCloseoutPanel" class="panel settings-card lifecycle-section" hidden><h2>سوابق بسته‌شدهٔ جابه‌جایی و تسویه</h2><p class="workflow-muted">امتیاز و مبلغ این بازه‌ها قطعی است؛ در جمع فصل فقط یک بار منظور می‌شود و پرداخت بانکی از این بخش انجام نمی‌شود.</p><button type="button" id="loadPositionCloseouts" class="secondary-button">نمایش سوابق بسته‌شده</button><div id="positionCloseoutHistory" aria-live="polite"></div></section>');
  $('#loadPositionCloseouts').onclick=async()=>{const actorId=user?.id,button=$('#loadPositionCloseouts'),container=$('#positionCloseoutHistory');if(!['hr','personnel'].includes(user?.role))return;button.disabled=true;try{const rows=await api('/api/org/position-closeouts');if(user?.id!==actorId)return;container.innerHTML=rows.length?rows.map(row=>`<details class="activity-criteria"><summary>${esc(accounts().find(p=>p.id===row.employeeId)?.name||row.employeeId)} · ${esc(window.PanelDate.format(row.start))} تا ${esc(window.PanelDate.format(row.months.at(-1)?.lastDay||row.end))} · ${money(row.earned)}</summary><p>امتیاز: ${pct(row.performance)} · مبلغ قطعی KPI: ${money(row.earned)} · قفل‌شده در ${esc(archiveDate(row.lockedAt))}</p>${table(['فصل','روز','امتیاز','مبلغ KPI'],row.months.map(m=>`<tr><td>${esc(window.PanelWorkflow.monthLabel(m.period))}</td><td>${fa.format(m.days)}</td><td>${pct(m.performance)}</td><td>${money(m.earned)}</td></tr>`).join(''),'')}</details>`).join(''):'<p class="workflow-muted">هنوز بازهٔ بسته‌شده‌ای ثبت نشده است.</p>';}catch(error){if(user?.id===actorId)container.textContent=error.message;}finally{button.disabled=false;}};
  const quarterFilters=document.createElement('form');quarterFilters.id='quarterFilters';quarterFilters.className='panel settings-card lifecycle-section';quarterFilters.hidden=true;quarterFilters.innerHTML='<div class="form-grid"><label>جست‌وجوی نام پرسنل<input id="quarterPersonnelSearch" type="search" maxlength="120" placeholder="نام یا نام خانوادگی" autocomplete="off"></label><label>واحد سازمانی<select id="quarterUnitFilter"><option value="all">همهٔ واحدها</option></select></label><button type="button" id="quarterFiltersClear" class="secondary-button">پاک‌کردن فیلترها</button></div><p id="quarterResultCount" class="workflow-muted" role="status" aria-live="polite"></p>';$('#quarterCards').before(quarterFilters);
  const quarterName=value=>String(value||'').normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\s\u200c]+/g,'').toLowerCase();
  const quarterUnitKey=employee=>employee?.unitId?'id:'+employee.unitId:employee?.unitName?'name:'+employee.unitName:'unknown';
  const quarterUnitLabel=employee=>employee?.unitName||'ثبت نشده';
  const quarterMatches=employee=>{const tokens=$('#quarterPersonnelSearch').value.trim().split(/\s+/).filter(Boolean),unit=$('#quarterUnitFilter').value;return (unit==='all'||quarterUnitKey(employee)===unit)&&tokens.every(token=>quarterName(employee?.name).includes(quarterName(token)));};
  function syncQuarterUnits(){const field=$('#quarterUnitFilter'),selected=field.value,units=new Map(quarterRows.map(row=>[quarterUnitKey(row.employee),quarterUnitLabel(row.employee)]));field.innerHTML='<option value="all">همهٔ واحدها</option>'+[...units].sort((a,b)=>a[1].localeCompare(b[1],'fa')).map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');field.value=units.has(selected)?selected:'all';}
  function filterQuarterRows(){renderQuarters();if(user?.role==='hr')renderQuarterInbox();}
  quarterFilters.onsubmit=event=>{event.preventDefault();filterQuarterRows();};$('#quarterPersonnelSearch').addEventListener('input',filterQuarterRows);$('#quarterUnitFilter').addEventListener('change',filterQuarterRows);$('#quarterFiltersClear').onclick=()=>{quarterFilters.reset();filterQuarterRows();};
  const designWeekdays=['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
  const designTargetUnits=['عدد','مورد','گزارش','فایل','سند','درخواست','تماس','جلسه','ساعت','دقیقه','صفحه','محصول','پروژه'];
  taskView.innerHTML=`<div class="page-heading"><div><p class="eyebrow">مدیر · تعریف براساس شرح وظایف</p><h1>تعریف شاخص‌های KPI</h1><p>ابتدا پیش‌نویس را ذخیره کنید؛ انتشار آن را مستقیم برای بررسی AI می‌فرستد. تخصیص به پرسنل همچنان پس از تأیید مدیر و ادمین انجام می‌شود.</p></div></div><div><form id="designForm" class="panel settings-card" novalidate><h2>تعریف شاخص</h2><p id="designEditingNote" class="workflow-muted" hidden></p>
    <div class="design-fields-grid"><label>پرسنل<select name="employeeId" id="designEmployee" required></select></label><label>نوع شاخص<select name="category"><option value="routine">روتین</option><option value="project">پروژه‌ای</option></select></label>
    <label class="design-title-field">عنوان تسک<input name="title" maxlength="200" required></label>
    <fieldset class="design-repeat-group"><legend>شرح، هدف و مسئولیت</legend><div id="designDescriptionFields" class="design-description-fields"></div><button type="button" id="addDesignDescription" class="secondary-button design-add-box" aria-label="افزودن باکس توضیحات" title="افزودن باکس توضیحات" aria-controls="designDescriptionFields"><span aria-hidden="true">+</span></button><p class="workflow-muted">در باکس‌های تکمیلی می‌توانید عنوان دلخواه بنویسید. مجموع توضیحات حداکثر ۴۰۰۰ نویسه است.</p></fieldset>
    <fieldset class="design-repeat-group"><legend>معیارهای پذیرش</legend><div id="designCriteriaFields" class="design-criteria-fields"></div><button type="button" id="addDesignCriterion" class="secondary-button design-add-box" aria-label="افزودن معیار" title="افزودن معیار" aria-controls="designCriteriaFields"><span aria-hidden="true">+</span></button><p class="workflow-muted">هر باکس برای یک معیار مستقل است؛ حداکثر ۱۲ معیار، هر معیار تا ۵۰۰ نویسه. باکس خالی ذخیره نمی‌شود.</p></fieldset>
    <div class="design-schedule-fields"><label>وزن تسک (۱ تا ۵)<select name="weight" required>${[1,2,3,4,5].map(value=>`<option value="${value}">${fa.format(value)}</option>`).join('')}</select></label>
    <div id="routineFields"><label>تناوب<select name="frequency" required>${['فصلی','ماهانه','هفتگی','روزانه','ساعتی'].map(value=>`<option>${value}</option>`).join('')}</select></label>
    <div id="designTimeLimit" class="form-grid"><label id="designMonthDay">روز ماه<select name="dayOfMonth"><option value="">انتخاب روز ماه</option>${Array.from({length:31},(_,index)=>`<option value="${index+1}">${fa.format(index+1)}</option>`).join('')}</select></label><label id="designWeekDay">روز هفته<select name="dayOfWeek"><option value="">انتخاب روز هفته</option>${designWeekdays.map((day,index)=>`<option value="${index}">${day}</option>`).join('')}</select></label><div class="design-time-field"><span>ساعت انجام</span><div class="design-time-picker" role="group" aria-label="انتخاب ساعت انجام شاخص" dir="ltr"><span aria-hidden="true">◷</span><select name="timeLimitHour" aria-label="ساعت" required><option value="">ساعت</option>${Array.from({length:24},(_,index)=>`<option value="${String(index).padStart(2,'0')}">${fa.format(index).padStart(2,'۰')}</option>`).join('')}</select></div></div></div>
    </div><label><span id="designTargetVolumeLabel">تعداد در ماه</span><input name="targetVolume" type="number" min="1" step="1" value="1" required></label><label>واحد هدف<select name="targetUnit" required>${designTargetUnits.map(unit=>`<option>${unit}</option>`).join('')}</select></label>
    <div id="projectFields" hidden><label>فرمت مستندات<select name="documentFormat"><option value="">انتخاب فرمت مستندات</option>${Object.entries(window.PanelDocumentFormats).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><div class="design-deadline-field"><label for="designDeadline">موعد پروژه</label><input id="designDeadline" name="deadline" type="text" readonly placeholder="انتخاب از تقویم فارسی" dir="ltr" role="combobox" aria-haspopup="dialog" aria-expanded="false" aria-controls="designDeadlineCalendar"><div id="designDeadlineCalendar" class="persian-calendar" role="dialog" aria-label="انتخاب موعد پروژه از تقویم فارسی" hidden></div></div></div></div></div>
    <p id="designWeightSummary" class="workflow-muted" aria-live="polite"></p><p class="formula-note">سهم هر تسک = وزن آن ÷ مجموع وزن تسک‌های همان نوع × ۱۰۰. وزن‌های روتین و پروژه‌ای جداگانه محاسبه می‌شوند؛ درصدهای مدل ارزیابی واحد تغییر نمی‌کنند.</p><div class="design-form-actions"><button class="primary-button">ذخیرهٔ پیش‌نویس</button><button type="button" id="designHelpToggle" class="secondary-button" aria-expanded="false" aria-controls="designHelp">راهنما</button><button type="button" id="cancelDesignEdit" class="secondary-button" hidden>لغو ویرایش</button></div>
    <section id="designHelp" class="design-help" aria-labelledby="designHelpTitle" hidden><h3 id="designHelpTitle">راهنمای تعریف شاخص</h3>
    <ol><li><strong>از شرح وظایف شروع کنید:</strong> پرسنل و دورهٔ درست را انتخاب کنید؛ خروجی مورد انتظار و حدود مسئولیت فرد را روشن بنویسید.</li>
    <li><strong>نوع و عنوان را مشخص کنید:</strong> کار تکرارشونده «روتین» و کار با خروجی و پایان مشخص «پروژه‌ای» است. عنوان کوتاه و شرح کار دقیق باشد.</li>
    <li><strong>معیار پذیرش قابل‌سنجش بنویسید:</strong> هر شرط در یک باکس جدا؛ برای شرط بیشتر دکمهٔ «+» زیر معیارها را بزنید. تعداد، کیفیت، بازهٔ زمانی و مدرک تحقق آن مشخص باشد. عبارت‌هایی مثل «انجام خوب کار» کافی نیست.</li>
    <li><strong>زمان و مقدار را هماهنگ کنید:</strong> برای روتین، تناوب، تعداد هدف، واحد و ساعت را کامل کنید؛ برای پروژه، موعد و فرمت مستندات را مشخص کنید. وابستگی به کار دیگران را در شرح توضیح دهید.</li>
    <li><strong>وزن را نسبی تعیین کنید:</strong> عدد ۱ تا ۵ نشان‌دهندهٔ اهمیت شاخص در میان شاخص‌های همان نوع است؛ سهم درصدی را پنل محاسبه می‌کند.</li>
    <li><strong>مسیر ثبت را بشناسید:</strong> «ذخیرهٔ پیش‌نویس» امکان ویرایش می‌دهد؛ انتشار نسخه، آن را برای AI می‌فرستد. تخصیص به پرسنل پس از تأیید مدیر و ادمین انجام می‌شود.</li></ol>
    <div class="design-help-example"><strong>نمونهٔ شاخص روتین</strong><p>عنوان: تهیهٔ گزارش ماهانهٔ مغایرت‌ها · هدف: ۱ گزارش در ماه، تا روز ۲۰ ساعت ۱۴.</p><p>معیارها: همهٔ مغایرت‌های همان ماه با منبع و وضعیت ثبت شوند؛ برای هر مورد، تاریخ، مسئول پیگیری و اقدام بعدی مشخص باشد. این دو معیار را در دو باکس جدا بنویسید.</p></div></section></form></div>
    <section id="designDraftPanel" class="panel settings-card lifecycle-section"><h2>نسخه‌های پیش‌نویس</h2><p class="workflow-muted">پیش‌نویس ذخیره‌شده قابل ویرایش و حذف است؛ دکمهٔ انتشار، همان نسخه را مستقیم برای بررسی AI می‌فرستد.</p><div id="designDraftList"></div></section>
    <section id="designPublishedPanel" class="panel settings-card lifecycle-section"><h2>نسخه‌های منتشرشده</h2><p class="workflow-muted">موارد ارسال‌شده برای AI و مراحل تأیید اینجا نمایش داده می‌شوند. «ارسال‌شده» به معنی تأیید یا تخصیص نهایی نیست. حذف رکورد از فهرست فعال، سابقه و نتایج قفل‌شده را تغییر نمی‌دهد.</p><div id="designList"></div></section>`;
  $('#designHelpToggle').onclick=()=>{const help=$('#designHelp');help.hidden=!help.hidden;$('#designHelpToggle').setAttribute('aria-expanded',String(!help.hidden));};
  let designFieldSequence=0;
  const descriptionLabels=['شرح','هدف','مسئولیت'];
  const composeDescription=sections=>sections.slice(1).every(s=>!s.text)?sections[0]?.text||'':sections.filter(s=>s.text).map(s=>s.title+':\n'+s.text).join('\n\n');
  function readDescriptionSections(){return [...$('#designDescriptionFields').children].map(row=>({title:row.querySelector('[data-section-title]')?.value.trim()||row.dataset.title,text:row.querySelector('textarea').value.trim()}));}
  function updateDesignFieldButtons(){
    const disabled=!!$('#designForm').dataset.submitting||!$('#designForm').elements.employeeId.value;
    $('#addDesignDescription').disabled=disabled||$('#designDescriptionFields').children.length>=20;
    $('#addDesignCriterion').disabled=disabled||$('#designCriteriaFields').children.length>=12;
    [...$('#designCriteriaFields').children].forEach((row,index)=>{row.querySelector('label > span').textContent='معیار '+fa.format(index+1);const remove=row.querySelector('button');if(remove)remove.setAttribute('aria-label','حذف معیار '+fa.format(index+1));});
  }
  function appendDescriptionField(section,index){
    const row=document.createElement('div'),id='designDescription-'+(++designFieldSequence);row.className='design-repeat-item';row.dataset.title=descriptionLabels[index]||section.title||'توضیحات تکمیلی';
    row.innerHTML=index<3?`<label for="${id}">${descriptionLabels[index]}<textarea id="${id}" ${index===0?'name="description" required':''} rows="1" maxlength="4000">${esc(section.text||'')}</textarea></label>`:`<label>عنوان باکس<input data-section-title maxlength="80" required value="${esc(section.title||'توضیحات تکمیلی')}"></label><label for="${id}">متن توضیحات<textarea id="${id}" rows="1" maxlength="4000">${esc(section.text||'')}</textarea></label><button type="button" class="secondary-button" data-remove-description>حذف باکس</button>`;
    $('#designDescriptionFields').append(row);return row;
  }
  function appendCriterionField(value,index){
    const row=document.createElement('div'),id='designCriterion-'+(++designFieldSequence);row.className='design-repeat-item';
    row.innerHTML=`<label for="${id}"><span>معیار ${fa.format(index+1)}</span><textarea id="${id}" ${index===0?'name="criteria"':''} rows="1" maxlength="500">${esc(value||'')}</textarea></label>${index>1?'<button type="button" class="secondary-button" data-remove-criterion>حذف معیار</button>':''}`;
    $('#designCriteriaFields').append(row);return row;
  }
  function loadDesignFieldEditors(task={}){
    const saved=task.descriptionSections,valid=Array.isArray(saved)&&saved.length>=3&&descriptionLabels.every((label,i)=>saved[i]?.title===label)&&composeDescription(saved)===(task.description||'');
    const sections=valid?saved:descriptionLabels.map((title,index)=>({title,text:index===0?task.description||'':''}));
    $('#designDescriptionFields').replaceChildren();sections.forEach(appendDescriptionField);
    const criteria=[...(task.criteria||[])];while(criteria.length<2)criteria.push('');$('#designCriteriaFields').replaceChildren();criteria.forEach(appendCriterionField);updateDesignFieldButtons();
  }
  const notifyDesignFieldsChanged=()=>$('#designForm').elements.description.dispatchEvent(new Event('input',{bubbles:true}));
  $('#addDesignDescription').onclick=()=>{const count=$('#designDescriptionFields').children.length;if(count>=20)return;const row=appendDescriptionField({title:'توضیحات تکمیلی '+fa.format(count-2),text:''},count);updateDesignFieldButtons();row.querySelector('input').focus();};
  $('#addDesignCriterion').onclick=()=>{const count=$('#designCriteriaFields').children.length;if(count>=12)return;const row=appendCriterionField('',count);updateDesignFieldButtons();row.querySelector('textarea').focus();};
  for(const selector of ['#designDescriptionFields','#designCriteriaFields'])$(selector).onclick=event=>{const button=event.target.closest('[data-remove-description],[data-remove-criterion]');if(!button)return;const row=button.closest('.design-repeat-item');if([...row.querySelectorAll('input,textarea')].some(el=>el.tagName==='TEXTAREA'&&el.value.trim())&&!confirm('متن این باکس از فرم حذف شود؟'))return;row.remove();updateDesignFieldButtons();notifyDesignFieldsChanged();$(selector==='#designDescriptionFields'?'#addDesignDescription':'#addDesignCriterion').focus();};
  loadDesignFieldEditors();
  const deadlinePanel=document.createElement('details');deadlinePanel.className='design-deadline-note';deadlinePanel.innerHTML='<summary>مهلت تعریف شاخص طبق قانون مؤثر؛ پیش‌فرض ۵ روز کاری</summary><div id="deadlineList"></div>';$('#designForm').querySelector('h2').after(deadlinePanel);
  const designPeriodPanel=document.createElement('section');designPeriodPanel.className='panel settings-card lifecycle-section design-period-filter';designPeriodPanel.innerHTML='<label>نمایش نسخه‌ها<select id="designPeriodScope"><option value="current">دورهٔ انتخاب‌شده</option><option value="all">همهٔ دوره‌ها</option></select></label><p id="designPeriodSummary" class="workflow-muted" role="status" aria-live="polite"></p>';$('#designDraftPanel').before(designPeriodPanel);
  let designListPeriod=null;$('#designPeriodScope').addEventListener('change',()=>renderTasks());
  window.addEventListener('panel:session',()=>{designListPeriod=null;$('#designPeriodScope').value='current';});
  function revealDesign(id){if(user?.role==='manager'&&designs.some(d=>d.id===id)){$('#designPeriodScope').value='all';renderTasks();}}
  const designClarificationArea=document.createElement('section');designClarificationArea.id='designClarificationAnswers';designClarificationArea.className='design-clarification-answers';designClarificationArea.hidden=true;$('#designWeightSummary').before(designClarificationArea);
  const finalReviewNotice=document.createElement('p');finalReviewNotice.id='designFinalReviewNotice';finalReviewNotice.className='warning-text';finalReviewNotice.hidden=true;$('#designWeightSummary').before(finalReviewNotice);
  const positionView=makeView('position-review','درخواست‌های پرسنلی','i-inbox',roleViews.positionReview);
positionView.innerHTML='<div class="page-heading"><div><p class="eyebrow">مدیر · درخواست‌های زیرمجموعه</p><h1>درخواست‌های پرسنلی</h1><p>ثبت پرسنل جدید، تغییر سمت و اعتراض‌ها؛ تصمیم نهایی ادمین و سوابق محفوظ‌اند.</p></div></div><div id="managerRequestsOverview" class="hr-overview manager-request-overview"></div><section class="panel settings-card"><div id="managerRequestsFilters" class="form-grid"><label>جست‌وجوی درخواست<input id="managerRequestsSearch" type="search" maxlength="120" placeholder="نام، سمت یا متن درخواست"></label><label>نوع درخواست<select id="managerRequestsType"><option value="all">همهٔ درخواست‌ها</option><option value="registration">ثبت پرسنل جدید</option><option value="position">تغییر سمت</option><option value="appeal">اعتراض</option></select></label><button type="button" class="secondary-button" data-refresh-lifecycle>تازه‌سازی</button></div></section><section class="panel settings-card lifecycle-section" data-manager-request-group="registration"><h2>ثبت پرسنل جدید</h2><div id="managerRegistrationList"></div></section><section class="panel settings-card lifecycle-section" data-manager-request-group="position"><h2>تغییر سمت</h2><div id="positionRequestList"></div></section><section class="panel settings-card lifecycle-section" data-manager-request-group="appeal"><h2>اعتراض‌ها</h2><div id="managerAppealList"></div></section>';
  const orgView=makeView('organization','مدیریت پرسنل','i-settings',roleViews.organization);
  const managerArchiveView=makeView('personnel-requests-archive','آرشیو درخواست‌ها','i-folder',roleViews.personnelRequestsArchive);managerArchiveView.innerHTML='<div class="page-heading"><div><p class="eyebrow">مدیر · سوابق تأیید</p><h1>آرشیو درخواست‌ها</h1><p>درخواست‌های تأییدشده در اینجا نگهداری می‌شوند؛ مرحلهٔ جاری ادمین مشخص است و سابقه بازنویسی نمی‌شود.</p></div></div><section class="panel settings-card"><form id="managerArchiveFilters" class="form-grid"><label>جست‌وجو<input name="search" maxlength="120" type="search" placeholder="نام، سمت یا متن درخواست"></label><label>نوع درخواست<select name="type"><option value="all">همه</option><option value="registration">ثبت پرسنل جدید</option><option value="position">تغییر سمت</option><option value="appeal">اعتراض</option></select></label><button type="submit" class="secondary-button">نمایش</button></form><p id="managerArchiveCount" class="workflow-muted" role="status"></p><div id="managerRequestArchiveList" class="incoming-request-list"></div><div class="design-form-actions"><button type="button" class="secondary-button" id="managerArchivePrev">قبلی</button><span id="managerArchivePage"></span><button type="button" class="secondary-button" id="managerArchiveNext">بعدی</button></div></section>';
  makeView('score-settings','تنظیمات محاسبه امتیاز','i-settings',roleViews.scoreSettings);
  const settingsView=makeView('evaluation-settings','تنظیمات مدل محاسبه','i-settings',roleViews.evaluationSettings);
  settingsView.innerHTML=`<div class="page-heading"><div><p class="eyebrow">ادمین · سیاست نسخه‌دار</p><h1>تنظیمات مدل محاسبه</h1><p>برای کل سازمان یا یک واحد، مدل نسخه‌دار تعریف کنید. فصل باز و فصل‌های آینده قابل انتخاب‌اند؛ نتیجه‌های قفل‌شده تغییر نمی‌کنند.</p></div></div>
    <div><form id="evaluationSettingsForm" class="panel settings-card"><label>واحد هدف مدل<select name="unitId" id="evaluationSettingsUnit"></select></label><p class="workflow-muted">مدل اختصاصی واحد بر پیش‌فرض سازمان اولویت دارد و فقط بر پرسنل همان واحد اثر می‌گذارد. جمع پنج مؤلفه باید ۱۰۰٪ باشد؛ سهم صفر یعنی آن مؤلفه در مدل محاسبه نمی‌شود.</p><h2>درصد مؤلفه‌های مدل · جمع ۱۰۰٪</h2>
      <div class="form-grid"><label>آزمون پرسنلی (%)<input name="exam" type="number" min="0" max="100" step="0.1" required></label><label>نظر مدیر (%)<input name="manager" type="number" min="0" max="100" step="0.1" required></label><label>KPI روتین (%)<input name="routine" type="number" min="0" max="100" step="0.1" required></label><label>KPI پروژه‌ای (%)<input name="project" type="number" min="0" max="100" step="0.1" required></label><label>نظرسنجی همکاران (%)<input name="peer" type="number" min="0" max="100" step="0.1" required></label></div>
      <h2>شروع اثر</h2><div class="form-grid"><label>سال<select name="effectiveYear" required></select></label><label>فصل<select name="effectiveSeason" required></select></label></div>
      <div class="design-form-actions"><button class="primary-button">ذخیرهٔ پیش‌نویس</button><button id="resetEvaluationSettings" type="button" class="secondary-button">بازگشت درصدها به پیش‌فرض</button></div></form></div>
    <section class="panel settings-card lifecycle-section"><h2>نسخه‌های پیش‌نویس</h2><p class="workflow-muted">برای انتشار، نسخهٔ موردنظر را از همین فهرست انتخاب کنید. انتشار آن را به فهرست پایین منتقل می‌کند.</p><div id="evaluationSettingsDrafts"></div></section>
    <section class="panel settings-card lifecycle-section"><h2>نسخه‌های منتشرشده</h2><p class="workflow-muted">مدل منتشرشده از فصل شروع اثر برای پرسنل واحد هدف اعمال می‌شود. حذف نسخه، محاسبات باز را به مدل قبلیِ معتبر یا پیش‌فرض برمی‌گرداند؛ نتایج قفل‌شده تغییر نمی‌کنند.</p><div id="evaluationSettingsVersions"></div></section>`;
  const updatesView=makeView('updates','لیست آپدیت پرسنل','i-file',roleViews.updates);
  updatesView.innerHTML='<div class="page-heading"><div><p class="eyebrow">ادمین · سوابق نسخه‌دار</p><h1>لیست آپدیت پرسنل</h1><p>تاریخچهٔ سمت، واحد، بخش، تاریخ اثر و وضعیت هر نسخه را اینجا ببینید.</p></div></div><section class="panel settings-card"><h2>تاریخچهٔ سمت‌های نسخه‌دار</h2><div id="positionList"></div></section>';
  const dutiesView=makeView('duties','شرح وظایف پرسنل','i-file',roleViews.duties);
  dutiesView.innerHTML='<div class="page-heading"><div><p class="eyebrow">ادمین · دیتای پرسنلی</p><h1>شرح وظایف پرسنل</h1><p>شرح وظایف نسخهٔ منتشرشده و معتبر در تاریخ امروز؛ پیش‌نویس‌ها و سمت‌های آینده اینجا نمایش داده نمی‌شوند.</p></div></div><section class="panel settings-card"><div class="form-grid"><label>جست‌وجو<input id="dutiesSearch" type="search" maxlength="120" placeholder="نام، سمت یا متن شرح وظایف"></label><label>واحد<select id="dutiesUnit"><option value="">همهٔ واحدها</option></select></label></div><p id="dutiesCount" class="workflow-muted" role="status" aria-live="polite"></p><div id="dutiesList"></div></section>';
  const incomingView=makeView('incoming','درخواست‌های ورودی','i-pulse',roleViews.incoming);
  const aiLogView=makeView('ai','AI','i-target',roleViews.ai);
  aiLogView.innerHTML='<div class="page-heading"><div><p class="eyebrow">ادمین · پایش بررسی‌های هوش مصنوعی</p><h1>AI</h1><p>مرحله، نتیجه و اطلاعات مرتبط با بررسی‌ها؛ سوابق دورهٔ انتخاب‌شده نمایش داده می‌شوند؛ همهٔ دوره‌ها و سوابق بدون دوره نیز از فیلتر این بخش در دسترس‌اند.</p></div></div><section class="panel settings-card"><p class="formula-note">این صفحه فقط لاگ‌ها را می‌خواند؛ هیچ بررسی، تأیید یا اتصال مدل را خودکار اجرا نمی‌کند. نتیجهٔ AI با تصویب مدیر یا ادمین یکسان نیست.</p><div id="aiLogCounts" class="design-form-actions"></div><form id="aiLogFilters" class="form-grid"><label>دورهٔ سوابق<select name="periodScope"><option value="current">دورهٔ انتخاب‌شده</option><option value="all">همهٔ دوره‌ها</option><option value="none">بدون دوره</option></select></label><label>نوع بررسی<select name="type"><option value="all">همهٔ انواع</option></select></label><label>وضعیت<select name="state"><option value="all">همهٔ وضعیت‌ها</option></select></label><label>جست‌وجو<input name="search" maxlength="160" placeholder="عنوان، نام، کد پرسنلی یا دوره"></label><button class="secondary-button">نمایش و تازه‌سازی</button></form><p id="aiLogStatus" role="status" aria-live="polite"></p><div id="aiLogList"></div><div class="design-form-actions"><button id="aiLogPrevious" class="secondary-button" type="button">قبلی</button><span id="aiLogPage"></span><button id="aiLogNext" class="secondary-button" type="button">بعدی</button></div></section><section id="aiLogDetail" class="panel settings-card lifecycle-section" hidden tabindex="-1"></section>';
  incomingView.innerHTML='<div class="page-heading"><div><p class="eyebrow">ادمین · موارد نیازمند تصمیم</p><h1>درخواست‌های ورودی</h1><p>پیشنهادهای سمت و KPI را بررسی کنید؛ درخواست‌های ارزیابی فصل و اعتراض از مسیر تخصصی خود باز می‌شوند.</p></div></div><section class="panel settings-card"><h2>سمت‌های در انتظار تصویب</h2><div id="hrPositionInbox"></div></section><section class="panel settings-card lifecycle-section"><h2>شاخص‌های KPI در انتظار تأیید</h2><div id="hrDesignList"></div></section><section class="panel settings-card lifecycle-section"><h2>ارزیابی‌های فصلی در صف</h2><div id="hrQuarterRequests"></div></section><section class="panel settings-card lifecycle-section"><h2>درخواست‌های اعتراض</h2><p class="workflow-muted">همهٔ اعتراض‌ها و وضعیت پیگیری آن‌ها؛ تصمیم نهایی فقط برای درخواست‌های در انتظار بررسی ادمین فعال است.</p><div id="hrAppealRequests"></div></section>';
  incomingView.querySelector('.page-heading p:last-child').textContent='درخواست‌های منتظر تصمیم ادمین و پیگیری کامل اعتراض‌ها؛ برای بررسی مستندات و سابقهٔ تصمیم‌ها، جزئیات هر ردیف را باز کنید.';
  const incomingArchiveView=makeView('incoming-archive','آرشیو درخواست‌ها','i-folder',roleViews.incomingArchive);
  incomingArchiveView.innerHTML='<div class="page-heading"><div><p class="eyebrow">ادمین · سوابق تأیید نهایی</p><h1>آرشیو درخواست‌ها</h1><p>درخواست‌ها پس از تأیید نهایی ادمین خودکار اینجا دیده می‌شوند؛ اصل رکورد، گزارش و سابقه محفوظ است. این فهرست مستقل از دورهٔ انتخاب‌شده است.</p></div></div><section class="panel settings-card"><form id="incomingArchiveFilters" class="form-grid"><label>نوع درخواست<select name="type"><option value="all">همهٔ درخواست‌ها</option><option value="position">سمت</option><option value="design">شاخص‌های KPI</option><option value="quarter">ارزیابی فصل</option><option value="appeal">اعتراض</option></select></label><label>جست‌وجو<input name="search" type="search" maxlength="160" placeholder="نام، کد پرسنلی، واحد یا دوره"></label><button class="secondary-button">جست‌وجو و تازه‌سازی</button></form><p id="incomingArchiveStatus" role="status" aria-live="polite"></p><div id="incomingArchiveList"></div><div class="design-form-actions"><button type="button" id="incomingArchivePrevious" class="secondary-button">قبلی</button><span id="incomingArchivePage"></span><button type="button" id="incomingArchiveNext" class="secondary-button">بعدی</button></div><section id="incomingArchiveDetail" class="incoming-request-detail" hidden tabindex="-1"></section></section>';
  const chartView=makeView('chart','چارت سازمانی پرسنل','i-users',roleViews.chart);
  chartView.innerHTML='<div class="page-heading"><div><p class="eyebrow">اطلاعات و ساختار سازمانی</p><h1 id="chartTitle">چارت سازمانی</h1><p id="chartScope"></p></div></div><section id="personalInfo" class="panel settings-card" hidden></section><section class="panel settings-card"><h2>چارت سازمانی</h2><div id="chartContents"></div></section>';
  const managerPersonnelView=makeView('manager-personnel','اطلاعات پرسنل','i-users',roleViews.managerPersonnel);
  managerPersonnelView.innerHTML='<div class="page-heading"><div><p class="eyebrow">مدیر · پرسنل زیرمجموعه</p><h1>اطلاعات پرسنل</h1><p>فهرست مشخصات فعلی پرسنل در محدودهٔ مدیریت شما؛ اطلاعات توسط ادمین به‌روزرسانی می‌شوند.</p></div></div><section class="panel settings-card"><label>جست‌وجوی پرسنل<input id="managerPersonnelSearch" type="search" maxlength="120" placeholder="نام، سمت، واحد یا بخش"></label><p id="managerPersonnelCount" class="workflow-muted" role="status" aria-live="polite"></p><div id="managerPersonnelList"></div></section>';
orgView.innerHTML='<div class="page-heading"><div><p class="eyebrow">پنل ادمین</p><h1>مدیریت پرسنل</h1><p>واحدها، بخش‌ها و مشخصات پرسنل را ثبت و پیشنهاد تغییر سمت را ارسال کنید.</p></div></div><div class="settings-grid"><form id="positionForm" class="panel settings-card"><h2>تغییر سمت یا جابجایی پرسنل</h2><label>پرسنل<select name="employeeId" id="positionEmployee" required></select></label><div class="form-grid"><label>عنوان شغل<input name="jobTitle" required></label><label>بخش<select name="sectionId" id="positionSection" required></select></label><label>سطح شغل<select name="jobLevel" required><option value="">انتخاب سطح</option><option>کارآموز</option><option>کارشناس</option><option>کارشناس ارشد</option><option>مسئول</option><option>سرپرست</option><option>مدیر</option></select></label><label>مدیر مقصد<select name="managerId" id="positionManager" required></select></label><label>واحد سازمانی<select name="unitId" id="positionUnit" required></select></label><input name="unitName" type="hidden"></div><label>شرح وظایف<textarea name="duties" rows="4" required></textarea></label><div class="form-grid"><label>تاریخ جابه‌جایی (شروع سمت جدید از همین روز)<input name="transferDate" type="text" inputmode="numeric" placeholder="۱۴۰۵/۰۷/۰۶" dir="ltr" title="تاریخ شمسی به صورت سال/ماه/روز"></label><label>تاریخ شروع اثر<input name="effectiveFrom" type="text" inputmode="numeric" placeholder="۱۴۰۵/۰۷/۰۶" dir="ltr" title="تاریخ شمسی به صورت سال/ماه/روز"></label><label>حقوق پایه ماهانه (تومان؛ خالی یعنی حفظ فعلی)<input name="baseSalary" type="number" min="0" step="1"></label><label>تاریخ پایان اثر (اختیاری)<input name="effectiveTo" type="text" inputmode="numeric" placeholder="۱۴۰۵/۰۷/۰۶" dir="ltr" title="تاریخ شمسی به صورت سال/ماه/روز"></label></div><label class="toggle-row"><span><b>سمت مدیریتی / خارج از KPI فردی</b></span><input name="isManager" type="checkbox"></label><button class="primary-button">ثبت برای بازبینی مدیر</button></form></div>';
const onboarding=document.createElement('section');onboarding.className='panel settings-card lifecycle-section';onboarding.innerHTML='<h2>ثبت پرسنل جدید</h2><form id="personCreateForm"><div class="form-grid"><label>نام و نام خانوادگی<input name="name" required></label><label>عنوان شغل<input name="jobTitle" required></label><label>واحد سازمانی<select name="unitId" id="newPersonUnit" required></select></label><label>بخش<select name="sectionId" id="newPersonSection" required></select></label><label>سطح شغل<select name="jobLevel" required><option value="">انتخاب سطح</option><option>کارآموز</option><option>کارشناس</option><option>کارشناس ارشد</option><option>مسئول</option><option>سرپرست</option><option>مدیر</option></select></label><label>شخص مافوق<select name="managerId" id="newPersonManager" required></select></label><input name="unitName" type="hidden"><label>حقوق پایه ماهانه (تومان)<input name="baseSalary" type="number" min="0" step="1" required aria-describedby="newPersonSalaryWords"><small id="newPersonSalaryWords" class="salary-words" role="status" aria-live="polite"></small></label><label>تاریخ شروع به کار<span class="person-start-date"><input id="newPersonStart" name="effectiveFrom" type="text" placeholder="انتخاب تاریخ" dir="ltr" readonly required><svg aria-hidden="true"><use href="#i-calendar"/></svg></span></label></div><label>شرح وظایف<textarea name="duties" rows="3" required></textarea></label><button class="primary-button">ایجاد حساب و ارسال سمت برای تصویب</button><p class="formula-note">حساب جدید در محیط فعلی نمونه است؛ ورود سازمانی و هویت واقعی هنوز متصل نیست. سمت نیز تا تأیید مدیر مقصد و ادمین فعال نمی‌شود.</p></form>';
  const hrOverview=document.createElement('section');hrOverview.className='hr-overview';hrOverview.id='hrOverview';hrOverview.setAttribute('aria-label','خلاصهٔ درخواست‌های ورودی ادمین');incomingView.querySelector('.page-heading').after(hrOverview);
  onboarding.querySelector('.form-grid').insertAdjacentHTML('afterbegin','<label>نوع دسترسی<select name="role" id="newPersonRole"><option value="personnel">پرسنلی</option><option value="manager">مدیر</option></select></label><label>شماره تماس<input name="phone" type="tel" maxlength="30" autocomplete="tel"></label><label>کد پرسنلی<input name="employeeCode" maxlength="60"></label>');
  orgView.append(onboarding);
  let settlementData={people:[],settlements:[]};
  const operationSelector=document.createElement('label');operationSelector.className='personnel-operation-selector';operationSelector.innerHTML='<span>نوع عملیات پرسنلی</span><select id="personnelOperation"><option value="transfer">جابجایی پرسنل</option><option value="settlement">تسویه پرسنل</option></select>';orgView.querySelector('.settings-grid').before(operationSelector);
  $('#positionForm h2').textContent='جابجایی';
  $('#positionForm h2').insertAdjacentHTML('afterend','<p class="workflow-muted">سمت جدید از خودِ تاریخ جابه‌جایی شروع می‌شود. تأیید نهایی ادمین فقط پس از تکمیل همهٔ امتیازهای قبلی و تأیید مبلغ قطعی آن بازه امکان‌پذیر است؛ شاخص‌های جدید جدا تعریف می‌شوند.</p>');
  const settlementForm=document.createElement('form');settlementForm.id='settlementForm';settlementForm.className='panel settings-card';settlementForm.hidden=true;
  settlementForm.innerHTML='<h2>تسویه</h2><p class="workflow-muted">نام یا کد پرسنلی را انتخاب کنید؛ مورد دیگر خودکار تکمیل می‌شود. پس از تکمیل امتیازها، حقوق مبنا و مبلغ KPI تا پایان روز تسویه محاسبه و بسته می‌شوند. سوابق قبلی حفظ می‌شوند.</p><input name="employeeId" type="hidden"><div class="form-grid"><label>نام و نام خانوادگی<input name="employeeName" id="settlementName" list="settlementNames" autocomplete="off" maxlength="200" required><datalist id="settlementNames"></datalist></label><label>کد پرسنلی<input name="employeeCode" id="settlementCode" list="settlementCodes" autocomplete="off" maxlength="60" dir="ltr"><datalist id="settlementCodes"></datalist></label><label>تاریخ تسویه<span class="person-start-date"><input name="settlementDate" id="settlementDate" type="text" dir="ltr" readonly required placeholder="انتخاب تاریخ"><svg aria-hidden="true"><use href="#i-calendar"/></svg></span></label></div><button class="primary-button">پیش‌نمایش و ثبت تسویه</button><p class="formula-note">پیش از ثبت، مبلغ بازه‌های باز را بررسی کنید. تسویهٔ آینده مجاز نیست؛ این عملیات پرداخت بانکی یا محاسبهٔ سایر اقلام پایان همکاری نیست.</p><section class="lifecycle-section"><h3>تسویه‌های ثبت‌شده</h3><div id="settlementHistory"></div></section>';
  $('#positionForm').after(settlementForm);
  window.PanelDatePicker.attach($('#settlementDate'),{id:'personnel-settlement-calendar',canOpen:()=>user?.role==='hr'&&!activeWrites&&!settlementForm.hidden&&orgView.classList.contains('active')});
  function syncPersonnelOperation(){const exit=$('#personnelOperation').value==='settlement';$('#positionForm').hidden=exit;settlementForm.hidden=!exit;}
  $('#personnelOperation').addEventListener('change',syncPersonnelOperation);
  const normalizeSettlementCode=value=>String(value).trim().replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632));
  const normalizeSettlementName=value=>String(value).normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\s\u200c]+/g,' ').trim();
  function availableSettlementPeople(){return settlementData.people.filter(p=>!p.settlementDate);}
  function resetSettlementForm(){settlementForm.reset();settlementForm.elements.employeeId.value='';for(const key of ['employeeName','employeeCode'])settlementForm.elements[key].setCustomValidity('');}
  function settlementNameLabel(person){return availableSettlementPeople().filter(p=>normalizeSettlementName(p.name)===normalizeSettlementName(person.name)).length>1?person.name+' · '+(person.employeeCode||person.id):person.name;}
  function syncSettlementIdentity(source){
    const form=settlementForm,people=availableSettlementPeople(),value=form.elements[source].value;
    const matches=people.filter(p=>source==='employeeCode'?p.employeeCode&&normalizeSettlementCode(p.employeeCode)===normalizeSettlementCode(value):normalizeSettlementName(settlementNameLabel(p))===normalizeSettlementName(value));
    const person=matches.length===1?matches[0]:null;form.elements.employeeId.value=person?.id||'';
    if(source==='employeeCode')form.elements.employeeName.value=person?settlementNameLabel(person):'';else form.elements.employeeCode.value=person?.employeeCode||'';
    form.elements[source].setCustomValidity(value&&!person?'پرسنل را از فهرست انتخاب کنید؛ نام یا کد مبهم/نامعتبر است.':'');
    form.elements[source==='employeeCode'?'employeeName':'employeeCode'].setCustomValidity('');
  }
  for(const source of ['employeeName','employeeCode'])settlementForm.elements[source].addEventListener('input',()=>syncSettlementIdentity(source));
  function renderSettlements(){
    if(user?.role!=='hr')return;
    const people=availableSettlementPeople();$('#settlementNames').innerHTML=people.map(p=>`<option value="${esc(settlementNameLabel(p))}">${esc(p.employeeCode||'')}</option>`).join('');$('#settlementCodes').innerHTML=people.filter(p=>p.employeeCode).map(p=>`<option value="${esc(p.employeeCode)}">${esc(p.name)}</option>`).join('');
    if(settlementForm.elements.employeeId.value&&!people.some(p=>p.id===settlementForm.elements.employeeId.value))resetSettlementForm();
    $('#settlementHistory').innerHTML=table(['پرسنل','کد پرسنلی','تاریخ تسویه','وضعیت'],settlementData.settlements.map(row=>`<tr><td>${esc(row.employeeName)}</td><td dir="ltr">${esc(row.employeeCode||'—')}</td><td>${esc(window.PanelDate.input(row.settlementDate))}</td><td>${row.status==='effective'?'خارج از فرایند KPI':'از تاریخ تسویه اعمال می‌شود'}</td></tr>`).join(''),'تسویه‌ای ثبت نشده است.');
  }
  const newPersonExclusion=document.createElement('label');newPersonExclusion.className='toggle-row manager-kpi-toggle';newPersonExclusion.innerHTML='<span><b>سمت مدیریتی / خارج از KPI فردی</b></span><input name="isManager" type="checkbox" aria-label="خارج از KPI فردی">';$('#personCreateForm .primary-button').before(newPersonExclusion);
  $('#positionForm .toggle-row').classList.add('manager-kpi-toggle');
  const positionSalary=$('#positionForm [name="baseSalary"]'),positionWords=document.createElement('small');positionWords.id='positionSalaryWords';positionWords.className='salary-words';positionWords.setAttribute('role','status');positionWords.setAttribute('aria-live','polite');positionSalary.setAttribute('aria-describedby',positionWords.id);positionSalary.after(positionWords);
  function updatePositionSalaryWords(){positionWords.textContent=window.PanelMoneyWords(positionSalary.value);}
  positionSalary.addEventListener('input',updatePositionSalaryWords);$('#positionForm').addEventListener('reset',()=>{positionWords.textContent='';});
  $('#personCreateForm').addEventListener('reset',()=>{const field=$('#personCreateForm').elements.isManager;field.disabled=false;delete field.dataset.previousValue;});
  function syncNewPersonRole(){
    const form=$('#personCreateForm');if(!form?.elements.role)return;const manager=form.elements.role.value==='manager';
    const exclusion=form.elements.isManager;if(exclusion){if(manager){if(!exclusion.disabled)exclusion.dataset.previousValue=String(exclusion.checked);exclusion.checked=true;exclusion.disabled=true;}else{if(exclusion.disabled)exclusion.checked=exclusion.dataset.previousValue==='true';exclusion.disabled=false;}}
    for(const key of ['sectionId','duties','baseSalary','managerId']){const field=form.elements[key];if(!field)continue;field.disabled=manager;field.required=!manager;field.closest('label').hidden=manager;}
    form.querySelector('.primary-button').textContent=manager?'ایجاد حساب مدیر':'ایجاد حساب و ارسال سمت برای تصویب';
    form.querySelector('.formula-note').textContent=manager?'حساب مدیر برای واحد سازمانی ایجاد می‌شود؛ بخش، شرح وظیفه و حقوق پایه برای این دسترسی کاربرد ندارند.':'حساب جدید در محیط فعلی نمونه است؛ سمت پرسنل تا تأیید مدیر مقصد و ادمین فعال نمی‌شود.';
    const note=form.querySelector(':scope > .workflow-muted');if(note)note.textContent=manager?'مدیر به واحد سازمانی متصل می‌شود و خارج از ارزیابی KPI فردی است.':'مدل ارزیابی و مؤلفهٔ پروژه براساس واحد و تاریخ شروع اثر به‌صورت خودکار تعیین می‌شوند؛ در نبود مدل اختصاصی واحد، مدل عمومی سازمان اعمال می‌شود.';
    updateNewPersonSalaryWords();
  }
  function updateNewPersonSalaryWords(){const field=$('#personCreateForm')?.elements.baseSalary,output=$('#newPersonSalaryWords');if(output&&field)output.textContent=field.disabled?'':window.PanelMoneyWords?.(field.value)||'';}
  // The role select is inserted above with insertAdjacentHTML before onboarding is attached.
  onboarding.querySelector('#newPersonRole')?.addEventListener('change',syncNewPersonRole);onboarding.querySelector('[name="baseSalary"]')?.addEventListener('input',updateNewPersonSalaryWords);syncNewPersonRole();
  window.PanelDatePicker?.attach($('#newPersonStart'),{id:'new-person-start-calendar',canOpen:()=>user?.role==='hr'&&!activeWrites&&orgView.classList.contains('active')});
  for(const [name,id,optional] of [['transferDate','position-transfer-calendar',true],['effectiveFrom','position-start-calendar',false],['effectiveTo','position-end-calendar',true]]){
    const field=$('#positionForm').elements[name],control=document.createElement('span');control.className='person-start-date';field.before(control);control.append(field);control.insertAdjacentHTML('beforeend','<svg aria-hidden="true"><use href="#i-calendar"/></svg>');field.removeAttribute('inputmode');field.placeholder=optional?'انتخاب تاریخ (اختیاری)':'انتخاب تاریخ';field.title='انتخاب تاریخ از تقویم شمسی';field.required=!optional;
    window.PanelDatePicker.attach(field,{id,allowClear:optional,canOpen:()=>user?.role==='hr'&&!activeWrites&&orgView.classList.contains('active')});
  }
  for(const form of [$('#positionForm'),$('#personCreateForm')]){const note=document.createElement('p');note.className='workflow-muted';note.textContent='مدل ارزیابی و مؤلفهٔ پروژه براساس واحد و تاریخ شروع اثر به‌صورت خودکار تعیین می‌شوند؛ در نبود مدل اختصاصی واحد، مدل عمومی سازمان اعمال می‌شود.';form.prepend(note);}
  const unitPanel=document.createElement('section');unitPanel.className='panel settings-card lifecycle-section';unitPanel.innerHTML='<h2>واحدهای سازمانی</h2><p class="workflow-muted">واحدهای سازمانی را ثبت کنید تا در تعریف بخش و اطلاعات پرسنل انتخاب شوند.</p><form id="unitForm" class="form-grid organization-entry-form"><label>شناسهٔ واحد<input name="id" required maxlength="80"></label><label>نام واحد<input name="name" required maxlength="120"></label><button class="primary-button">ثبت واحد</button></form><div id="unitList"></div>';orgView.insertBefore(unitPanel,onboarding);
  const sectionPanel=document.createElement('section');sectionPanel.className='panel settings-card lifecycle-section';sectionPanel.innerHTML='<h2>بخش‌های سازمانی</h2><p class="workflow-muted">شناسهٔ بخش خودکار ساخته می‌شود. هر بخش به یک واحد وابسته است و برای پرسنل انتخاب می‌شود.</p><form id="sectionForm" class="form-grid organization-entry-form"><label>نام بخش<input name="name" required maxlength="120"></label><label class="organization-entry-parent">واحد<select name="unitId" id="sectionUnit" required></select></label><button class="primary-button">ثبت بخش</button></form><div id="sectionList"></div>';orgView.insertBefore(sectionPanel,onboarding);const structureGrid=document.createElement('div');structureGrid.className='organization-structure-grid';orgView.insertBefore(structureGrid,unitPanel);structureGrid.append(unitPanel,sectionPanel);
  const peopleImport=document.createElement('section');peopleImport.id='personnelImportPanel';peopleImport.className='panel settings-card lifecycle-section';peopleImport.innerHTML='<h2>ورود گروهی پرسنل با اکسل</h2><p class="workflow-muted">فایل XLSX را مطابق قالب نمونه پر کنید. کد پرسنلی و شناسهٔ واحد/بخش باید معتبر باشند؛ برای پرسنل، کد مافوق باید از قبل در سامانه ثبت شده باشد. ابتدا پیش‌نمایش و خطاهای سطرها را بررسی کنید و سپس ثبت را تأیید کنید.</p><p class="formula-note">این ابزار برای ثبت پرسنل جدید همراه شرح وظایف است؛ کد تکراری ثبت نمی‌شود و اطلاعات افراد موجود بازنویسی نمی‌شود. سمت پرسنل پس از تأیید مدیر مقصد و ادمین فعال می‌شود.</p><div class="design-form-actions"><button type="button" class="secondary-button" id="downloadPersonnelTemplate">دریافت قالب اکسل</button></div><form id="personImportForm"><label>فایل پرسنل (XLSX، حداکثر ۲ مگابایت و ۱۰۰ سطر)<input name="file" type="file" accept=".xlsx" required></label><button class="primary-button">بررسی و پیش‌نمایش اکسل</button> <button type="button" id="cancelPersonnelImport" class="secondary-button" hidden>لغو ثبت</button></form><div id="personImportResult" role="status" aria-live="polite"></div>';updatesView.querySelector('.page-heading').after(peopleImport);
  window.addEventListener('panel:view',event=>{if(['updates','duties'].includes(event.detail)&&user?.role==='hr')$('#view-'+event.detail+' .page-heading').after(peopleImport);});
  const dataView=makeView('data','آزمون فصلی پرسنل','i-file',roleViews.data);
  dataView.innerHTML='<div class="page-heading"><div><p class="eyebrow">پنل ادمین · ورود کنترل‌شده</p><h1>آزمون فصلی پرسنل</h1><p>ورودی محلی با شناسهٔ منبع، نسخه و قرنطینه؛ شناسهٔ بسته به‌صورت خودکار ساخته می‌شود.</p></div></div><div class="exam-entry-grid"><form id="examImportForm" class="panel settings-card"><h2>ورود نتیجهٔ آزمون فصلی</h2><div class="form-grid"><label>فصل<select class="quarter-season" aria-label="فصل آزمون"></select></label><label>سال<select class="quarter-year" aria-label="سال آزمون"></select></label></div><input name="quarter" type="hidden"><input name="batchKey" type="hidden"><div class="form-grid"><label>کد پرسنلی<input name="employeeCode" inputmode="numeric" maxlength="60" dir="ltr" required></label><label>امتیاز<input name="score" type="number" min="0" max="100" step="any" required></label></div><button class="primary-button">ثبت نمره</button><p class="formula-note">کد پرسنلی نامعتبر، تکراری یا بدون امتیاز قرنطینه می‌شود؛ نتیجهٔ مفقود امتیاز صفر نمی‌گیرد.</p></form></div>';
  const examExcelPanel=document.createElement('section');examExcelPanel.className='panel settings-card lifecycle-section';examExcelPanel.innerHTML='<h2>ورود گروهی نتیجهٔ آزمون با اکسل</h2><p class="workflow-muted">قالب نمونه را دریافت کنید؛ برای هر پرسنل یک سطر با کد پرسنلی و امتیاز ۰ تا ۱۰۰ وارد کنید. فقط XLSX با حداکثر ۵۰۰ سطر پذیرفته می‌شود.</p><div class="design-form-actions"><button type="button" class="secondary-button" id="downloadExamTemplate">دریافت قالب اکسل</button></div><form id="examExcelForm"><label>فایل نتیجهٔ آزمون (XLSX، حداکثر ۲ مگابایت)<input name="file" type="file" accept=".xlsx" required></label><button class="primary-button">اعتبارسنجی و بارگذاری اکسل</button></form><div id="examExcelResult" role="status" aria-live="polite"></div>';dataView.append(examExcelPanel);
  const examArchivePanel=document.createElement('section');examArchivePanel.className='panel settings-card lifecycle-section';examArchivePanel.innerHTML='<h2>آرشیو بارگذاری‌های آزمون</h2><p class="workflow-muted">تاریخچهٔ بسته‌های ثبت‌شده و نتیجهٔ اعتبارسنجی هر بارگذاری در سامانه می‌ماند.</p><div id="examImportArchive"></div>';dataView.append(examArchivePanel);
  const finalExport=document.createElement('section');finalExport.className='panel settings-card lifecycle-section';finalExport.id='finalExport';finalExport.innerHTML='<h2>خروجی نهایی برای بررسی بیرون از سامانه</h2><p class="workflow-muted">فقط ارزیابی‌های قفل‌شدهٔ فصل در فایل اکسل قرار می‌گیرند. هیچ دسترسی پنلی برای مالی تعریف نشده است.</p><button class="secondary-button" id="exportFinalExcel">دریافت اکسل نهایی فصل</button>';quarterView.append(finalExport);
  const appealView=makeView('appeals','درخواست‌های اعتراض','i-pulse',roleViews.appeals);
  appealView.innerHTML='<div class="page-heading"><div><p class="eyebrow">حفظ تاریخچه و حق بازبینی</p><h1>درخواست‌های اعتراض</h1><p>درخواست‌ها به نسخهٔ قفل‌شده متصل می‌شوند؛ اصلاح، نتیجهٔ اصلی را بازنویسی نمی‌کند.</p></div></div><form id="appealForm" class="panel settings-card"><h2>ثبت درخواست</h2><div class="form-grid"><label>فصل<select class="quarter-season" aria-label="فصل ارزیابی"></select></label><label>سال<select class="quarter-year" aria-label="سال ارزیابی"></select></label><label>موضوع<select name="type"><option value="score">امتیاز عملکرد</option><option value="payroll">مبلغ/خروجی مالی</option></select></label></div><input name="quarter" type="hidden"><label>دلیل و مستند<textarea name="reason" rows="3" maxlength="2000" required></textarea></label><button class="primary-button">ثبت درخواست بازبینی</button></form><section class="panel settings-card lifecycle-section"><h2>درخواست‌های ثبت‌شده</h2><div id="appealList"></div></section>';
  appealView.querySelector('#appealForm [name="reason"]').closest('label').insertAdjacentHTML('afterend','<div class="appeal-file-field"><p class="workflow-muted">فایل‌های مستند · اختیاری؛ حداکثر ۵ فایل، هرکدام تا ۱۰ مگابایت</p><label class="activity-attach-control"><svg aria-hidden="true"><use href="#i-upload"/></svg><span>پیوست مستندات</span><input id="appealFiles" name="appealFiles" type="file" multiple aria-label="انتخاب فایل‌های مستند اعتراض" aria-describedby="appealFileNames"></label><p id="appealFileNames" class="workflow-muted" role="status" aria-live="polite"></p></div>');
  function syncAppealFileNames(){$('#appealFileNames').textContent=[...$('#appealFiles').files].map(file=>file.name).join('، ')||'فایلی انتخاب نشده است.';}
  $('#appealFiles').addEventListener('change',syncAppealFileNames);$('#appealForm').addEventListener('reset',()=>queueMicrotask(syncAppealFileNames));syncAppealFileNames();
  appealView.querySelector('#appealForm').insertAdjacentHTML('afterend','<p id="appealRoleHint" class="workflow-muted" hidden></p>');
  const surveyExtra=document.createElement('section');surveyExtra.className='panel settings-card lifecycle-section';surveyExtra.id='lifecycleSurvey';surveyExtra.innerHTML='<div id="serviceSurveyArea"></div>';
  const peerSurveyView=makeView('peer-surveys','نظرسنجی همکاران','i-users',roleViews.peerSurveys);
  peerSurveyView.innerHTML='<div class="page-heading"><div><p class="eyebrow">مدیر · بازخورد همکاران</p><h1>نظرسنجی همکاران</h1><p>نظرسنجی‌های همکارانِ مجاز برای شما؛ پاسخ‌ها از امتیازدهی مدیر به نیروها جدا و محرمانه‌اند.</p></div></div>';
  $('#view-surveys').append(surveyExtra);
  $('#view-surveys .page-heading h1').textContent='نظرسنجی‌های دوره';
  $('#view-surveys .page-heading .eyebrow').textContent='مدیر مستقیم · همکاران خدمات';
  $('#view-surveys .page-heading p:last-child').textContent='نظرسنجی‌های مدیر و همکاران جداگانه نگهداری می‌شوند.';

  const aiArchiveView=makeView('ai-archive','آرشیو','i-folder',roleViews.aiArchive);
  aiLogView.querySelector('.formula-note').textContent='این صفحه سوابق را نمایش و آرشیو می‌کند؛ هیچ بررسی، تأیید یا اتصال مدل را خودکار اجرا نمی‌کند. نتیجهٔ AI با تصویب مدیر یا ادمین یکسان نیست.';
  aiArchiveView.innerHTML=aiLogView.innerHTML.replaceAll('aiLog','aiArchive').replace('<h1>AI</h1>','<h1>آرشیو AI</h1>');
  aiArchiveView.querySelector('.page-heading p:last-child').textContent='لاگ‌های منتقل‌شده به آرشیو؛ جزئیات و تاریخچه حفظ شده‌اند و بازگرداندن به فهرست اصلی ممکن است.';
  aiArchiveView.querySelector('.formula-note').textContent='آرشیو فقط نحوه نمایش لاگ را تغییر می‌دهد؛ نتیجه، گردش تأیید و تحلیل مدل تغییر نمی‌کنند. با تغییر وضعیت لاگ، آن مورد دوباره در فهرست اصلی ظاهر می‌شود.';
  const aiNav=$('[data-view="ai"]');aiNav.title='لاگ‌ها';aiNav.setAttribute('aria-label','لاگ‌ها');aiNav.querySelector('span').textContent='لاگ‌ها';

  let sidebarFlyout=null,sidebarFlyoutTimer=null;
  const collapsedDesktop=()=>$('#sidebar').classList.contains('is-collapsed')&&window.innerWidth>820;
  function closeSidebarFlyout(focus=false){clearTimeout(sidebarFlyoutTimer);if(!sidebarFlyout)return;const entry=sidebarFlyout;sidebarFlyout=null;entry.submenu.classList.remove('nav-flyout');entry.submenu.style.removeProperty('left');entry.submenu.style.removeProperty('top');entry.group.append(entry.submenu);entry.submenu.hidden=true;entry.toggle.setAttribute('aria-expanded','false');if(focus&&!entry.group.hidden)entry.toggle.focus();}
  function openSidebarFlyout(entry,{pin=false,focus=false}={}){
    if(!collapsedDesktop()||entry.group.hidden)return;clearTimeout(sidebarFlyoutTimer);
    if(sidebarFlyout?.submenu!==entry.submenu){closeSidebarFlyout();sidebarFlyout={...entry,pinned:pin};entry.submenu.classList.add('nav-flyout');document.body.append(entry.submenu);}else if(pin)sidebarFlyout.pinned=true;
    entry.submenu.hidden=false;entry.toggle.setAttribute('aria-expanded','true');const rect=entry.toggle.getBoundingClientRect(),rail=$('#sidebar').getBoundingClientRect(),box=entry.submenu.getBoundingClientRect();entry.submenu.style.left=Math.max(8,Math.min(window.innerWidth-box.width-8,rail.left-box.width-8))+'px';entry.submenu.style.top=Math.max(8,Math.min(rect.top,window.innerHeight-box.height-8))+'px';
    if(focus)entry.submenu.querySelector('.nav-item:not([hidden]):not(:disabled)')?.focus();
  }
  function deferSidebarFlyoutClose(){clearTimeout(sidebarFlyoutTimer);sidebarFlyoutTimer=setTimeout(()=>{if(sidebarFlyout&&!sidebarFlyout.pinned&&!sidebarFlyout.submenu.contains(document.activeElement))closeSidebarFlyout();},180);}
  document.addEventListener('pointerdown',event=>{if(sidebarFlyout&&!sidebarFlyout.submenu.contains(event.target)&&!sidebarFlyout.toggle.contains(event.target))closeSidebarFlyout();});
  document.addEventListener('focusin',event=>{if(sidebarFlyout&&!sidebarFlyout.submenu.contains(event.target)&&!sidebarFlyout.toggle.contains(event.target))closeSidebarFlyout();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sidebarFlyout){event.preventDefault();closeSidebarFlyout(true);}});
  window.addEventListener('panel:view',()=>closeSidebarFlyout());window.addEventListener('resize',()=>closeSidebarFlyout());
  window.addEventListener('scroll',event=>{if(sidebarFlyout&&(!(event.target instanceof Node)||!sidebarFlyout.submenu.contains(event.target)))closeSidebarFlyout();},true);
  window.addEventListener('panel:sidebar',()=>{closeSidebarFlyout();for(const entry of Object.values(navigationGroups))entry.setOpen(false);syncNavigationGroups(true);});
  function makeNavigationGroup(id,title,iconId,views,allowedRole='hr'){
    iconId=({requests:'i-inbox',ai:'i-ai'})[id]||iconId;
    const group=document.createElement('div');group.className='nav-group';group.dataset.navGroup=id;group.hidden=true;
    const toggle=document.createElement('button');toggle.type='button';toggle.className='nav-item nav-group-toggle';toggle.title=title;toggle.setAttribute('aria-label',title);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',`nav-submenu-${id}`);
    toggle.innerHTML=`<svg aria-hidden="true"><use href="#${iconId}"/></svg><span>${title}</span><span class="nav-group-chevron" aria-hidden="true"></span>`;
    const submenu=document.createElement('div');submenu.id=`nav-submenu-${id}`;submenu.className='nav-submenu';submenu.hidden=true;submenu.setAttribute('role','group');submenu.setAttribute('aria-label',title);
    group.append(toggle,submenu);$('.main-nav').append(group);
    const setOpen=open=>{if(collapsedDesktop()){submenu.hidden=true;toggle.setAttribute('aria-expanded','false');return;}submenu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));};
    const entry={group,toggle,submenu,views,setOpen,allowedRole};
    toggle.addEventListener('click',event=>{if(collapsedDesktop()){if(sidebarFlyout?.submenu===submenu&&sidebarFlyout.pinned)closeSidebarFlyout();else openSidebarFlyout(entry,{pin:true,focus:event.detail===0});return;}setOpen(submenu.hidden);});
    toggle.addEventListener('mouseenter',()=>{if(collapsedDesktop())openSidebarFlyout(entry);});toggle.addEventListener('mouseleave',deferSidebarFlyoutClose);submenu.addEventListener('mouseenter',()=>clearTimeout(sidebarFlyoutTimer));submenu.addEventListener('mouseleave',deferSidebarFlyoutClose);
    toggle.addEventListener('keydown',event=>{if(collapsedDesktop()&&['ArrowDown','ArrowLeft'].includes(event.key)){event.preventDefault();openSidebarFlyout(entry,{pin:true,focus:true});}});
    submenu.addEventListener('keydown',event=>{if(!submenu.classList.contains('nav-flyout')||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const items=[...submenu.querySelectorAll('.nav-item:not([hidden]):not(:disabled)')],index=items.indexOf(document.activeElement);if(!items.length)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();});
    return entry;
  }
  const navigationGroups={
    managerRequests:makeNavigationGroup('manager-requests','درخواست‌های پرسنلی','i-inbox',['position-review','personnel-requests-archive'],'manager'),
    panelSettings:makeNavigationGroup('panel-settings','تنظیمات پنل','i-settings',['evaluation-settings','score-settings']),
    personnel:makeNavigationGroup('personnel','دیتای پرسنلی','i-users',['updates','chart','organization','duties']),
    requests:makeNavigationGroup('requests','درخواست‌ها','i-pulse',['incoming','incoming-archive']),
    ai:makeNavigationGroup('ai','AI','i-target',['ai','ai-archive']),
    kpi:makeNavigationGroup('kpi','شاخص‌های KPI','i-target',['assignments','projectAssignments'],'personnel'),
    managerKpi:makeNavigationGroup('manager-kpi','KPI پرسنل','i-chart-bars',['quarters','team'],'manager'),
    managerPersonnel:makeNavigationGroup('manager-personnel','اطلاعات پرسنلی','i-person-card',['chart','manager-personnel'],'manager'),
    managerSurveys:makeNavigationGroup('manager-surveys','رضایت‌سنجی پرسنل','i-checklist',['surveys','peer-surveys'],'manager')
  };
  function syncNavigationGroups(openActive=false){
    for(const {group,toggle,submenu,setOpen} of Object.values(navigationGroups)){
      const active=!group.hidden&&Boolean(submenu.querySelector('.nav-item.active'));toggle.classList.toggle('active',active);
      if(active&&openActive)setOpen(true);
    }
  }
  window.addEventListener('panel:view',()=>syncNavigationGroups(true));

  function applySession(next){
    if($('#positionCloseoutHistory')){$('#positionCloseoutHistory').replaceChildren();$('#positionCloseoutPanel').hidden=!['hr','personnel'].includes(next?.role);}
    if(user?.id!==next?.id){loadedContextKey=null;renderedDesignTables=new WeakMap();}
    refreshVersion++;
    closeSidebarFlyout();
    if(user?.id!==next?.id){$('#examExcelForm').reset();$('#examExcelResult').replaceChildren();}
    if(user?.id!==next?.id){$('#appealFiles').value='';syncAppealFileNames();}
    if(user?.id!==next?.id){settlementData={people:[],settlements:[]};resetSettlementForm();for(const id of ['settlementNames','settlementCodes','settlementHistory'])$('#'+id).replaceChildren();$('#personnelOperation').value='transfer';syncPersonnelOperation();}
    if(user?.id!==next?.id){quarterFilters.reset();quarterFilters.hidden=true;$('#quarterUnitFilter').innerHTML='<option value="all">همهٔ واحدها</option>';$('#quarterResultCount').textContent='';}
    if(user?.id!==next?.id)renewExamBatchKey();
    if(user?.id!==next?.id){managerArchivePage=1;$('#managerArchiveFilters').reset();$('#managerRequestArchiveList').replaceChildren();$('#managerArchiveCount').textContent='';$('#managerArchivePage').textContent='';}
    if(user?.id!==next?.id){managerRequestsData={positions:[],appeals:[]};for(const id of ['managerRequestsOverview','managerRegistrationList','positionRequestList','managerAppealList'])$('#'+id).replaceChildren();$('#managerRequestsSearch').value='';$('#managerRequestsType').value='all';}
    if(user?.id!==next?.id)$('#serviceSurveyArea').replaceChildren();
    if(user?.id!==next?.id){$('#managerPersonnelList').replaceChildren();$('#managerPersonnelCount').textContent='';$('#managerPersonnelSearch').value='';$('#personalInfo').replaceChildren();$('#chartContents').replaceChildren();}
    if(user?.id!==next?.id){incomingArchiveVersion++;incomingArchivePage=1;$('#incomingArchiveFilters').reset();$('#incomingArchiveList').replaceChildren();$('#incomingArchiveDetail').replaceChildren();$('#incomingArchiveDetail').hidden=true;$('#incomingArchiveStatus').textContent='';$('#incomingArchivePage').textContent='';for(const id of ['hrPositionInbox','hrDesignList','hrQuarterRequests','hrAppealRequests','hrOverview'])$('#'+id)?.replaceChildren();}
    if(user?.id!==next?.id)closeCorrectionEditor(false);
    const roleChanged=user?.role!==next?.role;
    if(user?.id!==next?.id){aiCapabilities={jobAnalysis:false,alignment:false};jobAnalysisResults.clear();for(const id of ['designList','designDraftList','hrDesignList'])$('#'+id)?.replaceChildren();}
    if(user?.id!==next?.id){positions=[];positionRequests=[];designs=[];deadlines=[];quarterRows=[];evaluations=[];appeals=[];campaigns=[];sources=[];examImports=[];orgChart=null;orgUnits=[];orgSections=[];evaluationSettingsData=null;evaluationModelsData=null;selectedSettingsUnitId=null;selectedServiceCampaignId=null;expandedSurveyMonths.clear();}
    if(user?.id&&user.id!==next?.id)resetDesignForm();
    if(user?.id!==next?.id){$('#dutiesList').replaceChildren();$('#dutiesCount').textContent='';$('#dutiesSearch').value='';$('#dutiesUnit').innerHTML='<option value="">همهٔ واحدها</option>';resetPersonnelImport(true);$('#personImportForm').reset();}
    user=next;const role=user?.role;document.querySelectorAll('[data-lifecycle-view]').forEach(nav=>nav.hidden=!roleViews[camelView(nav.dataset.view)]?.includes(role));
    if(role==='hr')$('[data-view="appeals"]').hidden=true;
    const chartNav=$('[data-view="chart"]'),chartName=role==='hr'?'چارت سازمانی پرسنل':role==='manager'?'اطلاعات مدیر':'اطلاعات پرسنلی';
    chartNav.title=chartName;chartNav.setAttribute('aria-label',chartName);chartNav.querySelector('span').textContent=chartName;chartNav.querySelector('use').setAttribute('href',role==='hr'?'#i-org-chart':'#i-person-card');$('#chartTitle').textContent=chartName;$('#personalInfo').hidden=role==='hr';
    const navigationOrder=role==='personnel'
      ?['dashboard','chart','quarters','group:kpi','surveys','appeals','chat','notes']
      :role==='manager'
        ?['manager-dashboard','group:managerKpi','group:managerPersonnel','group:managerSurveys','tasks','group:managerRequests','chat','notes']
        :['quarters','group:panelSettings','group:personnel','data','surveys','announcements','group:requests','group:ai','chat','notes'];
    const navContainer=document.querySelector('.main-nav');
    for(const view of new Set(Object.values(navigationGroups).flatMap(group=>group.views)))navContainer.append($(`[data-view="${view}"]`));
    for(const {group,submenu,views,allowedRole,setOpen} of Object.values(navigationGroups)){
      group.hidden=role!==allowedRole;if(group.hidden)setOpen(false);
      if(role===allowedRole||allowedRole==='personnel')for(const view of views)submenu.append($(`[data-view="${view}"]`));
    }
    for(const view of navigationOrder)(window.PanelUtilities?.navHost(view)||navContainer).append(view.startsWith('group:')?navigationGroups[view.slice(6)].group:$(`[data-view="${view}"]`));
    syncNavigationGroups(roleChanged);
    const baseRoles={dashboard:['personnel'],assignments:['personnel'],projectAssignments:['personnel'],team:['manager'],surveys:['manager','personnel','hr'],reviews:[],proposals:[],documents:[],users:[],activity:[],settings:[]};
    for(const [view,allowed] of Object.entries(baseRoles)){const nav=$(`[data-view="${view}"]`);if(nav)nav.hidden=!allowed.includes(role);}
    const surveyNav=$('[data-view="surveys"]'),surveyName='نظرسنجی پرسنل';surveyNav.title=surveyName;surveyNav.setAttribute('aria-label',surveyName);surveyNav.querySelector('span').textContent=surveyName;
    (role==='manager'?peerSurveyView:$('#view-surveys')).append(surveyExtra);
    $('#view-surveys .page-heading h1').textContent=role==='manager'?'نظرسنجی پرسنل':'نظرسنجی‌های دوره';
    $('#view-surveys .page-heading .eyebrow').textContent=role==='manager'?'مدیر مستقیم · ارزیابی پرسنل':'مدیر مستقیم · همکاران خدمات';
    $('#view-surveys .page-heading p:last-child').textContent=role==='manager'?'امتیاز رضایت شما برای پرسنل زیرمجموعه در مؤلفهٔ ارزیابی مدیر همان دوره ثبت می‌شود.':'نظرسنجی‌های مدیر و همکاران جداگانه نگهداری می‌شوند.';
    $('#view-surveys .settings-grid').hidden=role!=='manager';
    if(role==='manager'){$('[data-view="proposals"]').hidden=true;}
    const title=role==='hr'?'پنل ادمین':role==='manager'?'مرور تیم و وظایف':'مرور نتیجهٔ شخصی';
    $('#workflowRole').textContent=title;
    populateSelect($('#designEmployee'),(evaluationModelsData?.people||[]).filter(a=>a.managerId===user.id),'پرسنلی در محدودهٔ مدیریت شما وجود ندارد.');
    if(designDraftEmployeeId)$('#designEmployee').value=designDraftEmployeeId;
    populateSelect($('#positionEmployee'),accounts().filter(a=>a.role==='personnel'),'پرسنل نمونه');
    populateSelect($('#positionManager'),accounts().filter(a=>a.role==='manager'),'مدیر مقصد');
    populateSelect($('#newPersonManager'),accounts().filter(a=>a.role==='manager'&&!a.isSettled),'مدیر مجاز همان واحد');
    $('#finalExport').hidden=role!=='hr';
    $('#positionEmployee').dispatchEvent(new Event('change'));$('#positionManager').dispatchEvent(new Event('change'));$('#newPersonManager').dispatchEvent(new Event('change'));
  }
function camelView(id){return {'manager-dashboard':'managerDashboard','manager-personnel':'managerPersonnel','peer-surveys':'peerSurveys','position-review':'positionReview','personnel-requests-archive':'personnelRequestsArchive','evaluation-settings':'evaluationSettings','score-settings':'scoreSettings','ai-archive':'aiArchive','incoming-archive':'incomingArchive'}[id]||id;}
  const accounts=()=>window.PanelWorkflow.accounts||[];
  const modelTitle=row=>row.policy?.name||(row.status==='locked'?'مدل ثبت‌شدهٔ نتیجهٔ قفل‌شده':'مدل عمومی سازمان');
  function syncDesignModel(){
    const form=$('#designForm'),selected=designDraftEmployeeId||form.elements.employeeId.value,eligible=(evaluationModelsData?.people||[]).filter(person=>person.managerId===user?.id);
    populateSelect(form.elements.employeeId,eligible,'پرسنلی در محدودهٔ مدیریت شما وجود ندارد.');if(eligible.some(person=>person.id===selected))form.elements.employeeId.value=selected;
    const person=eligible.find(person=>person.id===form.elements.employeeId.value),category=form.elements.category,chosen=category.value;
    category.innerHTML=['routine','project'].map(id=>`<option value="${id}">${id==='routine'?'روتین':'پروژه‌ای'}</option>`).join('');if([...category.options].some(option=>option.value===chosen))category.value=chosen;
    category.disabled=!person;for(const button of form.querySelectorAll('button'))if(!activeWrites)button.disabled=button.id==='designHelpToggle'?false:!person;
    updateDesignFieldButtons();
    let note=$('#designModelNote');if(!note){note=document.createElement('p');note.id='designModelNote';note.className='workflow-muted';form.querySelector('h2').after(note);}note.textContent=person?`${person.policy.name} · ${person.policy.version} · سهم روتین ${pct(person.policy.weights.routine)}، پروژه ${pct(person.policy.weights.project)}؛ هر دو نوع قابل تعریف‌اند، سهم صفر روی امتیاز اثر ندارد.`:'پرسنلی در محدودهٔ مدیریت شما برای این فصل وجود ندارد.';
    syncDesignFields();syncFinalReviewForm();
    if(person?.partialPeriod)note.textContent+=' بازهٔ این سمت: '+window.PanelDate.format(person.evidenceStart||person.assessmentStart)+' تا پایان '+window.PanelDate.format(person.assessmentLastDay)+'؛ تعداد و موعد شاخص‌ها را برای همین بازه تعریف کنید.';
  }
  function populateSelect(select,rows,empty){if(!select)return;select.innerHTML=rows.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.unitName||'')}</option>`).join('')||`<option value="">${esc(empty)}</option>`;}
  function fillUnitSelect(select,selected){if(!select)return;select.innerHTML='<option value="">انتخاب واحد</option>'+orgUnits.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');select.value=selected&&orgUnits.some(row=>row.id===selected)?selected:'';}
  function syncOrgForm(form,{unitId=form.elements.unitId.value,sectionId=form.elements.sectionId.value,managerId=form.elements.managerId.value}={}){
    fillUnitSelect(form.elements.unitId,unitId);const unit=orgUnits.find(row=>row.id===form.elements.unitId.value);form.elements.unitName.value=unit?.name||'';
    const sections=orgSections.filter(row=>row.unitId===unit?.id);form.elements.sectionId.innerHTML='<option value="">انتخاب بخش</option>'+sections.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');form.elements.sectionId.value=sections.some(row=>row.id===sectionId)?sectionId:'';
    const candidates=accounts().filter(row=>row.role==='manager'&&!row.isSettled&&row.unitId===unit?.id&&row.id!==form.elements.employeeId?.value);populateSelect(form.elements.managerId,candidates,'مدیر مجاز در این واحد ثبت نشده است.');if(candidates.some(row=>row.id===managerId))form.elements.managerId.value=managerId;
    if(form.getAttribute('id')==='personCreateForm')syncNewPersonRole();
  }
  function canView(id){const role=user?.role;if(roleViews[camelView(id)])return roleViews[camelView(id)].includes(role);const base={dashboard:['personnel','manager'],assignments:['personnel'],projectAssignments:['personnel'],team:['manager'],surveys:['manager','personnel','hr'],reviews:['personnel'],proposals:[],documents:[],users:[],activity:[],settings:[]};return !!base[id]?.includes(role);}
  const state=(value)=>`<span class="workflow-state" data-status="${Object.hasOwn(labels,value)?value:'unknown'}">${esc(labels[value]||value||'نامشخص')}</span>`;
  const table=(headers,rows,empty)=>`<div class="workflow-table-wrap"><table class="workflow-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${headers.length}" class="workflow-muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  const message=(value,error=false)=>{const el=$('#workflowStatus');if(el){el.textContent=value;el.classList.toggle('warning-text',error);}};
  function currentPeriod(){return $('#workflowPeriod')?.value||'';}
  function fillCommonPeriods(resetAppeal=false){const q=quarterNow();for(const form of [$('#appealForm'),$('#examImportForm')]){const field=form?.querySelector('[name="quarter"]'),yearField=form?.querySelector('.quarter-year'),seasonField=form?.querySelector('.quarter-season');if(!field)return;const chosen=!resetAppeal&&field.value?field.value:q,year=Math.max(1405,Number(chosen.slice(0,4))),season=year===1405?Math.max(3,Number(chosen.slice(-1))):Number(chosen.slice(-1));yearField.innerHTML=Array.from({length:Math.max(11,year-1405+6)},(_,i)=>`<option value="${1405+i}">${new Intl.NumberFormat('fa-IR',{useGrouping:false}).format(1405+i)}</option>`).join('');yearField.value=String(year);const syncSeason=()=>{seasonField.innerHTML=['بهار','تابستان','پاییز','زمستان'].map((name,i)=>i+1).filter(index=>Number(yearField.value)>1405||index>=3).map(index=>`<option value="${index}">${['بهار','تابستان','پاییز','زمستان'][index-1]}</option>`).join('');seasonField.value=Number(yearField.value)===1405?'3':'1';field.value=`${yearField.value}-Q${seasonField.value}`;};yearField.onchange=syncSeason;syncSeason();seasonField.value=String(season);field.value=`${yearField.value}-Q${seasonField.value}`;seasonField.onchange=()=>{field.value=`${yearField.value}-Q${seasonField.value}`;};}}

  function renderEvaluationSettings(){
    if(!evaluationSettingsData)return;
    const {current,currentByUnit={},drafts=[],published,earliestQuarter}=evaluationSettingsData,form=$('#evaluationSettingsForm'),unitField=form.elements.unitId;
    unitField.innerHTML=`<option value="">همهٔ واحدها · پیش‌فرض سازمان</option>${orgUnits.map(unit=>`<option value="${esc(unit.id)}">${esc(unit.name)}</option>`).join('')}`;
    if(selectedSettingsUnitId===null)selectedSettingsUnitId=drafts[0]?.unitId||'';
    if(selectedSettingsUnitId&&!orgUnits.some(unit=>unit.id===selectedSettingsUnitId))selectedSettingsUnitId='';
    unitField.value=selectedSettingsUnitId;unitField.onchange=()=>{selectedSettingsUnitId=unitField.value;renderEvaluationSettings();};
    const selectedDraft=drafts.find(row=>(row.unitId||'')===selectedSettingsUnitId),values=selectedDraft||(selectedSettingsUnitId?currentByUnit[selectedSettingsUnitId]:current)||current,weights=values.weights;
    for(const name of ['exam','manager','routine','project','peer'])form.elements[name].value=weights[name];
    const target=selectedDraft?.effectiveQuarter||earliestQuarter,selected=target>=earliestQuarter?target:earliestQuarter,[year,season]=selected.split('-Q').map(Number),[firstYear,firstSeason]=earliestQuarter.split('-Q').map(Number),yearField=form.elements.effectiveYear,seasonField=form.elements.effectiveSeason;
    yearField.innerHTML=Array.from({length:Math.max(6,year-firstYear+2)},(_,i)=>`<option value="${firstYear+i}">${fa.format(firstYear+i)}</option>`).join('');yearField.value=String(year);
    const fillSeasons=chosen=>{const allowed=[1,2,3,4].filter(value=>Number(yearField.value)>firstYear||value>=firstSeason);seasonField.innerHTML=allowed.map(value=>`<option value="${value}">${['بهار','تابستان','پاییز','زمستان'][value-1]}</option>`).join('');seasonField.value=String(allowed.includes(chosen)?chosen:allowed[0]);};
    yearField.onchange=()=>fillSeasons();fillSeasons(season);
    const unitName=row=>row.unitId?orgUnits.find(unit=>unit.id===row.unitId)?.name||row.unitId:'همهٔ واحدها';
    const weightSummary=weights=>['exam','manager','routine','project','peer'].map(id=>fa.format(weights[id])).join(' / ');
    $('#evaluationSettingsDrafts').innerHTML=table(['نسخه','واحد هدف','شروع اثر','آزمون / مدیر / روتین / پروژه / همکاران','اقدام'],drafts.map((row,index)=>`<tr><td>پیش‌نویس ${fa.format(drafts.length-index)}</td><td>${esc(unitName(row))}</td><td>${esc(window.PanelWorkflow.quarterLabel(row.effectiveQuarter))}</td><td>${weightSummary(row.weights)}</td><td><button type="button" class="primary-button" data-publish-settings-draft="${esc(row.id)}">انتشار</button> <button type="button" class="secondary-button" data-delete-settings-draft="${esc(row.id)}">حذف</button></td></tr>`).join(''),'هنوز پیش‌نویسی ذخیره نشده است.');
    $('#evaluationSettingsVersions').innerHTML=table(['نسخه','واحد هدف','شروع اثر','آزمون / مدیر / روتین / پروژه / همکاران','اقدام'],[...published].reverse().map(row=>{const w=row.weights;return `<tr><td dir="ltr">${esc(row.version)}</td><td>${esc(unitName(row))}</td><td>${esc(window.PanelWorkflow.quarterLabel(row.effectiveQuarter))}</td><td>${weightSummary(w)}</td><td><button type="button" class="secondary-button" data-delete-settings-published="${esc(row.id)}" aria-label="حذف نسخهٔ ${esc(row.version)}">حذف</button></td></tr>`;}).join(''),'هنوز نسخه‌ای منتشر نشده است.');
  }

  let loadedContextKey=null;
  async function refresh({section=null}={}){
    if(!user)return;
    const version=++refreshVersion,requestedUser=user,requestedPeriod=currentPeriod(),role=user.role,q=quarterNow();
    const stale=()=>version!==refreshVersion||requestedUser!==user||requestedPeriod!==currentPeriod();
    const paths=role==='manager'?['/api/org/designs','/api/org/positions/review','/api/org/surveys','/api/org/task-deadlines','/api/org/appeals','/api/org/personnel-requests']:role==='hr'?['/api/org/positions','/api/org/units','/api/org/sections','/api/org/designs','/api/org/evaluations','/api/org/appeals','/api/org/surveys','/api/org/exams/imports','/api/org/task-deadlines','/api/org/evaluation-settings','/api/org/settlements']:['/api/org/surveys','/api/org/appeals'];
    const contextKey=JSON.stringify([user.id,role,requestedPeriod]),quarterPath='/api/org/quarters/'+q,modelPath='/api/org/evaluation-models?period='+requestedPeriod;
    const required={chart:['/api/org/chart'],appeals:['/api/org/appeals'],surveys:['/api/org/surveys'], 'peer-surveys':['/api/org/surveys'],data:['/api/org/exams/imports'],tasks:['/api/org/designs','/api/org/positions','/api/org/units',modelPath,'/api/org/ai-capabilities'],quarters:[quarterPath,'/api/org/evaluations'], 'evaluation-settings':['/api/org/evaluation-settings','/api/org/units',modelPath], 'position-review':['/api/org/positions/review'], 'personnel-requests-archive':['/api/org/personnel-requests']};
    const selected=section&&loadedContextKey===contextKey&&required[section]?new Set(required[section]):null;
    const values=role==='manager'?[designs,positionRequests,campaigns,deadlines,appeals,managerRequestsData]:role==='hr'?[positions,orgUnits,orgSections,designs,evaluations,appeals,campaigns,examImports,deadlines,evaluationSettingsData,settlementData]:[campaigns,appeals];
    const cached=new Map(paths.map((path,index)=>[path,values[index]]));cached.set(quarterPath,quarterRows);cached.set('/api/org/chart',orgChart);cached.set(modelPath,evaluationModelsData);cached.set('/api/org/ai-capabilities',aiCapabilities);
    try{
      const result=await Promise.all([...paths,quarterPath,'/api/org/chart',modelPath,...(['hr','manager'].includes(role)?['/api/org/ai-capabilities']:[])].map(path=>selected&&!selected.has(path)?Promise.resolve(cached.get(path)):path==='/api/org/ai-capabilities'?api(path).catch(()=>({jobAnalysis:false,alignment:false})):api(path)));if(stale())return;loadedContextKey=contextKey;
      if(['hr','manager'].includes(role))aiCapabilities=result.pop();
      evaluationModelsData=result.pop();orgChart=result.pop();quarterRows=result.pop();syncDesignModel();
      if(role==='manager'){[designs,positionRequests,campaigns,deadlines,appeals,managerRequestsData]=result;renderTasks();renderPositionRequests();}
      if(role==='hr'){[positions,orgUnits,orgSections,designs,evaluations,appeals,campaigns,examImports,deadlines,evaluationSettingsData,settlementData]=result;renderOrganization();renderSettlements();renderUpdates();renderDuties();renderIncoming();renderTasks();renderData();renderEvaluationSettings();}
      if(role==='personnel')[campaigns,appeals]=result;
      syncDesignModel();renderSurvey();renderAppeals();renderQuarters();fillCommonPeriods();renderChart();renderManagerPersonnel();if(role==='hr')renderQuarterInbox();
    }catch(error){if(!stale())throw error;}
  }

  function displayQuarterBlocker(item){
    const accurateText=item.replace(/^فصل تا پایان روز (?=\d{4}-\d{2}-\d{2})/,'فصل تا آغاز روز ');
    return window.PanelDate.formatEmbedded(accurateText);
  }
  function renderPersonnelQuarter(row){
    const panel=$('#quarterCards');
    if(!row){panel.innerHTML='<p class="workflow-muted">ارزیابی فصلی KPI برای این حساب پیدا نشد.</p>';return;}
    if(row.status==='not_applicable'){panel.innerHTML='<section class="panel settings-card"><h3>خارج از KPI فردی</h3><p>برای این سمت در فصل انتخاب‌شده KPI فردی محاسبه نمی‌شود.</p></section>';return;}
    const locked=row.status==='locked',stage=locked?3:row.status==='hr_review'?2:row.status==='ready'?1:0;
    const timeBlockers=(row.blockers||[]).filter(item=>/^فصل تا (پایان|آغاز) روز /.test(item));
    const dataBlockers=(row.blockers||[]).filter(item=>!timeBlockers.includes(item));
    const statusTitle=locked?'نهایی و قفل‌شده':stage===2?'در بررسی ادمین':stage===1?'آمادهٔ ارسال توسط مدیر':dataBlockers.length?'نیازمند تکمیل داده‌ها':'فصل هنوز باز است';
    const statusDescription=locked?'نتیجهٔ فصل تأیید شده و مبنای درخواست بازبینی است.':stage===2?'مدیر نتیجه را ارسال کرده است؛ تا تأیید ادمین، اعداد قطعی نیستند.':stage===1?'داده‌های فصل کامل است، اما هنوز نتیجه برای تأیید ادمین ارسال نشده است.':'نتیجهٔ نهایی پس از پایان فصل، تکمیل داده‌ها و تأیید مدیر و ادمین مشخص می‌شود.';
    const firstMonth=row.monthRows?.[0]?.components||[];
    const components=row.calculation?.components?.length?row.calculation.components:firstMonth.map(component=>({...component,score:null}));
    const componentCards=components.filter(component=>component.weight>0).map(component=>{
      const applicable=component.applicable!==false,score=component.id==='exam'?(row.exam?.score??component.score):component.score;
      const detail=component.id==='exam'?'<span>آزمون یک‌بار در فصل ثبت می‌شود.</span>':(row.monthRows||[]).map(month=>{
        const monthly=month.components?.find(item=>item.id===component.id);
        return `<span>${esc(window.PanelWorkflow.monthLabel(month.period))}: ${applicable?pct(monthly?.score??null):'غیرمشمول'}</span>`;
      }).join('');
      return `<article class="quarter-component"><div><h3>${esc(component.name)}</h3><span>${applicable?'وزن مؤثر '+pct(component.weight):'غیرمشمول'}</span></div><strong>${applicable?pct(score??null):'غیرمشمول'}</strong><div class="quarter-component-months">${detail}</div></article>`;
    }).join('');
    const hasEstimate=locked||stage===1||stage===2;
    const resultLabel=locked?'نتیجهٔ قطعی فصل':'محاسبهٔ موقت؛ هنوز تأیید نهایی نشده است';
    const steps=['گردآوری داده‌های فصل','آمادهٔ ارسال مدیر','بررسی ادمین','نتیجهٔ نهایی'];
    panel.innerHTML=`<div class="panel-heading"><div><h2>${esc(window.PanelWorkflow.quarterLabel(row.quarter))}</h2><p>ارزیابی فصلی KPI ${esc(modelTitle(row))}؛ نتیجهٔ قطعی فقط پس از قفل‌شدن منتشر می‌شود.</p></div><button class="secondary-button" data-refresh-lifecycle>به‌روزرسانی</button></div>
      <section class="quarter-status-panel" data-status="${esc(row.status)}"><div class="quarter-status-header"><div><span class="quarter-status-badge">${statusTitle}</span><p>${statusDescription}</p></div></div><ol class="quarter-stage-list">${steps.map((title,index)=>`<li class="${index<stage?'is-complete':index===stage?'is-current':''}" ${index===stage?'aria-current="step"':''}><span>${fa.format(index+1)}</span>${title}</li>`).join('')}</ol></section>
      <section class="quarter-section"><h3>امتیاز مؤلفه‌های فصل</h3><p class="workflow-muted">هر مؤلفه مستقیماً برای همین فصل ارزیابی می‌شود. امتیاز ثبت‌نشده صفر محسوب نمی‌شود.</p><div class="quarter-component-grid">${componentCards||'<p class="workflow-muted">مؤلفه‌ای برای نمایش موجود نیست.</p>'}</div></section>
      <section class="quarter-section"><h3>${resultLabel}</h3><div class="quarter-result-grid"><article><span>امتیاز عملکرد فصل</span><strong>${hasEstimate?pct(row.calculation?.performance??null):'در انتظار تکمیل'}</strong></article><article><span>مبلغ KPI فصلی</span><strong>${hasEstimate?money(row.quarterPay?.earned):'در انتظار تکمیل'}</strong></article><article><span>سقف KPI فصلی</span><strong>${hasEstimate?money(row.quarterPay?.ceiling):'در انتظار تکمیل'}</strong></article></div>${locked?'<p class="workflow-muted">این نتیجه قفل شده است؛ درخواست بازبینی فقط طبق مهلت و شرایط ثبت اعتراض پذیرفته می‌شود.</p>':'<p class="workflow-muted">این بخش سند پرداخت یا حقوق نهایی نیست. دریافتی تا فصل انتخاب‌شده در پیشخوان نمایش داده می‌شود.</p>'}</section>
      ${timeBlockers.length?`<section class="quarter-section quarter-information"><h3>زمان‌بندی فصل</h3><ul>${timeBlockers.map(item=>`<li>${esc(displayQuarterBlocker(item))}</li>`).join('')}</ul></section>`:''}
      ${dataBlockers.length?`<section class="quarter-section quarter-blockers"><h3>موارد نیازمند تکمیل یا بررسی</h3><ul>${dataBlockers.map(item=>`<li>${esc(displayQuarterBlocker(item))}</li>`).join('')}</ul></section>`:''}
      <div class="quarter-actions"><button type="button" class="secondary-button" data-quarter-monthly>مشاهدهٔ جزئیات فصل در پیشخوان</button>${locked?'<button type="button" class="secondary-button" data-quarter-appeal>بررسی امکان ثبت اعتراض</button>':''}</div>`;
  }
  function renderQuarters(){
    quarterFilters.hidden=!['hr','manager'].includes(user.role);
    $('#view-quarters h1').textContent=user.role==='personnel'?'وضعیت ارزیابی فصلی KPI':'ارزیابی فصلی KPI';
    $('#quarterIntro').textContent=user.role==='personnel'?'وضعیت تکمیل داده‌ها، بررسی مدیر و ادمین و نتیجهٔ نهایی فصل':'ارزیابی مستقیم فصل، یک نمره برای هر مؤلفه و تأیید مدیر و ادمین';
    if(user.role==='personnel'){$('#quarterInbox').hidden=true;renderPersonnelQuarter(quarterRows[0]);return;}
    $('#quarterInbox').hidden=user.role!=='hr';
    if(!canView('quarters'))return;syncQuarterUnits();const visible=quarterRows.filter(row=>quarterMatches(row.employee));$('#quarterResultCount').textContent=fa.format(visible.length)+' نفر از '+fa.format(quarterRows.length);const statusText=row=>state(row.status);const rows=visible.map(row=>{
      const score=row.calculation?.performance,earned=row.quarterPay?.earned,ceiling=row.quarterPay?.ceiling;
      const finalButton=user.role==='manager'&&row.canFinalize?`<button class="secondary-button" data-submit-quarter="${esc(row.employee.id)}">ارسال برای ادمین</button>`:'';
      return `<tr data-quarter-person="${esc(row.employee.id)}"><td><strong>${esc(row.employee.name)}</strong><small>${esc(row.employee.level||row.modelType)}</small></td><td>${esc(quarterUnitLabel(row.employee))}</td><td>${esc(modelTitle(row))}<small>${['exam','manager','routine','project','peer'].map(id=>fa.format(row.policy?.weights?.[id]||0)).join(' / ')}</small></td><td>${pct(score)}</td><td>${user.role==='manager'?'محدود':money(earned)}</td><td>${user.role==='manager'?'محدود':money(ceiling)}</td><td>${statusText(row.status)}</td><td>${finalButton}</td></tr>`;
    }).join('');
    const incomplete=visible.flatMap(row=>(row.blockers||[]).map(item=>`${row.employee.name}: ${displayQuarterBlocker(item)}`));
    const summary=incomplete.length?`<div class="lifecycle-note"><b>موارد ناقص (به‌جای صفر، متوقف می‌شوند):</b><ul>${incomplete.slice(0,12).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:'<p class="lifecycle-note">داده‌های فصل آمادهٔ بازبینی‌اند؛ این وضعیت هنوز تأیید یا پرداخت نیست.</p>';
    $('#quarterCards').innerHTML=`<div class="panel-heading"><div><h2>${esc(window.PanelWorkflow.quarterLabel(quarterNow()))}</h2><p>نسخهٔ تجمیع ${esc(quarterRows[0]?.aggregationVersion||'exam-once-monthly-thirds-v1')} · هر مؤلفه یک نمرهٔ مستقل در فصل دارد</p></div><button class="secondary-button" data-refresh-lifecycle>به‌روزرسانی</button></div>${table(['پرسنل','واحد','مدل','امتیاز فصل','مبلغ KPI فصلی','سقف KPI','وضعیت','اقدام'],rows,quarterRows.length?'پرسنلی با این جست‌وجو و واحد پیدا نشد.':'پرسنلی برای این نقش تعریف نشده است.')}${visible.length?summary:''}`;
    $('#quarterCards table').setAttribute('aria-label','ارزیابی فصلی پرسنل');$('#quarterCards').querySelectorAll('th').forEach(th=>th.setAttribute('scope','col'));
  }
  function renderQuarterInbox(){
    const rows=evaluations.filter(row=>row.quarter===quarterNow()&&quarterMatches(quarterRows.find(person=>person.employee.id===row.employeeId)?.employee||row.snapshot?.employee||{name:row.employeeId})).map(row=>`<tr><td>${esc(row.snapshot?.employee?.name||row.employeeId)}</td><td>${esc(window.PanelWorkflow.quarterLabel(row.quarter))}</td><td>${state(row.status)}</td><td>${row.status==='hr_review'?`<button class="primary-button" data-approve-evaluation="${esc(row.id)}">تصویب و قفل</button> <button class="secondary-button" data-return-evaluation="${esc(row.id)}">بازگرداندن</button>`:''}</td></tr>`).join('');
    $('#quarterInbox').hidden=user.role!=='hr';$('#quarterInbox').innerHTML='<h2>صف نهایی‌سازی ادمین</h2>'+table(['پرسنل','فصل','وضعیت','اقدام'],rows,'ارزیابی فصل نیازمند ادمین برای این فصل وجود ندارد.');
  }
  const designCategoryName=category=>category==='project'?'پروژه‌ای':'روتین';
  $('#routineFields').insertAdjacentHTML('beforeend','<label>تاریخ مشخص انجام در فصل (اختیاری)<input id="designRoutineDate" name="routineDate" type="text" dir="ltr" placeholder="انتخاب تاریخ"><small>برای کار مربوط به روزهای گذشتهٔ همین فصل، تاریخ موردنظر را انتخاب کنید؛ خالی یعنی موعد بر اساس تناوب.</small></label>');
  window.PanelDatePicker.attach($('#designRoutineDate'),{id:'design-routine-date-calendar',allowClear:true,canOpen:()=>user?.role==='manager'&&!activeWrites&&!$('#routineFields').hidden&&$('#view-tasks').classList.contains('active')});
  const designTimeLabel=limit=>limit?[limit.dayOfMonth!=null?'روز '+fa.format(limit.dayOfMonth)+' ماه':'',limit.dayOfWeek!=null?designWeekdays[limit.dayOfWeek]:'','ساعت '+window.PanelDate.hourOnly(limit.time)].filter(Boolean).join(' · '):'';
  const designWeight=(tasks,category)=>tasks.filter(task=>task.category===category).reduce((total,task)=>total+Number(task.weightPoints),0);
  let deadlineCalendarYear=1405,deadlineCalendarMonth=1;
  const persianMonthNames=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const dateAfter=(iso,days)=>new Date(Date.parse(iso+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
  const deadlineCalendar=$('#designDeadlineCalendar');deadlineCalendar.setAttribute('popover','manual');document.body.append(deadlineCalendar);
  function closeDeadlineCalendar(returnFocus=false){
    const calendar=$('#designDeadlineCalendar'),input=$('#designDeadline');if(!calendar||!input)return;
    if(typeof calendar.hidePopover==='function'){try{calendar.hidePopover();}catch{}}
    calendar.hidden=true;input.setAttribute('aria-expanded','false');if(returnFocus&&!input.disabled)input.focus();
  }
  function positionDeadlineCalendar(){
    const calendar=$('#designDeadlineCalendar');if(calendar.hidden)return;
    const anchor=$('#designDeadline').getBoundingClientRect(),margin=8,gap=6,width=Math.min(264,window.innerWidth-margin*2),height=calendar.getBoundingClientRect().height||282;
    const maxTop=Math.max(margin,window.innerHeight-height-margin);
    calendar.style.width=width+'px';calendar.style.maxHeight=Math.max(100,window.innerHeight-margin*2)+'px';
    calendar.style.left=Math.max(margin,Math.min(anchor.right-width,window.innerWidth-width-margin))+'px';
    calendar.style.top=Math.max(margin,Math.min(anchor.top-height-gap,maxTop))+'px';
  }
  function renderDeadlineCalendar(focusDate=null){
    const calendar=$('#designDeadlineCalendar'),input=$('#designDeadline'),first=window.PanelDate.toGregorian(`${deadlineCalendarYear}/${deadlineCalendarMonth}/1`);
    let selected='';try{selected=window.PanelDate.toGregorian(input.value,true);}catch{}
    const today=window.PanelDate.toGregorian(window.PanelDate.today()),days=[];
    for(let index=0;index<31;index++){const iso=dateAfter(first,index);if(Number(window.PanelDate.input(iso).split('/')[1])!==deadlineCalendarMonth)break;days.push(iso);}
    const offset=(new Date(first+'T12:00:00Z').getUTCDay()+1)%7,focused=days.includes(focusDate)?focusDate:days.includes(selected)?selected:days.includes(today)?today:first;
    calendar.innerHTML=`<div class="persian-calendar-header"><button type="button" data-calendar-shift="-1" aria-label="ماه قبل"${deadlineCalendarYear===1300&&deadlineCalendarMonth===1?' disabled':''}>›</button><select data-calendar-month aria-label="ماه تقویم">${persianMonthNames.map((name,index)=>`<option value="${index+1}"${index+1===deadlineCalendarMonth?' selected':''}>${name}</option>`).join('')}</select><select data-calendar-year aria-label="سال تقویم">${Array.from({length:301},(_,index)=>1300+index).map(year=>`<option value="${year}"${year===deadlineCalendarYear?' selected':''}>${fa.format(year).replace(/٬/g,'')}</option>`).join('')}</select><button type="button" data-calendar-shift="1" aria-label="ماه بعد"${deadlineCalendarYear===1600&&deadlineCalendarMonth===12?' disabled':''}>‹</button></div><div class="persian-calendar-weekdays" aria-hidden="true">${['ش','ی','د','س','چ','پ','ج'].map(day=>`<span>${day}</span>`).join('')}</div><div class="persian-calendar-days" role="group" aria-label="روزهای ${persianMonthNames[deadlineCalendarMonth-1]} ${deadlineCalendarYear}">${'<span aria-hidden="true"></span>'.repeat(offset)}${days.map((iso,index)=>`<button type="button" data-calendar-day="${iso}" tabindex="${iso===focused?'0':'-1'}" aria-label="${esc(window.PanelDate.format(iso))}" aria-pressed="${iso===selected}"${iso===today?' aria-current="date"':''}>${fa.format(index+1)}</button>`).join('')}</div><div class="persian-calendar-footer"><button type="button" data-calendar-today>امروز</button><button type="button" data-calendar-close>بستن</button></div>`;
    if(focusDate)calendar.querySelector(`[data-calendar-day="${focused}"]`)?.focus();
    positionDeadlineCalendar();
  }
  function openDeadlineCalendar(){
    const input=$('#designDeadline');if(input.disabled||$('#projectFields').hidden)return;
    let iso;try{iso=window.PanelDate.toGregorian(input.value||window.PanelDate.today());}catch{iso=window.PanelDate.toGregorian(window.PanelDate.today());}
    [deadlineCalendarYear,deadlineCalendarMonth]=window.PanelDate.input(iso).split('/').map(Number);
    const calendar=$('#designDeadlineCalendar');calendar.hidden=false;input.setAttribute('aria-expanded','true');renderDeadlineCalendar();if(typeof calendar.showPopover==='function'){try{calendar.showPopover();}catch{}}positionDeadlineCalendar();calendar.querySelector(`[data-calendar-day="${iso}"]`)?.focus();
  }
  function selectDeadline(iso){
    const input=$('#designDeadline');input.value=window.PanelDate.input(iso).replace(/\d/g,digit=>'۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);input.dispatchEvent(new Event('change',{bubbles:true}));closeDeadlineCalendar(true);
  }
  function shiftDeadlineMonth(delta){
    const absolute=deadlineCalendarYear*12+deadlineCalendarMonth-1+delta,year=Math.floor(absolute/12);if(year<1300||year>1600)return;
    deadlineCalendarYear=year;deadlineCalendarMonth=absolute%12+1;renderDeadlineCalendar(window.PanelDate.toGregorian(`${year}/${deadlineCalendarMonth}/1`));
  }
  $('#designDeadline').onclick=openDeadlineCalendar;
  $('#designDeadline').onkeydown=event=>{if(['Enter',' ','ArrowDown'].includes(event.key)){event.preventDefault();openDeadlineCalendar();}};
  $('#designDeadlineCalendar').onclick=event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.calendarDay)selectDeadline(button.dataset.calendarDay);
    else if(button.dataset.calendarShift)shiftDeadlineMonth(Number(button.dataset.calendarShift));
    else if(button.hasAttribute('data-calendar-today'))selectDeadline(window.PanelDate.toGregorian(window.PanelDate.today()));
    else if(button.hasAttribute('data-calendar-close'))closeDeadlineCalendar(true);
  };
  $('#designDeadlineCalendar').onchange=event=>{if(event.target.hasAttribute('data-calendar-month'))deadlineCalendarMonth=Number(event.target.value);else if(event.target.hasAttribute('data-calendar-year'))deadlineCalendarYear=Number(event.target.value);else return;renderDeadlineCalendar();$('#designDeadlineCalendar').querySelector(event.target.hasAttribute('data-calendar-month')?'[data-calendar-month]':'[data-calendar-year]')?.focus();};
  $('#designDeadlineCalendar').onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();closeDeadlineCalendar(true);return;}
    const day=event.target.closest('[data-calendar-day]');if(!day)return;
    const deltas={ArrowLeft:1,ArrowRight:-1,ArrowDown:7,ArrowUp:-7};
    let delta=deltas[event.key];if(event.key==='Home')delta=-(new Date(day.dataset.calendarDay+'T12:00:00Z').getUTCDay()+1)%7;if(event.key==='End')delta=6-(new Date(day.dataset.calendarDay+'T12:00:00Z').getUTCDay()+1)%7;
    if(delta==null)return;event.preventDefault();const iso=dateAfter(day.dataset.calendarDay,delta),[year,month]=window.PanelDate.input(iso).split('/').map(Number);if(year<1300||year>1600)return;deadlineCalendarYear=year;deadlineCalendarMonth=month;renderDeadlineCalendar(iso);
  };
  const closeCalendarOnBlur=()=>setTimeout(()=>{if(!$('.design-deadline-field').contains(document.activeElement)&&!deadlineCalendar.contains(document.activeElement))closeDeadlineCalendar();},0);
  $('.design-deadline-field').addEventListener('focusout',closeCalendarOnBlur);deadlineCalendar.addEventListener('focusout',closeCalendarOnBlur);
  document.addEventListener('click',event=>{if(!event.composedPath().includes($('.design-deadline-field'))&&!event.composedPath().includes(deadlineCalendar))closeDeadlineCalendar();});
  window.addEventListener('resize',positionDeadlineCalendar);window.addEventListener('scroll',positionDeadlineCalendar,true);
  window.addEventListener('panel:view',event=>{if(event.detail!=='tasks')closeDeadlineCalendar();});
  function syncDesignFields(){
    const form=$('#designForm'),project=form.elements.category.value==='project',frequency=form.elements.frequency.value;
    $('#designTargetVolumeLabel').textContent=project?'تعداد':({فصلی:'تعداد در فصل',ماهانه:'تعداد در ماه',هفتگی:'تعداد در هفته',روزانه:'تعداد در روز',ساعتی:'تعداد در ساعت'}[frequency]||'تعداد');
    $('#routineFields').hidden=project;$('#projectFields').hidden=!project;
    form.elements.documentFormat.disabled=!project;form.elements.documentFormat.required=project;form.elements.deadline.disabled=!project;form.elements.deadline.required=project;
    form.elements.routineDate.disabled=project;form.elements.frequency.disabled=project;form.elements.frequency.required=!project;if(!project)closeDeadlineCalendar();
    const monthly=!project&&frequency==='ماهانه',weekly=!project&&frequency==='هفتگی';
    $('#designMonthDay').hidden=!monthly;$('#designWeekDay').hidden=!weekly;
    for(const [key,visible] of [['dayOfMonth',monthly],['dayOfWeek',weekly],['timeLimitHour',!project]]){form.elements[key].disabled=!visible;form.elements[key].required=visible;}
  }
  function renderDesignDraft(){
    const form=$('#designForm');if(!form)return;
    if(designDraftEmployeeId)form.elements.employeeId.value=designDraftEmployeeId;
    const currentTitle=form.elements.title.value.trim(),currentWeight=Number(form.elements.weight.value),currentCategory=form.elements.category.value;
    const saved=form.dataset.draftId||form.dataset.revision?stagedDesignTasks:designs.find(row=>row.status==='draft'&&row.employeeId===form.elements.employeeId.value&&row.period===currentPeriod())?.tasks||[];
    const preview=[...saved,...(currentTitle&&currentWeight? [{category:currentCategory,weightPoints:currentWeight}]:[])];
    const summary=['routine','project'].map(category=>{const rows=preview.filter(task=>task.category===category);if(!rows.length)return null;return `${designCategoryName(category)}: ${fa.format(rows.length)} تسک · مجموع وزن ${fa.format(designWeight(preview,category))} · جمع سهم‌ها ۱۰۰٪${currentTitle&&currentCategory===category&&currentWeight?' · سهم تسک در حال ورود '+pct(100*currentWeight/designWeight(preview,category)):''}`;}).filter(Boolean);
    $('#designWeightSummary').textContent=summary.length?summary.join(' · '):'وزن ۱ تا ۵ را انتخاب کنید؛ سیستم سهم درصدی هر تسک را در همان نوع محاسبه می‌کند.';
    form.elements.employeeId.disabled=!!designDraftEmployeeId;
    syncFinalReviewForm();
  }
  function formReviewLock(){
    const f=$('#designForm'),previous=designs.find(d=>d.id===(f.dataset.draftId||f.dataset.revision));
    return designs.find(d=>d.finalReviewOnly&&d.employeeId===(designDraftEmployeeId||f.elements.employeeId.value)&&d.period===(previous?.period||currentPeriod()));
  }
  function syncFinalReviewForm(){const lock=user?.role==='manager'&&formReviewLock();finalReviewNotice.hidden=!lock;finalReviewNotice.textContent=lock?.finalReviewReason||'';const button=$('#designForm .primary-button');if(button){button.disabled=!!lock||!!$('#designForm').dataset.submitting||!$('#designForm').elements.employeeId.value;button.title=lock?.finalReviewReason||'';}}
  function enforceFinalReviewLocks(){
    for(const d of designs.filter(d=>d.finalReviewOnly)){
      const row=document.querySelector('[data-design-row="'+d.id+'"]');if(!row)continue;
      for(const button of row.querySelectorAll('[data-publish-design],[data-edit-design],[data-analyze-design],[data-review-design],[data-revise-design],[data-copy-design],[data-approve-design],[data-return-design]')){
        const finalManager=user?.role==='manager'&&d.id===d.finalReviewSourceId&&button.dataset.reviewDesign===d.id&&button.dataset.decision==='approve';
        const adminDecision=user?.role==='hr'&&(button.dataset.approveDesign===d.id||button.dataset.returnDesign===d.id);
        if(!finalManager&&!adminDecision){button.disabled=true;button.title=d.finalReviewReason;}
      }
    }syncFinalReviewForm();
  }
  function resetDesignForm(employeeId=null){
    closeDeadlineCalendar();
    const form=$('#designForm');stagedDesignTasks=[];designDraftEmployeeId=null;editingClarifications=[];designClarificationArea.replaceChildren();designClarificationArea.hidden=true;form.reset();
    for(const key of ['revision','draftId','taskId','draftRevision'])delete form.dataset[key];form.elements.employeeId.disabled=false;loadDesignFieldEditors();
    if(employeeId)form.elements.employeeId.value=employeeId;$('#cancelDesignEdit').hidden=true;$('#designEditingNote').hidden=true;syncDesignFields();renderDesignDraft();
  }
  function designTaskFromForm(form){
    if(!form.reportValidity())throw new Error('اطلاعات تسک و وزن آن را کامل و معتبر وارد کنید.');
    const data=Object.fromEntries(new FormData(form)),category=data.category,weight=Number(data.weight),base=designs.find(d=>d.id===(form.dataset.draftId||form.dataset.revision))?.tasks.find(t=>t.id===form.dataset.taskId);
    if(!Number.isSafeInteger(weight)||weight<1||weight>5)throw new Error('وزن هر تسک باید عدد صحیح بین ۱ تا ۵ باشد.');
    const descriptionSections=readDescriptionSections(),description=composeDescription(descriptionSections),criteria=[...$('#designCriteriaFields').querySelectorAll('textarea')].map(el=>el.value.trim()).filter(Boolean);
    if(description.length>4000)throw new Error('مجموع شرح، هدف، مسئولیت و توضیحات تکمیلی باید حداکثر ۴۰۰۰ نویسه باشد.');
    const task={...(base?.category===category?JSON.parse(JSON.stringify(base)):{}),...(form.dataset.taskId?{id:form.dataset.taskId}:{}),category,title:data.title.trim(),description,descriptionSections,criteria,weightPoints:weight,frequency:data.frequency,targetVolume:Number(data.targetVolume),targetUnit:data.targetUnit,timeLimit:null,responsible:base?.responsible||user.name,evidenceTypes:base?.category===category?base.evidenceTypes||['مستند خروجی']:['مستند خروجی']};
    if(!task.criteria.length)throw new Error('دست‌کم یک معیار پذیرش برای تسک لازم است.');
    if(!Number.isSafeInteger(task.targetVolume)||task.targetVolume<1)throw new Error('تعداد باید عدد صحیح و حداقل یک باشد.');
    if(category==='routine'){task.dueDate=data.routineDate?window.PanelDate.toGregorian(data.routineDate):null;task.recurrenceVersion='required-task-time-v2';task.timeLimit={...(task.frequency==='ماهانه'?{dayOfMonth:Number(data.dayOfMonth)}:{}),...(task.frequency==='هفتگی'?{dayOfWeek:Number(data.dayOfWeek)}:{}),time:base?.category==='routine'&&base.frequency===task.frequency&&base.timeLimit?.time?.split(':')[0]===data.timeLimitHour?base.timeLimit.time:`${data.timeLimitHour}:00`};}
    if(category==='project'){const deadline=window.PanelDate.toGregorian(data.deadline);if(!Object.hasOwn(window.PanelDocumentFormats,data.documentFormat))throw new Error('فرمت مستندات را انتخاب کنید.');Object.assign(task,{frequency:null,timeLimit:null,recurrenceVersion:'project-deadline-v1',documentFormat:data.documentFormat,deadline,evidenceTypes:base?.category==='project'&&base.documentFormat===data.documentFormat&&base.evidenceTypes?.length?JSON.parse(JSON.stringify(base.evidenceTypes)):[window.PanelDocumentFormats[data.documentFormat]],milestones:base?.category==='project'&&base.deadline===deadline&&base.milestones?.length?JSON.parse(JSON.stringify(base.milestones)):[{name:'تحویل نهایی',dueDate:deadline}]});}
    if(editingClarifications.length)task.clarifications=readClarificationAnswers(designClarificationArea);
    return task;
  }
  function validateDesignWeights(tasks){
    if(!tasks.length||tasks.length>30)throw new Error('برای هر طرح ۱ تا ۳۰ تسک لازم است.');
    if(tasks.some(task=>!Number.isInteger(task.weightPoints)||task.weightPoints<1||task.weightPoints>5))throw new Error('وزن هر تسک باید بین ۱ تا ۵ باشد.');
  }
  function loadDesignRevision(design,taskIndex=0){
    const form=$('#designForm'),usedIds=new Set((design.tasks||[]).map(task=>task.id).filter(Boolean));
    const revisionTaskId=(task,index)=>{if(task.id)return task.id;let id=`T${index+1}`;while(usedIds.has(id))id+='-revision';usedIds.add(id);return id;};
    const converted=(design.tasks||[]).map((task,index)=>({...task,id:revisionTaskId(task,index),
      weightPoints:task.weightPoints??Math.max(1,Math.round(5*task.weight/Math.max(...design.tasks.filter(row=>row.category===task.category).map(row=>row.weight)))),
      frequency:['فصلی','ماهانه','هفتگی','روزانه','ساعتی'].includes(task.frequency)?task.frequency:'فصلی',
      targetVolume:Number.isSafeInteger(task.targetVolume)&&task.targetVolume>0?task.targetVolume:1,
      targetUnit:designTargetUnits.includes(task.targetUnit)?task.targetUnit:designTargetUnits.find(unit=>task.targetUnit?.includes(unit))||'عدد'
    })),current=converted[taskIndex],others=converted.filter((_,index)=>index!==taskIndex);if(!current)return;
    resetDesignForm();stagedDesignTasks=others;designDraftEmployeeId=design.employeeId;
    form.dataset[design.status==='draft'?'draftId':'revision']=design.id;form.dataset.taskId=current.id||`T${taskIndex+1}`;form.elements.employeeId.value=design.employeeId;
    form.dataset.draftRevision=String(design.draftRevision||0);editingClarifications=(current.clarifications||[]).map(q=>({...q}));renderDraftClarifications();
    $('#cancelDesignEdit').hidden=false;$('#designEditingNote').hidden=false;$('#designEditingNote').textContent=`ویرایش ${current.title} · ماه ${window.PanelWorkflow.monthLabel(design.period)}${others.length?'؛ '+fa.format(others.length)+' شاخص دیگر همین نسخه بدون تغییر عنوان نگهداری می‌شود.':''}`;
    for(const key of ['category','title','frequency','targetVolume','targetUnit'])if(current[key]!=null)form.elements[key].value=String(current[key]);loadDesignFieldEditors(current);
    form.elements.documentFormat.value=current.documentFormat||'';
    form.elements.weight.value=String(current.weightPoints);
    form.elements.dayOfMonth.value=current.timeLimit?.dayOfMonth??'';form.elements.dayOfWeek.value=current.timeLimit?.dayOfWeek??'';form.elements.timeLimitHour.value=current.timeLimit?.time?.split(':')[0]||'';
    form.elements.routineDate.value=current.dueDate?window.PanelDate.input(current.dueDate):'';
    form.elements.deadline.value=current.deadline?window.PanelDate.input(current.deadline):'';
    syncDesignFields();renderDesignDraft();if(design.tasks.some(task=>task.weightPoints==null))message('نسخهٔ قبلی تغییر نکرده است؛ برای نسخهٔ اصلاحی وزن‌ها به ۱ تا ۵ تبدیل و تناوب/تعداد/واحد نامتعارف با پیش‌فرض جایگزین شدند. همهٔ سهم‌ها و مشخصات را پیش از ثبت بررسی کنید.');
  }
  const analysisLabels={retain:'حفظ',revise:'اصلاح پیشنهادی',merge:'ادغام پیشنهادی',replace:'جایگزینی پیشنهادی',reject:'رد تحلیلی',needs_information:'نیازمند اطلاعات',pass:'بدون مانع شناسایی‌شده',fail:'نیازمند اصلاح',unknown:'نامعلوم',covered:'پوشش داده‌شده',partial:'پوشش جزئی',uncovered:'بدون پوشش',direct:'مستقیم',shared:'مشترک',external:'خارج از اختیار',routine:'روتین',project:'پروژه‌ای',event_driven:'رویدادمحور',mixed:'ترکیبی',relevance:'ارتباط با شغل',control:'کنترل‌پذیری',definition:'تعریف',target:'هدف',source:'منبع داده',measurability:'سنجش‌پذیری',overlap:'هم‌پوشانی',gaming:'رفتار ناخواسته',coverage:'پوشش',title:'عنوان',description:'شرح',criteria:'معیارها',frequency:'تناوب',targetVolume:'تعداد هدف',targetUnit:'واحد هدف',timeLimit:'زمان انجام',deadline:'موعد',dueDate:'تاریخ تحویل',documentFormat:'فرمت مستند',deliverable:'خروجی',milestones:'نقاط تحویل',weightPoints:'وزن نسبی',evidenceTypes:'نوع شاهد'};
  const analysisValue=value=>value==null?'نامعلوم':typeof value==='string'?value:Array.isArray(value)?value.map(item=>typeof item==='object'?Object.values(item).join(' · '):item).join('\n'):typeof value==='object'?Object.values(value).filter(value=>value!=null).join(' · '):fa.format(value);
  const analysisFieldValue=(field,value)=>{
    if(value==null)return 'نامعلوم';
    if(field==='timeLimit'&&typeof value==='object')return [value.dayOfMonth!=null?'روز '+fa.format(value.dayOfMonth)+' ماه':'',value.dayOfWeek!=null?designWeekdays[value.dayOfWeek]:'',value.time?'ساعت '+window.PanelDate.hourOnly(value.time):'ساعت نامعلوم'].filter(Boolean).join(' · ');
    if(['deadline','dueDate'].includes(field)&&typeof value==='string')return window.PanelDate.format(value);
    if(field==='documentFormat')return window.PanelDocumentFormats[value]||analysisValue(value);
    if(field==='milestones'&&Array.isArray(value))return value.map(item=>item.name+' · موعد: '+window.PanelDate.format(item.dueDate)).join('\n');
    return analysisValue(value);
  };
  const analysisCitations=(refs,tasks=[])=>(refs||[]).map(ref=>{const clarification=ref.sourceId.startsWith('clarification-'),task=tasks.find(task=>(clarification?'clarification-':'proposal-')+task.id===ref.sourceId),source=clarification?(ref.segmentId.endsWith('-answer')?'پاسخ مدیر به ابهام':'پرسشِ ابهام')+(task?' · '+task.title:''):ref.sourceId.startsWith('position-')?'بند '+ref.segmentId.replace(/^D/,'')+' شرح وظایف':'پیشنهاد مدیر'+(task?' · '+task.title:'')+' · '+(analysisLabels[ref.segmentId]||'متن شاخص');return '<blockquote class="analysis-citation"><small>'+esc(source)+' · نسخه '+esc(ref.sourceVersion)+'</small><p>'+esc(ref.quote)+'</p></blockquote>';}).join('');
  function jobAnalysisHtml(analysis,{open=true}={}){
    if(!analysis)return '';const result=analysis.result;
    return `<details class="job-analysis-details" ${open?'open':''}><summary>تحلیل شرح وظایف</summary><p class="analysis-advisory">این تحلیل پیشنهاد است و متن رسمی شرح وظایف را تغییر نمی‌دهد.</p><p>${esc(result.summary)}</p>${result.duties.map(duty=>`<article class="analysis-duty"><h4>${esc(duty.activity)}</h4><dl><div><dt>خروجی</dt><dd>${esc(duty.output||'نامعلوم')}</dd></div><div><dt>دریافت‌کننده</dt><dd>${esc(duty.recipient||'نامعلوم')}</dd></div><div><dt>نقش فرد</dt><dd>${esc(duty.roleInOutput||'نامعلوم')}</dd></div><div><dt>نوع کار</dt><dd>${esc(analysisLabels[duty.workKind])}</dd></div><div><dt>حدود اختیار</dt><dd>${esc(analysisLabels[duty.control])}</dd></div><div><dt>تناوب / موعد</dt><dd>${esc([duty.frequency,duty.deadline].filter(Boolean).join(' · ')||'نامعلوم')}</dd></div></dl>${duty.dependencies.length?`<p>وابستگی‌ها: ${esc(duty.dependencies.join(' · '))}</p>`:''}${analysisCitations(duty.citations)}</article>`).join('')}${result.issues.length?`<h4>ابهام‌ها و اطلاعات لازم</h4><ul>${result.issues.map(issue=>`<li>${esc(issue.reason)}<p>${esc(issue.informationNeeded)} · مسئول پاسخ: ${esc(issue.responsibleRole||'نیازمند تعیین')}</p></li>`).join('')}</ul>`:''}${result.suggestedClarifications.length?`<h4>پیشنهاد تکمیل متن</h4>${result.suggestedClarifications.map(item=>`<p>${esc(item.text)} — ${esc(item.reason)}</p>`).join('')}`:''}</details>`;
  }
  const analysisBadge=(text,tone='neutral')=>'<span class="analysis-status-badge" data-tone="'+tone+'">'+esc(text)+'</span>';
  function clarificationFieldsHtml(rows,prefix,{editable=false,result=null,tasks=[]}={}){
    return rows.map((q,index)=>{const judgment=result?.clarificationReviews?.find(r=>r.questionId===q.id),status=q.needsReconfirmation?'پاسخ نیازمند بازبینی':judgment?.status==='resolved'?'ابهام رفع شده':judgment?.status==='insufficient'?'نیازمند تکمیل':q.answer?'در انتظار بررسی':'بدون پاسخ',id=prefix+'-'+q.id;
      return '<article class="clarification-question" data-question-id="'+esc(q.id)+'"><header><label for="'+esc(id)+'">'+fa.format(index+1)+'. '+esc(q.question)+'</label>'+analysisBadge(status,q.needsReconfirmation||judgment?.status==='insufficient'?'pending':'neutral')+'</header>'+(editable?'<textarea id="'+esc(id)+'" data-clarification-id="'+esc(q.id)+'" rows="2" maxlength="2000" placeholder="پاسخ کاری و دقیق به این سؤال…">'+esc(q.answer||'')+'</textarea><label class="clarification-reconfirm"'+(!q.needsReconfirmation?' hidden':'')+'><input type="checkbox" data-reconfirm-clarification="'+esc(q.id)+'">این پاسخ را با تعریف و شرایط فعلی شاخص دوباره بررسی کردم.</label>':'<p class="clarification-answer-text">'+esc(q.answer||'پاسخ جداگانه‌ای ثبت نشده است.')+'</p>')+(judgment?'<p class="clarification-judgment">'+esc(judgment.reason)+'</p>'+(judgment.citations?.length?analysisReferences(judgment.citations,tasks):''):'')+'</article>';
    }).join('');
  }
  function readClarificationAnswers(container){return [...container.querySelectorAll('[data-clarification-id]')].map(input=>({id:input.dataset.clarificationId,answer:input.value,reconfirmed:!![...container.querySelectorAll('[data-reconfirm-clarification]')].find(c=>c.dataset.reconfirmClarification===input.dataset.clarificationId)?.checked}));}
  function renderDraftClarifications(){designClarificationArea.hidden=!editingClarifications.length;if(!editingClarifications.length){designClarificationArea.replaceChildren();return;}designClarificationArea.innerHTML='<h3>پاسخ به ابهام‌های شاخص</h3><p class="analysis-advisory">پاسخ‌ها قابل ویرایش‌اند؛ ذخیرهٔ پیش‌نویس بررسی را اجرا نمی‌کند.</p><div class="clarification-fields">'+clarificationFieldsHtml(editingClarifications,'draft-answer',{editable:true})+'</div><p class="clarification-draft-warning warning-text" hidden>تعریف شاخص تغییر کرده؛ پاسخ‌های قبلی باید متناسب با تعریف جدید بازبینی شوند.</p>';}
  function clarificationSectionHtml(design,task){
    const rows=task?.clarifications||[];if(!rows.length)return '';const editable=!design.finalReviewOnly&&user?.role==='manager'&&design.managerId===user.id&&['manager_review','needs_revision'].includes(design.status)&&(!design.revisedBy||!!design.clarificationDraft),result=design.clarificationDraft?null:design.aiReview?.result;
    return '<section class="analysis-section analysis-clarifications"><h5>پاسخ به ابهام‌های شاخص</h5>'+(design.clarificationDraft||editable?'<p class="analysis-advisory">'+(design.clarificationDraft?'پاسخ‌ها در پیش‌نویس ذخیره شده‌اند؛ هنوز بررسی نشده‌اند.':'پاسخ‌ها فقط در پیش‌نویس اصلاحی ذخیره می‌شوند.')+'</p>':'')+(editable?'<form data-clarification-form data-design-id="'+esc(design.id)+'" data-proposal-id="'+esc(task.id)+'" novalidate>':'<div>')+clarificationFieldsHtml(rows,'analysis-answer-'+design.id+'-'+task.id,{editable,result,tasks:[task]})+(editable?'<p class="workflow-muted">فقط اطلاعات کاری؛ بدون حقوق، اطلاعات تماس یا رمز و کلید دسترسی.</p><p class="clarification-form-status" role="alert" aria-live="assertive"></p><div class="design-form-actions"><button type="submit" class="primary-button" data-clarification-action="save">ذخیرهٔ پاسخ‌ها</button></div></form>':'</div>')+'</section>';
  }
  const recommendationTone=value=>value==='reject'?'error':value==='retain'?'neutral':'pending';
  const correctionFields={definition:'criteria',target:'targetVolume',relevance:'description',control:'description',overlap:'criteria',gaming:'criteria',measurability:'criteria',weightPoints:'weight',timeLimit:'timeLimitHour'};
  function issueResolutionHtml(design,item,task){
    const needs=item.recommendation!=='retain'||item.missingInformation.length||item.checks.some(c=>c.status!=='pass'&&c.severity!=='advisory')||design.aiReview.result.planConflicts?.some(c=>c.proposalIds.includes(item.proposalId));if(!needs)return '';
    if(['published','rejected'].includes(design.status))return '<section class="analysis-section analysis-resolution"><h5>سابقهٔ بررسی</h5><p class="analysis-advisory">این نسخه نهایی یا بسته شده است؛ گزارش آن فقط برای مشاهدهٔ سابقه نمایش داده می‌شود.</p></section>';
    const manager=user?.role==='manager'&&design.managerId===user.id,terminal=design.finalReviewOnly||design.aiReview.result.humanReviewRequired;
    if(terminal){const id=design.finalReviewSourceId||design.id,source=designs.find(d=>d.id===id),available=source?.alignmentCurrent!==false&&(manager&&['manager_review','needs_revision'].includes(source?.status)||user?.role==='hr'&&source?.status==='hr_review');return '<section class="analysis-section analysis-resolution"><h5>مسیر رفع ایراد</h5><p class="analysis-advisory">چرخهٔ اصلاح این طرح پایان یافته است؛ ویرایش و پاسخ تازه قفل‌اند. یافته‌ها باید در بازبینی نهایی مستند بررسی شوند.</p>'+(available?'<button type="button" class="secondary-button" data-final-review-from-analysis="'+esc(id)+'">رفتن به بازبینی نهایی</button>':'')+'</section>';}
    if(!manager)return '<section class="analysis-section analysis-resolution"><h5>مسیر رفع ایراد</h5><p class="analysis-advisory">تکمیل اطلاعات و اصلاح شاخص باید توسط مدیر مربوط، در پیش‌نویس اصلاحی انجام شود.</p></section>';
    if(design.alignmentCurrent===false)return '<section class="analysis-section analysis-resolution"><h5>مسیر رفع ایراد</h5><p class="analysis-advisory">گزارش جاری نیست؛ ابتدا تحلیل را تازه کنید.</p>'+(design.canReanalyze?'<button type="button" class="secondary-button" data-analyze-design="'+esc(design.id)+'">تحلیل مجدد با ۷ محور</button>':'')+'</section>';
    if(!['manager_review','needs_revision'].includes(design.status)||design.revisedBy&&!design.clarificationDraft)return '<section class="analysis-section analysis-resolution"><h5>مسیر رفع ایراد</h5><p class="analysis-advisory">این نسخه برای اصلاح جاری نیست؛ نسخهٔ جدیدتر را از فهرست بررسی کنید.</p></section>';
    const field=item.changes.length===1?(correctionFields[item.changes[0].field]||item.changes[0].field):correctionFields[item.checks.find(c=>c.status!=='pass'&&c.severity!=='advisory')?.type]||'criteria';
    return '<section class="analysis-section analysis-resolution"><h5>رفع ایراد این شاخص</h5><p class="analysis-advisory">پاسخ و اطلاعات تکمیلی را ثبت کنید یا تعریف شاخص را در پیش‌نویس ویرایش کنید. هیچ اصلاح یا بررسی‌ای خودکار انجام نمی‌شود.</p><div class="design-form-actions">'+(task?.clarifications?.length?'<button type="button" class="secondary-button" data-focus-clarifications="'+esc(task.id)+'">تکمیل پاسخ‌ها و اطلاعات</button>':'')+'<button type="button" class="secondary-button" data-open-design-correction="'+esc(design.id)+'" data-proposal-id="'+esc(item.proposalId)+'" data-correction-field="'+esc(field)+'">'+(design.clarificationDraft?'ویرایش پیش‌نویس اصلاحی':'ویرایش شاخص در پیش‌نویس')+'</button></div></section>';
  }
  const analysisReferences=(refs,tasks=[])=>'<details class="analysis-references"><summary>شواهد و ارجاعات ('+fa.format((refs||[]).length)+')</summary>'+(refs?.length?analysisCitations(refs,tasks):'<p class="workflow-muted">ارجاعی برای این بخش ثبت نشده است.</p>')+'</details>';
  function alignmentHtml(design){
    const review=design.aiReview;if(!['kpi-alignment-v2','kpi-alignment-v3','kpi-alignment-v4'].includes(review?.contractVersion))return '';const result=review.result,current=review.contractVersion==='kpi-alignment-v4'&&design.alignmentCurrent!==false;
    const tasks=design.tasks||[],duties=review.jobAnalysis.result.duties;
    const taskTitle=id=>tasks.find(task=>task.id===id)?.title||'شاخص مرتبط یافت نشد';
    const dutyTitle=id=>duties.find(duty=>duty.id===id)?.activity||'مسئولیت مرتبط یافت نشد';
    const itemList=(values,empty)=>values.length?'<ul>'+values.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul>':'<p class="workflow-muted">'+esc(empty)+'</p>';
    const reviews=result.reviews.map((item,index)=>{
      const original=tasks.find(task=>task.id===item.proposalId);
      const checkCounts=['pass','fail','unknown'].map(status=>fa.format(item.checks.filter(check=>check.status===status).length)+' '+({pass:'بدون مانع',fail:'نیازمند اصلاح',unknown:'نامعلوم'}[status])).join(' · ');
      return '<article class="analysis-proposal" data-analysis-proposal="'+esc(item.proposalId)+'">'+
        '<header class="analysis-proposal-heading"><div><span class="analysis-eyebrow">شاخص '+fa.format(index+1)+' · '+esc(original?.category==='project'?'پروژه‌ای':'روتین')+'</span><h4>'+esc(original?.title||'عنوان ثبت نشده')+'</h4></div>'+analysisBadge(analysisLabels[item.recommendation],recommendationTone(item.recommendation))+'</header>'+
        '<section class="analysis-section analysis-rationale"><h5>نتیجه و دلیل بررسی</h5><p>'+esc(item.rationale)+'</p>'+(item.lock?'<p class="analysis-lock" data-analysis-locked="true">🔒 حفظ · قفل‌شده؛ این شاخص و مبنای بررسی تغییر نکرده‌اند.</p>':'')+'</section>'+
        (item.consistencyIssue?'<p class="warning-text" data-analysis-consistency="blocked">'+esc(item.consistencyIssue.reason)+'</p>':'')+
        '<section class="analysis-section analysis-duty-link"><h5>ارتباط با شرح وظایف</h5>'+itemList(item.dutyIds.map(dutyTitle),'رابطهٔ روشن ثبت نشده است.')+(item.relatedProposalIds.length?'<h5>شاخص‌های مرتبط با این پیشنهاد</h5>'+itemList(item.relatedProposalIds.map(taskTitle),''):'')+analysisReferences(item.citations,tasks)+'</section>'+
        '<section class="analysis-section analysis-missing" data-has-missing="'+(item.missingInformation.length>0)+'"><h5>اطلاعات لازم برای ادامه ('+fa.format(item.missingInformation.length)+')</h5>'+itemList(item.missingInformation,'کمبود اطلاعاتی برای این شاخص ثبت نشده است.')+'</section>'+
        clarificationSectionHtml(design,original)+issueResolutionHtml(design,item,original)+'<section class="analysis-section analysis-changes"><h5>اصلاحات پیشنهادی ('+fa.format(item.changes.length)+')</h5><p class="analysis-advisory">این پیشنهادها خودکار اعمال نمی‌شوند؛ مقدار فعلی تا پذیرش صریح محفوظ است.</p>'+
        (item.changes.length?item.changes.map(change=>'<article class="analysis-change"><h6>'+esc(analysisLabels[change.field])+'</h6><dl><div><dt>متن / مقدار فعلی</dt><dd>'+esc(analysisFieldValue(change.field,original?.[change.field]))+'</dd></div><div><dt>پیشنهاد AI</dt><dd>'+esc(analysisFieldValue(change.field,change.proposedValue))+'</dd></div></dl><p><b>دلیل اصلاح:</b> '+esc(change.reason)+'</p>'+analysisReferences(change.supportingReferences,tasks)+
          (item.correctionValidation?'<p class="analysis-quality" data-quality="'+esc(item.correctionValidation.status)+'">کنترل کیفیت اصلاح: '+esc(item.correctionValidation.status==='verified'?'بررسی مستقل موفق؛ قابل اعمال در پیش‌نویس':'نیازمند بازبینی انسانی')+' — '+esc(item.correctionValidation.reason)+'</p>':'')+
          (current&&!item.consistencyIssue&&!result.humanReviewRequired&&result.reviews.filter(review=>review.changes.length).length===1&&item.correctionValidation?.status==='verified'&&user?.role==='manager'&&['manager_review','needs_revision'].includes(design.status)?'<button type="button" class="secondary-button" data-accept-analysis-change="'+esc(design.id)+'" data-proposal-id="'+esc(item.proposalId)+'"'+(item.changes.length===1?' data-field="'+esc(change.field)+'"':'')+'>'+ (item.changes.length===1?'پذیرش در پیش‌نویس جدید':'اعمال اصلاحات مرتبط این شاخص')+'</button>':'')+'</article>').join(''):'<p class="workflow-muted">تغییر مشخصی پیشنهاد نشده است؛ این به معنی تأیید شاخص نیست.</p>')+'</section>'+
        '<details class="analysis-section analysis-checks"><summary>بررسی '+fa.format(item.checks.length)+' محور تطبیق <span class="analysis-check-counts">'+esc(checkCounts)+'</span></summary><div class="analysis-check-grid">'+item.checks.map(check=>'<article class="analysis-check" data-check="'+esc(check.type)+'"><header><h5>'+esc(analysisLabels[check.type])+'</h5>'+analysisBadge(analysisLabels[check.status],check.status==='fail'?'error':check.status==='unknown'?'pending':'neutral')+'</header><p>'+esc(check.reason)+'</p>'+analysisReferences(check.citations,tasks)+'</article>').join('')+'</div></details></article>';
    }).join('');
    return '<section class="design-alignment"><header class="analysis-report-heading"><div><span class="analysis-eyebrow">گزارش تحلیل طرح · نسخه '+fa.format(design.version||1)+'</span><h3>تطبیق شاخص‌های مدیر</h3></div>'+analysisBadge(result.blockers.length?'نیازمند اقدام':'بدون مانع ثبت‌شده',result.blockers.length?'pending':'neutral')+'</header>'+
      '<p class="analysis-advisory">نتیجهٔ تحلیلی است، نه تصویب سازمانی. اصل شاخص‌ها و وزن‌ها محفوظ‌اند.</p>'+
      (!current?'<p class="warning-text">این گزارش مربوط به قرارداد یا اجرای قبلی است؛ برای استفاده از ۷ محور جدید، تحلیل را دوباره اجرا کنید. نتیجهٔ قبلی فقط برای سابقه حفظ شده است.</p>':'<p class="analysis-advisory">محورهای فعلی: ارتباط با شغل، کنترل‌پذیری، تعریف، هدف، سنجش‌پذیری، هم‌پوشانی و رفتار ناخواسته.</p>')+
      '<section class="analysis-report-summary"><h4>خلاصهٔ گزارش</h4><p>'+esc(result.summary)+'</p><div class="analysis-report-counts">'+analysisBadge(fa.format(result.reviews.length)+' شاخص بررسی‌شده')+analysisBadge(fa.format(result.blockers.length)+' شاخص نیازمند اقدام',result.blockers.length?'pending':'neutral')+analysisBadge(fa.format(result.reviews.filter(item=>item.recommendation==='retain').length)+' پیشنهاد حفظ')+'</div>'+
      (result.consistencyResolution?'<p class="analysis-advisory" data-analysis-consistency="resolved">ناسازگاری پیشنهادِ بی‌تغییر با نتیجهٔ کنترل کیفیت برطرف شد؛ تأیید معتبر متن موجود حفظ شده و پیش‌نویس تازه لازم نیست. گزارش اولیه محفوظ است؛ تصمیم نهایی همچنان با مدیر و ادمین است.</p>':'')+
      (result.humanReviewRequired?'<p class="warning-text" data-human-review="true">چرخه اصلاح متوقف شد: '+(result.humanReviewTrigger==='quality_failed'?'اصلاحات از کنترل کیفیت مستقل عبور نکرده‌اند.':result.humanReviewTrigger==='round_limit'?'چهار دور اصلاح بدون رفع موانع انجام شده؛ در بررسی پنجم بازبینی انسانی فعال است.':'این گزارش با آستانهٔ پیشین ثبت شده است.')+' یافته‌های باقی‌مانده را مدیر و ادمین باید با دلیل مستند بازبینی کنند؛ هیچ تأیید خودکاری انجام نشده است.</p>':result.correctionQualityFailed?'<p class="warning-text" data-correction-quality-blocked="true">اصلاحات از کنترل کیفیت مستقل عبور نکرده‌اند؛ پذیرش خودکار آن‌ها مجاز نیست. برای رفع ابهام‌ها، اطلاعات را تکمیل کنید یا طرح را برای اصلاح دستی برگردانید. بازبینی نهایی فقط پس از بررسی پنجم فعال می‌شود.</p>':result.blockers.length?'<p class="warning-text">تأیید طرح تا رفع موانع شاخص‌ها متوقف است.</p>':'<p class="workflow-muted">مانعی در تحلیل ثبت نشده؛ تصمیم نهایی با مدیر و ادمین است.</p>')+
      (current&&!result.humanReviewRequired&&user?.role==='manager'&&['manager_review','needs_revision'].includes(design.status)&&result.reviews.some(item=>item.changes.length&&!item.consistencyIssue)&&result.reviews.filter(item=>item.changes.length).every(item=>item.correctionValidation?.status==='verified')?'<button type="button" class="primary-button" data-accept-analysis-change="'+esc(design.id)+'" data-accept-all="true">اعمال همه اصلاحات در پیش‌نویس جدید</button><p class="analysis-advisory">پس از بررسی پیش‌نویس، آن را برای تحلیل و تأیید مجدد ارسال کنید.</p>':'')+'</section>'+
      (result.findings?'<section class="analysis-section analysis-review-progress"><h4>پیگیری ایرادها و اصلاحات</h4>'+result.findings.map(finding=>'<article class="analysis-finding" data-finding-status="'+esc(finding.status)+'"><strong>'+esc(taskTitle(finding.proposalId))+' · '+esc(analysisLabels[finding.axis])+'</strong> '+analysisBadge(finding.status==='resolved'?'رفع‌شده':({blocking:'ایراد مسدودکننده',information:'نیازمند اطلاعات',advisory:'پیشنهاد نگارشی'}[finding.severity]||'باز'),finding.status==='resolved'||finding.severity==='advisory'?'neutral':'pending')+'<p>'+esc(finding.reason)+'</p></article>').join('')+(result.planConflicts||[]).map(conflict=>'<article class="analysis-finding"><strong>تعارض بین شاخص‌ها: '+esc(conflict.proposalIds.map(taskTitle).join(' / '))+'</strong><p>'+esc(conflict.reason)+'</p>'+analysisReferences(conflict.citations,tasks)+'</article>').join('')+'</section>':'')+
      jobAnalysisHtml(review.jobAnalysis,{open:false})+
      '<section class="analysis-proposals"><h4>نتیجهٔ هر شاخص</h4>'+reviews+'</section>'+
      (result.coverage?'<details class="analysis-section analysis-coverage"><summary>پوشش مسئولیت‌ها · صرفاً سابقه قرارداد قبلی ('+fa.format(result.coverage.length)+')</summary><div class="analysis-coverage-list">'+result.coverage.map(row=>'<article class="analysis-coverage-item"><header><h5>'+esc(dutyTitle(row.dutyId))+'</h5>'+analysisBadge(analysisLabels[row.status],row.status==='covered'?'neutral':'pending')+'</header><p>'+esc(row.reason)+'</p><h6>شاخص‌های پوشش‌دهنده</h6>'+itemList(row.proposalIds.map(taskTitle),'شاخص پوشش‌دهنده‌ای ثبت نشده است.')+'</article>').join('')+'</div></details>':'')+
      '<section class="analysis-section analysis-candidates"><h4>شاخص‌های پیشنهادی جدید ('+fa.format(result.candidates.length)+')</h4><p class="analysis-advisory">صرفاً کاندید بررسی‌اند؛ به طرح اضافه نشده‌اند.</p>'+
      (result.candidates.length?result.candidates.map(row=>'<article class="analysis-candidate"><h5>'+esc(row.title)+'</h5><dl><div><dt>تعریف پیشنهادی</dt><dd>'+esc(row.definition)+'</dd></div><div><dt>دلیل پیشنهاد</dt><dd>'+esc(row.reason)+'</dd></div><div><dt>منبع داده</dt><dd>'+esc(row.dataSource||'نامعلوم')+'</dd></div><div><dt>هدف</dt><dd>'+esc(row.target||'نامعلوم')+'</dd></div></dl><h6>مسئولیت‌های مرتبط</h6>'+itemList(row.dutyIds.map(dutyTitle),'رابطهٔ روشن ثبت نشده است.')+'<h6>اطلاعات لازم</h6>'+itemList(row.missingInformation,'کمبود اطلاعاتی ثبت نشده است.')+analysisReferences(row.citations,tasks)+'</article>').join(''):'<p class="workflow-muted">کاندید جدیدی در این گزارش ارائه نشده است.</p>')+'</section><p class="analysis-action-status" role="status" aria-live="polite"></p></section>';
  }
  function disableAnalysisApproval(){for(const button of document.querySelectorAll('[data-review-design][data-decision="approve"],[data-approve-design]')){const design=designs.find(row=>row.id===(button.dataset.reviewDesign||button.dataset.approveDesign));if(design?.aiReview?.contractVersion!=='kpi-alignment-v4'||design.alignmentCurrent===false){button.disabled=true;button.title='ابتدا تحلیل را با قرارداد v4 دوباره اجرا کنید.';continue;}if((design.aiReview.result.blockers.length||design.aiReview.result.correctionQualityFailed)&&!design.aiReview.result.humanReviewRequired){button.disabled=true;button.title='ابتدا موانع تحلیل را رفع کنید.';}else if(design.aiReview.result.humanReviewRequired&&(design.aiReview.result.blockers.length||design.aiReview.result.correctionQualityFailed)){button.textContent=button.hasAttribute('data-approve-design')?'تصویب مستند ادمین پس از بازبینی انسانی':'بازبینی نهایی مدیر و ارسال به ادمین';button.title='تصمیم انسانی با دلیل مستند درباره یافته‌های باقی‌مانده';}}}
  const taskListForDesign=d=>`<ul class="design-task-list">${d.tasks?.map(t=>`<li><strong>${esc(t.title)}</strong><span class="design-category ${t.category==='project'?'is-project':'is-routine'}">${t.category==='project'?'پروژه‌ای':'روتین'}</span><small>${t.weightPoints!=null?'وزن '+fa.format(t.weightPoints)+' از ۵ · سهم ':'وزن '}${pct(t.weight)}</small>${t.category==='routine'&&t.frequency?`<small>${esc(t.frequency)} · تعداد ${fa.format(t.targetVolume)} ${esc(t.targetUnit)}</small>`:''}${t.category==='routine'&&t.timeLimit?`<small>محدودیت زمانی: ${esc(designTimeLabel(t.timeLimit))}</small>`:''}${t.category==='project'&&t.targetVolume?`<small>تعداد ${fa.format(t.targetVolume)} ${esc(t.targetUnit||'')}</small>`:''}${t.documentFormat?`<small>فرمت مستندات: ${esc(window.PanelDocumentFormats[t.documentFormat]||t.documentFormat)}</small>`:''}${(t.deadline||t.dueDate)?`<small>موعد: ${esc(window.PanelDate.format(t.deadline||t.dueDate))}</small>`:''}</li>`).join('')||''}</ul>`;
  $('#designList').addEventListener('click',event=>{const toggle=event.target.closest('[data-toggle-design]');if(!toggle)return;const detail=toggle.closest('tr').nextElementSibling;if(detail?.dataset.designDetail!==toggle.dataset.toggleDesign)return;const opened=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(opened));detail.hidden=!opened;});
  const designTasksHtml=d=>`<p class="design-version">نسخه ${fa.format(d.version||1)}</p>${taskListForDesign(d)}${(d.tasks||[]).filter(t=>t.clarifications?.length).map(t=>'<details class="clarification-history"><summary>پاسخ‌های ابهام · '+esc(t.title)+'</summary>'+clarificationFieldsHtml(t.clarifications,'history-'+d.id+'-'+t.id,{result:d.aiReview?.result,tasks:[t]})+'</details>').join('')}`;
  const statusTextForDesign=d=>`<p class="design-version">نسخه ${fa.format(d.version||1)}</p>${d.aiReview&&!['kpi-alignment-v2','kpi-alignment-v3','kpi-alignment-v4'].includes(d.aiReview.contractVersion)?`<p class="workflow-muted">یافتهٔ AI: ${esc(d.aiReview.result.summary)}</p>`:''}${alignmentHtml(d)}${taskListForDesign(d)}`;
  const designAnalysisDialog=document.createElement('dialog');designAnalysisDialog.id='designAnalysisDialog';designAnalysisDialog.className='design-analysis-dialog';designAnalysisDialog.setAttribute('aria-labelledby','designAnalysisDialogTitle');designAnalysisDialog.setAttribute('aria-modal','true');
  designAnalysisDialog.innerHTML='<header class="design-analysis-dialog-header"><div><h2 id="designAnalysisDialogTitle">تحلیل هوش مصنوعی شاخص‌ها</h2><p id="designAnalysisDialogMeta"></p></div><button type="button" class="secondary-button" data-close-design-analysis aria-label="بستن تحلیل هوش مصنوعی">×</button></header><div class="design-analysis-dialog-body"></div><footer class="design-analysis-dialog-footer"><button type="button" class="secondary-button" data-close-design-analysis>بستن</button></footer>';document.body.append(designAnalysisDialog);
  let analysisDesignId=null,analysisOpener=null,analysisBackgroundInert=false,analysisRenderedKey=null;
  function collapseProposalSections(root){
    for(const proposal of root.querySelectorAll('.analysis-proposal')){
      const dutyLink=proposal.querySelector(':scope > .analysis-duty-link'),checks=proposal.querySelector(':scope > .analysis-checks');
      if(dutyLink&&checks)dutyLink.after(checks);
    }
    for(const proposal of root.querySelectorAll('.analysis-proposal'))for(const node of [...proposal.children]){
      if(node.matches('.analysis-proposal-heading,h4'))continue;
      let details=node,summary;
      if(node.tagName==='DETAILS'){
        summary=[...node.children].find(child=>child.tagName==='SUMMARY');if(!summary)continue;
        const counts=summary.querySelector('.analysis-check-counts');if(counts){const body=document.createElement('div');body.className='analysis-detail-body';const content=[...node.childNodes].filter(child=>child!==summary);body.append(counts);for(const child of content)body.append(child);node.append(body);}
      }else{
        details=document.createElement('details');
        if(node.tagName==='SECTION')for(const attr of [...node.attributes])details.setAttribute(attr.name,attr.value);else details.className='analysis-section';
        summary=document.createElement('summary');const heading=[...node.children].find(child=>child.matches('h4,h5,h6'));
        const title=heading||document.createElement('span');if(!heading)title.textContent=node.hasAttribute('data-analysis-consistency')?'ناسازگاری پیشنهاد AI':'جزئیات بررسی';title.classList.add('analysis-detail-title');summary.append(title);
        const body=document.createElement('div');body.className='analysis-detail-body';
        if(node.tagName==='SECTION'){while(node.firstChild)body.append(node.firstChild);}else body.append(node.cloneNode(true));
        details.append(summary,body);node.replaceWith(details);
      }
      details.classList.add('analysis-collapsible');details.removeAttribute('open');
      summary.classList.add('analysis-detail-summary');
      if(!summary.querySelector('.analysis-detail-title')){const title=document.createElement('span');title.className='analysis-detail-title';while(summary.firstChild)title.append(summary.firstChild);summary.append(title);}
      const cue=document.createElement('span');cue.className='analysis-detail-cue';cue.setAttribute('aria-hidden','true');cue.innerHTML='<span class="analysis-detail-closed">نمایش جزئیات</span><span class="analysis-detail-open">بستن جزئیات</span>';summary.append(cue);
    }
  }
  function revealAnalysisElement(element){
    for(let parent=element?.parentElement;parent&&parent!==designAnalysisDialog;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  }
  function closeDesignAnalysis(restoreFocus=true,force=false){
    if(clarificationWrite&&!force)return;
    if(!analysisDesignId&&!designAnalysisDialog.open)return;analysisDesignId=null;
    if(correctionEditor?.form&&designAnalysisDialog.contains(correctionEditor.form))closeCorrectionEditor(false);
    delete designAnalysisDialog.dataset.designId;
    analysisRenderedKey=null;
    document.body.classList.remove('design-analysis-dialog-open');
    if(typeof designAnalysisDialog.close==='function'&&designAnalysisDialog.open)designAnalysisDialog.close();else designAnalysisDialog.removeAttribute('open');
    designAnalysisDialog.querySelector('.design-analysis-dialog-body').replaceChildren();$('#designAnalysisDialogMeta').textContent='';const shell=document.querySelector('.app-shell');if(shell)shell.inert=analysisBackgroundInert;
    if(restoreFocus&&analysisOpener?.isConnected)analysisOpener.focus();analysisOpener=null;
  }
  function refreshDesignAnalysis(){
    if(!analysisDesignId)return;const design=designs.find(d=>d.id===analysisDesignId);
    if(!design?.aiReview||!['manager','hr'].includes(user?.role)){closeDesignAnalysis(false);return;}
    $('#designAnalysisDialogMeta').textContent=[accounts().find(p=>p.id===design.employeeId)?.name||design.employeeId,'نسخه '+fa.format(design.version),window.PanelWorkflow.monthLabel(design.period)].join(' · ');
    const renderKey=JSON.stringify({id:design.id,status:design.status,version:design.version,period:design.period,tasks:design.tasks,aiReview:design.aiReview,monthCopy:design.monthCopy,alignmentCurrent:design.alignmentCurrent,role:user?.role});if(renderKey===analysisRenderedKey)return;analysisRenderedKey=renderKey;
    const inherited=design.aiReview.inheritedFrom,dates=design.monthCopy?.dateChanges||[];
    const lineage=inherited?`<section class="design-analysis-inherited"><strong>تحلیل به‌ارث‌رسیده از ${esc(window.PanelWorkflow.monthLabel(inherited.period))}</strong><p>مدل دوباره اجرا نشده است؛ گزارش و زمان تحلیل مربوط به نسخهٔ مبدأ هستند. مرحله و تأییدهای ثبت‌شدهٔ سازمانی با ارجاع به همان نسخه حفظ شده‌اند.</p>${dates.length?'<details><summary>انتقال موعدهای ساختاری به ماه بعد</summary><ul>'+dates.map(row=>'<li>'+esc(design.tasks.find(t=>t.id===row.taskId)?.title||row.taskId)+' · '+esc(window.PanelDate.format(row.before))+' ← '+esc(window.PanelDate.format(row.after))+'</li>').join('')+'</ul></details>':''}</section>`:'';
    const report=alignmentHtml(design)||`<section class="design-alignment"><h3>نتیجهٔ تحلیل</h3><p>${esc(design.aiReview.result?.summary||'گزارش قدیمی خلاصهٔ تحلیلی ندارد.')}</p>${(design.aiReview.result?.tasks||[]).map(t=>`<article class="analysis-proposal"><h4>${esc(design.tasks.find(row=>row.id===t.taskId)?.title||t.taskId)}</h4><p>${esc(t.reason||'')}</p>${t.issues?.length?'<p>'+esc(t.issues.join(' · '))+'</p>':''}${t.suggestion?'<p>'+esc(t.suggestion)+'</p>':''}</article>`).join('')}</section>`;
    const textDates=(design.monthCopy?.textChanges||[]).flatMap(row=>row.dates.map(date=>({taskId:row.taskId,field:row.field,...date}))),textLedger=textDates.length?'<details class="design-analysis-inherited"><summary>هماهنگی ارجاع عددیِ موعد در متن شاخص</summary><ul>'+textDates.map(row=>'<li>'+esc(design.tasks.find(t=>t.id===row.taskId)?.title||row.taskId)+' · '+esc(row.before)+' ← '+esc(row.after)+'</li>').join('')+'</ul></details>':'';
    designAnalysisDialog.querySelector('.design-analysis-dialog-body').innerHTML=lineage+textLedger+report;
    collapseProposalSections(designAnalysisDialog.querySelector('.design-analysis-dialog-body'));
  }
  function openDesignAnalysis(id,opener){
    const design=designs.find(d=>d.id===id);if(!design?.aiReview)return;
    if(analysisDesignId)closeDesignAnalysis(false);
    analysisDesignId=id;designAnalysisDialog.dataset.designId=id;analysisOpener=opener;const shell=document.querySelector('.app-shell');analysisBackgroundInert=!!shell?.inert;refreshDesignAnalysis();if(!analysisDesignId)return;
    if(typeof designAnalysisDialog.showModal==='function'){try{designAnalysisDialog.showModal();}catch{designAnalysisDialog.setAttribute('open','');}}else designAnalysisDialog.setAttribute('open','');
    document.body.classList.add('design-analysis-dialog-open');
    if(shell)shell.inert=true;designAnalysisDialog.querySelector('[data-close-design-analysis]').focus();
  }
  designAnalysisDialog.onclick=event=>{if(event.target.closest('[data-close-design-analysis]'))closeDesignAnalysis();else if(event.target===designAnalysisDialog){const r=designAnalysisDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDesignAnalysis();}};
  designAnalysisDialog.addEventListener('cancel',event=>{event.preventDefault();closeDesignAnalysis();});designAnalysisDialog.addEventListener('close',()=>{if(!designAnalysisDialog.open)closeDesignAnalysis();});
  designAnalysisDialog.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();closeDesignAnalysis();return;}if(event.key!=='Tab')return;
    const focusable=[...designAnalysisDialog.querySelectorAll('button:not(:disabled),summary,input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')].filter(el=>{if(el.closest('[hidden]'))return false;for(let p=el.parentElement;p&&p!==designAnalysisDialog;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&el!==p.querySelector('summary'))return false;return true;});
    const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  window.addEventListener('panel:session',()=>closeDesignAnalysis(false,true));window.addEventListener('panel:view',event=>{if(event.detail!=='tasks')closeDesignAnalysis(false,true);});
  document.addEventListener('click',async event=>{
    const action=event.target.closest('[data-open-design-correction],[data-focus-clarifications],[data-final-review-from-analysis]');if(!action||action.disabled||activeWrites||window.PanelWorkflow.working)return;
    if(action.dataset.focusClarifications){const proposal=action.closest('.analysis-proposal'),fields=[...proposal.querySelectorAll('[data-clarification-form] textarea')],field=fields.find(e=>!e.value.trim())||fields[0];revealAnalysisElement(field);field?.scrollIntoView?.({behavior:'smooth',block:'center'});field?.focus();return;}
    if(action.dataset.finalReviewFromAnalysis){const id=action.dataset.finalReviewFromAnalysis,selector=user?.role==='hr'?'[data-approve-design="'+id+'"]':'[data-review-design="'+id+'"][data-decision="approve"]',button=document.querySelector(selector);if(!button||button.disabled){message('بازبینی نهایی این نسخه در دسترس نیست؛ نسخهٔ جاری و اعتبار گزارش را بررسی کنید.',true);return;}closeDesignAnalysis(false,true);button.click();return;}
    const design=designs.find(d=>d.id===action.dataset.openDesignCorrection),proposal=design?.tasks.find(t=>t.id===action.dataset.proposalId),actorId=user?.id,period=currentPeriod(),feedback=action.closest('.design-alignment').querySelector('.analysis-action-status');
    if(!design||!proposal||user?.role!=='manager'||design.finalReviewOnly||design.aiReview.result.humanReviewRequired)return;
    action.disabled=true;activeWrites++;feedback.textContent='در حال آماده‌سازی پیش‌نویس اصلاحی…';let saved=null;
    try{
      saved=await post(`/api/org/designs/${design.id}/correction-draft`,{runId:design.aiReview.runId,proposalId:proposal.id,draftId:design.clarificationDraft?.id||null,draftRevision:design.clarificationDraft?.draftRevision});
      if(actorId!==user?.id||period!==currentPeriod())return;closeDesignAnalysis(false,true);await refresh();if(actorId!==user?.id||period!==currentPeriod())return;
      const draft=designs.find(d=>d.id===saved.id);if(!draft)throw Error('پیش‌نویس ثبت شد؛ آن را از فهرست پیش‌نویس‌ها باز کنید.');loadDesignRevision(draft,Math.max(0,draft.tasks.findIndex(t=>t.id===proposal.id)));window.PanelWorkflow.go('tasks');
      const form=$('#designForm'),field=form.elements[action.dataset.correctionField],target=field&&!field.disabled?field:form.elements.criteria;form.scrollIntoView?.({behavior:'smooth',block:'start'});target?.focus();message('پیش‌نویس اصلاحی باز شد؛ تغییرات را ذخیره کنید و سپس برای بررسی ارسال کنید. گزارش قبلی محفوظ است.');
    }catch(error){if(actorId===user?.id){if(feedback.isConnected)feedback.textContent=error.message;else message((saved?'پیش‌نویس ثبت شد؛ از فهرست آن را باز کنید. ':'')+error.message,true);}}
    finally{activeWrites--;if(action.isConnected)action.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.matches?.('[data-clarification-form]'))return;event.preventDefault();if(clarificationWrite||activeWrites)return;
    const actorId=user?.id,uiPeriod=currentPeriod(),design=designs.find(d=>d.id===form.dataset.designId),proposal=design?.tasks.find(t=>t.id===form.dataset.proposalId),feedback=form.querySelector('.clarification-form-status'),answers=readClarificationAnswers(form);
    if(user?.role!=='manager'||!design||!proposal)return;
    if(answers.some(q=>q.answer.length>2000)){feedback.textContent='هر پاسخ باید حداکثر ۲۰۰۰ کاراکتر باشد.';return;}
    const controls=[...form.querySelectorAll('button,input,textarea')];controls.forEach(c=>c.disabled=true);form.setAttribute('aria-busy','true');clarificationWrite=true;activeWrites++;feedback.textContent='در حال ذخیرهٔ پاسخ‌ها…';let saved=null;
    try{
      saved=await post(`/api/org/designs/${design.id}/clarifications`,{runId:design.aiReview.runId,proposalId:proposal.id,draftId:design.clarificationDraft?.id||null,draftRevision:design.clarificationDraft?.draftRevision,answers});
      if(actorId!==user?.id||uiPeriod!==currentPeriod()||!form.isConnected)return;
      if(actorId!==user?.id)return;closeDesignAnalysis(false,true);await refresh();
      if(actorId!==user?.id)return;
      {const draft=designs.find(d=>d.id===saved.id);if(draft){loadDesignRevision(draft,Math.max(0,draft.tasks.findIndex(t=>t.id===proposal.id)));$('#designClarificationAnswers').scrollIntoView?.({behavior:'smooth',block:'center'});}}
      message('پاسخ‌ها در پیش‌نویس اصلاحی ذخیره شدند؛ بررسی از فهرست پیش‌نویس‌ها انجام می‌شود.');
    }catch(error){if(actorId===user?.id){if(saved){closeDesignAnalysis(false,true);await refresh().catch(()=>{});message('پاسخ‌ها ذخیره شدند، اما نمایش پیش‌نویس کامل نشد؛ آن را از فهرست پیش‌نویس‌ها باز کنید. '+error.message,true);}else if(form.isConnected)feedback.textContent=error.message||'ذخیره انجام نشد؛ پاسخ‌ها محفوظ‌اند.';}}
    finally{clarificationWrite=false;activeWrites--;if(form.isConnected){controls.forEach(c=>c.disabled=false);form.removeAttribute('aria-busy');}}
  });
  const humanReviewDialog=document.createElement('dialog');humanReviewDialog.id='humanReviewDialog';humanReviewDialog.className='design-analysis-dialog human-review-dialog';humanReviewDialog.setAttribute('aria-labelledby','humanReviewTitle');humanReviewDialog.setAttribute('aria-modal','true');
  humanReviewDialog.innerHTML='<header class="design-analysis-dialog-header"><div><h2 id="humanReviewTitle"></h2><p id="humanReviewMeta"></p></div><button type="button" class="secondary-button" data-close-human-review aria-label="بستن بازبینی مستند">×</button></header><div class="design-analysis-dialog-body"><p id="humanReviewHint" class="analysis-advisory"></p><section id="humanReviewFindings"></section><form id="humanReviewForm" novalidate><label for="humanReviewReason">دلیل مستند تصمیم<textarea id="humanReviewReason" name="reason" rows="4" minlength="20" maxlength="2000" required aria-describedby="humanReviewHint humanReviewStatus"></textarea></label><label class="human-review-acknowledgment"><input type="checkbox" name="acknowledgment" required><span id="humanReviewAcknowledgmentText"></span></label><p id="humanReviewStatus" role="alert" aria-live="assertive"></p></form></div><footer class="design-analysis-dialog-footer"><button type="submit" form="humanReviewForm" class="primary-button" id="submitHumanReview" disabled></button><button type="button" class="secondary-button" data-close-human-review>لغو</button></footer>';document.body.append(humanReviewDialog);
  let humanReviewEditor=null;
  const humanReviewForm=humanReviewDialog.querySelector('form'),humanReviewFeedback=$('#humanReviewStatus');
  function syncHumanReviewSubmit(){
    const editor=humanReviewEditor;$('#submitHumanReview').disabled=!editor||editor.busy||activeWrites>0||!humanReviewForm.elements.acknowledgment.checked||!humanReviewContextCurrent(editor);
  }
  function closeHumanReviewDialog(restoreFocus=true,force=false){
    if(!humanReviewEditor||humanReviewEditor.busy&&!force)return;
    const editor=humanReviewEditor;humanReviewEditor=null;
    if(typeof humanReviewDialog.close==='function'&&humanReviewDialog.open)humanReviewDialog.close();else humanReviewDialog.removeAttribute('open');
    humanReviewForm.reset();humanReviewFeedback.textContent='';$('#humanReviewFindings').replaceChildren();$('#humanReviewMeta').textContent='';humanReviewForm.elements.reason.removeAttribute('aria-invalid');humanReviewForm.elements.acknowledgment.removeAttribute('aria-invalid');
    syncHumanReviewSubmit();document.body.classList.remove('human-review-dialog-open');const shell=document.querySelector('.app-shell');if(shell)shell.inert=editor.backgroundInert;
    if(restoreFocus&&editor.action.isConnected)editor.action.focus();
  }
  function humanReviewContextCurrent(editor){
    const design=designs.find(row=>row.id===editor.designId);
    return editor.actorId===user?.id&&editor.role===user?.role&&editor.period===currentPeriod()&&(design?.status===(editor.role==='manager'?'manager_review':'hr_review')||editor.role==='manager'&&design?.status==='needs_revision'&&design.finalReviewOnly&&design.finalReviewSourceId===design.id)&&design.alignmentCurrent!==false&&design.aiReview?.runId===editor.runId&&design.aiReview?.result?.humanReviewRequired;
  }
  function openHumanReviewDialog(action){
    if(humanReviewEditor?.busy)return;
    const designId=action.dataset.reviewDesign||action.dataset.approveDesign,design=designs.find(row=>row.id===designId),role=user?.role;
    const editor={designId,runId:design?.aiReview?.runId,actorId:user?.id,role,period:currentPeriod(),action,busy:false};
    if(!['manager','hr'].includes(role)||!humanReviewContextCurrent(editor))return;
    closeDesignAnalysis(false);closeHumanReviewDialog(false);const shell=document.querySelector('.app-shell');editor.backgroundInert=!!shell?.inert;humanReviewEditor=editor;
    const hr=role==='hr';$('#humanReviewTitle').textContent=hr?'تصویب مستند ادمین پس از بازبینی انسانی':'بازبینی نهایی مدیر و ارسال به ادمین';$('#humanReviewMeta').textContent=[accounts().find(row=>row.id===design.employeeId)?.name||'', 'نسخه '+fa.format(design.version),window.PanelWorkflow.monthLabel(design.period)].join(' · ');
    $('#humanReviewHint').textContent=hr?'یافته‌ها و دلیل مدیر را مستقل بررسی کنید. ثبت این تصمیم طرح را منتشر و شاخص‌ها را فعال می‌کند؛ نتیجهٔ AI تغییر نمی‌کند.':'یافته‌های باقی‌مانده را بررسی و دلیل تصمیم خود را بنویسید. این اقدام فقط طرح را به صف ادمین می‌فرستد؛ تأیید AI یا انتشار شاخص نیست.';
    $('#humanReviewFindings').innerHTML='<h3>یافته‌های باقی‌مانده</h3><ul>'+(design.aiReview.result.blockers.length?design.aiReview.result.blockers:[{reason:'اصلاحات پیشنهادی از کنترل کیفیت مستقل عبور نکرده‌اند؛ پذیرش خودکار آن‌ها مجاز نیست.'}]).map(row=>'<li>'+esc(row.reason)+(row.missingInformation?.length?'<ul>'+row.missingInformation.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul>':'')+'</li>').join('')+'</ul>'+(hr?'<h3>دلیل ثبت‌شدهٔ مدیر</h3><p>'+esc(design.managerReview?.reason||'ثبت نشده')+'</p>':'');
    $('#humanReviewAcknowledgmentText').textContent=hr?'یافته‌ها و تصمیم مدیر را مستقل بررسی کرده‌ام و با مسئولیت ادمین انتشار این طرح را تصویب می‌کنم.':'یافته‌های باقی‌مانده را بررسی کرده‌ام و مسئولیت بازبینی نهایی این طرح را می‌پذیرم. ارسال طرح برای تصمیم‌گیری مستقل ادمین را تأیید می‌کنم.';
    $('#submitHumanReview').textContent=hr?'تصویب و انتشار با مسئولیت ادمین':'ثبت بازبینی نهایی و ارسال به ادمین';humanReviewForm.elements.reason.readOnly=false;humanReviewForm.elements.acknowledgment.disabled=false;humanReviewDialog.removeAttribute('aria-busy');humanReviewDialog.querySelectorAll('button').forEach(button=>button.disabled=false);
    humanReviewForm.elements.acknowledgment.checked=false;syncHumanReviewSubmit();
    if(typeof humanReviewDialog.showModal==='function'){try{humanReviewDialog.showModal();}catch{humanReviewDialog.setAttribute('open','');}}else humanReviewDialog.setAttribute('open','');
    if(shell)shell.inert=true;document.body.classList.add('human-review-dialog-open');humanReviewForm.elements.reason.focus();
  }
  humanReviewDialog.onclick=event=>{if(event.target.closest('[data-close-human-review]'))closeHumanReviewDialog();else if(event.target===humanReviewDialog){const r=humanReviewDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeHumanReviewDialog();}};
  humanReviewDialog.addEventListener('cancel',event=>{event.preventDefault();closeHumanReviewDialog();});humanReviewDialog.addEventListener('close',()=>{if(!humanReviewDialog.open)closeHumanReviewDialog(true,true);});
  humanReviewDialog.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();closeHumanReviewDialog();return;}if(event.key!=='Tab')return;const focusable=[...humanReviewDialog.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled)')],first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
  humanReviewForm.oninput=()=>{humanReviewFeedback.textContent='';humanReviewForm.elements.reason.removeAttribute('aria-invalid');humanReviewForm.elements.acknowledgment.removeAttribute('aria-invalid');syncHumanReviewSubmit();};
  humanReviewForm.elements.acknowledgment.addEventListener('change',syncHumanReviewSubmit);
  humanReviewForm.onsubmit=async event=>{
    event.preventDefault();const editor=humanReviewEditor;if(!editor||editor.busy||activeWrites)return;
    if(!humanReviewContextCurrent(editor)){closeHumanReviewDialog(false,true);return;}
    const reason=humanReviewForm.elements.reason.value.trim(),ack=humanReviewForm.elements.acknowledgment;
    if(reason.length<20||reason.length>2000){humanReviewFeedback.textContent='دلیل مستند باید بین ۲۰ تا ۲۰۰۰ کاراکتر باشد.';humanReviewForm.elements.reason.setAttribute('aria-invalid','true');humanReviewForm.elements.reason.focus();return;}
    if(!ack.checked){humanReviewFeedback.textContent='تأیید صریح بازبینی و مسئولیت تصمیم لازم است.';ack.setAttribute('aria-invalid','true');ack.focus();return;}
    editor.busy=true;activeWrites++;humanReviewDialog.setAttribute('aria-busy','true');humanReviewDialog.querySelectorAll('button').forEach(button=>button.disabled=true);humanReviewForm.elements.reason.readOnly=true;ack.disabled=true;humanReviewFeedback.textContent='در حال ثبت تصمیم…';
    try{
      await post(`/api/org/designs/${editor.designId}/${editor.role==='manager'?'review':'approval'}`,{decision:'approve',reason,humanReviewAcknowledgment:true});
      if(humanReviewEditor!==editor||editor.actorId!==user?.id)return;
      closeHumanReviewDialog(false,true);await refresh();if(editor.actorId===user?.id)message(editor.role==='manager'?'بازبینی مستند ثبت شد و طرح به صف ادمین ارسال شد.':'تصویب مستند ادمین ثبت شد و شاخص‌ها منتشر شدند.');
    }catch(error){if(humanReviewEditor===editor&&editor.actorId===user?.id)humanReviewFeedback.textContent=error.message||'ثبت تصمیم ناموفق بود؛ دوباره تلاش کنید.';}
    finally{activeWrites--;editor.busy=false;if(humanReviewEditor===editor){humanReviewDialog.removeAttribute('aria-busy');humanReviewDialog.querySelectorAll('button').forEach(button=>button.disabled=false);humanReviewForm.elements.reason.readOnly=false;ack.disabled=false;syncHumanReviewSubmit();}}
  };
  window.addEventListener('panel:session',()=>closeHumanReviewDialog(false,true));window.addEventListener('panel:view',event=>{if(event.detail!=='tasks')closeHumanReviewDialog(false,true);});
  let renderedDesignTables=new WeakMap();
  function renderDesignTable(target,html){
    // A late identical read must not detach an action the user is about to use.
    if(renderedDesignTables.get(target)===html&&target.firstChild)return;
    target.innerHTML=html;renderedDesignTables.set(target,html);
  }
  function renderTasks(){
    if(humanReviewEditor&&!humanReviewContextCurrent(humanReviewEditor))closeHumanReviewDialog(false,true);
    if(correctionEditor&&!correctionEditor.busy)closeCorrectionEditor(false);
    const isManager=user?.role==='manager',isHr=user?.role==='hr';if(!isManager&&!isHr)return;
    if(designListPeriod!==currentPeriod()){designListPeriod=currentPeriod();$('#designPeriodScope').value='current';}
    designPeriodPanel.hidden=!isManager;const allPeriods=$('#designPeriodScope').value==='all',visibleDesigns=isManager&&!allPeriods?designs.filter(d=>d.period===currentPeriod()):designs;
    $('#designPeriodSummary').textContent=(allPeriods?'سوابق همهٔ دوره‌ها؛ دورهٔ ثبت طرح جدید: ':'نسخه‌های دورهٔ ')+window.PanelWorkflow.monthLabel(currentPeriod())+' · '+fa.format(visibleDesigns.length)+' نسخه';
    if(isManager){
      renderManagerRequests();
    }
    const openDesignIds=new Set([...document.querySelectorAll('#designList [data-toggle-design][aria-expanded="true"],#designDraftList details[open][data-design-id]')].map(item=>item.dataset.toggleDesign||item.dataset.designId));
    const renderDesignRow=d=>{
      const employee=accounts().find(person=>person.id===d.employeeId)?.name||d.employeeId,period=window.PanelWorkflow.monthLabel(d.period);
      const categories=[...new Set((d.tasks||[]).map(task=>task.category))],typeLabel=categories.length===2?'روتین + پروژه‌ای':designCategoryName(categories[0]);
      const actions=`${isManager&&d.status==='draft'?`<button class="primary-button" data-publish-design="${esc(d.id)}">انتشار و ارسال به AI</button> <button class="secondary-button" data-edit-design="${esc(d.id)}">ویرایش</button>`:''}${(isManager&&['ai_pending','ai_failed'].includes(d.status)||d.canReanalyze&&(isManager||isHr))?`<button class="secondary-button" data-analyze-design="${esc(d.id)}">${d.canReanalyze?'تحلیل مجدد با ۷ محور':d.status==='ai_failed'?'تلاش دوباره AI':'اجرای بررسی AI'}</button>`:''}${isManager&&(d.status==='manager_review'||d.status==='needs_revision'&&d.finalReviewOnly&&d.id===d.finalReviewSourceId)?`<button class="primary-button" data-review-design="${esc(d.id)}" data-decision="approve">تأیید مدیر و ارسال ادمین</button> <button class="secondary-button" data-review-design="${esc(d.id)}" data-decision="return">برگشت برای اصلاح</button>`:''}${isHr&&d.status==='hr_review'?`<button class="primary-button" data-approve-design="${esc(d.id)}">تصویب و انتشار</button> <button class="secondary-button" data-return-design="${esc(d.id)}">بازگشت برای اصلاح</button>`:''}${(d.status==='needs_revision'||d.status==='ai_failed'&&d.tasks.some(t=>t.clarifications?.length))&&isManager?`<button class="secondary-button" data-revise-design="${esc(d.id)}">ساخت پیش‌نویس اصلاحی</button>`:''}`;
      const analysisAction=d.status!=='draft'?`<button type="button" class="secondary-button" data-show-design-analysis="${esc(d.id)}"${d.aiReview?'':' disabled title="هنوز تحلیل ثبت نشده است"'}>نمایش تحلیل AI</button>`:'';
      const deleteAction=isManager?`<button class="secondary-button" data-delete-design="${esc(d.id)}">حذف</button>`:'';
      const copyAction=false?`<button type="button" class="secondary-button" data-copy-design="${esc(d.id)}" title="${esc(d.copyNextMonth?.allowed?'کپی به '+window.PanelWorkflow.monthLabel(d.copyNextMonth.targetPeriod)+' با حفظ تحلیل و مرحلهٔ تأیید':d.copyNextMonth?.reason||'برای کنترل اعتبار کپی، فهرست را تازه کنید.')}"${d.copyNextMonth?.allowed?'':' disabled'}>${d.copyNextMonth?.existingId?'نسخهٔ ماه بعد موجود است':'کپی به ماه بعد'}</button>`:'';
      if(d.status!=='draft'){const opened=openDesignIds.has(d.id),detailId='design-detail-'+d.id;return `<tr data-design-row="${esc(d.id)}"><td><button type="button" class="design-queue-summary" data-toggle-design="${esc(d.id)}" data-design-id="${esc(d.id)}" aria-expanded="${opened}" aria-controls="${esc(detailId)}"><strong class="design-queue-name">${esc(employee)} · نسخه ${fa.format(d.version||1)}</strong><span class="design-queue-chevron" aria-hidden="true">⌄</span></button></td><td>${esc(period)}</td><td><span class="design-category ${categories.includes('project')?'is-project':'is-routine'}">${esc(typeLabel)}</span></td><td>${state(d.status)}</td><td><div class="design-form-actions">${actions}${analysisAction}${deleteAction}${copyAction}</div></td></tr><tr id="${esc(detailId)}" data-design-detail="${esc(d.id)}"${opened?'':' hidden'}><td colspan="5"><div class="design-queue-detail">${designTasksHtml(d)}</div></td></tr>`;}
      return `<tr data-design-row="${esc(d.id)}"><td><article class="design-queue-item"><details data-design-id="${esc(d.id)}" ${openDesignIds.has(d.id)?'open':''}><summary class="design-queue-summary"><strong class="design-queue-name">${esc(employee)} · نسخه ${fa.format(d.version||1)}</strong><span class="design-queue-chevron" aria-hidden="true">⌄</span></summary><div class="design-queue-detail">${designTasksHtml(d)}${d.status==='draft'&&d.tasks?.length>1?d.tasks.map((task,index)=>`<button type="button" class="secondary-button" data-edit-design="${esc(d.id)}" data-task-index="${index}">ویرایش ${esc(task.title)}</button>`).join(''):''}</div></details></article></td><td>${esc(period)}</td><td><span class="design-category ${categories.includes('project')?'is-project':'is-routine'}">${esc(typeLabel)}</span></td><td>${state(d.status)}</td><td><div class="design-form-actions">${actions}${analysisAction}${deleteAction}${copyAction}</div></td></tr>`;
    };
    const columns=['نسخه / پرسنل','فصل ارزیابی','نوع شاخص','وضعیت','اقدام'];
    $('#designDraftPanel').hidden=!isManager;
    renderDesignTable($('#designDraftList'),table(columns,visibleDesigns.filter(d=>d.status==='draft').map(renderDesignRow).join(''),'در این دوره پیش‌نویسی ذخیره نشده است.'));
    renderDesignTable($('#designList'),table(columns,visibleDesigns.filter(d=>d.status!=='draft').map(renderDesignRow).join(''),'در این دوره نسخه‌ای برای بررسی منتشر نشده است.'));
    disableAnalysisApproval();
    enforceFinalReviewLocks();
    refreshDesignAnalysis();
    $('#deadlineList').innerHTML=deadlines.map(row=>`<article class="proposal-item"><div><h3>${esc(row.employeeName)} · نسخه ${fa.format(row.positionVersion)}</h3>${state(row.state)}</div><p>${row.state==='reminder'?'یادآوری روز چهارم':'ارجاع پس از پایان روز پنجم'} · ثبت ${esc(window.PanelDate.format(row.createdAt))}</p><p class="workflow-muted">تعریف‌نشدن تسک به‌تنهایی امتیاز صفر نمی‌سازد؛ موارد باز به ادمین ارجاع می‌شوند.</p></article>`).join('')||'<p class="workflow-muted">مهلت نزدیک یا گذشته‌ای ثبت نشده است.</p>';
    if(isManager){
      const form=$('#designForm');form.hidden=false;
      form.elements.category.onchange=()=>{syncDesignFields();syncDesignModel();renderDesignDraft();};
    }else $('#designForm').hidden=true;
  }
  function renderOrganization(){
    if(user?.role!=='hr')return;
    const employees=accounts().filter(a=>a.role==='personnel'),positionForm=$('#positionForm'),personForm=$('#personCreateForm'),previousEmployee=positionForm.elements.employeeId.value;populateSelect($('#positionEmployee'),employees,'پرسنلی تعریف نشده است.');if(employees.some(row=>row.id===previousEmployee))positionForm.elements.employeeId.value=previousEmployee;
    syncOrgForm(positionForm,{unitId:positionForm.elements.unitId.value||accounts().find(row=>row.id===positionForm.elements.employeeId.value)?.unitId,sectionId:positionForm.elements.sectionId.value,managerId:positionForm.elements.managerId.value});syncOrgForm(personForm);
    fillUnitSelect($('#sectionUnit'),$('#sectionUnit').value);
$('#unitList').innerHTML=table(['شناسه','نام واحد','اقدام'],orgUnits.map(unit=>`<tr><td dir="ltr">${esc(unit.id)}</td><td>${esc(unit.name)}</td><td>${structureDeleteButton('unit',unit)}</td></tr>`).join(''),'واحدی ثبت نشده است.');
    $('#sectionList').innerHTML=table(['شناسه','نام بخش','واحد','اقدام'],orgSections.map(section=>`<tr><td dir="ltr">${esc(section.id)}</td><td>${esc(section.name)}</td><td>${esc(orgUnits.find(unit=>unit.id===section.unitId)?.name||section.unitId)}</td><td>${structureDeleteButton('section',section)}</td></tr>`).join(''),'بخشی ثبت نشده است.');
  }
  function structureDeleteButton(type,row){
    const disabled=row.deletion?.allowed===false,hint='دارای وابستگی فعال'+(row.deletion?.reason?'؛ '+row.deletion.reason:'');
    const button=`<button type="button" class="secondary-button" data-delete-structure="${type}" data-structure-id="${esc(row.id)}"${disabled?` disabled title="${esc(hint)}"`:''}>حذف</button>`;
    return disabled?`<span class="structure-delete-hint" tabindex="0" title="${esc(hint)}" aria-label="حذف غیرفعال: ${esc(hint)}">${button}</span>`:button;
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-delete-structure]');if(!button||button.disabled||user?.role!=='hr')return;const unit=button.dataset.deleteStructure==='unit',row=(unit?orgUnits:orgSections).find(r=>r.id===button.dataset.structureId);if(!row||!window.confirm(`${unit?'واحد':'بخش'} «${row.name}» از فهرست فعال حذف شود؟ سابقه حفظ می‌شود و موارد دارای وابستگی حذف نمی‌شوند.`))return;
    button.disabled=true;activeWrites++;try{await api(`/api/org/${unit?'units':'sections'}/${encodeURIComponent(row.id)}`,{method:'DELETE'});await refresh();message('از فهرست فعال حذف شد؛ سابقه محفوظ است.');}catch(error){message(error.message,true);}finally{activeWrites--;if(button.isConnected)button.disabled=false;}
  });
  function renderUpdates(){
    if(user?.role!=='hr')return;
    const rows=[...positions].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')||(b.version||0)-(a.version||0));
    $('#positionList').innerHTML=table(['فرد','کد پرسنلی','سمت/سطح','واحد','بخش','بالاسری','حقوق پایه','تاریخ اثر','وضعیت','نسخه','اقدام'],rows.map(p=>`<tr><td>${esc(accounts().find(a=>a.id===p.employeeId)?.name||p.employeeId)}</td><td dir="ltr">${esc(p.employeeCode||'N/A')}</td><td>${esc(p.jobTitle)} / ${esc(p.jobLevel)}</td><td>${esc(p.unitName)}</td><td>${p.isManager?'—':esc(p.jobFamily||'N/A')}</td><td>${esc(accounts().find(a=>a.id===p.managerId)?.name||'—')}</td><td>${p.isManager?'—':money(p.baseSalary)}</td><td>${esc(window.PanelDate.format(p.effectiveFrom))}${p.effectiveTo?' تا '+esc(window.PanelDate.format(p.effectiveTo)):''}</td><td>${state(p.status)}</td><td>${fa.format(p.version)}</td><td>${p.status==='needs_revision'?`<button class="secondary-button" data-revise-position="${esc(p.id)}">ویرایش نسخهٔ اصلاحی</button>`:'—'}</td></tr>`).join(''),'سابقهٔ سمتی ثبت نشده است.');
  }
  function renderDuties(){
    if(user?.role!=='hr')return;
    const unit=$('#dutiesUnit'),selected=unit.value;
    unit.innerHTML='<option value="">همهٔ واحدها</option>'+orgUnits.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');if([...unit.options].some(option=>option.value===selected))unit.value=selected;
    const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[\u064b-\u065f\u0670\u0640\u200c\u200d]/g,'').replace(/\s+/g,' ').trim();
    const tokens=normalize($('#dutiesSearch').value).split(' ').filter(Boolean),today=window.PanelDate.toGregorian(window.PanelDate.today());
    const rows=(orgChart?.people||[]).filter(person=>person.role==='personnel').map(person=>({person,position:positions.filter(p=>p.employeeId===person.id&&p.status==='published'&&p.effectiveFrom<=today&&(!p.effectiveTo||today<p.effectiveTo)).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom)||(b.version||0)-(a.version||0))[0]})).filter(({person,position})=>(!unit.value||(position?.unitId||person.unitId)===unit.value)&&tokens.every(token=>normalize([person.name,position?.employeeCode||person.employeeCode,position?.jobTitle||person.jobTitle,position?.unitName||person.unitName,position?.jobFamily,position?.duties].join(' ')).includes(token))).sort((a,b)=>a.person.name.localeCompare(b.person.name,'fa'));
    $('#dutiesCount').textContent=fa.format(rows.length)+' نفر';
$('#dutiesList').innerHTML=table(['پرسنل','کد پرسنلی','سمت','واحد','بخش','شرح وظایف','نسخه','شروع اثر'],rows.map(({person,position})=>`<tr class="personnel-duties-row"><td><strong>${esc(person.name)}</strong></td><td dir="ltr">${esc(position?.employeeCode||person.employeeCode||'—')}</td><td>${esc(position?.jobTitle||person.jobTitle||'—')}</td><td>${esc(position?.unitName||person.unitName||'—')}</td><td>${esc(position?.jobFamily||orgSections.find(section=>section.id===position?.sectionId)?.name||'—')}</td><td class="personnel-duties-text">${position?`<div class="duties-row-actions"><button type="button" class="secondary-button" data-show-duties="${esc(position.id)}" aria-haspopup="dialog" aria-controls="personnelDutiesDialog" aria-label="نمایش شرح وظیفهٔ ${esc(person.name)}">نمایش شرح وظیفه</button><button type="button" class="secondary-button" data-open-duties-edit="${esc(position.id)}" aria-haspopup="dialog" aria-controls="personnelDutiesDialog" aria-label="ویرایش شرح وظایف ${esc(person.name)}">ویرایش شرح وظایف</button></div>`:'شرح وظایف منتشرشده ثبت نشده است.'}</td><td>${position?fa.format(position.version):'—'}</td><td>${position?esc(window.PanelDate.format(position.effectiveFrom)):'—'}</td></tr>`).join(''),'فردی مطابق جست‌وجو یا واحد انتخاب‌شده پیدا نشد.');
    const dutiesTable=$('#dutiesList table'),wrap=$('#dutiesList .workflow-table-wrap');dutiesTable.setAttribute('aria-label','شرح وظایف پرسنل');dutiesTable.querySelectorAll('th').forEach(th=>th.setAttribute('scope','col'));wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','جدول شرح وظایف پرسنل؛ قابل پیمایش افقی');
  }
  $('#dutiesSearch').addEventListener('input',renderDuties);$('#dutiesUnit').addEventListener('change',renderDuties);
  const dutiesDialog=document.createElement('dialog');dutiesDialog.id='personnelDutiesDialog';dutiesDialog.className='design-analysis-dialog personnel-duties-dialog';dutiesDialog.setAttribute('aria-labelledby','personnelDutiesTitle');dutiesDialog.setAttribute('aria-modal','true');
  dutiesDialog.innerHTML='<header class="design-analysis-dialog-header"><div><h2 id="personnelDutiesTitle">شرح وظیفه</h2><p id="personnelDutiesMeta"></p></div><button type="button" class="secondary-button" data-close-duties aria-label="بستن شرح وظیفه">×</button></header><div class="design-analysis-dialog-body"><p class="personnel-duties-content"></p><form id="personnelDutiesForm" hidden><label for="personnelDutiesInput">ویرایش شرح وظیفه</label><textarea id="personnelDutiesInput" name="duties" rows="12" maxlength="6000" required aria-describedby="personnelDutiesHint personnelDutiesStatus"></textarea><p id="personnelDutiesHint" class="workflow-muted">متن در همهٔ بخش‌های مرتبط به‌روز می‌شود. نسخهٔ قبلی در سابقه باقی می‌ماند؛ تحلیل‌های وابسته به متن قبلی نیازمند بررسی مجدد خواهند بود.</p></form><p id="personnelDutiesStatus" role="status" aria-live="polite"></p><div id="personnelDutiesAnalysis"></div></div><footer class="design-analysis-dialog-footer"><button type="button" class="primary-button" data-edit-duties>ویرایش شرح وظیفه</button><button type="submit" form="personnelDutiesForm" class="primary-button" data-save-duties hidden>ذخیرهٔ تغییرات</button><button type="button" class="secondary-button" data-cancel-duties hidden>لغو ویرایش</button><button type="button" class="secondary-button" data-close-duties>بستن</button></footer>';document.body.append(dutiesDialog);
  let dutiesEditor=null;
  function setDutiesMode(editing){
    if(!dutiesEditor)return;dutiesEditor.editing=editing;
    $('#personnelDutiesForm').hidden=!editing;dutiesDialog.querySelector('.personnel-duties-content').hidden=editing;
    dutiesDialog.querySelector('[data-edit-duties]').hidden=editing;for(const attr of ['data-save-duties','data-cancel-duties'])dutiesDialog.querySelector('['+attr+']').hidden=!editing;
    $('#personnelDutiesAnalysis').hidden=editing;
    $('#personnelDutiesInput').value=dutiesEditor.position.duties||'';
    if(editing){const input=$('#personnelDutiesInput');input.focus();input.setSelectionRange(0,0);input.scrollTop=0;}
  }
  function renderDutiesDialog(){
    const position=dutiesEditor.position;
    if(jobAnalysisResults.get(position.id)?.positionVersion!==position.version)jobAnalysisResults.delete(position.id);
    $('#personnelDutiesMeta').textContent=[orgChart?.people.find(p=>p.id===position.employeeId)?.name,position.jobTitle,position.unitName,'نسخه '+fa.format(position.version)].filter(Boolean).join(' · ');
    dutiesDialog.querySelector('.personnel-duties-content').textContent=position.duties?.trim()||'شرح وظیفه ثبت نشده است.';
    $('#personnelDutiesAnalysis').innerHTML=aiCapabilities.jobAnalysis?`<div class="job-analysis-control"><button type="button" class="secondary-button" data-analyze-job="${esc(position.id)}">تحلیل شرح وظایف</button><p class="job-analysis-status" role="status" aria-live="polite"></p><div class="job-analysis-result">${jobAnalysisHtml(jobAnalysisResults.get(position.id)?.analysis)}</div></div>`:'';
  }
  function closeDutiesDialog(force=false){
    const editor=dutiesEditor;if(!editor)return;
    if(!force&&(editor.busy||activeWrites))return;
    if(!force&&editor.editing&&$('#personnelDutiesInput').value!==(editor.position.duties||'')&&!window.confirm('تغییرات ذخیره نشده‌اند. پنجره بسته شود؟'))return;
    dutiesEditor=null;if(typeof dutiesDialog.close==='function'&&dutiesDialog.open)dutiesDialog.close();else dutiesDialog.removeAttribute('open');
    document.body.classList.remove('personnel-duties-dialog-open');const shell=document.querySelector('.app-shell');if(shell)shell.inert=editor.backgroundInert;
    $('#personnelDutiesMeta').textContent='';dutiesDialog.querySelector('.personnel-duties-content').textContent='';$('#personnelDutiesInput').value='';$('#personnelDutiesAnalysis').replaceChildren();$('#personnelDutiesStatus').textContent='';
    if(!force){const attr=editor.opener.hasAttribute('data-open-duties-edit')?'data-open-duties-edit':'data-show-duties',opener=editor.opener.isConnected?editor.opener:document.querySelector(`[${attr}="${editor.position.id}"]`);opener?.focus();}
  }
  $('#dutiesList').addEventListener('click',event=>{
    const opener=event.target.closest('[data-show-duties],[data-open-duties-edit]');if(!opener||user?.role!=='hr'||activeWrites)return;
    const directEdit=opener.hasAttribute('data-open-duties-edit'),position=positions.find(p=>p.id===(directEdit?opener.dataset.openDutiesEdit:opener.dataset.showDuties));if(!position)return;
    closeDutiesDialog(true);const shell=document.querySelector('.app-shell');dutiesEditor={position:{...position},opener,actorId:user.id,editing:false,busy:false,backgroundInert:!!shell?.inert};
    renderDutiesDialog();setDutiesMode(false);dutiesDialog.querySelectorAll('button').forEach(button=>button.disabled=false);$('#personnelDutiesInput').readOnly=false;
    if(typeof dutiesDialog.showModal==='function')dutiesDialog.showModal();else dutiesDialog.setAttribute('open','');
    if(shell)shell.inert=true;document.body.classList.add('personnel-duties-dialog-open');if(directEdit)setDutiesMode(true);else dutiesDialog.querySelector('[data-edit-duties]').focus();
  });
  dutiesDialog.addEventListener('click',event=>{
    if(event.target.closest('[data-close-duties]'))closeDutiesDialog();
    else if(event.target.closest('[data-edit-duties]')){$('#personnelDutiesStatus').textContent='';setDutiesMode(true);}
    else if(event.target.closest('[data-cancel-duties]')){setDutiesMode(false);$('#personnelDutiesStatus').textContent='';dutiesDialog.querySelector('[data-edit-duties]').focus();}
  });
  dutiesDialog.addEventListener('cancel',event=>{event.preventDefault();closeDutiesDialog();});
  dutiesDialog.addEventListener('close',()=>{if(!dutiesDialog.open)closeDutiesDialog(true);});
  dutiesDialog.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDutiesDialog();return;}
    if(event.key!=='Tab')return;
    const items=[...dutiesDialog.querySelectorAll('button:not(:disabled),textarea:not(:disabled),summary,a[href]')].filter(el=>!el.closest('[hidden]')&&!el.hidden&&(!el.closest('details')||el.closest('details').open||el.tagName==='SUMMARY'));
    const first=items[0],last=items.at(-1);if(!first){event.preventDefault();return;}
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  $('#personnelDutiesForm').onsubmit=async event=>{
    event.preventDefault();const editor=dutiesEditor;if(!editor||editor.busy||!editor.editing||user?.role!=='hr'||editor.actorId!==user.id)return;
    const input=$('#personnelDutiesInput'),duties=input.value.trim(),feedback=$('#personnelDutiesStatus');if(!duties||duties.length>6000){feedback.textContent='شرح وظیفه باید بین ۱ و ۶۰۰۰ کاراکتر باشد.';input.focus();return;}
    editor.busy=true;activeWrites++;input.readOnly=true;dutiesDialog.setAttribute('aria-busy','true');dutiesDialog.querySelectorAll('button').forEach(button=>button.disabled=true);feedback.textContent='در حال ذخیره…';
    try{
      const updated=await post(`/api/org/positions/${editor.position.id}/duties`,{duties,expectedVersion:editor.position.version});
      if(dutiesEditor!==editor||editor.actorId!==user?.id)return;
      editor.position={...editor.position,...updated};positions=positions.map(p=>p.id===updated.id?{...p,...updated}:p);jobAnalysisResults.delete(updated.id);renderDuties();renderDutiesDialog();setDutiesMode(false);feedback.textContent='شرح وظیفه ذخیره شد و منبع مشترک به‌روز شد.';
      try{await window.PanelWorkflow.refresh();}catch{if(dutiesEditor===editor)feedback.textContent='شرح وظیفه ذخیره شد؛ تازه‌سازی بخش‌ها ناموفق بود. صفحه را تازه کنید.';}
    }catch(error){if(dutiesEditor===editor)feedback.textContent=error.message||'ذخیره ناموفق بود؛ متن ویرایش‌شده حفظ شده است.';}
    finally{activeWrites--;editor.busy=false;if(dutiesEditor===editor){input.readOnly=false;dutiesDialog.removeAttribute('aria-busy');dutiesDialog.querySelectorAll('button').forEach(button=>button.disabled=false);dutiesDialog.querySelector(editor.editing?'[data-save-duties]':'[data-edit-duties]').focus();}}
  };
  window.addEventListener('panel:session',()=>closeDutiesDialog(true));
  window.addEventListener('panel:view',event=>{if(event.detail!=='duties')closeDutiesDialog(true);});
  function renderIncoming(){
    if(user?.role!=='hr')return;
    const positionRequests=positions.filter(row=>row.status==='hr_approval'),designRequests=designs.filter(row=>row.status==='hr_review'),quarterRequests=evaluations.filter(row=>row.status==='hr_review'),appealRequests=appeals.filter(row=>row.status==='hr_review');
    $('#hrOverview').innerHTML=`<article class="panel"><span>سمت در انتظار تصویب</span><strong>${fa.format(positionRequests.length)}</strong><small>نیازمند تصمیم ادمین</small></article><article class="panel"><span>شاخص KPI در صف</span><strong>${fa.format(designRequests.length)}</strong><small>بررسی و انتشار</small></article><article class="panel"><span>ارزیابی فصل در صف</span><strong>${fa.format(quarterRequests.length)}</strong><small>تأیید یا بازگردانی</small></article><article class="panel"><span>اعتراض در صف</span><strong>${fa.format(appealRequests.length)}</strong><small>بررسی نتیجه یا مبلغ</small></article>`;
    renderIncomingRows('hrPositionInbox','position',positionRequests);
    renderIncomingRows('hrDesignList','design',designRequests);
    disableAnalysisApproval();
    enforceFinalReviewLocks();
    renderIncomingRows('hrQuarterRequests','quarter',quarterRequests);
    renderIncomingRows('hrAppealRequests','appeal',[...appeals].sort((a,b)=>Number(b.status==='hr_review')-Number(a.status==='hr_review')||String(b.createdAt||'').localeCompare(String(a.createdAt||''))));
  }
  const incomingTypeLabels={position:'سمت',design:'شاخص‌های KPI',quarter:'ارزیابی فصل',appeal:'اعتراض'};
  function renderManagerRequests(){
    if(user?.role!=='manager')return;const type=$('#managerRequestsType').value,tokens=$('#managerRequestsSearch').value.normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const match=row=>tokens.every(token=>[incomingName(row),row.jobTitle,row.reason,row.duties,row.status].join(' ').normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').toLowerCase().includes(token)),sort=(a,b)=>Number(b.status==='manager_review')-Number(a.status==='manager_review')||String(b.createdAt||'').localeCompare(String(a.createdAt||''));
    const groups=[['registration','ثبت پرسنل جدید','managerRegistrationList','position',managerRequestsData.positions.filter(p=>!p.archived&&p.requestOrigin==='registration')],['position','تغییر سمت','positionRequestList','position',managerRequestsData.positions.filter(p=>!p.archived&&p.requestOrigin!=='registration')],['appeal','اعتراض','managerAppealList','appeal',appeals.filter(p=>!managerRequestsData.appeals.find(a=>a.id===p.id)?.archived)]];
    $('#managerRequestsOverview').innerHTML=groups.map(([,label,,,rows])=>`<article class="panel"><span>${label} در صف شما</span><strong>${fa.format(rows.filter(r=>r.status==='manager_review').length)}</strong><small>نیازمند تصمیم مدیر</small></article>`).join('');
    for(const [key,,id,kind,rows] of groups){$('#'+id).closest('[data-manager-request-group]').hidden=type!=='all'&&type!==key;renderIncomingRows(id,kind,rows.filter(match).sort(sort));}
    renderManagerRequestArchive();
  }
  let managerArchivePage=1;
  function renderManagerRequestArchive(){
    if(user?.role!=='manager')return;const form=$('#managerArchiveFilters'),type=form.elements.type.value,tokens=form.elements.search.value.normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const all=[...managerRequestsData.positions.filter(r=>r.archived).map(row=>({row,type:'position',kind:row.requestOrigin})),...managerRequestsData.appeals.filter(r=>r.archived).map(row=>({row,type:'appeal',kind:'appeal'}))].filter(item=>(type==='all'||type===item.kind)&&tokens.every(token=>[incomingName(item.row),item.row.jobTitle,item.row.reason,item.row.duties,item.row.status].join(' ').normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').toLowerCase().includes(token))).sort((a,b)=>String(b.row.approvedAt||'').localeCompare(String(a.row.approvedAt||''))),pages=Math.max(1,Math.ceil(all.length/25));managerArchivePage=Math.min(managerArchivePage,pages);const rows=all.slice((managerArchivePage-1)*25,managerArchivePage*25);
    $('#managerArchiveCount').textContent=fa.format(all.length)+' درخواست تأییدشده';$('#managerArchivePage').textContent=fa.format(managerArchivePage)+' از '+fa.format(pages);$('#managerArchivePrev').disabled=managerArchivePage<=1;$('#managerArchiveNext').disabled=managerArchivePage>=pages;
    $('#managerRequestArchiveList').innerHTML=table(['پرسنل','نوع درخواست','دوره / شروع اثر','تاریخ تأیید','وضعیت جاری','اقدام'],rows.map(({row,type,kind})=>`<tr data-incoming-id="${esc(row.id)}"${type==='appeal'?` data-search-appeal="${esc(row.id)}"`:''}><td><strong>${esc(incomingName(row))}</strong></td><td>${kind==='registration'?'ثبت پرسنل جدید':kind==='position'?'تغییر سمت':'اعتراض'}</td><td>${esc(incomingPeriod(type,row))}</td><td>${esc(archiveDate(row.approvedAt))}</td><td>${state(row.status)}</td><td><button type="button" class="secondary-button" data-incoming-detail="${esc(row.id)}" data-incoming-type="${type}" data-manager-archive aria-controls="managerRequestArchiveDetail" aria-expanded="false">جزئیات</button></td></tr>`).join(''),'درخواست تأییدشده‌ای با این فیلتر پیدا نشد.')+'<section id="managerRequestArchiveDetail" class="incoming-request-detail" hidden tabindex="-1"></section>';
    $('#managerRequestArchiveList table').setAttribute('aria-label','آرشیو درخواست‌های پرسنلی');$('#managerRequestArchiveList').querySelectorAll('th').forEach(th=>th.setAttribute('scope','col'));
  }
  $('#managerArchiveFilters').onsubmit=event=>{event.preventDefault();managerArchivePage=1;renderManagerRequestArchive();};$('#managerArchivePrev').onclick=()=>{managerArchivePage=Math.max(1,managerArchivePage-1);renderManagerRequestArchive();};$('#managerArchiveNext').onclick=()=>{managerArchivePage++;renderManagerRequestArchive();};
  function personnelRequestView(id){return [...managerRequestsData.positions,...managerRequestsData.appeals].find(row=>row.id===id)?.archived?'personnel-requests-archive':'position-review';}
  function revealPersonnelRequest(id){
    if(user?.role!=='manager')return;
    if(personnelRequestView(id)==='personnel-requests-archive'){$('#managerArchiveFilters').reset();const rows=[...managerRequestsData.positions,...managerRequestsData.appeals].filter(row=>row.archived).sort((a,b)=>String(b.approvedAt||'').localeCompare(String(a.approvedAt||'')));managerArchivePage=Math.max(1,Math.floor(rows.findIndex(row=>row.id===id)/25)+1);renderManagerRequestArchive();}
    else{$('#managerRequestsSearch').value='';$('#managerRequestsType').value='all';renderManagerRequests();}
  }
  $('#managerRequestsSearch').addEventListener('input',renderManagerRequests);$('#managerRequestsType').addEventListener('change',renderManagerRequests);
  const personnelRequestsGo=window.PanelWorkflow.go;window.PanelWorkflow.go=name=>personnelRequestsGo(user?.role==='manager'&&name==='appeals'?'position-review':name);
  const incomingName=row=>row.snapshot?.employee?.name||row.employeeName||accounts().find(person=>person.id===row.employeeId)?.name||row.employeeId;
  const incomingPeriod=(type,row)=>type==='position'?window.PanelDate.format(row.effectiveFrom):type==='design'?window.PanelWorkflow.monthLabel(row.period):window.PanelWorkflow.quarterLabel(row.quarter);
  function incomingDesignSummary(row){
    const result=row.aiReview?.result,reviews=result?.reviews||[],legacy=result?.tasks||[],blockers=result?.blockers||legacy.filter(task=>!task.matches);
    const routine=(row.tasks||[]).filter(task=>task.category==='routine').length,project=(row.tasks||[]).filter(task=>task.category==='project').length;
    const brief=String(result?.summary||'گزارش AI ثبت نشده است.').replace(/\s+/g,' ').trim(),summary=brief.length>160?brief.slice(0,159)+'…':brief;
    const kept=reviews.length?reviews.filter(item=>item.recommendation==='retain').length:legacy.filter(task=>task.matches).length;
    const decision=row.alignmentCurrent===false?'گزارش قبلی معتبر نیست؛ تحلیل مجدد لازم است.':!result?'ابتدا بررسی AI لازم است.':(blockers.length||result.correctionQualityFailed)?(result.humanReviewRequired?'تصمیم مستقل و مستند ادمین درباره ایرادهای باقی‌مانده لازم است.':'تصویب تا رفع موانع متوقف است.'):'بدون مانع ثبت‌شده؛ منتظر تصمیم نهایی ادمین.';
    const lines=[['طرح',`نسخه ${fa.format(row.version||1)} · ${fa.format(routine)} روتین و ${fa.format(project)} پروژه‌ای`],['خلاصهٔ AI',summary],['نتیجه',`${fa.format(kept)} پیشنهاد حفظ · ${fa.format(blockers.length)} شاخص نیازمند اقدام`],['تصمیم',`${row.managerReview?.decision==='approve'?'مدیر تأیید کرده است. ':''}${decision}`]];
    return '<div class="incoming-design-summary">'+lines.map(([label,value])=>`<p><strong>${esc(label)}:</strong><span>${esc(value)}</span></p>`).join('')+'</div>';
  }
  function incomingDetailHtml(type,row,archived=false){
    let body='',actions='';
    if(type==='position'){
      body=`<p>کد پرسنلی: ${esc(row.employeeCode||accounts().find(person=>person.id===row.employeeId)?.employeeCode||'—')} · سمت: ${esc(row.jobTitle)} · ${esc(row.unitName)} / ${esc(row.jobFamily||'—')} · ${esc(row.jobLevel)}</p><p>مافوق: ${esc(accounts().find(person=>person.id===row.managerId)?.name||'—')} · شروع اثر: ${esc(window.PanelDate.format(row.effectiveFrom))}</p><p>حقوق پایه: ${money(row.baseSalary)} · مدل ارزیابی: ${esc(row.policy?.name||'براساس واحد و شروع اثر')} · ${row.hasProjects?'دارای پروژه':'بدون پروژه'}</p><h4>شرح وظایف</h4><p class="incoming-full-text">${esc(row.duties||'—')}</p>`;
      actions=`<button type="button" class="primary-button" data-approve-position="${esc(row.id)}">تصویب و انتشار</button><button type="button" class="secondary-button" data-return-position-hr="${esc(row.id)}">برگشت برای اصلاح</button>`;
      if(user.role==='manager'){actions=row.status==='manager_review'?`<button type="button" class="primary-button" data-review-position="${esc(row.id)}">تأیید مدیر و ارسال به ادمین</button><button type="button" class="secondary-button" data-return-position="${esc(row.id)}">برگشت برای اصلاح</button>`:'';body=body.replace(/<p>حقوق پایه:.*?<\/p>/,'')+`<p>${row.isKpiEligible===false?'خارج از KPI فردی':'مشمول KPI فردی'}</p>`;}
    }else if(type==='design'){
      body=archived?statusTextForDesign(row):incomingDesignSummary(row);actions=`<button type="button" class="secondary-button" data-return-design="${esc(row.id)}">بازگشت برای اصلاح</button>`;
    }else if(type==='quarter'){
      body=`<p>امتیاز: ${pct(row.snapshot?.calculation?.performance??null)} · مبلغ KPI: ${money(row.snapshot?.quarterPay?.earned)}</p>`;
      actions=`<button type="button" class="primary-button" data-approve-evaluation="${esc(row.id)}">تصویب و قفل</button><button type="button" class="secondary-button" data-return-evaluation="${esc(row.id)}">بازگرداندن</button>`;
    }else{
      body=`<p>${row.type==='payroll'?'اعتراض به مبلغ':'اعتراض به امتیاز'} · ${state(row.status)}</p><p class="incoming-full-text">${esc(row.reason)}</p><div class="appeal-file-list">${(row.files||[]).map(file=>`<button type="button" class="secondary-button" data-download-appeal-file="${esc(row.id)}" data-file-id="${esc(file.id)}">دانلود ${esc(file.name)}</button>`).join('')||'<span class="workflow-muted">فایل مستندی ثبت نشده است.</span>'}</div>`;
      actions=row.status==='hr_review'?`<button type="button" class="primary-button" data-review-appeal="${esc(row.id)}" data-decision="approve">تأیید نهایی</button><button type="button" class="secondary-button" data-review-appeal="${esc(row.id)}" data-decision="reject">رد با توضیح</button>`:'';
      if(user.role==='manager'){actions=row.status==='manager_review'?`<button type="button" class="primary-button" data-review-appeal="${esc(row.id)}" data-decision="approve">تأیید و ارجاع</button><button type="button" class="secondary-button" data-review-appeal="${esc(row.id)}" data-decision="return">برگشت برای اصلاح</button><button type="button" class="secondary-button" data-review-appeal="${esc(row.id)}" data-decision="reject">رد با توضیح</button>`:'';if(row.status==='manager_review')body+=`<form class="appeal-upload-form" data-appeal-upload="${esc(row.id)}"><label>افزودن فایل مستند<input type="file" name="files" multiple aria-label="فایل‌های مستند درخواست"></label><button type="submit" class="secondary-button">بارگذاری فایل</button></form>`;}
    }
    const reviewReasons=type==='design'&&!archived?'':`${row.managerReview?.reason?`<p>دلیل بازبینی مدیر: ${esc(row.managerReview.reason)}</p>`:''}${row.hrReview?.reason?`<p>دلیل تصمیم ادمین: ${esc(row.hrReview.reason)}</p>`:''}`;
    return `<header class="incoming-detail-heading"><div><h3>${esc(incomingName(row))} · ${esc(incomingTypeLabels[type])}</h3><p>${esc(incomingPeriod(type,row))}</p></div><button type="button" class="secondary-button" data-close-incoming-detail>بستن جزئیات</button></header>${body}${reviewReasons}${archived?'':`<div class="design-form-actions">${actions}</div>`}<p class="incoming-detail-status" role="status" aria-live="polite"></p>`;
  }
  function renderIncomingRows(id,type,rows){
    const list=$('#'+id);list.classList.add('incoming-request-list');
    list.innerHTML=table(['پرسنل','خلاصهٔ درخواست','دوره / شروع اثر','وضعیت','اقدام'],rows.map(row=>{
      const summary=type==='position'?(user?.role==='manager'?(row.requestOrigin==='registration'?'ثبت پرسنل جدید · ':'تغییر سمت · '):'')+row.jobTitle:type==='design'?'نسخه '+fa.format(row.version||1)+' · '+fa.format(row.tasks?.length||0)+' شاخص':type==='quarter'?'تصویب ارزیابی فصل':row.type==='payroll'?'اعتراض به مبلغ':'اعتراض به امتیاز';
return `<tr data-incoming-id="${esc(row.id)}"${type==='appeal'?` data-search-appeal="${esc(row.id)}"`:''}${type==='design'?` data-design-id="${esc(row.id)}"`:''}><td><strong>${esc(incomingName(row))}</strong></td><td>${esc(summary)}</td><td>${esc(incomingPeriod(type,row))}</td><td>${type==='appeal'||user?.role==='manager'?state(row.status):'<span class="incoming-status" data-tone="pending">منتظر تأیید ادمین</span>'}</td><td><div class="incoming-row-actions" role="group" aria-label="اقدام‌های درخواست"><button type="button" class="secondary-button" data-incoming-detail="${esc(row.id)}" data-incoming-type="${type}" aria-expanded="false" aria-controls="${id}Detail">جزئیات</button>${type==='design'?`<button type="button" class="primary-button" data-approve-design="${esc(row.id)}">تصویب و انتشار</button>`:''}</div></td></tr>`;
    }).join(''),type==='appeal'?'درخواست اعتراضی ثبت نشده است.':'درخواستی در انتظار تصمیم ادمین نیست.')+`<section id="${id}Detail" class="incoming-request-detail" hidden tabindex="-1"></section>`;
    list.querySelectorAll('th').forEach(th=>th.setAttribute('scope','col'));list.querySelector('table').setAttribute('aria-label','درخواست‌های '+incomingTypeLabels[type]);
  }
  document.addEventListener('click',event=>{
    const close=event.target.closest('[data-close-incoming-detail]');if(close){const detail=close.closest('.incoming-request-detail'),button=document.querySelector(`[aria-controls="${detail.id}"][aria-expanded="true"]`);detail.hidden=true;detail.replaceChildren();if(button){button.setAttribute('aria-expanded','false');button.focus();}return;}
    const button=event.target.closest('[data-incoming-detail]');if(!button||button.disabled||!['hr','manager'].includes(user?.role))return;
    const detail=document.getElementById(button.getAttribute('aria-controls'));if(button.getAttribute('aria-expanded')==='true'){detail.querySelector('[data-close-incoming-detail]').click();return;}
    const type=button.dataset.incomingType,row=({position:user.role==='manager'?managerRequestsData.positions:positions,design:designs,quarter:evaluations,appeal:appeals}[type]||[]).find(row=>row.id===button.dataset.incomingDetail);if(!row)return;
    detail.parentElement.querySelectorAll('[data-incoming-detail]').forEach(item=>item.setAttribute('aria-expanded',String(item===button)));
    detail.innerHTML=incomingDetailHtml(type,row,button.hasAttribute('data-manager-archive'));detail.hidden=false;disableAnalysisApproval();detail.focus();detail.scrollIntoView?.({behavior:'smooth',block:'nearest'});
  });
  const archiveDate=value=>{if(!value)return '—';const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeZone:'Asia/Tehran'}).format(date):'—';};
  async function refreshIncomingArchive(){
    if(user?.role!=='hr')return;
    const actorId=user.id,version=++incomingArchiveVersion,filters=$('#incomingArchiveFilters'),status=$('#incomingArchiveStatus'),params=new URLSearchParams({type:filters.elements.type.value,search:filters.elements.search.value,page:String(incomingArchivePage)});
    const stale=()=>user?.id!==actorId||version!==incomingArchiveVersion;
    $('#incomingArchiveDetail').hidden=true;$('#incomingArchiveDetail').replaceChildren();$('#incomingArchiveList').replaceChildren();$('#incomingArchivePrevious').disabled=true;$('#incomingArchiveNext').disabled=true;status.textContent='در حال دریافت آرشیو…';
    try{
      const data=await api('/api/org/incoming/archive?'+params);if(stale())return;incomingArchivePage=data.page;
      $('#incomingArchiveList').innerHTML=table(['پرسنل','نوع درخواست','خلاصه','دوره / شروع اثر','تاریخ تأیید','اقدام'],data.items.map(row=>`<tr><td><strong>${esc(row.name)}</strong></td><td>${esc(incomingTypeLabels[row.type])}</td><td>${esc(row.title)}${row.version?' · نسخه '+fa.format(row.version):''}</td><td>${esc(row.type==='position'?window.PanelDate.format(row.period):row.type==='design'?window.PanelWorkflow.monthLabel(row.period):window.PanelWorkflow.quarterLabel(row.period))}</td><td>${esc(archiveDate(row.approvedAt))}</td><td><button type="button" class="secondary-button" data-incoming-archive-detail="${esc(row.id)}" data-incoming-type="${row.type}" aria-expanded="false" aria-controls="incomingArchiveDetail">جزئیات</button></td></tr>`).join(''),'درخواست تأییدشده‌ای با این فیلتر پیدا نشد.');
      $('#incomingArchiveList').querySelectorAll('th').forEach(th=>th.setAttribute('scope','col'));status.textContent=fa.format(data.total)+' درخواست تأییدشده';$('#incomingArchivePage').textContent='صفحه '+fa.format(data.page)+' از '+fa.format(data.pages);$('#incomingArchivePrevious').disabled=data.page<=1;$('#incomingArchiveNext').disabled=data.page>=data.pages;
    }catch(error){if(!stale()){status.textContent=error.message||'دریافت آرشیو ناموفق بود؛ دوباره تلاش کنید.';$('#incomingArchivePage').textContent='';}}
  }
  $('#incomingArchiveFilters').onsubmit=event=>{event.preventDefault();incomingArchivePage=1;refreshIncomingArchive();};
  $('#incomingArchiveFilters').elements.type.onchange=()=>{incomingArchivePage=1;refreshIncomingArchive();};
  $('#incomingArchivePrevious').onclick=()=>{incomingArchivePage--;refreshIncomingArchive();};$('#incomingArchiveNext').onclick=()=>{incomingArchivePage++;refreshIncomingArchive();};
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-incoming-archive-detail]');if(!button||button.disabled||user?.role!=='hr')return;
    const detail=$('#incomingArchiveDetail');if(button.getAttribute('aria-expanded')==='true'){detail.querySelector('[data-close-incoming-detail]')?.click();return;}
    const actorId=user.id,version=++incomingArchiveVersion;button.disabled=true;detail.hidden=false;detail.innerHTML='<p role="status">در حال دریافت جزئیات…</p>';
    try{
      const data=await api(`/api/org/incoming/archive/${button.dataset.incomingType}/${button.dataset.incomingArchiveDetail}`);if(actorId!==user?.id||version!==incomingArchiveVersion||!button.isConnected)return;
      $('#incomingArchiveList').querySelectorAll('button').forEach(item=>item.setAttribute('aria-expanded',String(item===button)));
      detail.innerHTML=incomingDetailHtml(data.type,data.record,true)+`<p><span class="incoming-status" data-tone="approved">تأییدشده</span> · ${esc(archiveDate(data.approvedAt))} · تأییدکننده: ${esc(data.approverName)}</p>${data.removed?'<p class="warning-text">تخصیص فعال این طرح بعداً حذف شده است؛ این سابقهٔ تأیید محفوظ است.</p>':''}`;detail.focus();detail.scrollIntoView?.({behavior:'smooth',block:'nearest'});
    }catch(error){if(actorId===user?.id&&version===incomingArchiveVersion){detail.innerHTML='<p role="alert"></p>';detail.querySelector('p').textContent=error.message||'دریافت جزئیات ناموفق بود؛ دوباره تلاش کنید.';}}
    finally{if(button.isConnected)button.disabled=false;}
  });
  window.addEventListener('panel:view',event=>{if(event.detail==='incoming-archive')refreshIncomingArchive();});
  function renderManagerPersonnel(){
    if(user?.role!=='manager')return;
    const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u200c\u200d]/g,'').replace(/\s+/g,' ').trim();
    const tokens=normalize($('#managerPersonnelSearch').value).split(' ').filter(Boolean);
    const people=(orgChart?.people||[]).filter(person=>person.role==='personnel'&&person.unitId===user.unitId).map(person=>({...person,jobFamily:accounts().find(account=>account.id===person.id)?.jobFamily||''}));
    const rows=people.filter(person=>tokens.every(token=>normalize([person.name,person.jobTitle,person.jobLevel,person.unitName,person.jobFamily].join(' ')).includes(token))).sort((a,b)=>a.name.localeCompare(b.name,'fa'));
    $('#managerPersonnelCount').textContent=fa.format(rows.length)+' نفر از '+fa.format(people.length)+' نفر';
    $('#managerPersonnelList').innerHTML=table(['پرسنل','سمت','سطح شغلی','واحد','بخش','مافوق'],rows.map(person=>`<tr><td><strong>${esc(person.name)}</strong></td><td>${esc(person.jobTitle||'ثبت نشده')}</td><td>${esc(person.jobLevel||'ثبت نشده')}</td><td>${esc(person.unitName||'ثبت نشده')}</td><td>${esc(person.jobFamily||'ثبت نشده')}</td><td>${esc(orgChart.people.find(parent=>parent.id===person.managerId)?.name||'ثبت نشده')}</td></tr>`).join(''),people.length?'پرسنلی با این جست‌وجو پیدا نشد.':'پرسنلی در محدودهٔ مدیریت شما ثبت نشده است.');
  }
  $('#managerPersonnelSearch').addEventListener('input',renderManagerPersonnel);
  const chartUnitLabel=value=>{const name=String(value||'').trim();return /^واحد(?:\s|‌|$)/u.test(name)?name:'واحد '+name;};
  function renderChart(){
    if(!orgChart)return;
    $('#chartScope').textContent=orgChart.scope==='all'?'همهٔ واحدها و ارتباطات گزارش‌دهی':orgChart.scope==='unit'?'اطلاعات شما و چارت واحد':'اطلاعات شما، شخص مافوق و زیرمجموعهٔ مستقیم';
    if(user.role!=='hr'){
const self=orgChart.people.find(person=>person.id===user.id),parent=orgChart.people.find(person=>person.id===self?.managerId),fields=[['نوع دسترسی',user.role==='manager'?'مدیر':'پرسنل','i-appeal'],['کد پرسنلی',user.employeeCode,'i-person-card'],['سمت',user.jobTitle||user.level,'i-briefcase'],['سطح شغلی',user.level,'i-layers'],...(user.role==='manager'?[]:[['بخش',user.jobFamily,'i-org-chart']]),['واحد',user.unitName,'i-building'],['شخص مافوق',parent?.name||'—','i-users'],['شماره تماس',user.phone,'i-phone']];
      $('#personalInfo').innerHTML=`<div class="personal-info-heading"><div class="personal-info-identity"><h2>مشخصات ${esc(user.name)}</h2><p>${esc([user.jobTitle||user.level,user.unitName].filter(Boolean).join(' · '))}</p></div><div class="personnel-photo personal-info-photo" role="img" aria-label="عکس پرسنلی ${esc(user.name)}؛ هنوز ثبت نشده" title="عکس پرسنلی هنوز ثبت نشده"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg></div></div><dl class="personal-info-grid">${fields.map(([label,value,icon])=>`<div><dt><svg aria-hidden="true" focusable="false"><use href="#${icon}"/></svg><span>${esc(label)}</span></dt><dd>${esc(value||'ثبت نشده')}</dd></div>`).join('')}</dl><p class="workflow-muted">اطلاعات نمونه‌اند و توسط ادمین تکمیل یا اصلاح می‌شوند.</p>`;
    }
    $('#chartContents').innerHTML=orgChart.units.map(unit=>{const people=orgChart.people.filter(person=>person.unitId===unit.id),ids=new Set(people.map(person=>person.id)),visited=new Set();const node=person=>{if(visited.has(person.id))return '';visited.add(person.id);const children=people.filter(row=>row.managerId===person.id);return `<li><article data-search-person="${esc(person.id)}" class="org-person${person.id===user.id?' is-self':''}"><strong>${esc(person.name)}</strong><small>${esc(person.jobTitle||person.jobLevel||'سمت نامشخص')}</small><small>${esc(person.unitName)}</small></article>${children.length?`<ul>${children.map(node).join('')}</ul>`:''}</li>`;};const roots=people.filter(person=>!ids.has(person.managerId));const tree=roots.map(node).join('')+people.filter(person=>!visited.has(person.id)).map(node).join('');return `<section class="org-unit" data-search-unit="${esc(unit.id)}"><h2>${esc(chartUnitLabel(unit.name))}</h2>${tree?`<ul class="org-tree">${tree}</ul>`:'<p class="workflow-muted">فردی در این واحد ثبت نشده است.</p>'}</section>`;}).join('');
  }
  function renderPositionRequests(){renderManagerRequests();}

  function renderSurvey(){
    const role=user?.role;if(!role)return;
    const localToday=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}-${parts.find(p=>p.type==='day').value}`;};
    const localPeriod=()=>{const parts=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year').value}-Q${Math.ceil(Number(parts.find(p=>p.type==='month').value)/3)}`;};
    // Permission is resolved by the server for the campaign's assessment month.
    const detail=c=>{const deadline=c.dueAt||'',action=c.canRespond&&c.status==='open'&&deadline>=localToday()?(c.responded?'<p class="workflow-muted">پاسخ شما ثبت شده است؛ نتیجه پس از تکمیل مشارکت نمایش داده می‌شود.</p>':`<form class="inline-survey-form" data-survey-response="${esc(c.id)}"><label>امتیاز کیفیت خدمت از ۰ تا ۱۰۰<input type="number" name="score" min="0" max="100" required></label><button class="secondary-button">ثبت محرمانه</button></form>`):'';
      const progress=role==='hr'?`<p>پاسخ ثبت‌شده: ${fa.format(c.responseCount||0)} · مشارکت لازم: ${pct(c.minParticipation*100)} · ${Number.isFinite(c.aggregate)?'امتیاز نهایی: '+pct(c.aggregate):'امتیاز هنوز منتشر نشده است.'}</p>`:c.ownCampaign?`<p>${Number.isFinite(c.aggregate)?'امتیاز نهایی شما: '+pct(c.aggregate):c.status==='insufficient'?'مشارکت کافی نبود؛ امتیازی ثبت نشده است.':'نظرها در حال جمع‌آوری است؛ امتیاز پس از تکمیل مشارکت ثبت می‌شود.'}</p>`:Number.isFinite(c.aggregate)?`<p>امتیاز نهایی: ${pct(c.aggregate)}</p>`:'<p class="workflow-muted">تا تکمیل مشارکت، امتیازی منتشر نمی‌شود.</p>';
      return `<article class="proposal-item"><div><h3>${c.ownCampaign?'نظرسنجی عملکرد شما · ':''}${esc(c.employeeName||c.unitName)} · ${esc(window.PanelWorkflow.monthLabel(c.period))}</h3>${state(c.status)}</div><p>${esc(c.question||'کیفیت خدمت')} · جامعه: ${fa.format(c.population)} · مشارکت لازم: ${pct(c.minParticipation*100)} · مهلت تا ${esc(deadline?window.PanelDate.format(deadline):'در انتظار تعیین')}</p>${progress}${action}${role==='hr'&&c.status==='open'?`<button class="secondary-button" data-close-survey="${esc(c.id)}">بستن نظرسنجی</button>`:''}</article>`;};
    const servicePeople=(evaluationModelsData?.people||[]).filter(a=>{
      if(a.role!=='personnel')return false;
      const policy=a.policy;
      return a.isKpiEligible!==false&&policy?.weights.peer>0;
    });
    const startForm=role==='hr'&&currentPeriod()>=localPeriod()&&!servicePeople.length?'<p class="workflow-muted">در مدل مؤثرِ واحدهای این فصل، پرسنلی با سهم نظرسنجی همکاران وجود ندارد. برای فعال‌شدن این بخش، مدل واحد موردنظر را در تنظیمات ارزیابی منتشر کنید.</p>':role==='hr'&&currentPeriod()>=localPeriod()?`<form id="serviceCampaignForm" class="panel settings-card"><h3>تنظیم نظرسنجی همکاران</h3><div class="form-grid"><label>فرد هدف<select name="employeeId" required>${servicePeople.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.unitName)}</option>`).join('')}<option value="all">همگانی · همهٔ افراد واجد شرایط</option></select></label><label>حداقل مشارکت (درصد)<select name="minParticipation"><option value="">طبق قانون مؤثر واحد (پیش‌فرض ۶۰٪)</option>${[30,40,50,60,70,80,90,100].map(n=>`<option value="${n}">${fa.format(n)}٪</option>`).join('')}</select></label></div><label>سؤال نظرسنجی<input name="question" maxlength="500" value="کیفیت خدمت ارائه‌شده را چگونه ارزیابی می‌کنید؟" required></label><p class="workflow-muted">${currentPeriod()>localPeriod()?'برای فصل آینده فقط پیش‌نویس ساخته می‌شود و انتشار از آغاز همان فصل مجاز است.':'مهلت پاسخ طبق قانون مؤثر هنگام ساخت تعیین می‌شود؛ تاریخ دقیق در کارت نظرسنجی ثبت است.'} گزینهٔ همگانی برای هر فرد واجد شرایط یک پیش‌نویس جدا می‌سازد.</p><button class="primary-button">ذخیرهٔ پیش‌نویس</button></form>`:role==='hr'?'<p class="workflow-muted">برای فصل‌های گذشته پیش‌نویس جدید ساخته نمی‌شود؛ سوابق همان فصل را در فهرست پایین ببینید.</p>':'';
    if(role==='hr'){
      const selectedPeriod=currentPeriod();
      const visibleMonths=[selectedPeriod];
      const selected=campaigns.find(c=>c.id===selectedServiceCampaignId&&visibleMonths.includes(c.period));if(!selected)selectedServiceCampaignId=null;
      const list=visibleMonths.map(period=>{
        const rows=campaigns.filter(c=>c.period===period),drafts=rows.filter(c=>c.status==='draft');
        const expanded=expandedSurveyMonths.has(period)||period===selectedPeriod&&!expandedSurveyMonths.has(`${period}:closed`);
        const canPublish=period<=localPeriod()&&rows.some(c=>c.dueAt>=localToday());
        const publish=drafts.length?`<button type="button" class="primary-button" data-publish-service-month="${esc(period)}" ${canPublish?'':'disabled title="انتشار از آغاز فصل ارزیابی و پیش از پایان مهلت مجاز است"'}>انتشار همهٔ پیش‌نویس‌ها (${fa.format(drafts.length)})</button>`:'';
        const remove=rows.length?`<button type="button" class="secondary-button" data-remove-service-month="${esc(period)}">حذف همهٔ نظرسنجی‌ها (${fa.format(rows.length)})</button>`:'';
        const body=table(['فصل ارزیابی','فرد هدف','واحد','وضعیت','اقدام'],rows.map(c=>`<tr><td>${esc(window.PanelWorkflow.monthLabel(c.period))}</td><td>${esc(c.employeeName||c.unitName)}</td><td>${esc(c.unitName||'ثبت نشده')}</td><td>${c.status==='draft'?state('draft'):`<span class="workflow-state">منتشرشده · ${esc(labels[c.status]||c.status)}</span>`}</td><td>${c.status==='draft'?`<button type="button" class="primary-button" data-publish-service="${esc(c.id)}" ${canPublish?'':'disabled'}>انتشار</button>`:`<button type="button" class="secondary-button" data-service-detail="${esc(c.id)}">جزئیات</button>`} <button type="button" class="secondary-button" data-remove-service="${esc(c.id)}">حذف</button></td></tr>`).join(''),'برای این فصل نظرسنجی ثبت نشده است.');
        return `<section class="survey-month-group"><div class="survey-month-heading"><button type="button" class="survey-month-toggle" data-toggle-service-month="${esc(period)}" aria-expanded="${expanded}" aria-controls="survey-month-${esc(period)}"><span aria-hidden="true">${expanded?'▾':'▸'}</span> ${esc(window.PanelWorkflow.monthLabel(period))} <small>${fa.format(rows.length)} نظرسنجی</small></button><div class="survey-month-actions">${publish}${remove}</div></div><div id="survey-month-${esc(period)}" ${expanded?'':'hidden'}>${body}</div></section>`;
      }).join('');
      $('#serviceSurveyArea').innerHTML=selected?`<div class="panel-heading"><h2>جزئیات نظرسنجی ${esc(selected.employeeName||selected.unitName)}</h2><button type="button" class="secondary-button" data-back-service>بازگشت به فهرست</button></div>${detail(selected)}`:`<div class="panel-heading"><div><h2>نظرسنجی همکاران</h2><p>برای هر فرد ابتدا پیش‌نویس ذخیره و سپس منتشر می‌شود.</p></div></div>${startForm}<h3>فهرست نظرسنجی‌ها · ${esc(window.PanelWorkflow.quarterLabel(selectedPeriod))}</h3>${list}`;
    }else $('#serviceSurveyArea').innerHTML=`<div class="panel-heading"><div><h2>نظرسنجی همکاران</h2><p>پاسخ‌ها از رضایت مدیر و بازخورد شخصی جدا هستند.</p></div></div>${campaigns.map(detail).join('')||'<p class="workflow-muted">نظرسنجی فعالی برای این نقش/واحد وجود ندارد.</p>'}`;
    if(role!=='manager')$('#view-surveys .settings-grid').hidden=true;
  }
  function renderData(){
    if(user?.role!=='hr')return;
    $('#examImportArchive').innerHTML=table(['تاریخ و ثبت‌کننده','فصل / شناسه بسته','فایل / روش','سطرها','ثبت‌شده','قرنطینه / وضعیت','اقدام'],examImports.map(row=>`<tr><td>${esc(new Date(row.createdAt).toLocaleString('fa-IR'))}<br><small>${esc(accounts().find(account=>account.id===row.createdBy)?.name||row.createdBy)}</small></td><td>${esc(window.PanelWorkflow.quarterLabel(row.quarter))}<br><small dir="ltr">${esc(row.batchKey)}</small></td><td>${esc(row.fileName||'ورود دستی')}</td><td>${fa.format(row.rowCount??row.importedCount+(row.quarantined?.length||0))}</td><td>${fa.format(row.importedCount)}</td><td>${fa.format(row.quarantined?.length||0)} · ${state(row.status)}</td><td><button type="button" class="secondary-button" data-remove-exam-import="${esc(row.id)}" aria-label="حذف رکورد ${esc(row.batchKey)} از آرشیو">حذف</button></td></tr>`).join(''),'هنوز بسته‌ای بارگذاری نشده است.');
  }
  $('#examImportArchive').onclick=async event=>{
    const button=event.target.closest('[data-remove-exam-import]');if(!button)return;
    if(!window.confirm('این رکورد از آرشیو پنهان شود؟ امتیازهای ثبت‌شدهٔ پرسنل و گزارش ممیزی حذف نمی‌شوند.'))return;
    button.disabled=true;try{await post('/api/org/exams/imports/remove',{id:button.dataset.removeExamImport});await refresh();message('رکورد از آرشیو حذف شد؛ نتیجه‌های آزمون و گزارش ممیزی حفظ شدند.');}catch(error){button.disabled=false;message(error.message,true);}
  };
  function renderAppeals(){
    if(!user)return;
    if(user.role==='hr'||user.role==='manager'){$('#appealForm').hidden=true;$('#appealList').replaceChildren();return;}
    $('#appealForm').hidden=user.role!=='personnel';const hint=$('#appealRoleHint');hint.hidden=user.role==='personnel';hint.textContent=user.role==='manager'?'مدیر می‌تواند برای درخواست‌های پرسنل زیرمجموعه مستند اضافه کند و سپس آن‌ها را بررسی کند.':'ادمین می‌تواند مستندات درخواست‌ها را مشاهده و دانلود کند.';
    $('#appealList').innerHTML=appeals.map(a=>{
      const files=(a.files||[]).map(file=>`<button type="button" class="secondary-button" data-download-appeal-file="${esc(a.id)}" data-file-id="${esc(file.id)}">دانلود ${esc(file.name)}</button>`).join('');
      const canAttach=user.role==='personnel'&&['manager_review','needs_revision'].includes(a.status)||user.role==='manager'&&a.status==='manager_review';
      const correction=user.role==='personnel'&&a.status==='needs_revision'?`<form data-appeal-resubmit="${esc(a.id)}"><label>توضیحات اصلاح‌شده<textarea name="reason" rows="3" maxlength="2000" required>${esc(a.reason)}</textarea></label><p class="workflow-muted">ارسال مجدد همین درخواست، سهمیهٔ اعتراض تازه مصرف نمی‌کند و دوباره برای مدیر ارسال می‌شود.</p><button type="submit" class="primary-button">ارسال مجدد اعتراض</button></form>`:'';
      const upload=canAttach?`<form class="appeal-upload-form" data-appeal-upload="${esc(a.id)}"><label>افزودن فایل مستند<input type="file" name="files" multiple aria-label="فایل‌های مستند درخواست"></label><button type="submit" class="secondary-button">بارگذاری فایل</button></form>`:'';
      const review=['manager','hr'].includes(user.role)&&((user.role==='manager'&&a.status==='manager_review')||(user.role==='hr'&&a.status==='hr_review'))?`<button class="primary-button" data-review-appeal="${esc(a.id)}" data-decision="approve">تأیید و ارجاع</button> <button class="secondary-button" data-review-appeal="${esc(a.id)}" data-decision="reject">رد با توضیح</button>`:'';
      return `<article class="proposal-item" data-search-appeal="${esc(a.id)}"><div><h3>${esc(accounts().find(p=>p.id===a.employeeId)?.name||a.employeeId)} · ${esc(window.PanelWorkflow.quarterLabel(a.quarter))} · ${a.type==='payroll'?'مبلغ':'امتیاز'}</h3>${state(a.status)}</div><p>${esc(a.reason)}</p>${files?`<div class="appeal-file-list">${files}</div>`:'<p class="workflow-muted">فایل مستندی ثبت نشده است.</p>'}${upload}${correction}${review}</article>`;
    }).join('')||'<p class="workflow-muted">درخواستی برای نمایش وجود ندارد.</p>';
  }
  function validateAppealFiles(files,existingCount=0){
    if(existingCount+files.length>5)throw new Error('برای هر درخواست حداکثر پنج فایل قابل ثبت است.');
    for(const file of files)if(!file.size||file.size>10*1024*1024||!file.name||file.name.length>200||/[/\\\x00-\x1f]/.test(file.name))throw new Error('هر فایل باید نام معتبر و حجم حداکثر ۱۰ مگابایت داشته باشد.');
  }
  async function uploadAppealFiles(appealId,files,existingCount=0){
    validateAppealFiles(files,existingCount);
    for(const file of files)await api(`/api/org/appeals/${appealId}/files?name=${encodeURIComponent(file.name)}`,{method:'POST',body:file});
  }

  function closeCorrectionEditor(restoreFocus=true){
    if(!correctionEditor)return;
    const {form,action}=correctionEditor;correctionEditor=null;form.remove();
    if(action.isConnected){action.disabled=false;action.setAttribute('aria-expanded','false');action.removeAttribute('aria-controls');if(restoreFocus)action.focus();}
  }
  function openCorrectionEditor(action){
    if(correctionEditor?.busy||activeWrites)return;
    closeCorrectionEditor(false);
    const actorId=user?.id,period=currentPeriod(),all=action.dataset.acceptAll==='true',area=action.closest('.design-alignment'),status=area.querySelector('.analysis-action-status');
    const form=document.createElement('form');form.id='analysisCorrectionForm';form.className='analysis-correction-form';form.noValidate=true;
    form.innerHTML='<h5>'+(all?'اعمال همه اصلاحات در پیش‌نویس جدید':'اعمال اصلاحات انتخاب‌شده در پیش‌نویس جدید')+'</h5><p id="analysisCorrectionHint" class="analysis-advisory">اصل طرح محفوظ می‌ماند؛ پیش‌نویس جدید را باید جداگانه بررسی و برای تأیید ارسال کنید.</p><label>دلیل پذیرش اصلاحات<textarea name="reason" rows="3" maxlength="2000" required aria-describedby="analysisCorrectionHint analysisCorrectionStatus" placeholder="دلیل پذیرش این اصلاحات را بنویسید…"></textarea></label><p id="analysisCorrectionStatus" role="alert" aria-live="assertive"></p><div class="design-form-actions"><button type="submit" class="primary-button">ثبت و ساخت پیش‌نویس</button><button type="button" class="secondary-button" data-cancel-correction>لغو</button></div>';
    const reasonInput=form.elements.reason,feedback=form.querySelector('[role="alert"]'),buttons=[...form.querySelectorAll('button')];
    const editor={form,action,busy:false};correctionEditor=editor;action.disabled=true;action.setAttribute('aria-expanded','true');action.setAttribute('aria-controls',form.id);action.after(form);status.textContent='';reasonInput.focus();
    form.querySelector('[data-cancel-correction]').onclick=()=>{if(!editor.busy)closeCorrectionEditor();};
    form.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!editor.busy)closeCorrectionEditor();}};
    reasonInput.oninput=()=>{reasonInput.removeAttribute('aria-invalid');feedback.textContent='';};
    form.onsubmit=async event=>{
      event.preventDefault();if(editor.busy||correctionEditor!==editor||!form.isConnected)return;
      if(actorId!==user?.id||period!==currentPeriod()||user?.role!=='manager'){closeCorrectionEditor(false);return;}
      const reason=reasonInput.value.trim();
      if(!reason||reason.length>2000){feedback.textContent=!reason?'دلیل پذیرش اصلاحات را وارد کنید.':'دلیل پذیرش باید حداکثر ۲۰۰۰ کاراکتر باشد.';reasonInput.setAttribute('aria-invalid','true');reasonInput.focus();return;}
      editor.busy=true;activeWrites++;buttons.forEach(button=>button.disabled=true);reasonInput.readOnly=true;form.setAttribute('aria-busy','true');feedback.textContent='ساخت پیش‌نویس جدید…';
      try{
        const created=await post(`/api/org/designs/${action.dataset.acceptAnalysisChange}/accept-change`,all?{all:true,reason}:{proposalId:action.dataset.proposalId,field:action.dataset.field,reason});
        if(actorId!==user?.id||correctionEditor!==editor)return;
        closeCorrectionEditor(false);action.disabled=true;status.textContent='پیش‌نویس جدید ساخته شد؛ برای تأیید باید آن را بررسی و ارسال کنید.';
        closeDesignAnalysis(false);
        try{await refresh();}catch(error){if(actorId===user?.id&&status.isConnected)status.textContent='پیش‌نویس ثبت شد، اما تازه‌سازی فهرست ناموفق بود؛ صفحه را تازه کنید.';return;}
        if(actorId!==user?.id)return;
        const draftRow=[...document.querySelectorAll('#designDraftList [data-design-row]')].find(row=>row.dataset.designRow===created.id);
        if(draftRow){draftRow.querySelector('details').open=true;draftRow.scrollIntoView?.({behavior:'smooth',block:'nearest'});draftRow.querySelector('summary')?.focus();}
      }catch(error){if(actorId===user?.id&&form.isConnected&&correctionEditor===editor)feedback.textContent=error.message||'ثبت اصلاحات ناموفق بود؛ دوباره تلاش کنید.';}
      finally{activeWrites--;editor.busy=false;if(form.isConnected){form.removeAttribute('aria-busy');reasonInput.readOnly=false;buttons.forEach(button=>button.disabled=false);}}
    };
  }
  document.addEventListener('click',async event=>{
    const action=event.target.closest('[data-analyze-job],[data-accept-analysis-change]');if(!action||action.disabled)return;
    if(action.dataset.acceptAnalysisChange){openCorrectionEditor(action);return;}
    const actorId=user?.id,area=action.closest('.job-analysis-control,.design-alignment'),status=area.querySelector('.job-analysis-status,.analysis-action-status');
    action.disabled=true;activeWrites++;
    try{
      if(action.dataset.analyzeJob){
        status.textContent='تحلیل شرح وظایف در حال اجراست…';const id=action.dataset.analyzeJob;
        let data=await api(`/api/org/positions/${id}/analysis`);if(!data.analysis)data=await post(`/api/org/positions/${id}/analysis`,{provider:'codex'});
        if(actorId!==user?.id)return;jobAnalysisResults.set(id,data);if(area.isConnected){area.querySelector('.job-analysis-result').innerHTML=jobAnalysisHtml(data.analysis);status.textContent='تحلیل ثبت شد؛ شرح وظایف رسمی تغییر نکرد.';}else if(user.role==='hr')renderDuties();
      }
    }catch(error){if(actorId===user?.id&&status.isConnected)status.textContent=error.message||'تحلیل ناموفق؛ دوباره تلاش کنید.';}finally{activeWrites--;if(action.isConnected)action.disabled=false;}
  });
  async function approvePositionWithCloseout(id){
    const preview=await api(`/api/org/positions/${id}/closeout`);
    if(!preview.ready)throw new Error('جابه‌جایی هنوز مجاز نیست:\n'+preview.blockers.join('\n'));
    if(preview.required){const text=`بازهٔ قبلی تا پایان روز قبل از ${window.PanelDate.format(preview.end)} بسته می‌شود.\nامتیاز نهایی: ${pct(preview.performance)}\nمبلغ قطعی KPI: ${money(preview.earned)}\n${preview.months.map(m=>window.PanelWorkflow.monthLabel(m.period)+' · '+fa.format(m.days)+' روز · '+money(m.earned)).join('\n')}\nشاخص‌های سمت جدید از خود تاریخ جابه‌جایی جدا شروع می‌شوند. این تأیید قابل ویرایش از مسیر عادی نیست. تأیید می‌کنید؟`;if(!window.confirm(text))return false;}
    await post(`/api/org/positions/${id}/approval`,{decision:'approve',closeoutAcknowledgment:preview.required,closeoutFingerprint:preview.fingerprint});return true;
  }
  async function doAction(action){
    if(action.dataset.showDesignAnalysis){openDesignAnalysis(action.dataset.showDesignAnalysis,action);return;}
    if(action.dataset.copyDesign){
      const actorId=user?.id,source=designs.find(d=>d.id===action.dataset.copyDesign),copy=source?.copyNextMonth;if(!copy?.allowed)throw new Error(copy?.reason||'کپی این نسخه مجاز نیست.');
      if(!copy.existingId&&!confirm('این نسخه برای همین فرد در '+window.PanelWorkflow.monthLabel(copy.targetPeriod)+' با همان تحلیل و مرحلهٔ تأیید کپی شود؟ مدل دوباره اجرا نمی‌شود؛ نمره و مستندات ماه قبل منتقل نمی‌شوند.'+(copy.dateChanges?.length?' موعدهای ساختاری دقیقاً یک ماه شمسی منتقل می‌شوند.':'')+(copy.textChangeCount?' ارجاع عددی همین موعدها در متن نیز هماهنگ می‌شود.':'')))return;
      const created=await post(`/api/org/designs/${source.id}/copy-next-month`,{sourceFingerprint:copy.sourceFingerprint});if(actorId!==user?.id)return;
      await refresh();message(created.copyCached?'نسخهٔ ماه بعد قبلاً ساخته شده؛ نسخهٔ تکراری ایجاد نشد.':'نسخهٔ '+fa.format(created.version)+' برای '+window.PanelWorkflow.monthLabel(created.period)+' با تحلیل به‌ارث‌رسیده ساخته شد؛ مدل دوباره اجرا نشد.');return;
    }
    if(action.hasAttribute('data-quarter-monthly')){$('#showMonth').click();window.PanelWorkflow.go('dashboard');return;}
    if(action.hasAttribute('data-quarter-appeal')){fillCommonPeriods(true);window.PanelWorkflow.go('appeals');return;}
    if(action.hasAttribute('data-refresh-lifecycle'))return window.PanelWorkflow.refresh();
    if(action.dataset.submitQuarter){await post(`/api/org/quarters/${quarterNow()}/employees/${action.dataset.submitQuarter}/submit`,{});message('snapshot فصل برای تأیید ادمین ارسال شد.');}
    if(action.dataset.approveEvaluation||action.dataset.returnEvaluation){const id=action.dataset.approveEvaluation||action.dataset.returnEvaluation,decision=action.dataset.approveEvaluation?'approve':'return';await post(`/api/org/evaluations/${id}/approval`,{decision,reason:decision==='return'?'بازبینی و تکمیل داده/مستند لازم است.':''});message(decision==='approve'?'ارزیابی فصل قفل شد؛ خروجی اکسل نهایی برای ادمین آماده است.':'ارزیابی برای بازبینی برگشت خورد.');}
    if(action.dataset.analyzeDesign){message('بررسی AI در حال اجراست…');await post(`/api/org/designs/${action.dataset.analyzeDesign}/analyze`,{provider:'codex'});}
    if(action.dataset.editDesign){const previous=designs.find(design=>design.id===action.dataset.editDesign);if(previous){loadDesignRevision(previous,Number(action.dataset.taskIndex||0));message('پیش‌نویس در فرم بالا بارگذاری شد؛ تغییرات را ذخیره کنید.');$('#designForm').scrollIntoView?.({behavior:'smooth',block:'start'});}return;}
    if(action.dataset.publishDesign){message('پیش‌نویس در حال ارسال مستقیم برای بررسی AI است…');try{await post(`/api/org/designs/${action.dataset.publishDesign}/publish`,{provider:'codex',draftRevision:designs.find(d=>d.id===action.dataset.publishDesign)?.draftRevision});message('ارسال و بررسی AI انجام شد؛ نتیجه و مرحلهٔ بعد در فهرست منتشرشده‌ها مشخص است.');}finally{await refresh();}return;}
    if(action.dataset.deleteDesign){const id=action.dataset.deleteDesign,design=designs.find(row=>row.id===id);if(!design||!confirm(design.status==='draft'?'این پیش‌نویس حذف شود؟':'این رکورد و تخصیص فعالش حذف شوند؟ سابقه، مستندات و نتایج قفل‌شده حفظ می‌شوند.'))return;await post(`/api/org/designs/${id}/delete`,{});if($('#designForm').dataset.draftId===id)resetDesignForm();message('رکورد از فهرست فعال حذف شد؛ سابقه محفوظ است.');}
    if(action.dataset.reviewDesign){const decision=action.dataset.decision,manual=decision==='approve'&&designs.find(row=>row.id===action.dataset.reviewDesign)?.aiReview?.result?.humanReviewRequired;if(manual){openHumanReviewDialog(action);return;}await post(`/api/org/designs/${action.dataset.reviewDesign}/review`,{decision,reason:decision==='return'?'معیار یا نگاشت وظیفه باید اصلاح شود.':''});}
    if(action.dataset.approveDesign||action.dataset.returnDesign){const id=action.dataset.approveDesign||action.dataset.returnDesign,decision=action.dataset.approveDesign?'approve':'return',manual=decision==='approve'&&designs.find(row=>row.id===id)?.aiReview?.result?.humanReviewRequired;if(manual){openHumanReviewDialog(action);return;}await post(`/api/org/designs/${id}/approval`,{decision,reason:decision==='return'?'بازبینی شرح وظیفه و معیار لازم است.':''});}
    if(action.dataset.reviseDesign){const previous=designs.find(design=>design.id===action.dataset.reviseDesign);if(previous){message('تسک‌ها و وزن‌های نسخهٔ قبلی در فرم بارگذاری شدند؛ اصلاح و دوباره ارسال کنید.');loadDesignRevision(previous);window.PanelWorkflow.go('tasks');}}
    if(action.dataset.revisePosition){const previous=positions.find(p=>p.id===action.dataset.revisePosition),form=$('#positionForm');if(previous){$('#personnelOperation').value='transfer';syncPersonnelOperation();form.dataset.revision=previous.id;form.elements.employeeId.value=previous.employeeId;syncOrgForm(form,{unitId:previous.unitId,sectionId:previous.sectionId||orgSections.find(row=>row.unitId===previous.unitId&&row.name===previous.jobFamily)?.id,managerId:previous.managerId});for(const key of ['jobTitle','jobLevel','duties','transferDate','effectiveFrom','effectiveTo','baseSalary'])if(previous[key]!=null&&form.elements[key])form.elements[key].value=['transferDate','effectiveFrom','effectiveTo'].includes(key)?window.PanelDate.input(previous[key]):previous[key];for(const key of ['isManager'])if(form.elements[key])form.elements[key].checked=!!previous[key];updatePositionSalaryWords();window.PanelWorkflow.go('organization');message('نسخهٔ اصلاحی را بازبینی و دوباره برای مدیر مقصد ارسال کنید.');}}
    if(action.dataset.reviewPosition){await post(`/api/org/positions/${action.dataset.reviewPosition}/review`,{decision:'approve',reason:''});}
    if(action.dataset.returnPosition){await post(`/api/org/positions/${action.dataset.returnPosition}/review`,{decision:'return',reason:'شرح وظایف، تاریخ اثر یا مدل باید اصلاح شود.'});}
    if(action.dataset.approvePosition||action.dataset.returnPositionHr){const id=action.dataset.approvePosition||action.dataset.returnPositionHr;if(action.dataset.approvePosition)await approvePositionWithCloseout(id);else await post(`/api/org/positions/${id}/approval`,{decision:'return',reason:'اطلاعات سمت نیازمند اصلاح است.'});}
    if(action.id==='exportFinalExcel')await window.PanelWorkflow.download(`/api/org/export/final/${quarterNow()}`);
    if(action.dataset.downloadAppealFile){const appeal=appeals.find(row=>row.id===action.dataset.downloadAppealFile),file=appeal?.files?.find(row=>row.id===action.dataset.fileId);if(!file)throw new Error('فایل درخواست پیدا نشد.');await window.PanelWorkflow.download(`/api/org/appeals/${appeal.id}/files/${file.id}`,file.name);return;}
    if(action.dataset.reviewAppeal){const decision=action.dataset.decision,reason=decision==='reject'?'دلایل و مستندات برای تأیید کافی نیست.':'';await post(`/api/org/appeals/${action.dataset.reviewAppeal}/review`,{decision,reason});}
    if(action.dataset.closeSurvey){if(!confirm('نظرسنجی همین حالا بسته شود؟ پس از بستن رأی جدید پذیرفته نمی‌شود. اگر مشارکت کافی نباشد، امتیازی منتشر نخواهد شد.'))return;await post(`/api/org/surveys/service/${action.dataset.closeSurvey}/close`,{});message('نظرسنجی بسته شد و وضعیت آن ثبت شد.');}
    await refresh();
  }
  document.addEventListener('click',async event=>{const action=event.target.closest('[data-show-design-analysis],[data-copy-design],[data-quarter-monthly],[data-quarter-appeal],[data-submit-quarter],[data-approve-evaluation],[data-return-evaluation],[data-analyze-design],[data-edit-design],[data-publish-design],[data-delete-design],[data-review-design],[data-approve-design],[data-return-design],[data-revise-design],[data-review-position],[data-return-position],[data-approve-position],[data-return-position-hr],[data-revise-position],[data-review-appeal],[data-download-appeal-file],[data-close-survey],[data-refresh-lifecycle],#exportFinalExcel');if(!action||action.disabled)return;action.disabled=true;activeWrites++;try{await doAction(action);}catch(error){message(error.message,true);}finally{activeWrites--;if(action.isConnected)action.disabled=false;}});
  $('#serviceSurveyArea').onclick=async event=>{
    const button=event.target.closest('[data-toggle-service-month],[data-publish-service-month],[data-remove-service-month],[data-publish-service],[data-service-detail],[data-remove-service],[data-back-service]');if(!button||button.disabled)return;
    if(button.dataset.toggleServiceMonth){const period=button.dataset.toggleServiceMonth;if(button.getAttribute('aria-expanded')==='true'){expandedSurveyMonths.delete(period);expandedSurveyMonths.add(`${period}:closed`);}else{expandedSurveyMonths.delete(`${period}:closed`);expandedSurveyMonths.add(period);}renderSurvey();return;}
    if(button.dataset.publishServiceMonth){const period=button.dataset.publishServiceMonth;if(!window.confirm(`همهٔ پیش‌نویس‌های ${window.PanelWorkflow.monthLabel(period)} منتشر شوند؟`))return;button.disabled=true;try{const result=await post('/api/org/surveys/service/publish-month',{period}),published=new Map(result.campaigns.map(row=>[row.id,row]));campaigns=campaigns.map(row=>published.has(row.id)?{...row,...published.get(row.id)}:row);renderSurvey();message(`${fa.format(result.publishedCount)} نظرسنجی ${window.PanelWorkflow.monthLabel(period)} منتشر شد.`);}catch(error){button.disabled=false;message(error.message,true);}return;}
    if(button.dataset.removeServiceMonth){const period=button.dataset.removeServiceMonth,count=campaigns.filter(row=>row.period===period).length;if(!window.confirm(`همهٔ ${fa.format(count)} نظرسنجیِ ${window.PanelWorkflow.monthLabel(period)}، شامل پیش‌نویس‌ها و منتشرشده‌ها، از فهرست حذف شوند؟ پاسخ‌های خام و سوابق ممیزی حفظ می‌شوند.`))return;button.disabled=true;try{const result=await post('/api/org/surveys/service/remove-month',{period}),removed=new Set(result.campaigns.map(row=>row.id));campaigns=campaigns.filter(row=>!removed.has(row.id));if(removed.has(selectedServiceCampaignId))selectedServiceCampaignId=null;renderSurvey();message(`${fa.format(result.removedCount)} نظرسنجی ${window.PanelWorkflow.monthLabel(period)} از فهرست حذف شد.`);}catch(error){button.disabled=false;message(error.message,true);}return;}
    if(button.hasAttribute('data-back-service')){selectedServiceCampaignId=null;renderSurvey();return;}
    if(button.dataset.serviceDetail){selectedServiceCampaignId=button.dataset.serviceDetail;renderSurvey();return;}
    const id=button.dataset.publishService||button.dataset.removeService;
    if(button.dataset.removeService&&!window.confirm('این نظرسنجی از فهرست حذف شود؟ پاسخ‌های خام برای ممیزی حفظ می‌شوند؛ رأی جدید پذیرفته نمی‌شود و امتیاز تجمیعیِ حذف‌شده در محاسبات باز لحاظ نخواهد شد.'))return;
    button.disabled=true;
    try{
      const published=!!button.dataset.publishService;
      const updated=await post(`/api/org/surveys/service/${id}/${published?'publish':'remove'}`,{});
      campaigns=published?campaigns.map(row=>row.id===id?{...row,...updated}:row):campaigns.filter(row=>row.id!==id);
      if(!published&&selectedServiceCampaignId===id)selectedServiceCampaignId=null;
      renderSurvey();
      message(published?'نظرسنجی منتشر شد و برای پاسخ‌دهندگان واجد شرایط فعال است.':'نظرسنجی از فهرست حذف شد.');
    }catch(error){button.disabled=false;message(error.message,true);}
  };
  document.addEventListener('click',async event=>{const action=event.target.closest('[data-approve-position-row]');if(!action||action.disabled)return;action.disabled=true;activeWrites++;try{await approvePositionWithCloseout(action.dataset.approvePositionRow);await window.PanelWorkflow.refresh();}catch(error){message(error.message,true);}finally{activeWrites--;if(action.isConnected)action.disabled=false;}});
  $('#positionForm').onsubmit=async event=>{event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form));data.isManager=form.elements.isManager.checked;data.isKpiEligible=!data.isManager;if(!data.baseSalary)data.baseSalary=null;if(!data.effectiveTo)data.effectiveTo=null;try{for(const key of ['transferDate','effectiveFrom','effectiveTo']){data[key]=window.PanelDate.toGregorian(data[key],key!=='effectiveFrom');if(key!=='effectiveFrom'&&!data[key])data[key]=null;}if(form.dataset.revision){await post(`/api/org/positions/${form.dataset.revision}/revision`,data);delete form.dataset.revision;}else await post('/api/org/positions',data);form.reset();form.elements.effectiveFrom.value=window.PanelDate.today();message('پیشنهاد سمت برای بازبینی مدیر مقصد ارسال شد.');await refresh();}catch(error){message(error.message,true);}};
  $('#personCreateForm').onsubmit=async event=>{event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form));try{data.isManager=data.role==='manager'||form.elements.isManager.checked;data.isKpiEligible=!data.isManager;if(data.role==='manager'){for(const key of ['sectionId','duties','baseSalary','managerId'])delete data[key];}else{if(!String(data.baseSalary??'').trim())throw new Error('حقوق پایه را وارد کنید.');data.baseSalary=Number(data.baseSalary);}data.effectiveFrom=window.PanelDate.toGregorian(data.effectiveFrom);const result=await post('/api/org/people',data);const list=window.PanelWorkflow.accounts;if(!list.some(a=>a.id===result.employee.id))list.push(result.employee);form.reset();syncNewPersonRole();form.elements.effectiveFrom.value=window.PanelDate.today();applySession(user);message('حساب نمونه ساخته شد و ساختار سازمانی به‌روز شد.');await refresh();}catch(error){message(error.message,true);}};
  $('#unitForm').onsubmit=async event=>{event.preventDefault();try{await post('/api/org/units',Object.fromEntries(new FormData(event.target)));event.target.reset();await refresh();message('واحد سازمانی ثبت شد.');}catch(error){message(error.message,true);}};
  $('#sectionForm').onsubmit=async event=>{event.preventDefault();try{await post('/api/org/sections',Object.fromEntries(new FormData(event.target)));event.target.reset();await refresh();message('بخش سازمانی ثبت شد.');}catch(error){message(error.message,true);}};
  const personnelColumns=['نام و نام خانوادگی','کد پرسنلی','نوع دسترسی','شناسه واحد','شناسه بخش','سطح شغل','عنوان شغل','کد پرسنلی مافوق','حقوق پایه ماهانه','دارای پروژه','شرح وظایف','تاریخ شروع شمسی','شماره تماس'];
  let excelLibraryPromise;
  function loadExcelLibrary(){if(window.XLSX)return Promise.resolve(window.XLSX);if(!excelLibraryPromise)excelLibraryPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='src/vendor/xlsx.full.min.js';script.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('خواندن اکسل در این مرورگر ممکن نشد.'));script.onerror=()=>reject(new Error('کتابخانهٔ خواندن اکسل بارگذاری نشد.'));document.head.append(script);});return excelLibraryPromise;}
  $('#downloadPersonnelTemplate').onclick=async()=>{try{const XLSX=await loadExcelLibrary(),book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([personnelColumns]);sheet['!cols']=personnelColumns.map(label=>({wch:Math.max(18,label.length+4)}));XLSX.utils.book_append_sheet(book,sheet,'پرسنل');const bytes=XLSX.write(book,{bookType:'xlsx',type:'array'}),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download='personnel-import-template.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){message(error.message,true);}};
  const examColumns=['کد پرسنلی','امتیاز'];
  $('#downloadExamTemplate').onclick=async()=>{try{const XLSX=await loadExcelLibrary(),book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([examColumns]);sheet['!cols']=[{wch:24},{wch:18}];XLSX.utils.book_append_sheet(book,sheet,'نتایج آزمون');const bytes=XLSX.write(book,{bookType:'xlsx',type:'array'}),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download='exam-results-template.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){message(error.message,true);}};
  function importBool(value,label){const normal=String(value??'').trim();if(['بله','yes','1','true'].includes(normal.toLowerCase()))return true;if(['خیر','no','0','false'].includes(normal.toLowerCase()))return false;throw new Error(`${label} باید «بله» یا «خیر» باشد.`);}
  function verifyPersonnelZip(bytes){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(view.getUint32(offset,true)===0x06054b50){end=offset;break;}
    if(end<0)throw new Error('ساختار فایل XLSX معتبر نیست.');const entries=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),directoryOffset=view.getUint32(end+16,true);if(entries>200||directoryOffset+directorySize>bytes.length)throw new Error('ساختار فایل اکسل بیش از حد مجاز است.');
    let offset=directoryOffset,expanded=0;for(let index=0;index<entries;index++){if(offset+46>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw new Error('ساختار فایل XLSX معتبر نیست.');if(view.getUint16(offset+8,true)&1)throw new Error('فایل رمزگذاری‌شده پشتیبانی نمی‌شود.');const size=view.getUint32(offset+24,true);expanded+=size;if(size===0xffffffff||expanded>8*1024*1024)throw new Error('حجم بازشدهٔ اکسل بیش از حد مجاز است.');offset+=46+view.getUint16(offset+28,true)+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);}
  }
  function personnelFromExcel(row,index,seen){
const get=position=>String(row[position]??'').trim(),name=get(0),employeeCode=get(1),roleName=get(2),role=['مدیر','مدیر واحد'].includes(roleName)?'manager':roleName==='پرسنلی'?'personnel':null,unitId=get(3),sectionId=get(4),jobLevel=get(5),jobTitle=get(6),managerCode=get(7),salary=get(8),hasProjects=role==='manager'?false:importBool(get(9),'دارای پروژه'),duties=get(10),shamsiDate=get(11),phone=get(12);
    if(!name||!employeeCode||!role||!unitId||!jobLevel||!jobTitle||!shamsiDate||(role==='personnel'&&(!sectionId||!duties)))throw new Error('فیلدهای ضروری سطر کامل نیستند.');if(seen.has(employeeCode)||orgChart?.people.some(person=>person.employeeCode===employeeCode))throw new Error('کد پرسنلی تکراری است.');seen.add(employeeCode);
    const unit=orgUnits.find(item=>item.id===unitId),section=role==='manager'?null:orgSections.find(item=>item.id===sectionId&&item.unitId===unitId);if(!unit||(role==='personnel'&&!section))throw new Error('شناسهٔ واحد یا بخش با ساختار ثبت‌شده مطابقت ندارد.');
    if(!['کارآموز','کارشناس','کارشناس ارشد','مسئول','سرپرست','مدیر'].includes(jobLevel))throw new Error('سطح شغلی در فهرست مجاز نیست.');
    const baseSalary=role==='manager'?null:Number(salary);if(role==='personnel'&&(!salary||!Number.isSafeInteger(baseSalary)||baseSalary<0))throw new Error('حقوق پایه معتبر نیست.');
    const manager=orgChart?.people.find(person=>person.employeeCode===managerCode);if(role==='personnel'&&(!manager||manager.role!=='manager'||manager.isSettled||manager.unitId!==unitId))throw new Error('کد پرسنلی مافوق باید به مدیر مجاز همان واحد تعلق داشته باشد.');if(role==='manager'&&orgChart?.people.some(person=>person.role==='manager'&&person.unitId===unitId))throw new Error('این واحد از قبل مدیر دارد.');
    // No-project employees keep the model's project weight and receive a project score of zero.
    const effectiveFrom=window.PanelDate.toGregorian(shamsiDate);return {name,employeeCode,role,unitId,unitName:unit.name,sectionId:section?.id||null,jobFamily:section?.name||null,jobLevel,jobTitle,managerId:role==='personnel'?manager.id:'',baseSalary,hasProjects,duties:role==='manager'?null:duties,effectiveFrom,phone,rowNumber:index+2};
  }
  function resetPersonnelImport(clearResult=false){personnelImportPreview=null;$('#personImportForm .primary-button').textContent='بررسی و پیش‌نمایش اکسل';$('#cancelPersonnelImport').hidden=true;if(clearResult)$('#personImportResult').replaceChildren();}
  $('#personImportForm [name="file"]').addEventListener('change',()=>resetPersonnelImport(true));
  $('#cancelPersonnelImport').onclick=()=>{resetPersonnelImport(true);$('#personImportForm').reset();};
  $('#personImportForm').onsubmit=async event=>{
    event.preventDefault();const form=event.target,file=form.elements.file.files[0],button=form.querySelector('button'),result=$('#personImportResult');try{
      if(user?.role!=='hr')throw new Error('ورود پرسنل فقط برای ادمین مجاز است.');
      if(!file||!file.name.toLowerCase().endsWith('.xlsx')||file.size>2*1024*1024)throw new Error('فقط فایل XLSX تا ۲ مگابایت پذیرفته می‌شود.');button.disabled=true;const bytes=new Uint8Array(await file.arrayBuffer());verifyPersonnelZip(bytes);const XLSX=await loadExcelLibrary(),book=XLSX.read(bytes,{type:'array',cellFormula:true,cellDates:false,sheetRows:102,bookVBA:false}),sheet=book.Sheets[book.SheetNames[0]];if(!sheet)throw new Error('برگهٔ پرسنل در فایل پیدا نشد.');if(Object.values(sheet).some(cell=>cell&&typeof cell==='object'&&cell.f))throw new Error('فرمول در فایل ورودی مجاز نیست؛ فقط مقادیر ثابت را وارد کنید.');
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:false}),headers=rows[0]?.map(value=>String(value).trim()),legacyColumns=[...personnelColumns.slice(0,10),'معافیت پروژه','مرجع معافیت',...personnelColumns.slice(10)],legacy=JSON.stringify(headers)===JSON.stringify(legacyColumns);if(!legacy&&JSON.stringify(headers)!==JSON.stringify(personnelColumns))throw new Error('ستون‌ها با قالب نمونه مطابقت ندارند. قالب را دریافت و بدون تغییر عنوان ستون‌ها تکمیل کنید.');if(rows.length<2||rows.length>101)throw new Error('فایل باید بین ۱ تا ۱۰۰ سطر داده داشته باشد.');if(legacy)for(const row of rows)row.splice(10,2);
      const seen=new Set(),prepared=[],errors=[];for(let index=1;index<rows.length;index++){try{prepared.push(personnelFromExcel(rows[index],index-1,seen));}catch(error){errors.push({row:index+1,message:error.message});}}
      if(errors.length){resetPersonnelImport();result.innerHTML=`<p class="warning-text">پیش از ثبت، ${fa.format(errors.length)} سطر را اصلاح کنید؛ هیچ داده‌ای از این فایل ثبت نشد.</p>${table(['سطر','خطا'],errors.map(item=>`<tr><td>${fa.format(item.row)}</td><td>${esc(item.message)}</td></tr>`).join(''),'')}`;return;}
      if(!personnelImportPreview||personnelImportPreview.file!==file||personnelImportPreview.actorId!==user.id||JSON.stringify(personnelImportPreview.prepared)!==JSON.stringify(prepared)){
        personnelImportPreview={file,actorId:user.id,prepared};button.textContent='تأیید و ثبت '+fa.format(prepared.length)+' نفر';$('#cancelPersonnelImport').hidden=false;
        result.innerHTML=`<p>${fa.format(prepared.length)} سطر معتبر است؛ هنوز هیچ پرسنلی ثبت نشده است. برای ثبت، دکمهٔ «تأیید و ثبت» را بزنید.</p>${table(['سطر','نام','کد پرسنلی','سمت','واحد','بخش','شرح وظایف'],prepared.map(item=>`<tr><td>${fa.format(item.rowNumber)}</td><td>${esc(item.name)}</td><td dir="ltr">${esc(item.employeeCode)}</td><td>${esc(item.jobTitle)}</td><td>${esc(item.unitName)}</td><td>${esc(item.jobFamily)}</td><td class="personnel-duties-text">${esc(item.duties)}</td></tr>`).join(''),'')}`;return;
      }
      const outcomes=[];for(const item of prepared){const {rowNumber,...data}=item;try{const saved=await post('/api/org/people',data);window.PanelWorkflow.accounts.push({...saved.employee,employeeCode:item.employeeCode});outcomes.push({row:rowNumber,name:item.name,ok:true});}catch(error){outcomes.push({row:rowNumber,name:item.name,ok:false,error:error.message});}}
      result.innerHTML=`<p>${fa.format(outcomes.filter(item=>item.ok).length)} نفر ثبت شد؛ ${fa.format(outcomes.filter(item=>!item.ok).length)} سطر خطا داشت. سطرهای موفق را دوباره بارگذاری نکنید.</p>${table(['سطر','نام','نتیجه'],outcomes.map(item=>`<tr><td>${fa.format(item.row)}</td><td>${esc(item.name)}</td><td>${item.ok?'ثبت شد':esc(item.error)}</td></tr>`).join(''),'')}`;resetPersonnelImport();form.reset();applySession(user);await refresh();message('ورود گروهی پرسنل پایان یافت.');
    }catch(error){resetPersonnelImport();result.innerHTML=`<p class="warning-text">${esc(error.message)}</p>`;message(error.message,true);}finally{button.disabled=false;}
  };
  $('#newPersonRole').onchange=()=>{const manager=$('#newPersonRole').value==='manager';$('#newPersonManager').required=!manager;$('#newPersonManager').closest('label').hidden=manager;};
  $('#cancelDesignEdit').onclick=()=>{resetDesignForm();message('ویرایش لغو شد؛ پیش‌نویس ذخیره‌شده تغییر نکرد.');};
  $('#designForm').addEventListener('input',event=>{if(['title','weight'].includes(event.target.name))renderDesignDraft();});
  function markClarificationsForReview(event){if((!event.target.closest('#designDescriptionFields,#designCriteriaFields')&&!['category','title','description','criteria','weight','frequency','targetVolume','targetUnit','dayOfMonth','dayOfWeek','timeLimitHour','documentFormat','deadline','routineDate'].includes(event.target.name))||!editingClarifications.some(q=>q.answer))return;designClarificationArea.querySelector('.clarification-draft-warning').hidden=false;for(const q of editingClarifications.filter(q=>q.answer)){q.needsReconfirmation=true;const row=designClarificationArea.querySelector('[data-question-id="'+q.id+'"]');row.querySelector('.clarification-reconfirm').hidden=false;row.querySelector('.analysis-status-badge').textContent='پاسخ نیازمند بازبینی';row.querySelector('[data-reconfirm-clarification]').checked=false;}}
  $('#designForm').addEventListener('input',markClarificationsForReview);$('#designForm').addEventListener('change',markClarificationsForReview);
  $('#designForm').addEventListener('change',event=>{if(event.target.name==='frequency')syncDesignFields();if(['weight','employeeId'].includes(event.target.name))renderDesignDraft();});
  syncDesignFields();
  $('#designEmployee').onchange=()=>syncDesignModel();
  $('#designForm').onsubmit=async event=>{event.preventDefault();const form=event.target;if(form.dataset.submitting)return;const lock=formReviewLock();if(lock){message(lock.finalReviewReason,true);syncFinalReviewForm();return;}try{const task=designTaskFromForm(form),tasks=[...stagedDesignTasks,task],editing=designs.find(d=>d.id===(form.dataset.draftId||form.dataset.revision));if(editing){const order=new Map(editing.tasks.map((t,i)=>[t.id,i]));tasks.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));}validateDesignWeights(tasks);form.dataset.submitting='true';activeWrites++;for(const button of form.querySelectorAll('button'))button.disabled=true;
    const id=form.dataset.draftId,previous=designs.find(row=>row.id===(id||form.dataset.revision)),input={employeeId:designDraftEmployeeId||form.elements.employeeId.value,period:previous?.period||currentPeriod(),tasks,...(id?{draftRevision:Number(form.dataset.draftRevision)}:{}),...(form.dataset.revision?{revises:form.dataset.revision}:{})};
    await post(id?`/api/org/designs/${id}/draft`:'/api/org/designs/drafts',input);resetDesignForm(input.employeeId);await refresh();message('شاخص در پیش‌نویس همان فرد و ماه ذخیره شد؛ انتشار، همهٔ شاخص‌های این نسخه را برای AI می‌فرستد.');
    }catch(error){message(error.message,true);}finally{if(form.dataset.submitting){activeWrites--;delete form.dataset.submitting;syncDesignModel();}}};
  $('#positionEmployee').onchange=()=>{const selected=accounts().find(a=>a.id===$('#positionEmployee').value),form=$('#positionForm');if(!selected)return;form.elements.jobTitle.value=selected.jobTitle||'';form.elements.jobLevel.value=selected.level||'';syncOrgForm(form,{unitId:selected.unitId,sectionId:selected.sectionId||orgSections.find(row=>row.unitId===selected.unitId&&row.name===selected.jobFamily)?.id,managerId:selected.managerId});};
  settlementForm.onsubmit=async event=>{
    event.preventDefault();const fields=settlementForm.elements;
    try{
      const person=availableSettlementPeople().find(p=>p.id===fields.employeeId.value);
      if(!person||normalizeSettlementName(fields.employeeName.value)!==normalizeSettlementName(settlementNameLabel(person))||normalizeSettlementCode(fields.employeeCode.value)!==normalizeSettlementCode(person.employeeCode||''))throw new Error('نام یا کد پرسنلی را از فهرست معتبر انتخاب کنید.');
      const settlementDate=window.PanelDate.toGregorian(fields.settlementDate.value);
      const input={employeeId:person.id,employeeCode:person.employeeCode||null,settlementDate},preview=await post('/api/org/settlements/preview',input);
      if(!preview.ready)throw new Error(preview.blockers.join('\n'));
      if(!confirm(`تسویهٔ ${person.name} تا پایان روز ${fields.settlementDate.value} نهایی شود؟\nمبلغ KPI بازه‌های باز: ${money(preview.earned)}\nحقوق مبنای همین بازه‌ها: ${money(preview.baseSalary)}\nجمع: ${money(preview.total)}\nمبالغ قبلاً قفل‌شده دوباره محاسبه نمی‌شوند. پس از ثبت، امتیاز و مبلغ این بازه‌ها قابل تغییر نیست.`))return;
      await post('/api/org/settlements',{...input,closeoutAcknowledgment:true,closeoutFingerprint:preview.fingerprint});
      resetSettlementForm();
      await window.PanelWorkflow.refresh();await refresh();message('تسویه ثبت شد؛ امتیاز و مبلغ تا پایان روز انتخاب‌شده نهایی و بسته شد.');
    }catch(error){message(error.message,true);}
  };
  $('#positionUnit').onchange=()=>syncOrgForm($('#positionForm'),{unitId:$('#positionUnit').value});
  $('#newPersonUnit').onchange=()=>syncOrgForm($('#personCreateForm'),{unitId:$('#newPersonUnit').value});
  $('#positionForm [name="transferDate"]').onchange=event=>{if(!event.target.value)return;try{$('#positionForm [name="effectiveFrom"]').value=event.target.value;}catch(error){message(error.message,true);}};
  function renewExamBatchKey(){const field=$('#examImportForm [name="batchKey"]'),id=Array.from(window.crypto.getRandomValues(new Uint8Array(12)),value=>value.toString(16).padStart(2,'0')).join('');field.defaultValue='ex-'+id;field.value=field.defaultValue;}
  renewExamBatchKey();$('#examImportForm').addEventListener('reset',renewExamBatchKey);
  dataView.querySelector('.exam-entry-grid').append(examExcelPanel);examExcelPanel.classList.remove('lifecycle-section');examExcelPanel.id='examExcelPanel';
  function attachExcelPicker(formId,description,statusId,accessibleName){
    const form=$('#'+formId),input=form.elements.file,field=document.createElement('div');field.className='excel-file-field'+(formId==='examExcelForm'?' exam-file-field':'');field.innerHTML='<p class="workflow-muted"></p><label class="activity-attach-control"><svg aria-hidden="true"><use href="#i-upload"/></svg><span>پیوست فایل اکسل</span></label><p class="workflow-muted" role="status" aria-live="polite"></p>';field.firstElementChild.textContent=description;const status=field.lastElementChild;status.id=statusId;
    input.closest('label').replaceWith(field);field.querySelector('label').append(input);input.setAttribute('aria-label',accessibleName);input.setAttribute('aria-describedby',statusId);
    const syncName=()=>{status.textContent=input.files?.[0]?.name||'فایلی انتخاب نشده است.';};input.addEventListener('change',syncName);form.addEventListener('reset',()=>queueMicrotask(syncName));syncName();
  }
  attachExcelPicker('examExcelForm','فایل نتیجهٔ آزمون · XLSX تا ۲ مگابایت','examExcelFileName','انتخاب فایل اکسل نتیجهٔ آزمون');
  attachExcelPicker('personImportForm','فایل پرسنل · XLSX تا ۲ مگابایت و ۱۰۰ سطر','personExcelFileName','انتخاب فایل اکسل پرسنل');
  function compactExcelActions(templateId,formId,className){const actions=document.createElement('div');actions.className='excel-import-actions '+className;const template=$('#'+templateId),wrapper=template.closest('.design-form-actions');wrapper.before(actions);actions.append(template,$('#'+formId));wrapper.remove();}
  compactExcelActions('downloadPersonnelTemplate','personImportForm','personnel-import-actions');compactExcelActions('downloadExamTemplate','examExcelForm','exam-import-actions');
  window.PanelPeerSurveyImport?.mount({container:$('#view-surveys'),loadExcelLibrary,verifyZip:verifyPersonnelZip,attachPicker:attachExcelPicker,compactActions:compactExcelActions,refresh:()=>refresh({section:'surveys'}),onBusy:value=>{activeWrites+=value?1:-1;}});
  $('#examImportForm').onsubmit=async event=>{event.preventDefault();const form=event.target;if(!form.elements.batchKey.value)renewExamBatchKey();const data=Object.fromEntries(new FormData(form)),rows=[{employeeCode:data.employeeCode.trim(),score:data.score.trim()}],button=form.querySelector('button');button.disabled=true;try{const result=await post('/api/org/exams/import',{quarter:data.quarter,batchKey:data.batchKey,source:'local-json',rows});message(`نتایج واردشده: ${fa.format(result.importedCount)} · قرنطینه: ${fa.format(result.quarantined?.length||0)}`);if(result.importedCount){form.reset();form.elements.quarter.value=data.quarter;fillCommonPeriods();}else renewExamBatchKey();await refresh();}catch(error){message(error.message,true);}finally{button.disabled=false;}};
  $('#examExcelForm').onsubmit=async event=>{
    event.preventDefault();const form=event.target,file=form.elements.file.files[0],button=form.querySelector('button'),output=$('#examExcelResult');try{
      if(!file||!file.name.toLowerCase().endsWith('.xlsx')||file.size>2*1024*1024)throw new Error('فقط فایل XLSX تا ۲ مگابایت پذیرفته می‌شود.');
      button.disabled=true;const bytes=new Uint8Array(await file.arrayBuffer());verifyPersonnelZip(bytes);const XLSX=await loadExcelLibrary(),book=XLSX.read(bytes,{type:'array',cellFormula:true,cellDates:false,sheetRows:502,bookVBA:false}),sheet=book.Sheets[book.SheetNames[0]];if(!sheet)throw new Error('برگهٔ نتایج آزمون پیدا نشد.');if(Object.values(sheet).some(cell=>cell&&typeof cell==='object'&&cell.f))throw new Error('فرمول در فایل ورودی مجاز نیست؛ فقط مقدار ثابت وارد کنید.');
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:false});if(JSON.stringify(rows[0]?.map(value=>String(value).trim()))!==JSON.stringify(examColumns))throw new Error('عنوان ستون‌ها با قالب نمونه مطابقت ندارد.');if(rows.length<2||rows.length>501)throw new Error('فایل باید بین ۱ تا ۵۰۰ سطر داده داشته باشد.');
      const prepared=rows.slice(1).map((row,index)=>{if(row.length>2)throw new Error(`سطر ${fa.format(index+2)} ستون اضافی دارد.`);return {employeeCode:String(row[0]??'').trim(),score:String(row[1]??'').trim()};});
      const quarter=$('#examImportForm [name="quarter"]').value,batchKey=`excel-${quarter}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,result=await post('/api/org/exams/import',{quarter,batchKey,source:'local-xlsx',fileName:file.name,rows:prepared});
      output.innerHTML=`<p>ثبت‌شده: ${fa.format(result.importedCount)} · قرنطینه: ${fa.format(result.quarantined.length)}</p>${result.quarantined.length?table(['کد پرسنلی','دلیل'],result.quarantined.map(row=>`<tr><td>${esc(row.employeeCode||'—')}</td><td>${esc(row.reason)}</td></tr>`).join(''),''):''}`;
      form.reset();await refresh();message('فایل آزمون پردازش شد و نتیجه در آرشیو ثبت شد.');
    }catch(error){output.innerHTML=`<p class="warning-text">${esc(error.message)}</p>`;message(error.message,true);}finally{button.disabled=false;}
  };
  $('#appealForm').onsubmit=async event=>{event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form)),files=[...form.elements.appealFiles.files];try{validateAppealFiles(files);const appeal=await post('/api/org/appeals',{quarter:data.quarter,type:data.type,reason:data.reason});form.reset();fillCommonPeriods();try{await uploadAppealFiles(appeal.id,files);await refresh();message(files.length?'درخواست و فایل‌های مستند در گردش تأیید مدیر و ادمین ثبت شدند.':'درخواست در گردش تأیید مدیر و ادمین ثبت شد.');}catch(error){await refresh();message(`درخواست ثبت شد، اما بارگذاری همهٔ فایل‌ها کامل نشد: ${error.message} از کنار درخواست دوباره بارگذاری کنید.`,true);}}catch(error){message(error.message,true);}};
  $('#appealList').onsubmit=async event=>{const form=event.target;if(form.matches('[data-appeal-resubmit]')){event.preventDefault();if(form.dataset.busy)return;form.dataset.busy='1';const button=form.querySelector('button');button.disabled=true;activeWrites++;try{await post(`/api/org/appeals/${form.dataset.appealResubmit}/resubmit`,{reason:form.elements.reason.value});await refresh();message('اعتراض اصلاح‌شده دوباره برای مدیر ارسال شد.');}catch(error){message(error.message,true);}finally{activeWrites--;delete form.dataset.busy;button.disabled=false;}return;}if(!form.matches('[data-appeal-upload]'))return;event.preventDefault();const appeal=appeals.find(row=>row.id===form.dataset.appealUpload),files=[...form.elements.files.files],button=form.querySelector('button');try{if(!files.length)throw new Error('ابتدا فایل را انتخاب کنید.');validateAppealFiles(files,appeal?.files?.length||0);button.disabled=true;await uploadAppealFiles(form.dataset.appealUpload,files,appeal?.files?.length||0);await refresh();message('فایل مستند به درخواست اضافه شد.');}catch(error){message(error.message,true);}finally{button.disabled=false;}};
  surveyExtra.addEventListener('submit',async event=>{
    const form=event.target;if(form.id!=='serviceCampaignForm'&&!form.matches('[data-survey-response]'))return;event.preventDefault();if(form.dataset.submitting)return;
    const data=Object.fromEntries(new FormData(form)),button=form.querySelector('button');form.dataset.submitting='true';button.disabled=true;activeWrites++;
    try{if(form.id==='serviceCampaignForm'){const result=await post('/api/org/surveys/service',{...data,minParticipation:data.minParticipation||undefined,period:currentPeriod()});message(data.employeeId==='all'?`${fa.format(result.createdCount)} پیش‌نویس فردی ذخیره شد؛ ${fa.format(result.skippedCount)} مورد از قبل وجود داشت.`:'پیش‌نویس نظرسنجی ذخیره شد.');}
      else{const result=await post(`/api/org/surveys/service/${form.dataset.surveyResponse}/response`,{score:data.score});message(result.published?'مشارکت لازم تکمیل شد و امتیاز فرد هدف ثبت شد.':`پاسخ شما ثبت شد؛ ${fa.format(result.responses)} از ${fa.format(result.required)} پاسخ لازم جمع‌آوری شده است.`);}await refresh();
    }catch(error){message(error.message,true);}finally{activeWrites--;delete form.dataset.submitting;if(button.isConnected)button.disabled=false;}
  });
  $('#evaluationSettingsForm').onsubmit=async event=>{event.preventDefault();const form=event.target,number=name=>Number(form.elements[name].value),effectiveQuarter=`${form.elements.effectiveYear.value}-Q${form.elements.effectiveSeason.value}`;
    const data={effectiveQuarter,unitId:form.elements.unitId.value||null,weights:Object.fromEntries(['exam','manager','routine','project','peer'].map(name=>[name,number(name)]))};
    try{await post('/api/org/evaluation-settings/draft',data);await refresh();message('پیش‌نویس در فهرست پایین ذخیره شد.');}catch(error){message(error.message,true);}
  };
  $('#resetEvaluationSettings').onclick=()=>{const form=$('#evaluationSettingsForm'),unitId=form.elements.unitId.value,weights=unitId?evaluationSettingsData?.defaults.byUnit[unitId]:evaluationSettingsData?.defaults.global;if(!weights)return;for(const name of ['exam','manager','routine','project','peer'])form.elements[name].value=weights[name];message('درصدهای فرم به پیش‌فرض برگشتند؛ برای ثبت، پیش‌نویس را ذخیره کنید.');};
  $('#evaluationSettingsDrafts').onclick=async event=>{
    const publishButton=event.target.closest('[data-publish-settings-draft]'),deleteButton=event.target.closest('[data-delete-settings-draft]'),id=publishButton?.dataset.publishSettingsDraft||deleteButton?.dataset.deleteSettingsDraft;if(!id)return;
    if(deleteButton&&!window.confirm('این پیش‌نویس حذف شود؟ نسخه‌های منتشرشده حفظ می‌شوند.'))return;
    const button=publishButton||deleteButton;if(button.disabled)return;button.disabled=true;
    try{if(publishButton){const result=await post('/api/org/evaluation-settings/publish',{id});await window.PanelWorkflow.refresh();const scope=result.unitId?orgUnits.find(unit=>unit.id===result.unitId)?.name||result.unitId:'همهٔ واحدها';message(`نسخهٔ ${result.version} منتشر شد؛ مدل از ${window.PanelWorkflow.quarterLabel(result.effectiveQuarter)} برای پرسنل ${scope} اعمال می‌شود. نتایج قفل‌شده تغییر نمی‌کنند.`);}else{await post('/api/org/evaluation-settings/draft/delete',{id});await refresh();message('پیش‌نویس حذف شد.');}}catch(error){message(error.message,true);}finally{if(button.isConnected)button.disabled=false;}
  };
  $('#evaluationSettingsVersions').onclick=async event=>{
    const button=event.target.closest('[data-delete-settings-published]');if(!button||button.disabled)return;
    const row=evaluationSettingsData?.published.find(row=>row.id===button.dataset.deleteSettingsPublished);if(!row)return;
    const scope=row.unitId?orgUnits.find(unit=>unit.id===row.unitId)?.name||row.unitId:'همهٔ واحدها';
    if(!window.confirm(`نسخهٔ ${row.version} برای ${scope} حذف شود؟ مدل این نسخه دیگر در محاسبات باز اعمال نمی‌شود و مدل قبلیِ معتبر یا پیش‌فرض جایگزین خواهد شد. نتایج قفل‌شده و سابقهٔ نسخه حفظ می‌شوند.`))return;
    button.disabled=true;try{await post('/api/org/evaluation-settings/published/delete',{id:row.id});await window.PanelWorkflow.refresh();message('نسخهٔ منتشرشده از فهرست حذف شد؛ مدل قبلیِ معتبر یا پیش‌فرض در محاسبات باز اعمال می‌شود. نتایج قفل‌شده حفظ شدند.');}catch(error){message(error.message,true);}finally{if(button.isConnected)button.disabled=false;}
  };
  for(const id of ['positionForm','settlementForm','personCreateForm','unitForm','sectionForm','personImportForm','examImportForm','examExcelForm','appealForm','evaluationSettingsForm']){
    const form=$('#'+id),submit=form.onsubmit;let submitting=false;
    form.onsubmit=async event=>{event.preventDefault();if(submitting)return;submitting=true;activeWrites++;const buttons=[...form.querySelectorAll('button')].map(button=>[button,button.disabled]);buttons.forEach(([button])=>button.disabled=true);try{return await submit(event);}finally{activeWrites--;submitting=false;for(const [button,disabled] of buttons)if(button.isConnected)button.disabled=disabled;}};
  }
  for(const id of ['serviceSurveyArea','evaluationSettingsDrafts','evaluationSettingsVersions','examImportArchive']){
    const area=$('#'+id),click=area.onclick;area.onclick=async event=>{const button=event.target.closest('button');if(!button||button.disabled)return;if(button.matches('[data-toggle-service-month],[data-service-detail],[data-back-service]'))return click(event);activeWrites++;try{return await click(event);}finally{activeWrites--;}};
  }
  window.PanelLifecycle={revealDesign,personnelRequestView,revealPersonnelRequest,applySession,canView,refresh,get managerDashboardState(){return user?.role==='manager'?{designs:designs.map(({id,employeeId,period,status,version})=>({id,employeeId,period,status,version})),positions:positionRequests.map(({id,employeeId,jobTitle,status})=>({id,employeeId,jobTitle,status})),appeals:appeals.map(({id,employeeId,status,quarter})=>({id,employeeId,status,quarter})),deadlines:deadlines.map(({id,employeeId,employeeName,state})=>({id,employeeId,employeeName,state}))}:{designs:[],positions:[],appeals:[],deadlines:[]};},get dashboardCampaigns(){return campaigns.map(({id,employeeName,unitName,period,status,canRespond,ownCampaign,responded,dueAt})=>({id,employeeName,unitName,period,status,canRespond,ownCampaign,responded,dueAt}));},get working(){return activeWrites>0;}};
  if(window.PanelWorkflow.user){applySession(window.PanelWorkflow.user);refresh().catch(error=>message(error.message,true));}
  window.addEventListener('panel:view',event=>{if(['quarters','organization','evaluation-settings','updates','duties','incoming','chart','tasks','position-review','personnel-requests-archive','data','appeals','surveys','peer-surveys'].includes(event.detail))refresh({section:event.detail}).catch(error=>message(error.message,true));});
  window.addEventListener('panel:reviewed',()=>refresh().catch(error=>message(error.message,true)));
  $('#workflowPeriod').addEventListener('change',()=>fillCommonPeriods(true));

  $('#positionForm [name="effectiveFrom"]').value=window.PanelDate.today();
  $('#personCreateForm [name="effectiveFrom"]').value=window.PanelDate.today();
})();

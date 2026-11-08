(() => {
  // Display help only; the rule registry and submitted values remain unchanged.
  const groupSummaries=Object.freeze({
    deadlines:'موعد ارسال مستندات، مهلت ارفاق و مبنای شمارش روزها.',
    delay:'روش، مقدار و سقف کسر امتیاز برای تحویل دیرهنگام.',
    late:'پذیرش یا بستن ارسال پس از پایان مهلت.',
    revisions:'تعداد و مهلت اصلاح مستندات و ملاک نسخهٔ نهایی.',
    attempts:'سقف نوبت‌های تحویل؛ نه تعداد فایل‌ها یا تلاش‌های ناموفق.',
    activityAppeal:'اعتراض مستقل به شاخص با حفظ اصل تحلیل AI.',
    quarterAppeal:'تعداد، مهلت و مستندات اعتراض به نتیجهٔ فصل.',
    evidence:'کفایت مستندات، ارجاع معتبر و قواعد ارزیابی هوش مصنوعی.',
    exceptions:'درخواست تمدید مستند با تأیید مدیر و ادمین.',
    surveys:'حداقل مشارکت، تعداد پاسخ و مهلت نظرسنجی.',
    workflow:'مهلت تعریف شاخص، یادآوری و ارجاع موارد معوق.',
    money:'سقف مشوق، گردکردن مبلغ و وضعیت فرد بدون پروژه.',
    scope:'انتخاب دامنه و زمان اثر؛ انتشار پس از پیش‌نمایش.',
    transparency:'پیش‌نمایش آزمایشی، ثبت دلیل تغییر و نمایش جزئیات امتیاز.',
    records:'نگهداری تاریخچه و جلوگیری از بازنویسی نتایج قفل‌شده.'
  });
  const root=document.getElementById('view-score-settings');if(!root)return;
  const esc=escapeHtml,fa=new Intl.NumberFormat('fa-IR'),dateLabel=value=>new Intl.DateTimeFormat('fa-IR',{year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Tehran'}).format(new Date(value+'T12:00:00Z'));
  let data=null,seasons=[],actor=null,generation=0,draft=null,previewHash=null,busy=false,dirty=false;
  const allowed=()=>window.PanelWorkflow?.user?.role==='hr';
  const $=selector=>root.querySelector(selector);
  const option=(value,label,selected=false)=>`<option value="${esc(value)}"${selected?' selected':''}>${esc(label)}</option>`;
  const scope=row=>[row.unitId?data.units.find(u=>u.id===row.unitId)?.name||row.unitId:'کل سازمان',{all:'همهٔ شاخص‌ها',routine:'روتین',project:'پروژه‌ای'}[row.activityKind],dateLabel(row.effectiveDate)].join(' · ');
  function status(message,error=false){const el=$('#scoreSettingsStatus');if(el){el.textContent=message;el.classList.toggle('is-error',error);}}
  function invalidate(){dirty=true;previewHash=null;$('#scorePublish').disabled=true;$('#scorePreview').disabled=true;$('#scorePreviewResult').replaceChildren();status('تغییرات ذخیره نشده‌اند؛ ابتدا پیش‌نویس را ذخیره کنید.');}
  const timeLabel=value=>value?new Intl.DateTimeFormat('fa-IR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Tehran'}).format(new Date(value)):'—';
  const publisherName=row=>{
    const workflow=window.PanelWorkflow,person=(workflow?.accounts||[]).find(account=>account.id===row.publishedBy)||(workflow?.user?.id===row.publishedBy?workflow.user:null);
    return person?.name||row.publishedByName||'نام منتشرکننده ثبت نشده';
  };
  let historyOpener=null;
  const historyDialog=document.createElement('dialog');historyDialog.id='scoreHistoryDialog';historyDialog.className='design-analysis-dialog score-history-dialog';historyDialog.setAttribute('aria-labelledby','scoreHistoryTitle');historyDialog.setAttribute('aria-modal','true');
  historyDialog.innerHTML='<header class="design-analysis-dialog-header"><div><h2 id="scoreHistoryTitle">جزئیات قانون منتشرشده</h2><p id="scoreHistoryScope"></p></div><button type="button" class="secondary-button" data-close-history aria-label="بستن جزئیات قانون">×</button></header><div class="design-analysis-dialog-body" id="scoreHistoryBody"></div><footer class="design-analysis-dialog-footer"><button type="button" class="secondary-button" id="scoreHistoryCopy">کپی در پیش‌نویس جدید</button></footer>';document.body.append(historyDialog);
  function closeHistory(restoreFocus=true){if(historyDialog.open)historyDialog.close();historyDialog.querySelector('#scoreHistoryBody').replaceChildren();historyDialog.querySelector('#scoreHistoryScope').textContent='';historyDialog.querySelector('#scoreHistoryCopy').removeAttribute('data-copy-rule');if(restoreFocus&&historyOpener?.isConnected)historyOpener.focus();historyOpener=null;}
  historyDialog.querySelector('[data-close-history]').onclick=()=>closeHistory();
  historyDialog.addEventListener('cancel',event=>{event.preventDefault();closeHistory();});
  historyDialog.addEventListener('close',()=>{if(!historyDialog.open)closeHistory();});
  function showHistory(row,opener){
    historyOpener=opener;historyDialog.querySelector('#scoreHistoryScope').textContent=row.id+' · '+scope(row);
    historyDialog.querySelector('#scoreHistoryBody').innerHTML=`<dl class="score-history-meta"><div><dt>انتشار توسط</dt><dd>${esc(publisherName(row))}</dd></div><div><dt>زمان انتشار</dt><dd>${esc(timeLabel(row.publishedAt))}</dd></div></dl><h3>دلیل تغییر</h3><p class="score-history-reason">${esc(row.reason)}</p><h3>مقادیر قانون</h3><dl class="score-history-values">${data.groups.flatMap(g=>g.fields).filter(f=>!f.locked).map(f=>`<div><dt>${esc(f.label)}</dt><dd>${esc(f.options.find(o=>o.value===row.values[f.key])?.label||'—')}</dd></div>`).join('')}</dl>`;
    historyDialog.querySelector('#scoreHistoryCopy').dataset.copyRule=row.id;
    if(!historyDialog.open)historyDialog.showModal();historyDialog.querySelector('[data-close-history]').focus();
  }
  function historyRows(){return data.history.map(row=>`<article class="score-rule-history score-history-row"><div class="score-history-info"><strong><bdi dir="ltr">${esc(row.id)}</bdi> · ${esc(scope(row))}</strong><small>انتشار توسط ${esc(publisherName(row))} · ${esc(timeLabel(row.publishedAt))}</small></div><button type="button" class="secondary-button" data-history-rule="${esc(row.id)}" aria-haspopup="dialog" aria-controls="scoreHistoryDialog" aria-label="جزئیات نسخهٔ ${esc(row.id)}">جزئیات</button></article>`).join('')||'<p class="workflow-muted">هنوز قانون جدیدی منتشر نشده است؛ منطق فعلی برقرار است.</p>';}
  function draftRows(){return data.drafts.map(row=>`<article class="score-rule-history score-draft-row"><div class="score-draft-info"><strong>${esc(scope(row))}</strong><small>ویرایش ${fa.format(row.revision)} · آخرین ذخیره: ${esc(timeLabel(row.updatedAt))}</small></div><p class="score-draft-reason" title="${esc(row.reason)}">${esc(row.reason)}</p><div class="score-draft-actions"><button type="button" class="secondary-button" data-edit-rule="${esc(row.id)}">ویرایش</button><button type="button" class="primary-button" data-publish-rule="${esc(row.id)}" title="پیش‌نمایش این پیش‌نویس و سپس انتشار قانون">انتشار قانون</button><button type="button" class="secondary-button" data-discard-rule="${esc(row.id)}">حذف</button></div></article>`).join('')||'<p class="workflow-muted">هنوز پیش‌نویسی ذخیره نشده است.</p>';}
  // Keep the API's no-retroactivity rule: this season starts today; future
  // seasons start on their first day. Selecting a season never republishes it.
  function availableSeasons(today){
    const [year,month]=window.PanelDate.input(today).split('/').map(Number),currentSeason=Math.ceil(month/3),limit=new Date(Date.parse(today+'T12:00:00Z')+366*86400000).toISOString().slice(0,10);
    return [year,year+1].flatMap(y=>['بهار','تابستان','پاییز','زمستان'].map((label,i)=>{const startDate=window.PanelDate.toGregorian(y+'/'+(i*3+1)+'/1');return {year:y,season:i+1,label,startDate,effectiveDate:y===year&&i+1===currentSeason?today:startDate};})).filter(s=>(s.year===year&&s.season===currentSeason||s.startDate>=today)&&s.effectiveDate<=limit);
  }
  function seasonOptions(year,selected){return seasons.filter(s=>String(s.year)===String(year)).map(s=>option(s.season,s.label,s.effectiveDate===selected)).join('');}
  function updateEffectDate(){
    const f=$('#scoreRulesForm').elements,selected=seasons.find(s=>String(s.year)===f.effectiveYear.value&&String(s.season)===f.effectiveSeason.value);
    if(!selected)return;f.effectiveDate.value=selected.effectiveDate;$('#scoreEffectNote').textContent='شروع اثر: '+dateLabel(selected.effectiveDate)+(selected.startDate<data.today?' · فصل جاری از امروز قابل انتخاب است؛ سوابق قبلی تغییر نمی‌کنند.':' · فصل‌های جاری و آینده تا یک سال آینده قابل انتخاب‌اند.')+' تغییر قواعد مالی فقط از ابتدای فصل آینده مجاز است.';
  }
  function selectStoredEffect(date){
    const f=$('#scoreRulesForm').elements,selected=seasons.find(s=>s.effectiveDate===date);
    // Legacy daily dates are displayed intact, never silently moved to a season boundary.
    f.effectiveDate.value=date;
    if(selected){f.effectiveYear.value=String(selected.year);f.effectiveSeason.innerHTML=seasonOptions(selected.year,date);updateEffectDate();}
    else {const year=Number(window.PanelDate.input(date).split('/')[0]);f.effectiveYear.value=String(seasons.some(s=>s.year===year)?year:seasons[0].year);f.effectiveSeason.innerHTML=option('','فصل اثر را انتخاب کنید',true)+seasonOptions(f.effectiveYear.value);$('#scoreEffectNote').textContent='تاریخ ثبت‌شده: '+dateLabel(date)+'؛ برای ذخیرهٔ نسخهٔ جدید، سال و فصل اثر را انتخاب کنید. تاریخ قبلی بدون انتخاب شما تغییر نمی‌کند.';}
  }
  function render(){
    seasons=availableSeasons(data.today);
    const initialSeason=seasons.find(s=>s.startDate>=data.today)||seasons[0];
    root.innerHTML=`<div class="page-heading"><div><p class="eyebrow">ادمین · قواعد اجرایی نسخه‌دار</p><h1>تنظیمات محاسبه امتیاز</h1><p>موعد، تحویل، کسر و گردش بررسی؛ مستقل از وزن‌های مدل محاسبه</p></div><button type="button" class="secondary-button" id="scoreReload">بارگذاری مجدد</button></div>
    <div class="score-rule-summary"><article class="panel"><span>قواعد قابل تنظیم</span><strong>${fa.format(data.groups.flatMap(g=>g.fields).filter(f=>!f.locked).length)}</strong><small>متصل به مسیرهای اجرایی</small></article><article class="panel"><span>نسخه‌های منتشرشده</span><strong>${fa.format(data.history.length)}</strong><small>حفظ تاریخچه و نتایج قبلی</small></article><article class="panel"><span>پیش‌نویس‌های ذخیره‌شده</span><strong id="scoreDraftCount">${fa.format(data.drafts.length)}</strong><small>بدون اثر تا پیش‌نمایش و انتشار</small></article></div>

    <form id="scoreRulesForm"><section class="panel settings-card"><h2>دامنه و زمان اثر</h2><div class="score-rule-fields score-rule-scope">
    <label>واحد هدف<select name="unitId">${option('','کل سازمان')}${data.units.map(u=>option(u.id,u.name)).join('')}</select></label>
    <label>نوع شاخص<select name="activityKind">${option('all','همهٔ شاخص‌ها')}${option('routine','فقط روتین')}${option('project','فقط پروژه‌ای')}</select></label>
    <label>سال اثر<select name="effectiveYear" required aria-describedby="scoreEffectNote">${[...new Set(seasons.map(s=>s.year))].map(year=>option(year,fa.format(year).replace(/٬/g,''),year===initialSeason.year)).join('')}</select></label>
    <label>فصل اثر<select name="effectiveSeason" required aria-describedby="scoreEffectNote">${seasonOptions(initialSeason.year,initialSeason.effectiveDate)}</select></label></div><input type="hidden" name="effectiveDate" value="${esc(initialSeason.effectiveDate)}"><p id="scoreEffectNote" class="workflow-muted" aria-live="polite"></p>
    <p class="workflow-muted">قانون اختصاصی واحد بر سازمان اولویت دارد؛ سپس قانون اختصاصی نوع شاخص. نسخهٔ جدید از زمان انتشار و تاریخ اثر به بعد اعمال می‌شود، نه روی سوابق. در دامنهٔ یک نوع شاخص، فقط قواعد تحویل و ارزیابی قابل تغییرند.</p>
    <div class="score-rule-toolbar"><button type="button" id="scoreLoadEffective" class="secondary-button">بارگذاری قانون مؤثر این دامنه</button><button type="button" id="scoreReset" class="secondary-button">بازگشت فرم به پیش‌فرض اولیه</button><label>نمایش بخش‌ها<select id="scoreGroupFilter"><option value="all">همهٔ بخش‌ها</option><option value="editable">دارای تنظیم قابل تغییر</option><option value="pending">نیازمند توسعه</option></select></label></div></section>
    <div class="score-rule-groups">${data.groups.map((group,index)=>`<details class="panel score-rule-group" data-rule-group="${esc(group.id)}"${index===0?' open':''}><summary><span class="score-rule-group-title">${fa.format(index+1)}. ${esc(group.title)}</span><span class="score-rule-group-description">${esc(Object.hasOwn(groupSummaries,group.id)?groupSummaries[group.id]:group.description||'تنظیمات و قواعد این بخش.')}</span><small class="score-rule-group-state">${group.fields.some(f=>!f.locked)?'قابل تنظیم':group.fields.some(f=>f.pending)?'نیازمند توسعه':'ثابت / حفاظتی'}</small><span class="score-rule-details"><span class="score-rule-show">نمایش جزئیات</span><span class="score-rule-hide">بستن جزئیات</span></span></summary>${group.description?`<p class="workflow-muted">${esc(group.description)}</p>`:''}<div class="score-rule-fields">${group.fields.map(f=>`<label class="${f.locked?'score-rule-fixed':''}"><span>${esc(window.PanelWorkflow.roleText(f.label))} ${f.pending?'<small class="score-pending">نیازمند توسعه</small>':f.locked?'<small>ثابت</small>':''}</span><select name="rule_${esc(f.key)}"${f.locked?' disabled':''} aria-describedby="rule-help-${esc(f.key)}">${f.options.map(o=>option(o.value,window.PanelWorkflow.roleText(o.label),o.value===data.current.values[f.key])).join('')}</select><small id="rule-help-${esc(f.key)}">${esc(window.PanelWorkflow.roleText(f.help||''))}</small></label>`).join('')}</div></details>`).join('')}</div>
    <section class="panel settings-card"><label>دلیل تغییر <textarea name="reason" rows="2" minlength="5" maxlength="2000" required placeholder="دلیل و هدف تغییر قانون را بنویسید…"></textarea></label><p id="scoreEditing" class="workflow-muted">پیش‌نویس جدید</p><div class="score-rule-toolbar"><button type="submit" class="primary-button">ذخیرهٔ پیش‌نویس</button><button type="button" class="secondary-button" id="scorePreview" disabled>پیش‌نمایش آزمایشی</button><button type="button" class="primary-button" id="scorePublish" disabled>انتشار قانون</button></div><p id="scoreSettingsStatus" role="status" aria-live="polite"></p><div id="scorePreviewResult"></div></section></form>
    <section class="panel settings-card lifecycle-section"><h2>پیش‌نویس‌ها</h2><p class="workflow-muted">برای انتشار هر ردیف، ابتدا پیش‌نمایش آن را بررسی و سپس انتشار را تأیید کنید.</p><div id="scoreDrafts">${draftRows()}</div></section>
    <section class="panel settings-card lifecycle-section"><h2>تاریخچهٔ انتشار</h2><div class="score-history-log">${historyRows()}</div></section>`;
    draft=null;dirty=false;previewHash=null;
    updateEffectDate();
    $('#scoreRulesForm').oninput=event=>{if(event.target.id!=='scoreGroupFilter')invalidate();};
    $('#scoreRulesForm').onchange=event=>{if(event.target.id!=='scoreGroupFilter'){if(event.target.name==='activityKind')applyScope(true);if(event.target.name==='effectiveYear')$('#scoreRulesForm').elements.effectiveSeason.innerHTML=seasonOptions(event.target.value);if(['effectiveYear','effectiveSeason'].includes(event.target.name))updateEffectDate();invalidate();}};
    $('#scoreRulesForm').onsubmit=event=>{event.preventDefault();if(!event.currentTarget.reportValidity())return;write('save',values(),row=>{draft=row;data.drafts=[row,...data.drafts.filter(item=>item.id!==row.id)];$('#scoreDrafts').innerHTML=draftRows();$('#scoreDraftCount').textContent=fa.format(data.drafts.length);dirty=false;previewHash=null;$('#scoreEditing').textContent='پیش‌نویس ذخیره‌شده · ویرایش '+fa.format(row.revision);$('#scorePreview').disabled=false;$('#scorePublish').disabled=true;status('ذخیره شد؛ برای بررسی اثر تغییرات، پیش‌نمایش را اجرا کنید.');});};
    $('#scorePreview').onclick=()=>{if(!draft||dirty)return;write('preview',{id:draft.id,revision:draft.revision},result=>{previewHash=result.previewHash;$('#scorePublish').disabled=false;$('#scorePreviewResult').innerHTML=`<h3>مقایسهٔ قانون مؤثر و پیش‌نویس</h3><p class="workflow-muted">${esc(result.note)}</p><ul>${result.changes.map(c=>`<li>${esc(c.label)}: ${esc(c.before)} ← ${esc(c.after)}</li>`).join('')||'<li>تفاوتی با قانون مؤثر این دامنه ندارد.</li>'}</ul><div class="table-wrap"><table><thead><tr><th>تأخیر پس از ارفاق</th><th>امتیاز فعلی</th><th>امتیاز پیشنهادی</th><th>کسر پیشنهادی</th></tr></thead><tbody>${result.scenarios.map(s=>`<tr><td>${fa.format(s.days)} روز</td><td>${s.beforeClosed?'ارسال بسته':fa.format(s.before.finalScore)}</td><td>${s.afterClosed?'ارسال بسته':fa.format(s.after.finalScore)}</td><td>${fa.format(s.after.deduction)}</td></tr>`).join('')}</tbody></table></div><h3>مثال مالی فرضی (تومان)</h3><div class="table-wrap"><table><thead><tr><th>وضعیت پروژه</th><th>سقف فعلی / پیشنهادی</th><th>دریافتی فعلی / پیشنهادی</th></tr></thead><tbody>${result.amountScenarios.map(s=>`<tr><td>${s.hasProjects?'دارای پروژه':'بدون پروژه'}</td><td>${fa.format(s.before.ceiling)} / ${fa.format(s.after.ceiling)}</td><td>${s.before.earned==null?'نامشخص':fa.format(s.before.earned)} / ${s.after.earned==null?'نامشخص':fa.format(s.after.earned)}</td></tr>`).join('')}</tbody></table></div>`;status('پیش‌نمایش کامل شد؛ مقایسه را بررسی کنید و برای تأیید نهایی، «انتشار قانون» را بزنید. هنوز قانونی منتشر نشده است.');$('#scorePreviewResult').scrollIntoView({block:'center'});});};
    $('#scorePublish').onclick=()=>{if(!draft||dirty||!previewHash)return;write('publish',{id:draft.id,revision:draft.revision,previewHash},async row=>{await load();status('نسخهٔ '+row.id+' منتشر شد. اثر فقط از تاریخ تعیین‌شده؛ سوابق و نتایج قفل‌شده محفوظ‌اند.');});};
    $('#scoreReset').onclick=()=>{fill(data.defaults);invalidate();};
    $('#scoreLoadEffective').onclick=()=>{const f=$('#scoreRulesForm').elements,rows=data.history.filter(r=>r.effectiveDate<=f.effectiveDate.value&&(!r.unitId||r.unitId===f.unitId.value)&&(r.activityKind==='all'||r.activityKind===f.activityKind.value));rows.sort((a,b)=>(Number(!!a.unitId)*2+Number(a.activityKind!=='all'))-(Number(!!b.unitId)*2+Number(b.activityKind!=='all'))||a.effectiveDate.localeCompare(b.effectiveDate)||a.sequence-b.sequence);fill(rows.at(-1)?.values||data.defaults);invalidate();};
    $('#scoreGroupFilter').onchange=event=>{for(const group of data.groups)$(`[data-rule-group="${group.id}"]`).hidden=event.target.value==='editable'?!group.fields.some(f=>!f.locked):event.target.value==='pending'?!group.fields.some(f=>f.pending):false;};
    $('#scoreReload').onclick=()=>{if(!dirty||confirm('تغییرات ذخیره‌نشده کنار گذاشته شوند؟'))load();};

    root.onclick=historyDialog.onclick=event=>{
      const edit=event.target.closest('[data-edit-rule]'),copy=event.target.closest('[data-copy-rule]'),publish=event.target.closest('[data-publish-rule]'),discard=event.target.closest('[data-discard-rule]');
      if(busy||!allowed()||!data)return;
      const details=event.target.closest('[data-history-rule]');if(details){const row=data.history.find(r=>r.id===details.dataset.historyRule);if(row)showHistory(row,details);return;}
      if(edit||copy||publish){
        if(dirty&&!confirm('تغییرات ذخیره‌نشده کنار گذاشته شوند؟'))return;
        const row=copy?data.history.find(r=>r.id===copy.dataset.copyRule):data.drafts.find(r=>r.id===(edit?.dataset.editRule||publish.dataset.publishRule));if(!row)return;
        if(copy)closeHistory();
        draft=copy?null:row;fill(row.values);const f=$('#scoreRulesForm').elements;f.unitId.value=row.unitId||'';f.activityKind.value=row.activityKind;applyScope();selectStoredEffect(row.effectiveDate);f.reason.value=row.reason;invalidate();
        $('#scoreEditing').textContent=copy?'کپی نسخه در پیش‌نویس جدید':'پیش‌نویس انتخاب‌شده · ویرایش '+fa.format(row.revision);
        if(publish){dirty=false;$('#scorePreview').disabled=false;$('#scorePreview').click();}
        $('#scoreRulesForm').scrollIntoView({block:publish?'end':'start'});
      }
      if(discard){
        const row=data.drafts.find(r=>r.id===discard.dataset.discardRule);
        if(row&&confirm('این پیش‌نویس از فهرست حذف شود؟ سابقهٔ ممیزی محفوظ می‌ماند.'+(dirty?' تغییرات ذخیره‌نشدهٔ فرم هم کنار گذاشته می‌شوند.':'')))write('discard',{id:row.id,revision:row.revision},load);
      }
    };
  }
  function applyScope(reset=false){const f=$('#scoreRulesForm').elements;for(const field of data.groups.flatMap(g=>g.fields)){const restricted=f.activityKind.value!=='all'&&!data.activityKeys.includes(field.key);f['rule_'+field.key].disabled=field.locked||restricted;if(reset&&restricted)f['rule_'+field.key].value=field.default;}}
  function fill(values){const f=$('#scoreRulesForm').elements;for(const [key,value]of Object.entries({...data.defaults,...values}))if(f['rule_'+key])f['rule_'+key].value=value;applyScope();}
  function values(){const f=$('#scoreRulesForm').elements;return {id:draft?.id,revision:draft?.revision,unitId:f.unitId.value||null,activityKind:f.activityKind.value,effectiveDate:f.effectiveDate.value,reason:f.reason.value,values:Object.fromEntries(data.groups.flatMap(g=>g.fields).map(field=>[field.key,f['rule_'+field.key].value]))};}
  async function write(action,input,done){if(busy||!allowed())return;const requested=actor,token=generation;busy=true;root.setAttribute('aria-busy','true');const buttons=[...root.querySelectorAll('button,input,select,textarea')],states=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);try{const result=await window.PanelWorkflow.post('/api/org/score-settings/'+action,input);if(requested!==actor||token!==generation)return;buttons.forEach((b,i)=>b.disabled=states[i]);await done(result);}catch(error){if(requested===actor&&token===generation){buttons.forEach((b,i)=>b.disabled=states[i]);status(error.message,true);}}finally{busy=false;root.removeAttribute('aria-busy');}}
  async function load(){closeHistory(false);if(!allowed())return;const token=++generation;actor=window.PanelWorkflow.user.id;root.innerHTML='<p role="status">در حال دریافت قوانین…</p>';try{const result=await window.PanelWorkflow.api('/api/org/score-settings');if(token!==generation||!allowed())return;data=result;render();}catch(error){if(token===generation)root.innerHTML=`<p role="alert">${esc(error.message)}</p><button class="secondary-button" id="retryScoreSettings">تلاش دوباره</button>`;root.querySelector('#retryScoreSettings')?.addEventListener('click',load);}}
  window.addEventListener('panel:session',()=>{closeHistory(false);generation++;actor=null;data=null;draft=null;previewHash=null;dirty=false;root.replaceChildren();});
  window.addEventListener('panel:period',()=>closeHistory(false));
  window.addEventListener('panel:view',event=>{if(event.detail!=='score-settings')closeHistory(false);if(event.detail==='score-settings'&&allowed()&&!data)load();});
  window.PanelScoreSettings={refresh:load,get working(){return busy;}};
})();

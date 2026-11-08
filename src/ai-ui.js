(() => {
  let token, selected, provider='codex', working=false, providerInitialized=false, detailVersion=0, sessionVersion=0,returnAssignmentView='assignments',reviewTimer,quotaTimer;
  const escape=escapeHtml;
  const fieldIcon=id=>icon(id).replace('<svg','<svg aria-hidden="true" focusable="false"');
  const reportDrafts=new Map();
  const humanDrafts=new Map();
  const correctionAnswerDrafts=new Map();
  const pendingFiles=new Map();
  let analysisSelection=null,analysisRenderedKey=null;
  const kinds={task:'تسک',project:'پروژه',routine:'فعالیت روتین'};
  const states={ready:'متن آماده',partial:'بررسی محدود',unsupported:'نیازمند مبدل',needs_conversion:'نیازمند OCR یا تبدیل',failed:'خطای استخراج'};
  const decisions={completed:'انجام‌شده',needs_revision:'نیازمند اصلاح',insufficient:'شواهد ناکافی'};
  const nav=document.createElement('button');nav.className='nav-item';nav.dataset.view='reviews';nav.hidden=true;nav.innerHTML=icon('i-pulse')+'<span>فعالیت‌ها و ارزیابی AI</span>';
  nav.onclick=()=>{showView('reviews');if(!working)refresh().catch(showError);};document.querySelector('.main-nav').append(nav);
  const view=document.createElement('section');view.className='view';view.id='view-reviews';
  view.innerHTML=`<div class="page-heading"><div><p class="eyebrow">ارزیابی مبتنی بر مستندات</p><h1>فعالیت‌ها و ارزیابی هوشمند</h1><p>تعریف خروجی مورد انتظار، دریافت شواهد و تصمیم درباره کیفیت فعالیت.</p></div></div>
  <div class="panel settings-card"><label>ارائه‌دهنده هوش مصنوعی<select id="aiProvider"><option value="codex">Codex — حساب فعلی</option><option value="openai">OpenAI API</option><option value="gemini">Gemini API</option></select></label><p id="aiConnection" role="status">در حال بررسی اتصال…</p><button class="secondary-button" id="aiCheck">بررسی اتصال</button></div>
  <p id="aiStatus" role="status" aria-live="polite"></p>
  <div class="settings-grid"><form id="activityForm" class="panel settings-card"><h2>فعالیت جدید</h2>
    <label>نوع<select name="kind"><option value="task">تسک</option><option value="project">پروژه</option><option value="routine">فعالیت روتین</option></select></label>
    <label>عنوان<input name="title" maxlength="200" required></label><label>دوره / نوبت فعالیت<input name="period" maxlength="200" placeholder="مثلاً گزارش شهریور ۱۴۰۵"></label>
    <label>خروجی مورد انتظار<textarea name="description" maxlength="4000" rows="3"></textarea></label>
    <label>معیارهای پذیرش؛ هر معیار در یک خط<textarea name="criteria" rows="4" required placeholder="گزارش شامل وضعیت هر درخواست باشد&#10;تاریخ انجام و نتیجه نهایی مشخص باشد"></textarea></label>
    <button class="primary-button">ثبت فعالیت</button></form>
    <section class="panel settings-card"><h2>فعالیت‌های ثبت‌شده</h2><div id="activityList"></div></section></div>
  <section id="activityDetail" class="panel settings-card" style="margin-top:18px" hidden></section>`;
  document.querySelector('main').append(view);
  let activityDialog=null,activityBackdrop=null,activityOpener=null,backgroundWasInert=false;
  if(window.PanelWorkflow){
    document.querySelector('#activityForm').hidden=true;
    view.querySelector('.settings-grid').hidden=true;
    view.querySelector('.page-heading h1').textContent='مستندات و ارزیابی شاخص';
    view.querySelector('.page-heading').insertAdjacentHTML('beforeend',`<button type="button" class="secondary-button" id="backToAssignments" aria-label="بازگشت به شاخص‌های روتین و پروژه‌ای">${icon('i-grid')}<span>بازگشت به شاخص‌ها</span></button>`);
    activityDialog=document.createElement('dialog');activityDialog.id='activityDialog';activityDialog.className='activity-dialog';activityDialog.setAttribute('aria-labelledby','activityDialogTitle');activityDialog.setAttribute('aria-modal','true');
    activityDialog.innerHTML='<header class="activity-dialog-header"><h2 id="activityDialogTitle">جزئیات شاخص</h2><button type="button" class="secondary-button" id="closeActivityDialog" aria-label="بستن مستندات شاخص">×</button></header><div class="activity-dialog-body"><details class="activity-connection-settings"><summary>تنظیمات بررسی هوشمند</summary></details></div><footer class="activity-dialog-footer"></footer>';
    activityDialog.querySelector('.activity-connection-settings').append(view.querySelector('#aiProvider').closest('.panel'));
    activityDialog.querySelector('.activity-dialog-body').append(view.querySelector('#aiStatus'),view.querySelector('#activityDetail'));
    activityDialog.querySelector('.activity-dialog-body').append(activityDialog.querySelector('.activity-connection-settings'));
    activityDialog.querySelector('.activity-dialog-footer').append(view.querySelector('#backToAssignments'));document.body.append(activityDialog);
    const back=document.querySelector('#backToAssignments');back.setAttribute('aria-label','بستن مستندات شاخص');back.replaceChildren(document.createTextNode('بستن'));back.onclick=()=>closeActivityDialog();document.querySelector('#closeActivityDialog').onclick=()=>closeActivityDialog();
    activityBackdrop=document.createElement('div');activityBackdrop.className='activity-dialog-backdrop';activityBackdrop.hidden=true;document.body.append(activityBackdrop);activityBackdrop.onclick=()=>closeActivityDialog();
    activityDialog.addEventListener('cancel',event=>{if(event.target!==activityDialog)return;event.preventDefault();closeActivityDialog();});
    activityDialog.addEventListener('click',event=>{if(event.target===activityDialog){const rect=activityDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeActivityDialog();}});
    activityDialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();closeActivityDialog();return;}
      if(event.key!=='Tab')return;const controls=[...activityDialog.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(el=>!el.disabled&&!el.closest('[hidden]')&&(!el.closest('details:not([open])')||el.tagName==='SUMMARY'));
      if(!controls.length){event.preventDefault();return;}const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    });
  }
  function closeActivityDialog(force=false){
    closeActivityAnalysis(false);
    if(!activityDialog?.open)return;if(working&&!force)return;
    if(typeof activityDialog.close==='function')activityDialog.close();else activityDialog.removeAttribute('open');activityBackdrop.hidden=true;document.body.classList.remove('activity-dialog-open');const shell=document.querySelector('.app-shell');if(shell)shell.inert=backgroundWasInert;
    clearTimeout(reviewTimer);clearTimeout(quotaTimer);detailVersion++;selected=null;document.querySelector('#activityDetail').hidden=true;document.querySelector('#activityDetail').replaceChildren();document.querySelector('#aiStatus').textContent='';
    if(!force){if(activityOpener?.isConnected)activityOpener.focus();else document.querySelector(`#view-${returnAssignmentView} summary`)?.focus();}activityOpener=null;
  }
  window.PanelAi={get working(){return working;},open(id,sourceView='assignments',opener=null){if(working)return;closeActivityAnalysis(false);selected=id;returnAssignmentView=sourceView==='projectAssignments'?'projectAssignments':'assignments';
    if(activityDialog){if(!activityDialog.open){activityOpener=opener||document.activeElement;const shell=document.querySelector('.app-shell');backgroundWasInert=shell?.inert||false;if(typeof activityDialog.showModal==='function')activityDialog.showModal();else{activityDialog.setAttribute('open','');activityBackdrop.hidden=false;}if(shell)shell.inert=true;document.body.classList.add('activity-dialog-open');}
      document.querySelector('#aiStatus').textContent='';const panel=document.querySelector('#activityDetail');panel.hidden=false;panel.innerHTML='<p class="workflow-muted">در حال دریافت مشخصات شاخص…</p>';document.querySelector('#activityDialogTitle').textContent='جزئیات شاخص';document.querySelector('#closeActivityDialog').focus();
    }else showView('reviews');detail().catch(showError);connection().catch(showError);}};
  window.addEventListener('panel:session',()=>{closeActivityDialog(true);reportDrafts.clear();correctionAnswerDrafts.clear();pendingFiles.clear();selected=null;returnAssignmentView='assignments';detailVersion++;sessionVersion++;token=null;document.querySelector('#activityDetail').hidden=true;document.querySelector('#activityDetail').replaceChildren();document.querySelector('#activityList').replaceChildren();document.querySelector('#aiStatus').textContent='';});
  window.addEventListener('panel:view',()=>{if(activityDialog?.open)closeActivityDialog();});
  function setWorking(value) {
    working=value;
    [view,activityDialog].filter(Boolean).forEach(root=>root.querySelectorAll('input,textarea,select,button').forEach(el=>{if(value){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else{el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}}));
  }
  async function api(path,options={}) {
    if(window.PanelWorkflow)return window.PanelWorkflow.api(path,options);
    if(!token) {const response=await fetch('/api/session');if(!response.ok)throw new Error('سرور جدید فعال نیست؛ پنل را با pnpm start اجرا کنید.');token=(await response.json()).token;}
    const response=await fetch(path,{...options,headers:{'x-panel-token':token,...options.headers}});
    if(response.status===403)token=null;
    const result=await response.json();if(!response.ok)throw new Error(result.error||'درخواست ناموفق');return result;
  }
  const post=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const showError=error=>{document.querySelector('#aiStatus').textContent=error.message;};
  async function connection() {
    const version=sessionVersion;
    const result=await api('/api/providers');
    if(version!==sessionVersion)return;
    if(!providerInitialized){provider=result.defaultProvider;providerInitialized=true;document.querySelector('#aiProvider').value=provider;}
    const state=result.providers.find(p=>p.provider===provider);
    document.querySelector('#aiConnection').textContent=state?state.message+(state.ready?'':' — آماده نیست'):'ارائه‌دهنده سرور معتبر نیست.';
  }
  async function refresh() {
    const version=sessionVersion;
    const activities=await api('/api/activities');
    if(version!==sessionVersion)return;
    document.querySelector('#activityList').innerHTML=activities.length?activities.map(a=>`<button class="quick-action" style="width:100%" data-activity="${a.id}"><span>${escape(kinds[a.kind])}</span><span><b>${escape(a.title)}</b><small>${escape(a.period)}${a.ownerName?' · '+escape(a.ownerName):''}</small></span></button>`).join(''):'هنوز فعالیتی ثبت نشده است.';
    if(selected)await detail();
    await connection();
  }
  document.querySelector('#aiCheck').onclick=()=>connection().catch(showError);
  document.querySelector('#aiProvider').onchange=e=>{provider=e.target.value;connection().catch(showError);};
  document.querySelector('#activityForm').onsubmit=async e=>{
    e.preventDefault();if(working)return;const data=Object.fromEntries(new FormData(e.target));setWorking(true);
    try {data.criteria=data.criteria.split('\n').map(x=>x.trim()).filter(Boolean);const activity=await post('/api/activities',data);selected=activity.id;e.target.reset();await refresh();}
    catch(error){showError(error);}finally{setWorking(false);}
  };
  document.querySelector('#activityList').onclick=e=>{const button=e.target.closest('[data-activity]');if(button&&!working){selected=button.dataset.activity;detail().catch(showError);}};
  async function detail() {
    clearTimeout(reviewTimer);clearTimeout(quotaTimer);const version=++detailVersion;const data=await api(`/api/activities/${selected}?summary=1`);
    let assignment=data.activity,unitName=window.PanelWorkflow?.accounts.find(person=>person.id===data.activity.ownerId)?.unitName;
    if(window.PanelWorkflow?.user?.id===data.activity.ownerId && /^\d{4}-\d{2}$/.test(data.activity.period)){
      const snapshot=await api('/api/workflow/me?period='+encodeURIComponent(data.activity.period));
      assignment=snapshot.assignments.find(row=>row.id===data.activity.id)||assignment;unitName=snapshot.employee.unitName;
    }
    if(version!==detailVersion)return;const panel=document.querySelector('#activityDetail');panel.hidden=false;
    const latest=data.reviews.find(r=>r.status==='done');let quota=data.submissionQuota,uploadClosed=quota?.canUpload===false;
    const changed=!data.humanFinal&&latest && (data.reviewMatchesCurrentEvidence===undefined?(latest.documentHashes.length!==data.documents.length || data.documents.some(d=>!latest.documentHashes.some(h=>h.sha256===d.sha256&&h.extractionHash===d.extractionHash))):!data.reviewMatchesCurrentEvidence);
    const archivedEvidence=data.reviews.some(r=>r.evidenceDisposition?.archivedDocumentIds?.length)||data.history?.some(r=>r.evidenceDisposition?.archivedDocumentIds?.length);
    const scored=data.scoreAmendment||data.humanFinal||latest&&!changed&&latest.result?.finalForActivity&&Number.isFinite(latest.result.qualityScore),score=data.scoreAmendment?.score??data.humanFinal?.finalScore??(scored?(latest.result.finalScore??latest.result.qualityScore):null);
    const currentReview=data.reviews[0],scoreTone=data.scoreAmendment||data.humanFinal?'approved':currentReview?.status==='failed'?'error':!scored||changed||['queued','running'].includes(currentReview?.status)?'pending':latest.result.decision==='completed'?'approved':latest.result.decision==='needs_revision'?'error':'pending';
    const scoreText=score!=null?fa.format(score)+' از ۱۰۰'+(data.scoreAmendment?' · اصلاح با تأیید ادمین':data.humanFinal?' · تأیید نهایی انسانی':''):currentReview?.status==='failed'?'ناموفق':currentReview?.status==='done'&&currentReview.result?.decision==='insufficient'&&!changed?'شواهد ناکافی':'در انتظار';
    const displayDue=data.deadlineExtension?.dueDate||data.activity.dueDate,timing=data.activity.timeLimit,weekdays=['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
    const timeText=timing?[timing.dayOfMonth!=null?'روز '+fa.format(timing.dayOfMonth)+' ماه':'',timing.dayOfWeek!=null?weekdays[timing.dayOfWeek]:'',timing.time?'ساعت '+window.PanelDate.hourOnly(timing.time):''].filter(Boolean).join(' · '):'';
    panel.innerHTML=`<div class="activity-title-block"><span class="activity-field-label">عنوان شاخص</span><div class="activity-title-heading"><div class="activity-title-line"><span class="activity-title-icon" aria-hidden="true"></span><h2>${escape(data.activity.title)}</h2></div><span class="activity-score-state" data-tone="${scoreTone}"><span>امتیاز بررسی</span><strong>${scoreText}</strong>${score!=null?`<progress max="100" value="${score}" aria-label="امتیاز بررسی"></progress>`:''}</span></div>${data.activity.description?`<p>${escape(data.activity.description)}</p>`:''}</div>
    <section class="activity-info-box" aria-label="اطلاعات شاخص"><div class="activity-task-toolbar"><span class="activity-toolbar-kind"><small>${fieldIcon(data.activity.kind==='project'?'i-folder':'i-file')}نوع شاخص:</small> <strong>${data.activity.kind==='project'?'پروژه‌ای':'روتین'}</strong></span><span class="activity-toolbar-period"><small>${fieldIcon('i-calendar')}دوره:</small> <strong>${escape(data.activity.period?(window.PanelWorkflow?window.PanelWorkflow.monthLabel(data.activity.period):data.activity.period):'ثبت نشده')}</strong></span><span class="activity-attachment-count"><small>${fieldIcon('i-file')}پیوست‌ها</small> <strong>${fa.format(data.documents.length)} پیوست</strong></span><span class="activity-unit-tag"><small>${fieldIcon('i-building')}واحد:</small> <strong>${escape(unitName||'ثبت نشده')}</strong></span></div>
    <div class="activity-detail-meta">${displayDue?`<span><small>${fieldIcon('i-calendar')}مهلت انجام${data.deadlineExtension?' · تمدید مصوب':''}</small><strong>${escape(window.PanelDate.format(displayDue))}</strong></span>`:''}${timeText?`<span><small>${fieldIcon('i-clock')}زمان انجام</small><strong>${escape(timeText)}</strong></span>`:''}${data.activity.frequency?`<span><small>${fieldIcon('i-repeat')}تناوب</small><strong>${escape(data.activity.frequency)}</strong></span>`:''}${data.activity.targetVolume?`<span><small>${fieldIcon('i-hash')}تعداد</small><strong>${fa.format(data.activity.targetVolume)} ${escape(data.activity.targetUnit||'')}</strong></span>`:''}${Number.isFinite(assignment.kpiWeight)?`<span><small>${fieldIcon('i-percent')}سهم نهایی شاخص</small><strong class="activity-normalized-share">${fa.format(Math.round(assignment.kpiWeight))}٪</strong></span>`:''}${data.activity.documentFormat||data.activity.deliverable?`<span><small>${fieldIcon('i-file')}فرمت مستندات</small><strong>${escape(window.PanelDocumentFormats?.[data.activity.documentFormat]||data.activity.deliverable||data.activity.documentFormat)}</strong></span>`:''}</div></section>
    <details class="activity-criteria" open><summary>معیارهای پذیرش</summary><ol>${data.activity.criteria.map(c=>`<li>${escape(c.text)}</li>`).join('')}</ol></details>
    ${renderQuota(quota)}${renderHumanReview(data)}<section class="activity-evidence-box"><h3>ثبت گزارش و مستندات</h3>
    <label class="activity-report-field">گزارش متنی<textarea id="activityReport" rows="3" maxlength="10000" placeholder="شرح انجام کار و نتیجه شاخص را بنویسید…">${escape(reportDrafts.get(data.activity.id)||'')}</textarea></label>
    <p id="pendingActivityFiles" class="activity-evidence-hint">${(pendingFiles.get(data.activity.id)||[]).map(file=>escape(file.name)).join(' · ')}</p>
    <div id="activityDocuments">${data.documents.map(d=>`<div class="activity-document-chip" title="${escape(d.name)} — ${escape(states[d.extraction.status]||d.extraction.status)}">${fieldIcon('i-file')}<span class="activity-document-name" dir="auto">${escape(d.name)}</span><button type="button" class="activity-document-remove" data-detach="${escape(d.id)}" aria-label="حذف پیوست ${escape(d.name)}" title="حذف پیوست">${fieldIcon('i-close')}</button></div>`).join('')||(archivedEvidence?'':'<p class="activity-empty-evidence">هنوز مستندی پیوست نشده است.</p>')}</div>
    <div class="activity-evidence-actions"><label class="activity-attach-control">${icon('i-upload')}<span>پیوست مستندات</span><input type="file" id="activityFiles" multiple aria-label="افزودن مستندات به همین فعالیت"></label><button type="button" id="activityEvidenceHelpToggle" class="secondary-button" aria-expanded="false" aria-controls="activityEvidenceHelp">راهنما</button></div>
    <div id="activityEvidenceHelp" class="activity-evidence-help" hidden><p><strong>ارسال:</strong> گزارش و مدارک مرتبط با معیارهای پذیرش را آماده کنید؛ پس از تأیید مجازبودن مستندات، «ثبت گزارش و ارزیابی با AI» را بزنید.</p><p><strong>فایل‌ها:</strong> هر فایل حداکثر ۲۵ مگابایت؛ مجموع محتوای استخراج‌شده در هر بررسی حداکثر ۵ مگابایت. تصویر و PDF اسکن‌شده به خوانش تصویری فعال نیاز دارند؛ صوت و ویدئو را به فایل قابل‌خواندن تبدیل کنید.</p><p><strong>بررسی:</strong> با ارسال مجاز و فایل قابل‌خواندن، بررسی شروع می‌شود. اگر گزارش یا فایل تازه‌ای انتخاب نکرده باشید، همان پیوست‌های ثبت‌شده بررسی می‌شوند؛ ثبت فایل به‌معنی تأیید یا ثبت نمرهٔ قطعی نیست.</p><p><strong>نتیجه و اصلاح:</strong> ایرادها را در «تاریخچهٔ ارسال و تحلیل» ← «نمایش تحلیل AI» ببینید و گزارش اصلاح‌شده را در مهلت و سهمیهٔ مجاز ارسال کنید.</p><p><strong>بایگانی:</strong> پیوست‌های تأییدنشده ممکن است از فهرست فعال خارج شوند؛ سوابق محفوظ‌اند و بایگانی، سهمیه را بازنشانی نمی‌کند.</p><label class="activity-visual-consent"><input type="checkbox" id="visualEvidenceConsent"><span>اجازه می‌دهم تصویر یا PDF اسکن‌شدهٔ همین ارسال برای خوانش به سرویس بیرون از دستگاه فرستاده شود؛ پیش از تأیید، محتوای حساس را حذف کرده‌ام.</span></label></div>
    <label class="activity-auto-review"><input type="checkbox" id="workEvidence"><span>تأیید می‌کنم مستندات کاری انتخاب‌شده فاقد حقوق، کلید و گفتگوی شخصی و مجاز برای ارسال به مدل هستند.</span></label></section>
    <div style="margin:18px 0"><label>پیوست از مستندات قبلی<select id="existingDoc"><option value="">انتخاب مستند</option>${documents.filter(d=>d.blob).map(d=>`<option value="${d.id}">${escape(d.title||d.name)}</option>`).join('')}</select></label><button class="secondary-button" id="attachExisting">پیوست و پردازش</button></div>
    <div class="activity-review-actions"><div class="activity-review-buttons"><button type="button" class="primary-button" id="submitActivityReport" disabled>ثبت گزارش و ارزیابی با AI</button></div></div>
    ${changed?'<p class="warning-text">مستندات پس از آخرین ارزیابی تغییر کرده‌اند؛ ارزیابی مجدد لازم است.</p>':''}

    <div class="activity-review-results">${renderHistory(data)}</div>`;
    document.querySelectorAll('#activityDetail .activity-info-box strong').forEach(node=>{node.title=node.textContent;});
    renderActivityAnalysis(data);
    bindHumanReview(data);
    if(data.humanReview?.canSubmit||data.humanReview?.row&&['manager_review','hr_review','approved'].includes(data.humanReview.row.status)){
      panel.querySelector('.activity-evidence-box').hidden=true;panel.querySelector('.activity-review-actions').hidden=true;
    }
    const evidenceHelpToggle=panel.querySelector('#activityEvidenceHelpToggle'),evidenceHelp=panel.querySelector('#activityEvidenceHelp');
    evidenceHelpToggle.onclick=()=>{evidenceHelp.hidden=!evidenceHelp.hidden;evidenceHelpToggle.setAttribute('aria-expanded',String(!evidenceHelp.hidden));};
    const report=document.querySelector('#activityReport'),submitReport=document.querySelector('#submitActivityReport');
    const hasReadableEvidence=data.documents.some(d=>d.extraction.chunks?.length),reviewInProgress=data.reviews.some(r=>['queued','running'].includes(r.status));
    const hasNewReport=()=>!!(report.value.trim()||pendingFiles.get(data.activity.id)?.length);
    const updateSubmit=()=>{submitReport.disabled=reviewInProgress||!document.querySelector('#workEvidence').checked||(hasNewReport()?uploadClosed:!hasReadableEvidence);};
    report.oninput=()=>{reportDrafts.set(data.activity.id,report.value);updateSubmit();};
    submitReport.onclick=()=>{if(submitReport.disabled||working)return;if(hasNewReport())upload(pendingFiles.get(data.activity.id)||[]);else run();};
    document.querySelector('#workEvidence').onchange=updateSubmit;
    if(uploadClosed){document.querySelector('#activityFiles').disabled=true;report.disabled=true;document.querySelector('#workEvidence').disabled=!hasReadableEvidence;}
    panel.querySelector('.activity-review-results').onclick=e=>{const definition=e.target.closest('[data-history-definition]');if(definition){openHistoryDialog(data,Number(definition.dataset.historyDefinition),definition,'definition');return;}const analysis=e.target.closest('[data-history-analysis]');if(analysis)openActivityAnalysis(data,Number(analysis.dataset.historyAnalysis),analysis);};
    document.querySelector('#activityDocuments').onclick=async e=>{
      const button=e.target.closest('[data-detach]');if(!button||working||!confirm('این گزارش از شاخص حذف شود؟ نسخه اصلی و تاریخچه برای پیگیری حفظ می‌شوند.'))return;
      setWorking(true);try{await api(`/api/activities/${selected}/documents/${button.dataset.detach}`,{method:'DELETE'});await detail();}catch(error){showError(error);}finally{setWorking(false);}
    };
    document.querySelector('#activityFiles').onchange=e=>{const files=[...e.target.files];pendingFiles.set(data.activity.id,files);document.querySelector('#pendingActivityFiles').textContent=files.map(file=>file.name).join(' · ');updateSubmit();};
    document.querySelector('#attachExisting').onclick=()=>{const doc=documents.find(d=>d.id===Number(document.querySelector('#existingDoc').value));if(doc?.blob)upload([new File([doc.blob],doc.name)]);};
    if(window.PanelWorkflow){
      document.querySelector('#attachExisting').parentElement.hidden=true;
      if(window.PanelWorkflow.user?.id!==data.activity.ownerId){
        document.querySelector('.activity-report-field').hidden=true;
        submitReport.hidden=true;
        submitReport.parentElement.hidden=true;
        document.querySelector('#activityFiles').parentElement.hidden=true;
        document.querySelector('#workEvidence').parentElement.hidden=true;
        panel.querySelectorAll('[data-detach]').forEach(button=>button.hidden=true);
      }
    }
    if(working)panel.querySelectorAll('input,textarea,select,button').forEach(el=>{el.dataset.wasDisabled=String(el.disabled);el.disabled=true;});
    if(quota&&activityDialog?.open){const refreshQuota=()=>{quotaTimer=setTimeout(async()=>{if(version!==detailVersion||selected!==data.activity.id||!activityDialog.open)return;try{if(!working){const nextState=await api('/api/activities/'+data.activity.id+'/quota?humanReview=1'),next=nextState.submissionQuota||nextState,human=nextState.humanReview||data.humanReview;if(version!==detailVersion||!activityDialog.open)return;if(JSON.stringify(human)!==JSON.stringify(data.humanReview)){await detail();return;}if(JSON.stringify(next)!==JSON.stringify(quota)){quota=next;data.submissionQuota=next;uploadClosed=next.canUpload===false;panel.querySelector('.activity-submission-quota').outerHTML=renderQuota(next);document.querySelector('#activityFiles').disabled=uploadClosed;report.disabled=uploadClosed;document.querySelector('#workEvidence').disabled=uploadClosed&&!hasReadableEvidence;updateSubmit();renderActivityAnalysis(data);}}}catch{}if(version===detailVersion&&activityDialog.open)refreshQuota();},10000);};refreshQuota();}
    if(data.reviews.some(r=>['queued','running'].includes(r.status)))reviewTimer=setTimeout(()=>{if(version===detailVersion&&selected===data.activity.id&&!working)detail().catch(showError);},2000);
    return data;
  }
  const humanStates={manager_review:'در انتظار تأیید مدیر',hr_review:'در انتظار تأیید ادمین',needs_revision:'نیازمند تکمیل توضیحات',approved:'نهایی‌شده با تأیید انسانی'};
  function renderHumanReview(data){
    const s=data.humanReview,row=s?.row;if(!s||!row&&!s.canSubmit)return '';
    const status=row?humanStates[row.status]:'پایان پنج نوبت؛ ثبت توضیحات نهایی',managerScore=row?.managerReview?.qualityScore;
    return `<section class="activity-human-review" aria-label="تأیید نهایی انسانی"><h3>تأیید نهایی انسانی</h3><p class="activity-human-status" role="status">${escape(status)}</p><p>توضیحات نهایی پرسنل ← بررسی و امتیاز پیشنهادی مدیر ← تأیید نهایی ادمین و اعمال امتیاز.</p>${s.stale?'<p class="warning-text">تعریف یا شواهد تغییر کرده است؛ درخواست قبلی قابل تأیید نیست.</p>':''}${row?`<details open><summary>توضیحات نهایی پرسنل</summary><p class="activity-human-note">${escape(row.explanation)}</p></details>${row.managerReview?`<p class="activity-human-note"><strong>نظر مدیر:</strong> ${escape(row.managerReview.reason)}${Number.isFinite(managerScore)?`<br>امتیاز کیفیت پیشنهادی: ${fa.format(managerScore)} از ۱۰۰؛ کسر تأخیر طبق قواعد همان نوبت اعمال می‌شود.`:''}</p>`:''}${row.adminReview?`<p class="activity-human-note"><strong>نظر ادمین:</strong> ${escape(row.adminReview.reason)}</p>`:''}${data.humanFinal?`<p><strong>امتیاز نهایی: ${fa.format(data.humanFinal.finalScore)} از ۱۰۰</strong> · کسر تأخیر: ${fa.format(data.humanFinal.deduction)}</p>`:''}<details><summary>مستندات و سوابق تأیید</summary><div class="design-form-actions">${row.documents.map(d=>`<button type="button" class="secondary-button" data-human-document="${escape(d.id)}">دریافت ${escape(d.name)}</button>`).join('')}</div><ol>${row.events.map(e=>`<li><strong>${escape(humanStates[e.status]||e.status)}</strong> · ${escape(window.PanelDate.format(e.at))}<p class="activity-human-note">${escape(e.note)}</p></li>`).join('')}</ol><p>تحلیل‌های AI هر نوبت در تاریخچهٔ پایین همین صفحه در دسترس است.</p></details>`:''}${s.canSubmit?`<form id="activityHumanSubmit"><label>توضیحات نهایی برای مدیر<textarea name="explanation" rows="4" minlength="5" maxlength="10000" required placeholder="نتیجهٔ انجام کار، دلیل رفع‌نشدن ایرادها و ارجاع به مستندات را توضیح دهید…">${escape(humanDrafts.get(data.activity.id)||'')}</textarea></label><button class="primary-button" type="submit">ارسال توضیحات نهایی به مدیر</button></form>`:''}${s.canManagerReview||s.canAdminReview?`<form id="activityHumanDecision">${s.canManagerReview?`<label>امتیاز کیفیت پیشنهادی (۰ تا ۱۰۰)<input name="qualityScore" type="number" min="0" max="100" step="0.1" value="${Number.isFinite(managerScore)?managerScore:''}"></label>`:''}<label>${s.canManagerReview?'توضیح مدیر و مبنای امتیاز':'توضیح بررسی ادمین'}<textarea name="reason" rows="3" minlength="5" maxlength="10000" required></textarea></label><div class="design-form-actions"><button type="submit" class="primary-button" value="approve">${s.canManagerReview?'تأیید و ارسال به ادمین':'تأیید نهایی و اعمال امتیاز'}</button><button type="submit" class="secondary-button" value="return">${s.canManagerReview?'بازگشت برای تکمیل توضیحات':'بازگشت به مدیر'}</button></div></form>`:''}<p id="activityHumanMessage" role="status" aria-live="polite"></p></section>`;
  }
  function bindHumanReview(data){
    const section=document.querySelector('#activityDetail .activity-human-review');if(!section)return;
    const submit=section.querySelector('#activityHumanSubmit'),decision=section.querySelector('#activityHumanDecision'),row=data.humanReview.row,version=sessionVersion;
    if(submit)submit.elements.explanation.oninput=()=>humanDrafts.set(data.activity.id,submit.elements.explanation.value);
    const perform=async(path,input)=>{if(working)return;setWorking(true);try{await post(`/api/activities/${data.activity.id}/human-review/${path}`,input);if(version!==sessionVersion)return;humanDrafts.delete(data.activity.id);await detail();window.dispatchEvent(new CustomEvent('panel:reviewed'));refreshHumanInbox().catch(showError);}catch(error){if(version===sessionVersion)section.querySelector('#activityHumanMessage').textContent=error.message;}finally{setWorking(false);}};
    if(submit)submit.onsubmit=e=>{e.preventDefault();perform('submit',{explanation:submit.elements.explanation.value,revision:row?.revision});};
    if(decision)decision.onsubmit=e=>{e.preventDefault();const choice=e.submitter?.value;if(!choice)return;const score=decision.elements.qualityScore;if(choice==='approve'&&score&&score.value.trim()===''){section.querySelector('#activityHumanMessage').textContent='امتیاز پیشنهادی را وارد کنید.';score.focus();return;}perform('decision',{requestId:row.id,revision:row.revision,decision:choice,reason:decision.elements.reason.value,...(score&&choice==='approve'?{qualityScore:Number(score.value)}:{})});};
    section.onclick=async e=>{const b=e.target.closest('[data-human-document]');if(!b||working)return;const d=row.documents.find(d=>d.id===b.dataset.humanDocument);if(!d)return;b.disabled=true;try{await window.PanelWorkflow.download(`/api/activities/${data.activity.id}/human-review/documents/${d.id}`,d.name);}catch(error){section.querySelector('#activityHumanMessage').textContent=error.message;}finally{b.disabled=false;}};
  }
  let humanInboxVersion=0;
  async function refreshHumanInbox(){
    const version=++humanInboxVersion,actor=window.PanelWorkflow?.user;
    document.querySelectorAll('[data-human-inbox]').forEach(p=>p.hidden=true);
    if(!['manager','hr'].includes(actor?.role))return;
    const parent=document.querySelector(actor.role==='hr'?'#view-incoming':'#view-position-review');if(!parent)return;
    let panel=parent.querySelector('[data-human-inbox]');if(!panel){panel=document.createElement('section');panel.className='panel settings-card';panel.dataset.humanInbox='';parent.querySelector('.page-heading').after(panel);}
    panel.hidden=false;panel.innerHTML='<h2>تأیید نهایی گزارش شاخص‌ها</h2><p role="status">در حال دریافت درخواست‌ها…</p>';
    try{const rows=await api('/api/activity-human-reviews');if(version!==humanInboxVersion||window.PanelWorkflow.user?.id!==actor.id)return;
      const pending=actor.role==='hr'?'hr_review':'manager_review';rows.sort((a,b)=>Number(b.status===pending)-Number(a.status===pending)||b.updatedAt.localeCompare(a.updatedAt));
      panel.innerHTML='<h2>تأیید نهایی گزارش شاخص‌ها</h2><p>درخواست‌های پس از پایان سهمیه و سوابق تأیید انسانی؛ همهٔ دوره‌ها.</p>'+ (rows.length?rows.map(r=>`<article class="activity-human-inbox-item"><div><strong>${escape(r.employeeName)} · ${escape(r.title)}</strong><p>${escape(window.PanelWorkflow.monthLabel(r.period))} · ${escape(humanStates[r.status])}</p></div><button type="button" class="secondary-button" data-human-open="${escape(r.activityId)}">بررسی و جزئیات</button></article>`).join(''):'<p>درخواستی ثبت نشده است.</p>');
      panel.onclick=e=>{const b=e.target.closest('[data-human-open]');if(b)window.PanelAi.open(b.dataset.humanOpen,actor.role==='hr'?'incoming':'position-review',b);};
    }catch(error){if(version===humanInboxVersion)panel.innerHTML=`<h2>تأیید نهایی گزارش شاخص‌ها</h2><p role="alert">${escape(error.message)}</p><button type="button" class="secondary-button" data-human-retry>تلاش دوباره</button>`;panel.onclick=e=>{if(e.target.closest('[data-human-retry]'))refreshHumanInbox();};}
  }
  window.addEventListener('panel:session',()=>{humanDrafts.clear();refreshHumanInbox();});
  window.addEventListener('panel:view',e=>{if(['incoming','position-review'].includes(e.detail))refreshHumanInbox();});
  if(window.PanelWorkflow?.user)refreshHumanInbox();
  function renderQuota(q){if(!q)return '';const help='شامل ارسال اول و اصلاح‌ها؛ چند فایل یک گزارش یک نوبت است. خطای پردازش و cache سهمیه تازه مصرف نمی‌کنند. سقف از تنظیمات امتیاز ادمین اعمال می‌شود.'+(q.blockedReason?' '+q.blockedReason:'');return `<section class="activity-submission-quota" aria-label="سهمیه ارسال گزارش" aria-description="${escape(help)}" title="${escape(help)}" tabindex="0" data-blocked="${q.canUpload===false}"><strong>سهمیه: ${q.limit==null?'نامحدود':fa.format(q.limit)+' نوبت'}</strong><span>مصرف: ${fa.format(q.used)}</span>${q.pending?'<span>در صف: '+fa.format(q.pending)+'</span>':''}<span>باقی: ${q.remaining==null?'نامحدود':fa.format(q.remaining)}</span>${q.blockedReason?'<span class="quota-closed" role="status">'+(q.remaining===0?'سقف تکمیل':'ارسال بسته')+'</span>':''}</section>`;}
  function historyRows(data){return data.history?.length?data.history:data.reviews.map(r=>({id:'review:'+r.id,kind:'analysis',reviewId:r.id,status:r.status==='done'?r.result?.decision:r.status,finalScore:r.result?.finalScore??r.result?.qualityScore??null,createdAt:r.createdAt||r.startedAt||r.finishedAt,files:r.documentHashes||[]}));}
  const activityAnalysisDialog=document.createElement('dialog');activityAnalysisDialog.id='activityAnalysisDialog';activityAnalysisDialog.className='activity-dialog activity-analysis-dialog';activityAnalysisDialog.setAttribute('aria-labelledby','activityAnalysisTitle');activityAnalysisDialog.setAttribute('aria-modal','true');
  activityAnalysisDialog.innerHTML='<header class="activity-dialog-header"><div><h2 id="activityAnalysisTitle">تحلیل هوش مصنوعی گزارش</h2><p id="activityAnalysisMeta" class="workflow-muted"></p></div><button type="button" class="secondary-button" data-close-activity-analysis aria-label="بستن تحلیل گزارش">×</button></header><div class="activity-dialog-body"></div><footer class="activity-dialog-footer"><button type="button" class="secondary-button" data-close-activity-analysis>بستن</button></footer>';document.body.append(activityAnalysisDialog);
  const activityAnalysisBackdrop=document.createElement('div');activityAnalysisBackdrop.className='activity-dialog-backdrop activity-analysis-backdrop';activityAnalysisBackdrop.hidden=true;document.body.append(activityAnalysisBackdrop);
  function closeActivityAnalysis(restoreFocus=true){
    if(!analysisSelection&&!activityAnalysisDialog.open)return;const previous=analysisSelection;analysisSelection=null;analysisRenderedKey=null;
    if(typeof activityAnalysisDialog.close==='function'&&activityAnalysisDialog.open)activityAnalysisDialog.close();else activityAnalysisDialog.removeAttribute('open');activityAnalysisBackdrop.hidden=true;document.body.classList.remove('activity-analysis-open');if(activityDialog)activityDialog.inert=previous?.parentInert||false;
    activityAnalysisDialog.querySelector('.activity-dialog-body').replaceChildren();document.querySelector('#activityAnalysisMeta').textContent='';
    if(restoreFocus&&previous){const rows=previous.data&&historyRows(previous.data),index=rows?.findIndex(item=>item.id===previous.itemId),opener=previous.opener?.isConnected?previous.opener:document.querySelector('['+(previous.mode==='definition'?'data-history-definition':'data-history-analysis')+'="'+index+'"]');opener?.focus();}
  }
  function renderActivityAnalysis(data){
    if(!analysisSelection)return;const rows=historyRows(data),index=rows.findIndex(row=>row.id===analysisSelection.itemId),item=rows[index];if(data.activity.id!==analysisSelection.activityId||!item){closeActivityAnalysis(false);return;}
    analysisSelection.data=data;
    if(analysisSelection.mode==='definition'){renderActivityDefinition(data,item,index,rows.length);return;}
    const summary=data.reviews.find(row=>row.id===item.reviewId),reportKey=summary?.id+':'+summary?.reportVersion;
    if(summary?.summaryOnly&&analysisSelection.reviewKey!==reportKey){
      const state=analysisSelection,body=activityAnalysisDialog.querySelector('.activity-dialog-body');
      document.querySelector('#activityAnalysisMeta').textContent=data.activity.title+' · نوبت '+fa.format(rows.length-index);
      if(state.loadingKey===reportKey)return;
      state.loadingKey=reportKey;state.review=null;state.correctionKey=null;analysisRenderedKey=null;
      body.innerHTML='<p class="workflow-muted" role="status">در حال دریافت تحلیل این نوبت…</p>';
      api('/api/activities/'+encodeURIComponent(data.activity.id)+'/reviews/'+encodeURIComponent(summary.id)).then(review=>{
        if(analysisSelection!==state||state.loadingKey!==reportKey)return;
        state.review=review;state.reviewKey=reportKey;renderActivityAnalysis(state.data);
      }).catch(error=>{
        if(analysisSelection!==state||state.loadingKey!==reportKey)return;
        body.innerHTML='<p role="alert">'+escape(error.message||'دریافت تحلیل انجام نشد.')+'</p><button type="button" class="secondary-button" data-retry-history-analysis>تلاش دوباره</button>';
      });return;
    }
    const review=summary?.summaryOnly?analysisSelection.review:summary,result=review?.status==='done'?review.result:null,key=JSON.stringify([item,review,data.submissionQuota,canDraftActivityCorrection(data,item,review)]);if(key===analysisRenderedKey)return;analysisRenderedKey=key;
    const section=(title,content,tone='info')=>'<section class="activity-analysis-section" data-tone="'+tone+'"><h3>'+title+'</h3>'+content+'</section>',criteria=result?.criteria||[],issues=criteria.filter(c=>c.status!=='met'),snapshot=review?.activitySnapshot;
    document.querySelector('#activityAnalysisMeta').textContent=(snapshot?.title||data.activity.title)+' · نوبت '+fa.format(rows.length-index)+(item.createdAt?' · '+window.PanelDate.formatDateTime(item.createdAt):'');
    let content=section('دربارهٔ این تحلیل','<p>این گزارش مربوط به همین نوبت و شواهد ثبت‌شدهٔ آن است. نمایش آن بررسی تازه‌ای اجرا نمی‌کند و امتیاز یا تصمیمی را تغییر نمی‌دهد.</p>');
    const progress=review?.fileProcessing,diagnostic=progress?.diagnostic;
    if(progress&&Number.isFinite(progress.totalParts))content+=section('پیشرفت خواندن فایل','<p>'+fa.format(progress.readParts||0)+' از '+fa.format(progress.totalParts)+' بخش خوانده شده است.</p>'+(diagnostic?'<p>'+escape(diagnostic.stage==='reporting'?'مرحلهٔ تهیهٔ گزارش نهایی':'بخش '+fa.format(diagnostic.part)+' از '+fa.format(diagnostic.totalParts))+' · '+escape(diagnostic.message)+'</p><p>تلاش این مرحله: '+fa.format(progress.phase==='repairing'?diagnostic.nextAttempt||diagnostic.attempt:diagnostic.attempt)+' از '+fa.format(diagnostic.maxAttempts)+'</p>':'')+(progress.phase==='repairing'?'<p>پاسخ نامعتبر مدل در همین مرحله دوباره بررسی می‌شود؛ صحت شواهد همچنان الزامی است.</p>':''),progress.phase==='failed'||progress.phase==='repairing'?'warning':'info');
    if(review?.resumeAvailable&&window.PanelWorkflow?.user?.id===data.activity.ownerId&&!working)content+=section('ادامهٔ بررسی نیمه‌تمام','<p>بخش‌های معتبر قبلی دوباره تحلیل نمی‌شوند؛ پیش از ادامه، یکسان‌بودن فایل‌ها، شاخص و مدل کنترل می‌شود. این کار بررسی AI را دوباره اجرا می‌کند.</p><button type="button" class="primary-button" data-resume-review="'+escape(review.id)+'">ادامه از بخش '+fa.format((progress?.readParts||0)+1)+'</button>');
    if(result){
      content+=section('نتیجهٔ این نوبت','<p><strong>'+escape(decisions[result.decision]||result.decision||'نامشخص')+'</strong></p><p>'+escape(result.summary||'خلاصه‌ای ثبت نشده است.')+'</p>',result.decision==='completed'?'success':'warning');
      content+=section('نواقص و ایرادهای گزارش',issues.length?issues.map(c=>{const criterion=snapshot?.criteria?.find(row=>row.id===c.id);return '<article class="activity-analysis-finding"><h4>'+escape(c.id)+(criterion?.text?' · '+escape(criterion.text):'')+'</h4><strong>'+escape(c.status==='unmet'?'نیازمند اصلاح':c.status==='insufficient'?'شواهد ناکافی':c.status)+'</strong><p>'+escape(c.reason||'دلیل جزئی ثبت نشده است.')+'</p></article>';}).join(''):'<p>'+(result.decision==='completed'?'ایراد یا کمبود شاهدی در معیارهای این نوبت ثبت نشده است.':'جزئیات ایرادها در معیارهای این نوبت ثبت نشده است؛ خلاصهٔ نتیجه را بررسی کنید.')+'</p>','warning');
      if(result.coverage?.incomplete||result.coverage?.omittedChunks>0||result.fileProcessing?.complete===false)content+=section('محدودیت شواهد','<p>پوشش مستندات این نوبت ناقص است؛ بخش‌های ناخوانده یا حذف‌شده را نمی‌توان شاهد تأیید دانست.</p>','warning');
      content+=activityCorrectionHtml(data,item,review);
      content+='<details class="activity-analysis-section activity-analysis-details"><summary><span>همهٔ معیارها، شواهد و جزئیات ارزیابی</span><span class="activity-correction-cue">نمایش جزئیات</span></summary>'+renderReview(review,[])+'</details>';
    }else if(review?.status==='failed'||item.status==='failed'||item.status==='blocked'){
      content+=section('خطای پردازش یا اجرای تحلیل','<p>برای این نوبت نتیجهٔ معتبر تحلیل ثبت نشده است. خطای فنی به‌تنهایی به معنی وجود ایراد در گزارش یا شاخص نیست؛ علت عدم تأیید محتوایی از آن قابل نتیجه‌گیری نیست.</p><p class="activity-analysis-error">'+escape(review?.error||item.error||'علت دقیق خطا در این نوبت ثبت نشده است.')+'</p>','error');
    }else content+=section('وضعیت تحلیل',review?renderReview(review,[]):'<p>هنوز نتیجهٔ تحلیلی برای این نوبت ثبت نشده است.</p>');
    content+=section('مستندات همین نوبت','<ul>'+((item.files||review?.documentHashes||[]).map(file=>'<li>'+escape(file.name||file.id)+'</li>').join('')||'<li>نام مستندی برای این نوبت ثبت نشده است.</li>')+'</ul>');
    const body=activityAnalysisDialog.querySelector('.activity-dialog-body');body.innerHTML=content;body.scrollTop=0;
  }
  function renderActivityDefinition(data,item,index,total){
    const state=analysisSelection,body=activityAnalysisDialog.querySelector('.activity-dialog-body');
    const summary=data.reviews.find(row=>row.id===item.reviewId),reviewKey=item.reviewId;
    if(reviewKey&&!summary?.activitySnapshot&&state.definitionKey!==reviewKey){
      if(state.definitionLoadingKey===reviewKey)return;
      state.definitionLoadingKey=reviewKey;
      document.querySelector('#activityAnalysisMeta').textContent='نوبت '+fa.format(total-index);
      body.innerHTML='<p class="workflow-muted" role="status">در حال دریافت مشخصات شاخص در این نوبت…</p>';
      api('/api/activities/'+encodeURIComponent(data.activity.id)+'/reviews/'+encodeURIComponent(reviewKey)).then(review=>{
        if(analysisSelection!==state||state.definitionLoadingKey!==reviewKey)return;
        state.definitionReview=review;state.definitionKey=reviewKey;renderActivityAnalysis(state.data);
      }).catch(error=>{
        if(analysisSelection!==state||state.definitionLoadingKey!==reviewKey)return;
        body.innerHTML='<p role="alert">'+escape(error.message||'دریافت جزئیات شاخص انجام نشد.')+'</p><button type="button" class="secondary-button" data-retry-history-definition>تلاش دوباره</button>';
      });return;
    }
    const recorded=summary?.activitySnapshot||state.definitionReview?.activitySnapshot,snapshot=recorded||data.activity;
    const renderKey=JSON.stringify(['definition',item.id,snapshot,!!recorded]);if(analysisRenderedKey===renderKey)return;analysisRenderedKey=renderKey;
    document.querySelector('#activityAnalysisMeta').textContent=(snapshot.title||'شاخص')+' · نوبت '+fa.format(total-index)+(item.createdAt?' · '+window.PanelDate.formatDateTime(item.createdAt):'');
    const display=value=>value==null||value===''?'ثبت نشده':typeof value==='object'?JSON.stringify(value):String(value);
    const section=(title,content)=>'<section class="activity-analysis-section activity-definition-section"><h3>'+title+'</h3>'+content+'</section>';
    const timing=snapshot.timeLimit,weekdays=['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
    const schedule=timing?[timing.dayOfMonth!=null?'روز '+fa.format(timing.dayOfMonth)+' ماه':'',timing.dayOfWeek!=null?weekdays[timing.dayOfWeek]:'',timing.time?'ساعت '+window.PanelDate.hourOnly(timing.time):''].filter(Boolean).join(' · '):null;
    const fields=[['نوع شاخص',kinds[snapshot.kind]||snapshot.kind],['دوره',snapshot.period?(window.PanelWorkflow?.monthLabel?.(snapshot.period)||snapshot.period):null],['تناوب',snapshot.frequency],['مهلت انجام',snapshot.dueDate?window.PanelDate.formatDateTime(snapshot.dueDate):null],['زمان انجام',schedule],['تعداد و واحد هدف',snapshot.targetVolume!=null?fa.format(snapshot.targetVolume)+' '+(snapshot.targetUnit||''):null],['قالب مستندات',snapshot.documentFormat]];
    if(snapshot.designVersion!=null)fields.push(['نسخهٔ تعریف شاخص',fa.format(snapshot.designVersion)]);
    if(snapshot.positionVersion!=null)fields.push(['نسخهٔ سمت',fa.format(snapshot.positionVersion)]);
    const criteria=Array.isArray(snapshot.criteria)?snapshot.criteria:[];
    body.innerHTML='<p class="activity-definition-notice"'+(recorded?'':' role="status"')+'>'+escape(recorded?'مشخصات ثبت‌شدهٔ شاخص هنگام بررسی همین نوبت.':'نسخهٔ تاریخی شاخص برای این نوبت در دسترس نیست؛ مشخصات فعلی شاخص در زیر نمایش داده می‌شود.')+'</p>'+
      section('عنوان شاخص','<p>'+escape(display(snapshot.title))+'</p>')+
      section('شرح، هدف و مسئولیت','<p class="activity-definition-description">'+escape(display(snapshot.description))+'</p>')+
      section('مشخصات شاخص','<dl class="activity-definition-fields">'+fields.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escape(display(value))+'</dd></div>').join('')+'</dl>')+
      (snapshot.deliverable?section('خروجی مورد انتظار','<p class="activity-definition-description">'+escape(display(snapshot.deliverable))+'</p>'):'')+
      section('معیارهای پذیرش',criteria.length?'<ol>'+criteria.map(c=>'<li>'+escape(display(typeof c==='string'?c:c.text))+'</li>').join('')+'</ol>':'<p>معیار پذیرش در این نسخه ثبت نشده است.</p>');
  }
  function activityCorrectionItems(review){
    const result=review?.status==='done'?review.result:null;if(!result)return [];
    const items=(result.criteria||[]).filter(c=>c.status!=='met').map(c=>({id:c.id,status:c.status,reason:c.reason||'دلیل جزئی ثبت نشده است.',text:review.activitySnapshot?.criteria?.find(row=>row.id===c.id)?.text||c.id}));
    if(!items.length&&(result.decision!=='completed'||result.coverage?.incomplete||result.coverage?.omittedChunks>0||result.fileProcessing?.complete===false))items.push({id:'report',status:result.decision==='needs_revision'?'unmet':'insufficient',reason:result.summary||'پوشش یا اطلاعات مستندات کامل نیست.',text:'جمع‌بندی همین بررسی'});
    return items;
  }
  function analysisReview(data,item){
    const summary=data?.reviews.find(row=>row.id===item?.reviewId);
    return summary?.summaryOnly?(analysisSelection?.reviewKey===summary.id+':'+summary.reportVersion?analysisSelection.review:null):summary;
  }
  function canDraftActivityCorrection(data,item,review){
    const actor=window.PanelWorkflow?.user,definitionKeys=['kind','title','description','period','criteria','ownerId','unitId','assignmentStatus','positionId','positionVersion','designId','designVersion','dueDate','timeLimit','frequency','targetVolume','targetUnit','documentFormat','deliverable'],currentDefinition=review?.activitySnapshot&&definitionKeys.every(key=>JSON.stringify(review.activitySnapshot[key]??null)===JSON.stringify(data.activity[key]??null));
    return !!(actor?.role==='personnel'&&actor.id===data.activity.ownerId&&!actor.isSettled&&selected===data.activity.id&&!working&&currentDefinition&&review?.status==='done'&&review.result?.decision!=='completed'&&data.reviews[0]?.id===review.id&&historyRows(data)[0]?.id===item.id&&!data.reviews.some(r=>['queued','running'].includes(r.status))&&data.submissionQuota?.canUpload===true);
  }
  function activityCorrectionHtml(data,item,review){
    const items=activityCorrectionItems(review);analysisSelection.correctionKey=null;if(!items.length)return '';
    const editable=canDraftActivityCorrection(data,item,review),needs=items.filter(row=>row.status==='insufficient'),key=JSON.stringify([window.PanelWorkflow?.user?.id,data.activity.id,review.id,items]);
    let draft=correctionAnswerDrafts.get(key);if(editable&&!draft){draft={answers:items.map(()=>''),appliedText:null};correctionAnswerDrafts.set(key,draft);}if(editable)analysisSelection.correctionKey=key;
    const panel=(title,content,tone,extra='')=>'<details class="activity-analysis-section activity-correction-section '+extra+'" data-tone="'+tone+'"><summary>'+title+' <span class="activity-correction-cue">نمایش جزئیات</span></summary>'+content+'</details>';
    let html=needs.length?panel('اطلاعات لازم برای ادامه','<p>کمبودهای زیر در توضیحات همین بررسی ثبت شده‌اند؛ اطلاعات کاری و مدرک مرتبط را کامل کنید.</p><ul>'+needs.map(row=>'<li><strong>'+escape(row.id)+' · '+escape(row.text)+'</strong><p>'+escape(row.reason)+'</p></li>').join('')+'</ul>','warning'):'';
    html+=panel('پاسخ به ابهام‌های گزارش و شاخص','<p>این پاسخ‌ها توضیح گزارش‌اند؛ معیارهای شاخص یا نتیجهٔ قبلی را تغییر نمی‌دهند. پاسخِ بدون مدرک، تأیید خودکار محسوب نمی‌شود.</p>'+(editable?'<form id="activityCorrectionForm" novalidate>'+items.map((row,index)=>'<label class="activity-correction-answer" for="activityCorrectionAnswer-'+index+'"><strong>'+escape(row.id)+' · '+escape(row.text)+'</strong><span>'+escape(row.reason)+'</span><textarea id="activityCorrectionAnswer-'+index+'" data-correction-answer="'+index+'" rows="3" maxlength="2000" placeholder="اطلاعات تکمیلی، توضیح اصلاح و محل مدرک مرتبط…">'+escape(draft.answers[index]||'')+'</textarea></label>').join('')+'<p class="workflow-muted">فقط اطلاعات کاری، بدون حقوق، اطلاعات تماس یا رمز. پاسخ‌های خالی همچنان نیازمند تکمیل‌اند. این پاسخ‌ها هنوز ارسال نشده‌اند؛ ثبت آن‌ها فقط با ارسال گزارش انجام می‌شود.</p><p id="activityCorrectionStatus" role="alert" aria-live="polite"></p><button type="submit" class="secondary-button">افزودن پاسخ‌ها به پیش‌نویس گزارش</button></form>':'<p class="workflow-muted">پاسخ تازه فقط برای صاحب گزارش در آخرین نوبت و با امکان ارسال مجاز است. این نوبت یا دسترسی فعلی فقط برای مشاهده است.</p>'),'success');
    html+=panel('پیشنهاد اصلاحات','<p>راهنمای اصلاح بر اساس ایرادهای ثبت‌شده است؛ پیشنهاد مستقل تازه‌ای از AI تولید نشده و تغییری خودکار اعمال نمی‌شود.</p><ol>'+items.map(row=>'<li><strong>'+escape(row.id)+' · '+escape(row.text)+'</strong><p>'+escape(row.status==='unmet'?'خروجی مربوط به این معیار را اصلاح کنید و مدرک اصلاح‌شده را ارائه دهید.':'اطلاعات و شواهد مربوط به این کمبود را کامل کنید؛ توضیح متنی به‌تنهایی جای مدرک انجام کار را نمی‌گیرد.')+'</p></li>').join('')+'</ol>'+(editable?'<button type="button" class="secondary-button" data-edit-corrected-report>ویرایش گزارش و پیوست مستند اصلاحی</button>':'')+'<p class="workflow-muted">پس از بازبینی پیش‌نویس و پیوست مستندات، مجازبودن شواهد را تأیید و «ثبت گزارش و ارزیابی با AI» را خودتان انتخاب کنید؛ مدل فقط در آن مرحله دوباره اجرا می‌شود.</p>','info','activity-correction-guidance');
    return html;
  }
  function focusCorrectedReport(){closeActivityAnalysis(false);const field=document.querySelector('#activityReport');field?.focus();field?.scrollIntoView?.({block:'center',behavior:'smooth'});}
  activityAnalysisDialog.addEventListener('input',event=>{
    const input=event.target.closest('[data-correction-answer]'),draft=correctionAnswerDrafts.get(analysisSelection?.correctionKey);if(!input||!draft)return;draft.answers[Number(input.dataset.correctionAnswer)]=input.value;const status=document.querySelector('#activityCorrectionStatus');if(status)status.textContent='';
  });
  activityAnalysisDialog.addEventListener('submit',async event=>{
    if(event.target.id!=='activityCorrectionForm')return;event.preventDefault();const state=analysisSelection,data=state?.data,item=data&&historyRows(data).find(row=>row.id===state.itemId),review=analysisReview(data,item),draft=correctionAnswerDrafts.get(state?.correctionKey),status=document.querySelector('#activityCorrectionStatus'),field=document.querySelector('#activityReport');
    if(!draft||!item||!canDraftActivityCorrection(data,item,review)||!field||field.disabled||field.hidden){if(status)status.textContent='این نوبت یا امکان ارسال تغییر کرده است؛ وضعیت جاری را دوباره بررسی کنید.';return;}
    const items=activityCorrectionItems(review),answered=items.map((row,index)=>({...row,answer:(draft.answers[index]||'').trim()})).filter(row=>row.answer);
    if(!answered.length){status.textContent='حداقل یک پاسخ را وارد کنید.';return;}if(answered.some(row=>row.answer.length>2000)){status.textContent='هر پاسخ حداکثر ۲۰۰۰ نویسه است.';return;}
    const form=event.target;if(form.dataset.preparing==='true')return;const actorId=window.PanelWorkflow?.user?.id,button=form.querySelector('button[type="submit"]');form.dataset.preparing='true';button.disabled=true;
    try{
      const fresh=await api('/api/activities/'+encodeURIComponent(data.activity.id)+'?summary=1');
      if(analysisSelection!==state||window.PanelWorkflow?.user?.id!==actorId||!form.isConnected||!field.isConnected)return;
      const freshItem=historyRows(fresh).find(row=>row.id===state.itemId),freshSummary=fresh.reviews.find(row=>row.id===freshItem?.reviewId),freshReview=freshSummary?.summaryOnly?await api('/api/activities/'+encodeURIComponent(data.activity.id)+'/reviews/'+encodeURIComponent(freshSummary.id)):freshSummary,freshKey=JSON.stringify([actorId,fresh.activity.id,freshReview?.id,activityCorrectionItems(freshReview)]);
      if(analysisSelection!==state||window.PanelWorkflow?.user?.id!==actorId||!form.isConnected||!field.isConnected)return;
      if(!freshItem||!canDraftActivityCorrection(fresh,freshItem,freshReview)||freshKey!==state.correctionKey){status.textContent='تعریف، نوبت یا امکان ارسال تغییر کرده است؛ پنجرهٔ شاخص را دوباره باز کنید.';return;}
      state.data=fresh;
    const block='اطلاعات تکمیلی صاحب گزارش برای بررسی دوباره؛ این متن تأیید خودکار نیست.\n'+answered.map(row=>row.id+' · '+row.text+'\nپاسخ: '+row.answer).join('\n\n'),before=field.value;
    if(draft.appliedText&&!before.includes(draft.appliedText)&&!before.includes(block)){status.textContent='پاسخ قبلی در متن پیش‌نویس ویرایش یا حذف شده است؛ برای جلوگیری از بازنویسی، متن گزارش را دستی بازبینی کنید.';return;}
    const combined=before.includes(block)?before:draft.appliedText?before.replace(draft.appliedText,block):before+(before?'\n\n':'')+block;
    if(combined.length>10000){status.textContent='گزارش همراه با پاسخ‌ها از سقف ۱۰٬۰۰۰ نویسه بیشتر است؛ متن را کوتاه کنید.';return;}
    draft.appliedText=block;field.value=combined;field.dispatchEvent(new Event('input',{bubbles:true}));const consent=document.querySelector('#workEvidence');if(consent){consent.checked=false;consent.dispatchEvent(new Event('change',{bubbles:true}));}focusCorrectedReport();
    }catch(error){if(analysisSelection===state&&form.isConnected)status.textContent=error.message||'بررسی وضعیت جاری انجام نشد؛ پیش‌نویس تغییری نکرد.';}
    finally{if(form.isConnected){delete form.dataset.preparing;button.disabled=false;}}
  });
  async function resumeFailedReview(button){
    const state=analysisSelection,activityId=state?.activityId,actorId=window.PanelWorkflow?.user?.id;if(!state||working||button.disabled)return;
    const item=historyRows(state.data).find(row=>row.id===state.itemId),review=analysisReview(state.data,item);if(!review?.resumeAvailable||review.id!==button.dataset.resumeReview)return;
    if(!confirm('بررسی از بخش بعدی ادامه یابد؟ این کار از سرویس AI استفاده می‌کند و بخش‌های معتبر قبلی حفظ می‌شوند.'))return;
    button.disabled=true;setWorking(true);
    try{await post('/api/activities/'+activityId+'/reviews',{resumeReviewId:review.id});if(selected===activityId&&window.PanelWorkflow?.user?.id===actorId){if(analysisSelection===state)closeActivityAnalysis();await detail();document.querySelector('#aiStatus').textContent='ادامهٔ بررسی در صف ثبت شد؛ بخش‌های معتبر قبلی دوباره تحلیل نمی‌شوند.';}}
    catch(error){if(analysisSelection===state){const status=document.createElement('p');status.setAttribute('role','alert');status.textContent=error.message||'ادامهٔ بررسی انجام نشد.';button.parentElement.append(status);}else if(selected===activityId&&window.PanelWorkflow?.user?.id===actorId)showError(error);}
    finally{setWorking(false);if(button.isConnected)button.disabled=false;}
  }
  activityAnalysisDialog.addEventListener('click',event=>{const button=event.target.closest('[data-resume-review]');if(button)resumeFailedReview(button);});
  function openActivityAnalysis(data,index,opener){openHistoryDialog(data,index,opener,'analysis');}
  function openHistoryDialog(data,index,opener,mode){
    const item=historyRows(data)[index];if(!item||selected!==data.activity.id)return;closeActivityAnalysis(false);analysisSelection={mode,activityId:data.activity.id,itemId:item.id,opener,parentInert:activityDialog?.inert||false,data};
    document.querySelector('#activityAnalysisTitle').textContent=mode==='definition'?'جزئیات شاخص':'تحلیل هوش مصنوعی گزارش';activityAnalysisDialog.querySelector('.activity-dialog-header [data-close-activity-analysis]').setAttribute('aria-label',mode==='definition'?'بستن جزئیات شاخص':'بستن تحلیل گزارش');renderActivityAnalysis(data);
    if(typeof activityAnalysisDialog.showModal==='function')activityAnalysisDialog.showModal();else{activityAnalysisDialog.setAttribute('open','');activityAnalysisBackdrop.hidden=false;}if(activityDialog)activityDialog.inert=true;document.body.classList.add('activity-analysis-open');activityAnalysisDialog.querySelector('[data-close-activity-analysis]').focus();
  }
  activityAnalysisDialog.onclick=event=>{if(event.target.closest('[data-retry-history-definition]')){if(analysisSelection?.mode==='definition'){analysisSelection.definitionLoadingKey=null;renderActivityAnalysis(analysisSelection.data);}return;}if(event.target.closest('[data-retry-history-analysis]')){if(analysisSelection){analysisSelection.loadingKey=null;renderActivityAnalysis(analysisSelection.data);}return;}if(event.target.closest('[data-edit-corrected-report]')){const data=analysisSelection?.data,item=data&&historyRows(data).find(row=>row.id===analysisSelection.itemId),review=analysisReview(data,item);if(item&&canDraftActivityCorrection(data,item,review))focusCorrectedReport();}else if(event.target.closest('[data-close-activity-analysis]'))closeActivityAnalysis();else if(event.target===activityAnalysisDialog){const r=activityAnalysisDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeActivityAnalysis();}};
  activityAnalysisBackdrop.onclick=()=>closeActivityAnalysis();activityAnalysisDialog.addEventListener('cancel',event=>{event.preventDefault();closeActivityAnalysis();});activityAnalysisDialog.addEventListener('close',()=>{if(!activityAnalysisDialog.open)closeActivityAnalysis();});
  activityAnalysisDialog.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();closeActivityAnalysis();return;}if(event.key!=='Tab')return;const controls=[...activityAnalysisDialog.querySelectorAll('button,textarea,input,select,summary,a[href]')].filter(el=>!el.disabled&&!el.closest('[hidden]')&&(!el.closest('details:not([open])')||el.tagName==='SUMMARY')),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
  window.addEventListener('panel:session',()=>closeActivityAnalysis(false));window.addEventListener('panel:view',()=>closeActivityAnalysis(false));document.querySelector('#workflowPeriod')?.addEventListener('change',()=>closeActivityAnalysis(false));
  function renderHistory(data){
    const rows=historyRows(data);
    const labels={completed:'تأیید شده',needs_revision:'نیاز به اصلاح',insufficient:'شواهد ناکافی',failed:'ناموفق',blocked:'ارسال به مدل متوقف',queued:'در صف بررسی',running:'در حال تحلیل',uploading:'در حال تکمیل ارسال',uploaded:'ثبت‌شده؛ بدون تحلیل'},tones={completed:'approved',needs_revision:'error',insufficient:'pending',failed:'error',blocked:'error',queued:'pending',running:'pending'};
    return `<h3>تاریخچهٔ ارسال و تحلیل</h3><div class="review-history-legend" aria-label="راهنمای رنگ وضعیت"><span data-tone="approved">تأیید</span><span data-tone="pending">در انتظار / شواهد ناکافی</span><span data-tone="error">اصلاح / خطا</span><span data-tone="neutral">بدون تحلیل</span></div>${rows.map((item,index)=>{const status=labels[item.status]||item.status||'نامشخص',meta=(item.kind==='upload'?'ارسال گزارش':'تحلیل')+(item.createdAt?' · '+window.PanelDate.formatDateTime(item.createdAt):'')+(item.cached?' · استفاده از نتیجهٔ قبلی':'');return `<article class="review-history-item"><div class="review-history-summary" tabindex="0" aria-label="خلاصه نوبت ${fa.format(rows.length-index)}"><b class="review-history-round">نوبت ${fa.format(rows.length-index)}</b><span class="review-history-status" data-tone="${tones[item.status]||'neutral'}" title="${escape(status)}"><span>${escape(status)}</span></span><small class="review-history-meta" title="${escape(meta)}">${escape(meta)}</small><strong class="review-history-score">امتیاز نهایی: ${Number.isFinite(item.finalScore)?fa.format(item.finalScore):'نامشخص'}</strong><div class="review-history-actions"><button type="button" class="secondary-button" data-history-definition="${index}" aria-haspopup="dialog">جزئیات شاخص</button><button type="button" class="secondary-button" data-history-analysis="${index}" aria-haspopup="dialog">نمایش تحلیل AI</button></div></div></article>`;}).join('')||'<p class="workflow-muted">هنوز ارسال یا تحلیلی ثبت نشده است.</p>'}`;
  }
  function renderReview(review,docs) {
    const retention=review.evidenceDisposition?.archivedDocumentIds?.length?'<p class="workflow-muted">پیوست‌های این بررسی از فهرست فعال حذف و قابل بازیابی بایگانی شدند؛ نتیجه، شواهد تحلیل و شمارش سهمیه حفظ شده‌اند.</p>':'';
    if(review.status!=='done'){const progress=review.fileProcessing;return retention+`<p role="status">${escape(review.status==='failed'?(review.error||'ارزیابی ناموفق؛ گزارش را دوباره ارسال کنید.'):review.status==='queued'?'مستندات در صف خواندن کامل فایل هستند.':progress?.phase==='retry_wait'?'تلاش مجدد خودکار برای همین بخش در حال انجام است؛ بخش‌های ثبت‌شده دوباره تحلیل نمی‌شوند.':progress?.phase==='repairing'?'پاسخ نامعتبر مدل برای همین بخش دوباره بررسی می‌شود؛ شواهد باید با متن اصلی مطابقت داشته باشند.':progress?.phase==='reporting'?'تمام بخش‌ها خوانده شدند؛ گزارش معیارهای پذیرش در حال تهیه است.':'هوش مصنوعی در حال خواندن محتوای مستندات بر اساس شرح تسک است.')}</p>${progress?`<p>بخش‌های خوانده‌شده: ${fa.format(progress.readParts||0)} از ${fa.format(progress.totalParts||0)}</p>`:''}`;}
    const result=review.result;
    const breakdown=result.scoreBreakdown;
    return retention+`<article class="ai-result"><h3>${escape(decisions[result.decision])} ${result.qualityScore==null?'':`— کیفیت ${fa.format(result.qualityScore)} از ۱۰۰`}</h3><small>${escape(review.provider)} · ${escape(review.model||'')} · ${escape(window.PanelDate.formatDateTime(review.finishedAt))} · ${escape(review.policyVersion)}</small><p>${escape(result.summary)}</p>
    ${breakdown?`<div class="score-breakdown"><span>قانون: ${escape(breakdown.ruleVersion)}</span><span>کیفیت: ${breakdown.qualityScore==null?'نامشخص':fa.format(breakdown.qualityScore)}</span><span>تأخیر پس از ارفاق: ${fa.format(breakdown.lateDays)} روز</span><span>کسر: ${fa.format(breakdown.deduction)}</span><strong>امتیاز نهایی: ${breakdown.finalScore==null?'نامشخص':fa.format(breakdown.finalScore)}</strong></div>`:''}
    ${result.fileProcessing?`<section class="file-review-coverage"><h4>گزارش خواندن فایل</h4><p>${result.fileProcessing.complete?'همهٔ بخش‌های قابل‌خواندن فایل به مدل رسیدند.':'پوشش فایل ناقص است؛ نتیجهٔ قطعی مجاز نیست.'} ${fa.format(result.fileProcessing.readParts)} از ${fa.format(result.fileProcessing.totalParts)} بخش بررسی شد.</p>${result.fileProcessing.documents.map(d=>`<p>${escape(d.name)}${d.sheets!=null?' · '+fa.format(d.sheets)+' شیت · '+fa.format(d.cells)+' سلول':''}</p>`).join('')}</section>`:''}
    ${result.criteria.map(c=>`<div><b>${escape(c.id)} — ${escape({met:'تأیید',unmet:'نیازمند اصلاح',insufficient:'شواهد ناکافی'}[c.status])}</b><p>${escape(c.reason)}</p>${c.citations.map(q=>{const doc=docs.find(d=>d.extraction?.chunks?.some(chunk=>chunk.id===q.chunkId));const source=review.evidenceSnapshot?.chunks?.find(chunk=>chunk.id===q.chunkId);const name=doc?.name||review.documentHashes?.find(d=>d.id===source?.documentId)?.name;return `<blockquote>${escape(q.quote)}<br><small>${escape(name||'')} · ${escape(source?.label||q.chunkId)}</small></blockquote>`;}).join('')}</div>`).join('')}
    <p>${result.fileProcessing?'بخش‌های خوانده‌شده':'بخش‌های انتخاب‌شده'}: ${fa.format(result.coverage.totalChunks-result.coverage.omittedChunks)} از ${fa.format(result.coverage.totalChunks)}؛ ${fa.format(result.coverage.bytes)} بایت${result.coverage.incomplete?' — پوشش ناقص؛ نتیجه قطعی نیست.':''}</p><small>مصرف گزارش‌شده مدل: ${escape(JSON.stringify(review.usage||{}))}</small></article>`;
  }
  async function upload(files) {
    if(working)return;const report=(reportDrafts.get(selected)||'').trim();
    if(report.length>10000){showError(new Error('گزارش متنی باید حداکثر ۱۰٬۰۰۰ نویسه باشد.'));return;}
    const reportFile=report?new File([report],'گزارش متنی.txt',{type:'text/plain;charset=utf-8'}):null;
    files=reportFile?[reportFile,...files]:files;if(!files.length)return;
    if(!document.querySelector('#workEvidence')?.checked){showError(new Error('مجاز بودن مستندات کاری و نبود اطلاعات حساس را تأیید کنید.'));return;}
    setWorking(true);let queued;const batchId=window.crypto?.randomUUID?.()||('batch-'+Date.now()+'-'+Math.random().toString(36).slice(2));
    try {
      for(const [index,file] of files.entries()){
        if(file.size>25*1048576)throw new Error('حداکثر حجم هر فایل ۲۵ مگابایت است.');
        document.querySelector('#aiStatus').textContent=`در حال استخراج ${file.name}…`;
        const result=await api(`/api/activities/${selected}/documents?name=${encodeURIComponent(file.name)}&provider=${provider}&workEvidence=true&visualConsent=${document.querySelector('#visualEvidenceConsent')?.checked?'true':'false'}&batchId=${encodeURIComponent(batchId)}&deferReview=${index===files.length-1?'0':'1'}`,{method:'POST',body:file});
        queued=result.autoReview;
        if(file===reportFile)reportDrafts.delete(selected);else pendingFiles.set(selected,(pendingFiles.get(selected)||[]).filter(item=>item!==file));
      }
      // The last upload normally queues automatic assessment. Only fall back
      // when no automatic job was created; never start a second review.
      if(!queued)queued=await post(`/api/activities/${selected}/reviews`,{provider});
      await detail();document.querySelector('#aiStatus').textContent=queued?.error||(['queued','running'].includes(queued?.status)?'مستندات ثبت شد و بررسی خودکار هوش مصنوعی شروع شد. می‌توانید این پنجره را ببندید.':queued?.status==='done'?(queued.cached?'نتیجه همین مستندات قبلاً ثبت شده است؛ تماس دوباره با مدل انجام نشد.':'گزارش ثبت شد و نتیجهٔ ارزیابی آماده است.'):'مستندات ذخیره شدند.');
    }catch(error){showError(error);await detail().catch(showError);}
    finally{setWorking(false);window.dispatchEvent(new Event('panel:reviewed'));}
  }
  async function run() {
    if(working)return;
    if(!document.querySelector('#workEvidence')?.checked){showError(new Error('مجاز بودن مستندات کاری و نبود اطلاعات حساس را تأیید کنید.'));return;}
    setWorking(true);
    document.querySelector('#aiStatus').textContent='در حال خواندن کامل فایل و بررسی معیارهای پذیرش؛ فایل بزرگ در چند بخش تحلیل می‌شود و ممکن است چند دقیقه طول بکشد…';
    try {const review=await post(`/api/activities/${selected}/reviews`,{provider});document.querySelector('#aiStatus').textContent=review.cached?'نتیجه قبلی برای همین شواهد بازاستفاده شد؛ مصرف مجدد مدل نداشت.':'نتیجه ارزیابی ثبت شد.';}
    catch(error){showError(error);}finally{await detail().catch(showError);setWorking(false);window.dispatchEvent(new Event('panel:reviewed'));}
  }
})();

(() => {
  const view=document.querySelector('#view-notes');if(!view)return;
  const $=selector=>view.querySelector(selector),esc=escapeHtml;
  let notes=[],editingId=null,editingRevision=null,editorBaseline=null,working=false,version=0,loadedOwner=null;
  const canUseNotes=()=>['personnel','manager','hr'].includes(window.PanelWorkflow.user?.role);
  const visible=()=>view.classList.contains('active')||window.PanelUtilities?.isOpen('notes');
  const colors={yellow:'زرد',green:'سبز',blue:'آبی',pink:'صورتی'};
  const monthNames=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  view.innerHTML=`<div class="page-heading"><div><p class="eyebrow">فضای شخصی شما</p><h1>یادداشت‌ها</h1><p>فکرها، کارهای کوچک و یادآوری‌ها؛ فقط برای خودتان.</p></div><button type="button" class="primary-button" id="newPersonalNote">${icon('i-plus')}یادداشت جدید</button></div>
    <p class="notes-privacy">${icon('i-file')}خصوصی در سطح حساب؛ به مدیر، ادمین یا هوش مصنوعی ارسال نمی‌شود.</p>
    <p id="notesStatus" role="status" aria-live="polite"></p>
    <form id="noteEditor" class="panel settings-card notes-editor" hidden novalidate><h2 id="noteEditorTitle">یادداشت جدید</h2><div class="form-grid"><label>عنوان (اختیاری)<input name="title" maxlength="120"></label><label>رنگ یادداشت<select name="color">${Object.entries(colors).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label></div><label>متن یادداشت<textarea name="text" rows="5" maxlength="10000" required placeholder="اینجا بنویسید…"></textarea></label>
    <div class="notes-editor-options"><label><input name="pinned" type="checkbox">سنجاق در بالای فهرست</label><label><input name="completed" type="checkbox">انجام شده</label><label><input name="hasReminder" type="checkbox">یادآوری زمان‌دار</label></div>
    <div id="noteReminderFields" class="form-grid" hidden><label>سال شمسی<select name="year" aria-label="سال یادآوری"></select></label><label>ماه<select name="month" aria-label="ماه یادآوری">${monthNames.map((name,index)=>`<option value="${index+1}">${name}</option>`).join('')}</select></label><label>روز<select name="day" aria-label="روز یادآوری">${Array.from({length:31},(_,index)=>`<option value="${index+1}">${fa.format(index+1)}</option>`).join('')}</select></label><label>ساعت (زمان تهران)<input name="time" type="time" aria-label="ساعت یادآوری"></label></div>
    <p class="workflow-muted">یادآوری در زنگولهٔ پنل ثبت می‌شود. هنگام بسته بودن برنامه، بعد از بازگشت آن را می‌بینید؛ اعلان سیستم‌عامل و صدای پس‌زمینه فعال نیست. ذخیرهٔ سریع: Ctrl + Enter</p>
    <div class="design-form-actions"><button type="submit" class="primary-button">ذخیره یادداشت</button><button type="button" class="secondary-button" id="cancelPersonalNote">انصراف</button></div></form>
    <div class="panel notes-toolbar"><label class="table-search">${icon('i-search')}<input id="noteSearch" aria-label="جست‌وجو در یادداشت‌های من" placeholder="جست‌وجو در یادداشت‌های من…"></label><select id="noteFilter" aria-label="فیلتر یادداشت‌ها"><option value="all">همه یادداشت‌ها</option><option value="pinned">سنجاق‌شده</option><option value="reminders">یادآوری‌دار</option><option value="completed">انجام‌شده</option></select><button type="button" class="secondary-button" id="refreshPersonalNotes">تازه‌سازی</button></div>
    <p id="notesCount" class="workflow-muted"></p><div id="personalNotesGrid" class="personal-notes-grid"></div>`;
  const form=$('#noteEditor'),fields=form.elements;
  const editorState=()=>JSON.stringify([...form.elements].filter(el=>el.name).map(el=>[el.name,el.type==='checkbox'?el.checked:el.value]));
  const confirmDiscard=()=>form.hidden||editorState()===editorBaseline||confirm('تغییرات ذخیره‌نشده کنار گذاشته شوند؟');
  const alertBox=document.createElement('aside');alertBox.id='notesReminderAlert';alertBox.className='notes-reminder-alert';alertBox.hidden=true;alertBox.setAttribute('role','alert');alertBox.innerHTML='<strong>زمان یادآوری یادداشت رسید</strong><p>یک یادداشت شخصی منتظر توجه شماست.</p><div><button type="button" class="primary-button" data-open-note-reminder>باز کردن یادداشت</button><button type="button" class="secondary-button" data-dismiss-note-reminder>متوجه شدم</button></div>';document.body.append(alertBox);
  let activeNotice=null;const shownNotices=new Set();
  function notify(items){
    if(!canUseNotes()){alertBox.hidden=true;activeNotice=null;return;}
    if(activeNotice&&!items.some(item=>item.id===activeNotice.id)){alertBox.hidden=true;activeNotice=null;}
    if(activeNotice)return;const notice=items.find(item=>!shownNotices.has(item.id));if(!notice)return;shownNotices.add(notice.id);activeNotice=notice;alertBox.hidden=false;
  }
  alertBox.onclick=async event=>{
    const button=event.target.closest('button');if(!button||!activeNotice||working)return;const notice=activeNotice,owner=window.PanelWorkflow.user?.id;button.disabled=true;
    try{await window.PanelWorkflow.post('/api/notifications/'+notice.id+'/read',{});if(window.PanelWorkflow.user?.id!==owner)return;alertBox.hidden=true;activeNotice=null;if(button.hasAttribute('data-open-note-reminder')){window.PanelWorkflow.go('notes');window.dispatchEvent(new CustomEvent('panel:note-focus',{detail:notice.entityId}));}window.PanelNotifications?.refresh();}
    catch(error){if(window.PanelWorkflow.user?.id===owner)alertBox.querySelector('p').textContent=error.message;}finally{button.disabled=false;}
  };
  const status=(message,error=false)=>{const el=$('#notesStatus');el.textContent=message;el.classList.toggle('warning-text',error);};
  function setWorking(value){working=value;view.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=value);}
  const json=(path,method,value)=>window.PanelWorkflow.api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  function render(){
    const query=$('#noteSearch').value.trim().toLocaleLowerCase('fa'),filter=$('#noteFilter').value;
    const rows=notes.filter(note=>(!query||`${note.title}\n${note.text}`.toLocaleLowerCase('fa').includes(query))&&(filter==='all'||filter==='pinned'&&note.pinned||filter==='reminders'&&note.remindAt&&!note.completed||filter==='completed'&&note.completed));
    $('#notesCount').textContent=`${fa.format(rows.length)} یادداشت از ${fa.format(notes.length)}`;
    $('#personalNotesGrid').innerHTML=rows.map(note=>`<article class="personal-note" data-color="${colors[note.color]?note.color:'yellow'}" data-note-id="${esc(note.id)}"><header><h2>${esc(note.title||'بدون عنوان')}</h2>${note.pinned?'<span class="note-badge">سنجاق‌شده</span>':''}${note.completed?'<span class="note-badge">انجام‌شده</span>':''}</header><p class="personal-note-text">${esc(note.text)}</p>${note.remindAt?`<p class="note-reminder${note.remindedAt&&!note.completed?' is-due':''}">${icon('i-clock')}${note.completed?'یادآوری متوقف':note.remindedAt?'زمان یادآوری رسیده':'یادآوری'} · ${esc(window.PanelDate.formatDateTime(note.remindAt))}</p>`:''}<footer><small>ویرایش: ${esc(window.PanelDate.formatDateTime(note.updatedAt))}</small><div class="note-actions"><button type="button" data-note-action="edit">ویرایش</button><button type="button" data-note-action="pin" aria-pressed="${note.pinned}">${note.pinned?'برداشتن سنجاق':'سنجاق'}</button><button type="button" data-note-action="complete" aria-pressed="${note.completed}">${note.completed?'فعال کردن':'انجام شد'}</button>${note.remindedAt&&!note.completed?'<button type="button" data-note-action="snooze">۱۵ دقیقه بعد</button>':''}<button type="button" data-note-action="delete">حذف</button></div></footer></article>`).join('')||'<section class="panel notes-empty"><h2>فضای فکرهای شما</h2><p>یادداشتی در این فهرست نیست؛ یادداشت جدید بسازید یا فیلتر را تغییر دهید.</p></section>';
    if(working)view.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);
  }
  async function refresh(){
    const user=window.PanelWorkflow.user;if(!canUseNotes())return;
    const request=++version,owner=user.id;
    try{const result=await window.PanelWorkflow.api('/api/notes');if(request!==version||window.PanelWorkflow.user?.id!==owner)return;notes=result;loadedOwner=owner;render();}
    catch(error){if(request===version)status(error.message,true);}
  }
  function openEditor(note=null){
    if(working||!confirmDiscard())return;editingId=note?.id||null;editingRevision=note?.revision||null;form.reset();fields.title.value=note?.title||'';fields.text.value=note?.text||'';fields.color.value=note?.color||'yellow';fields.pinned.checked=!!note?.pinned;fields.completed.checked=!!note?.completed;fields.hasReminder.checked=!!note?.remindAt;
    const date=note?.remindAt?new Date(note.remindAt):new Date(Date.now()+60*60*1000),[year,month,day]=window.PanelDate.input(date).split('/').map(Number);
    fields.year.innerHTML=Array.from({length:6},(_,index)=>`<option value="${year+index}">${fa.format(year+index).replace(/٬/g,'')}</option>`).join('');fields.month.value=String(month);fields.day.value=String(day);
    fields.time.value=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
    $('#noteReminderFields').hidden=!fields.hasReminder.checked;$('#noteEditorTitle').textContent=note?'ویرایش یادداشت':'یادداشت جدید';form.hidden=false;editorBaseline=editorState();fields.text.focus();
  }
  function closeEditor(check=true){if(check&&!confirmDiscard())return;form.hidden=true;form.reset();editingId=null;editorBaseline=null;$('#newPersonalNote').focus();}
  function reminder(){if(!fields.hasReminder.checked)return null;const date=window.PanelDate.toGregorian(`${fields.year.value}/${fields.month.value}/${fields.day.value}`);if(!/^\d{2}:\d{2}$/.test(fields.time.value))throw new Error('ساعت یادآوری را انتخاب کنید.');const iso=new Date(`${date}T${fields.time.value}:00+03:30`).toISOString(),old=notes.find(note=>note.id===editingId)?.remindAt;return old&&old.slice(0,16)===iso.slice(0,16)?old:iso;}
  const notePayload=note=>({title:note.title,text:note.text,color:note.color,pinned:note.pinned,completed:note.completed,remindAt:note.remindAt,revision:note.revision});
  async function mutate(action){if(working)return;const owner=window.PanelWorkflow.user?.id;setWorking(true);try{await action();if(window.PanelWorkflow.user?.id!==owner)return;status('تغییرات یادداشت ذخیره شد.');await refresh();window.PanelNotifications?.refresh();}catch(error){if(window.PanelWorkflow.user?.id===owner)status(error.message,true);}finally{setWorking(false);}}
  form.onsubmit=event=>{event.preventDefault();if(working)return;let data;try{data={title:fields.title.value,text:fields.text.value,color:fields.color.value,pinned:fields.pinned.checked,completed:fields.completed.checked,remindAt:reminder(),revision:editingRevision};}catch(error){return status(error.message,true);}const id=editingId;mutate(async()=>{await json(id?'/api/notes/'+id:'/api/notes',id?'PUT':'POST',data);closeEditor(false);});};
  fields.hasReminder.onchange=()=>{$('#noteReminderFields').hidden=!fields.hasReminder.checked;};
  form.onkeydown=event=>{if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();form.requestSubmit();}if(event.key==='Escape'&&!working){event.preventDefault();closeEditor();}};
  $('#newPersonalNote').onclick=()=>openEditor();$('#cancelPersonalNote').onclick=closeEditor;$('#refreshPersonalNotes').onclick=refresh;$('#noteSearch').oninput=render;$('#noteFilter').onchange=render;
  $('#personalNotesGrid').onclick=event=>{
    const button=event.target.closest('[data-note-action]');if(!button||working)return;const note=notes.find(row=>row.id===button.closest('[data-note-id]').dataset.noteId);if(!note)return;
    const action=button.dataset.noteAction;if(action==='edit')return openEditor(note);
    if(action==='delete'){if(confirm('این یادداشت برای همیشه حذف شود؟'))mutate(()=>json('/api/notes/'+note.id,'DELETE',{revision:note.revision}));return;}
    const data=notePayload(note);if(action==='pin')data.pinned=!data.pinned;if(action==='complete')data.completed=!data.completed;if(action==='snooze')data.remindAt=new Date(Date.now()+15*60*1000).toISOString();mutate(()=>json('/api/notes/'+note.id,'PUT',data));
  };
  function sessionChanged(){version++;notes=[];loadedOwner=null;editingId=null;working=false;setWorking(false);form.reset();form.hidden=true;$('#noteSearch').value='';$('#noteFilter').value='all';status('');render();const nav=document.querySelector('[data-view="notes"]');if(nav)(window.PanelUtilities?.navHost('notes')||document.querySelector('.main-nav')).append(nav);if(visible())refresh();}
  window.addEventListener('panel:session',sessionChanged);
  window.addEventListener('panel:view',event=>{if(event.detail==='notes')refresh();});
  window.addEventListener('panel:utility',event=>{if(event.detail.kind==='notes'&&event.detail.open)refresh();});
  window.addEventListener('panel:note-focus',async event=>{const owner=window.PanelWorkflow.user?.id;await refresh();if(window.PanelWorkflow.user?.id!==owner||!canUseNotes())return;const note=notes.find(row=>row.id===event.detail);if(note&&!working)openEditor(note);});
  window.addEventListener('focus',()=>{if(visible()&&!working)refresh();});
  window.setInterval(()=>{if(!document.hidden&&visible()&&!working&&loadedOwner)refresh();},30000);
  window.addEventListener('panel:session',()=>{alertBox.hidden=true;activeNotice=null;shownNotices.clear();});
  window.PanelNotes={get working(){return working;},get hasDraft(){return !form.hidden&&editorState()!==editorBaseline;},refresh,notify};sessionChanged();
})();

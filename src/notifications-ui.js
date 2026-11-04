(() => {
  const $=selector=>document.querySelector(selector),shell=$('#notificationShell'),button=$('#notificationButton'),panel=$('#notificationPanel'),list=$('#notificationList'),badge=$('#notificationCount'),readAll=$('#notificationReadAll');
  let items=[],requestId=0,accountId=null,boundaryTimer=null;
  const systemText=(item,value)=>item.kind==='action'?window.PanelWorkflow.roleText(value):value;
  const noticeDialog=document.createElement('dialog');noticeDialog.id='announcementNoticeDialog';noticeDialog.className='announcement-notice-dialog';noticeDialog.setAttribute('aria-labelledby','announcementNoticeTitle');noticeDialog.innerHTML='<header><h2 id="announcementNoticeTitle"></h2><button type="button" class="icon-button" aria-label="بستن اطلاعیه">×</button></header><div id="announcementNoticeContent"></div>';document.body.append(noticeDialog);
  const clearNotice=()=>{noticeDialog.querySelector('#announcementNoticeTitle').textContent='';noticeDialog.querySelector('#announcementNoticeContent').replaceChildren();delete noticeDialog.dataset.noticeId;};
  const closeNotice=()=>{if(noticeDialog.open&&typeof noticeDialog.close==='function')noticeDialog.close();else noticeDialog.removeAttribute('open');clearNotice();button.focus();};noticeDialog.querySelector('button').onclick=closeNotice;noticeDialog.addEventListener('close',clearNotice);noticeDialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeNotice();}});
  function showNotice(item){noticeDialog.dataset.noticeId=item.id;noticeDialog.querySelector('#announcementNoticeTitle').textContent=`اطلاعیهٔ ${fa.format(item.number)} · ${item.title}`;noticeDialog.querySelector('#announcementNoticeContent').innerHTML=`<p class="announcement-phase">${item.pinned?'سنجاق‌شده':'اطلاعیه'}</p><p class="announcement-body">${escapeHtml(item.description)}</p>`;if(!noticeDialog.open){if(typeof noticeDialog.showModal==='function')noticeDialog.showModal();else noticeDialog.setAttribute('open','');}noticeDialog.querySelector('button').focus();}
  // Keep the panel outside the single-row header's horizontal scroll container.
  document.body.append(panel);panel.classList.add('notification-portal');
  function position(){if(panel.hidden)return;const rect=button.getBoundingClientRect(),width=Math.min(410,window.innerWidth-24);panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12))+'px';panel.style.top=rect.bottom+12+'px';panel.style.maxHeight=Math.max(100,Math.min(650,window.innerHeight-rect.bottom-28))+'px';}
  window.addEventListener('resize',position);window.addEventListener('scroll',position,{passive:true,capture:true});
  const fa=new Intl.NumberFormat('fa-IR');
  const close=()=>{panel.hidden=true;button.setAttribute('aria-expanded','false');};
  function render(unreadCount=0){
    window.PanelNotes?.notify(items.filter(item=>item.view==='notes'&&!item.readAt));
    badge.hidden=!unreadCount;badge.textContent=unreadCount>99?'۹۹+':fa.format(unreadCount);
    button.setAttribute('aria-label',unreadCount?`اعلان‌ها، ${fa.format(unreadCount)} خوانده‌نشده`:'اعلان‌ها، مورد خوانده‌نشده‌ای نیست');
    readAll.disabled=!unreadCount;
    if(!items.length){list.innerHTML='<p class="notification-empty">هنوز اعلانی برای شما ثبت نشده است.</p>';return;}
    list.innerHTML=items.map(item=>`<button type="button" class="notification-item${item.readAt?'':' is-unread'}${item.pinned?' is-pinned':''}" data-kind="${item.kind==='announcement'?'announcement':item.kind==='action'?'action':'info'}" data-notification-id="${escapeHtml(item.id)}"><span class="notification-item-top"><span class="notification-kind">${item.kind==='announcement'?`اطلاعیهٔ ${fa.format(item.number)}${item.pinned?' · سنجاق‌شده':''}`:item.kind==='action'?'نیازمند اقدام':'جهت اطلاع'}</span>${item.kind==='announcement'?'':`<time>${escapeHtml(window.PanelDate.formatDateTime(item.createdAt))}</time>`}</span><strong>${escapeHtml(systemText(item,item.title))}</strong><span class="notification-description">${escapeHtml(systemText(item,item.description))}</span></button>`).join('');
  }
  async function refresh(){
    const user=window.PanelWorkflow?.user;if(!user)return;
    const current=++requestId,id=user.id;
    try{const result=await window.PanelWorkflow.api('/api/notifications');if(current!==requestId||window.PanelWorkflow.user?.id!==id)return;accountId=id;items=result.items;if(noticeDialog.open&&!items.some(item=>item.id===noticeDialog.dataset.noticeId))closeNotice();render(result.unreadCount);clearTimeout(boundaryTimer);if(Number.isFinite(result.refreshAfterMs))boundaryTimer=setTimeout(()=>{if(PanelWorkflow.user?.id===id)refresh();},Math.max(50,result.refreshAfterMs+25));}
    catch(error){if(current===requestId&&!panel.hidden)list.innerHTML=`<p class="notification-empty">${escapeHtml(error.message)}</p>`;}
  }
  button.addEventListener('click',async()=>{const opening=panel.hidden;panel.hidden=!opening;button.setAttribute('aria-expanded',String(opening));if(opening){position();await refresh();panel.querySelector('h2')?.focus?.();}});
  readAll.addEventListener('click',async()=>{try{await window.PanelWorkflow.post('/api/notifications/read-all',{});await refresh();}catch(error){list.innerHTML=`<p class="notification-empty">${escapeHtml(error.message)}</p>`;}});
  list.addEventListener('click',async event=>{const target=event.target.closest('[data-notification-id]');if(!target)return;const item=items.find(row=>row.id===target.dataset.notificationId);if(!item)return;const owner=PanelWorkflow.user?.id;try{if(!item.readAt)await window.PanelWorkflow.post(`/api/notifications/${item.id}/read`,{});if(owner!==PanelWorkflow.user?.id)return;close();if(item.kind==='announcement')showNotice(item);else {let view=item.view;if(window.PanelWorkflow.user?.role==='manager'&&['appeals','position-review'].includes(view)){await window.PanelLifecycle.refresh();if(owner!==PanelWorkflow.user?.id)return;view=window.PanelLifecycle.personnelRequestView(item.entityId);}if(window.PanelWorkflow.canView(view)){window.PanelWorkflow.go(view);if(item.view==='chat')window.dispatchEvent(new CustomEvent('panel:chat-focus',{detail:item.entityId}));}}await refresh();}catch(error){if(owner===PanelWorkflow.user?.id)list.innerHTML=`<p class="notification-empty">${escapeHtml(error.message)}</p>`;}});
  document.addEventListener('click',event=>{if(!shell.contains(event.target)&&!panel.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();button.focus();}});
  window.addEventListener('panel:session',()=>{requestId++;clearTimeout(boundaryTimer);if(noticeDialog.open)closeNotice();clearNotice();accountId=window.PanelWorkflow.user?.id||null;items=[];render(0);close();refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&accountId)refresh();});window.addEventListener('focus',refresh);
  window.addEventListener('panel:reviewed',refresh);
  window.addEventListener('panel:view',refresh);
  let lastPeriodicRefresh=0;window.setInterval(()=>{if(!document.hidden&&accountId&&(!panel.hidden||noticeDialog.open||Date.now()-lastPeriodicRefresh>=30000)){lastPeriodicRefresh=Date.now();refresh();}},5000);
  window.PanelNotifications={refresh};
  list.addEventListener('click',event=>{const button=event.target.closest('[data-notification-id]'),item=items.find(row=>row.id===button?.dataset.notificationId);if(item?.view==='notes')window.dispatchEvent(new CustomEvent('panel:note-focus',{detail:item.entityId}));});
  if(window.PanelWorkflow?.user){accountId=window.PanelWorkflow.user.id;refresh();}
})();

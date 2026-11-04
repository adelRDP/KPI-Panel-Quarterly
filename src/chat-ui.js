(() => {
  const $=selector=>document.querySelector(selector),view=$('#view-chat');if(!view)return;
  const esc=escapeHtml,fa=new Intl.NumberFormat('fa-IR'),allowed=()=>['personnel','manager','hr'].includes(window.PanelWorkflow?.user?.role);
  let contacts=[],selected=null,rows=[],peerRead=0,hasOlder=false,working=false,loading=false,epoch=0,request=0,loadedOwner=null;
  const drafts=new Map();let pending=null;
  const visible=()=>view.classList.contains('active')||window.PanelUtilities?.isOpen('chat');
  const reading=()=>visible()&&(!window.PanelUtilities?.isOpen('chat')||window.PanelUtilities.isForeground('chat'));
  view.innerHTML=`<div class="page-heading"><div><p class="eyebrow">گفتگوی سازمانی مستقیم</p><h1>Chat</h1><p>فقط با مافوق مستقیم و زیرمجموعهٔ مستقیم خود گفتگو کنید.</p></div></div>
    <p id="chatStatus" class="workflow-muted" role="status" aria-live="polite"></p>
    <div class="chat-layout"><aside class="panel chat-contacts"><h2>مخاطبان مجاز</h2><label class="table-search"><svg aria-hidden="true"><use href="#i-search"/></svg><input id="chatContactSearch" placeholder="جست‌وجوی مخاطب…" aria-label="جست‌وجوی مخاطبان Chat"></label><div id="chatContactList"></div><p class="chat-privacy-note">گفتگوی مستقیم با مافوق، زیرمجموعه و ادمین؛ دسترسی افراد هم‌رده به یکدیگر مسدود است.</p></aside>
    <section class="panel chat-conversation" aria-label="گفتگوی انتخاب‌شده"><header id="chatPeerHeading"><div id="chatPeerCopy" class="chat-peer-copy"><h2>یک مخاطب انتخاب کنید</h2><span>پیام‌ها فقط برای دو طرف گفتگو قابل دسترسی‌اند.</span></div><button type="button" class="secondary-button" id="chatBackContacts" hidden>بازگشت به مخاطبان</button></header>
    <button type="button" class="secondary-button chat-older" id="chatOlder" hidden>پیام‌های قدیمی‌تر</button><div id="chatMessages" class="chat-messages" aria-label="پیام‌ها"><p class="chat-empty">برای شروع گفتگو، مخاطب مورد نظر را انتخاب کنید.</p></div>
    <form id="chatComposer" hidden><label for="chatText">پیام شما</label><textarea id="chatText" name="text" maxlength="4000" rows="3" placeholder="پیام خود را بنویسید…" required></textarea><div class="chat-compose-actions"><span>ارسال: Ctrl + Enter · پیام متنی، بدون پیوست</span><button type="submit" class="primary-button" id="chatSend">ارسال پیام</button></div></form></section></div>`;
  const composer=$('#chatComposer'),text=$('#chatText'),messages=$('#chatMessages');
  const nav=document.querySelector('[data-view="chat"]'),badge=document.createElement('span');badge.id='chatUnreadCount';badge.className='chat-unread';badge.hidden=true;nav.append(badge);
  const status=(message,error=false)=>{$('#chatStatus').textContent=message;$('#chatStatus').classList.toggle('warning-text',error);};
  function paintContacts(){
    const query=$('#chatContactSearch').value.trim().toLocaleLowerCase('fa'),visible=contacts.filter(peer=>`${peer.name} ${peer.jobTitle}`.toLocaleLowerCase('fa').includes(query));
    $('#chatContactList').innerHTML=visible.length?visible.map(peer=>`<button type="button" class="chat-contact${peer.id===selected?' is-selected':''}" data-chat-peer="${esc(peer.id)}" aria-pressed="${peer.id===selected}"><span class="chat-avatar" aria-hidden="true">${esc(peer.name.trim().slice(0,1))}</span><span class="chat-contact-copy"><strong>${esc(peer.name)}</strong><small>${esc(peer.relation)}</small><span>${peer.lastMessage?esc((peer.lastMessage.mine?'شما: ':'')+peer.lastMessage.text.slice(0,70)):'هنوز پیامی ثبت نشده'}</span></span>${peer.unread?`<span class="chat-unread" aria-label="${fa.format(peer.unread)} پیام خوانده‌نشده">${fa.format(peer.unread)}</span>`:''}</button>`).join(''):`<p class="chat-empty">${contacts.length?'مخاطبی با این نام یافت نشد.':'مافوق یا زیرمجموعهٔ مستقیمی برای گفتگو ثبت نشده است.'}</p>`;
    const total=contacts.reduce((sum,peer)=>sum+peer.unread,0);badge.hidden=!total;badge.textContent=total>99?'۹۹+':fa.format(total);badge.dataset.large=String(total>99);badge.title=total?`${fa.format(total)} پیام خوانده‌نشده`:'';nav.setAttribute('aria-label',total?`Chat، ${fa.format(total)} پیام خوانده‌نشده`:'Chat');
  }
  function clearConversation(message='یک مخاطب انتخاب کنید'){
    selected=null;rows=[];peerRead=0;hasOlder=false;pending=null;composer.hidden=true;text.value='';$('#chatOlder').hidden=true;$('#chatBackContacts').hidden=true;view.dataset.chatSelected='false';$('#chatPeerCopy').innerHTML=`<h2>${esc(message)}</h2><span>گفتگو فقط با مخاطبان مجاز امکان‌پذیر است.</span>`;messages.innerHTML='<p class="chat-empty">مخاطب مورد نظر را از فهرست انتخاب کنید.</p>';paintContacts();
  }
  function paintMessages(scroll=false){
    const owner=window.PanelWorkflow.user?.id,peer=contacts.find(row=>row.id===selected);if(!peer)return;
    $('#chatPeerCopy').innerHTML=`<h2>${esc(peer.name)}</h2><span>${esc(peer.relation)} · ${esc(peer.jobTitle||peer.unitName)}</span>`;
    const atBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<64,oldTop=messages.scrollTop;
    messages.innerHTML=rows.length?rows.map(row=>`<article class="chat-message${row.senderId===owner?' is-mine':''}" data-kind="${row.announcement?'announcement':'message'}" data-message-id="${esc(row.id)}">${row.announcement?`<strong class="chat-announcement-label">اطلاعیهٔ ${fa.format(row.announcement.number)}</strong>`:''}<p dir="auto">${esc(row.text)}</p><footer><time datetime="${esc(row.sentAt)}">${esc(window.PanelDate.formatDateTime(row.sentAt))}</time>${row.senderId===owner?`<span>${row.seq<=peerRead?'خوانده شد':'ارسال شد'}</span>`:''}</footer></article>`).join(''):'<p class="chat-empty">هنوز پیامی نیست؛ گفتگو را شروع کنید.</p>';
    messages.scrollTop=scroll||atBottom?messages.scrollHeight:oldTop;$('#chatOlder').hidden=!hasOlder;composer.hidden=false;
  }
  async function loadConversation({older=false,scroll=false}={}){
    if(!selected||loading)return;const owner=window.PanelWorkflow.user?.id,peerId=selected,token=epoch;loading=true;
    try{
      const before=older&&rows.length?`?before=${rows[0].seq}`:'',data=await window.PanelWorkflow.api(`/api/chat/${encodeURIComponent(peerId)}/messages${before}`);
      if(token!==epoch||owner!==window.PanelWorkflow.user?.id||peerId!==selected)return;
      const withdrawn=new Set(data.withdrawnAnnouncementIds||[]),merged=new Map((older?[...data.messages,...rows]:[...rows,...data.messages]).filter(row=>!row.announcement||!withdrawn.has(row.announcement.id)).map(row=>[row.id,row]));rows=[...merged.values()].sort((a,b)=>a.seq-b.seq);peerRead=data.peerReadThrough;hasOlder=older||!rows.length||rows.length===data.messages.length?data.hasOlder:hasOlder;
      paintMessages(scroll);
      if(!older&&!document.hidden&&reading()&&data.lastSeq>data.readThrough){await window.PanelWorkflow.post(`/api/chat/${encodeURIComponent(peerId)}/read`,{through:data.lastSeq});if(token!==epoch||peerId!==selected)return;const peer=contacts.find(row=>row.id===peerId);if(peer)peer.unread=0;paintContacts();window.PanelNotifications?.refresh();}
    }catch(error){if(token===epoch&&peerId===selected){status(error.message,true);if(/محدوده|دسترسی|نشست/.test(error.message)){drafts.delete(peerId);clearConversation('دسترسی این گفتگو تغییر کرده است');}}}
    finally{if(token===epoch)loading=false;}
  }
  async function refresh(){
    if(!allowed())return;const owner=window.PanelWorkflow.user.id,token=epoch,current=++request;
    try{const data=await window.PanelWorkflow.api('/api/chat/contacts');if(token!==epoch||current!==request||owner!==window.PanelWorkflow.user?.id)return;contacts=data;loadedOwner=owner;if(selected&&!contacts.some(peer=>peer.id===selected)){drafts.delete(selected);clearConversation('دسترسی این گفتگو تغییر کرده است');}paintContacts();if(visible()&&!working)await loadConversation();}
    catch(error){if(token===epoch&&current===request){status(error.message,true);if(/نشست|دسترسی/.test(error.message)){contacts=[];drafts.clear();clearConversation();}}}
  }
  async function select(peerId){
    if(working||!contacts.some(peer=>peer.id===peerId))return;if(selected)drafts.set(selected,text.value);epoch++;loading=false;clearConversation();selected=peerId;view.dataset.chatSelected='true';$('#chatBackContacts').hidden=false;pending=null;text.value=drafts.get(peerId)||'';status('');paintContacts();await loadConversation({scroll:true});if(selected===peerId)text.focus();
  }
  $('#chatContactList').onclick=event=>{const button=event.target.closest('[data-chat-peer]');if(button)select(button.dataset.chatPeer);};
  $('#chatBackContacts').onclick=()=>{if(working)return;if(selected)drafts.set(selected,text.value);epoch++;loading=false;clearConversation();$('#chatContactSearch').focus();};
  $('#chatContactSearch').oninput=paintContacts;$('#chatOlder').onclick=()=>loadConversation({older:true});text.oninput=()=>{if(selected)drafts.set(selected,text.value);};
  composer.onsubmit=async event=>{
    event.preventDefault();const value=text.value.trim();if(working||!selected||!value)return;const owner=window.PanelWorkflow.user?.id,peerId=selected,token=epoch;
    if(!pending||pending.text!==value||pending.peerId!==peerId)pending={text:value,peerId,clientId:window.crypto.randomUUID()};working=true;text.disabled=true;$('#chatSend').disabled=true;status('در حال ارسال…');
    try{await window.PanelWorkflow.post(`/api/chat/${encodeURIComponent(peerId)}/messages`,{text:pending.text,clientId:pending.clientId});if(token!==epoch||owner!==window.PanelWorkflow.user?.id)return;pending=null;text.value='';drafts.delete(peerId);status('پیام ارسال شد.');await loadConversation({scroll:true});await refresh();window.PanelNotifications?.refresh();}
    catch(error){if(token===epoch){if(/محدوده|دسترسی|نشست/.test(error.message)){drafts.delete(peerId);clearConversation('دسترسی این گفتگو تغییر کرده است');status(error.message,true);}else status(error.message+' متن پیام حفظ شده؛ دوباره ارسال کنید.',true);}}
    finally{if(token===epoch){working=false;text.disabled=false;$('#chatSend').disabled=false;}}
  };
  text.onkeydown=event=>{if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();composer.requestSubmit();}};
  function sessionChanged(){epoch++;request++;contacts=[];drafts.clear();loadedOwner=null;working=false;loading=false;text.disabled=false;$('#chatSend').disabled=false;$('#chatContactSearch').value='';status('');clearConversation();view.querySelector('.page-heading p:last-child').textContent=window.PanelWorkflow.user?.role==='hr'?'ادمین می‌تواند با همهٔ افراد گفتگو کند؛ گفتگوهای دیگران نمایش داده نمی‌شوند.':'با مافوق مستقیم، زیرمجموعهٔ مستقیم و ادمین گفتگو کنید.';if(allowed())refresh();}
  window.addEventListener('panel:session',sessionChanged);
  window.addEventListener('panel:view',event=>{if(event.detail==='chat')refresh();});
  window.addEventListener('panel:utility',event=>{if(event.detail.kind==='chat'&&event.detail.open)refresh();});
  window.addEventListener('panel:chat-focus',async event=>{const token=epoch;await refresh();if(token===epoch&&allowed())select(event.detail);});
  window.addEventListener('focus',()=>{if(allowed()&&!working)refresh();});
  window.setInterval(()=>{if(!document.hidden&&allowed()&&!working&&loadedOwner)refresh();},15000);
  window.setInterval(()=>{if(!document.hidden&&allowed()&&visible()&&!working)loadConversation();},5000);
  window.PanelChat={get working(){return working;},get hasDraft(){return !!text.value.trim()||[...drafts.values()].some(value=>value.trim());},refresh};sessionChanged();
})();

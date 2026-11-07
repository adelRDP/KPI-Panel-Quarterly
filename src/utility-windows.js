(() => {
  const quick=document.querySelector('#sidebarQuickActions');if(!quick||!window.PanelWorkflow||!window.PanelChat||!window.PanelNotes)return;
  const windows=new Map(),anchors=new Map(),allowed=()=>['personnel','manager','hr'].includes(window.PanelWorkflow.user?.role);let foreground=null,sequence=0,ending=false;
  const names={chat:'چت سازمانی',notes:'یادداشت‌های شخصی'},icons={chat:'i-chat',notes:'i-note'};
  const isOpen=kind=>!!windows.get(kind)&&!windows.get(kind).hidden;
  const navHost=kind=>['chat','notes'].includes(kind)?quick:null;
  function placeNavigation(){for(const kind of ['chat','notes']){const nav=document.querySelector(`[data-view="${kind}"]`);if(nav){nav.classList.add('sidebar-tool-button');nav.onclick=()=>isOpen(kind)?close(kind):open(kind);nav.setAttribute('aria-controls','utility-'+kind);nav.setAttribute('aria-expanded',String(isOpen(kind)));quick.append(nav);}}}
  function layout(){
    const width=document.documentElement.clientWidth||window.innerWidth,height=window.innerHeight,sidebar=document.querySelector('#sidebar'),base=width>820?Math.ceil(sidebar.getBoundingClientRect().width||264)+12:12,room=Math.max(160,width-base-12);
    for(const [kind,panel]of windows){if(panel.hidden)continue;const expanded=panel.dataset.size==='expanded',w=expanded?Math.min(1120,room):Math.min(kind==='chat'?420:480,room);let right=base;
      if(kind==='notes'&&!expanded&&isOpen('chat')&&windows.get('chat').dataset.size!=='expanded'){const chatWidth=Math.min(420,room);right=room>=chatWidth+w+12?base+chatWidth+12:base+Math.min(20,Math.max(0,room-w));}
      panel.style.width=w+'px';panel.style.right=right+'px';panel.style.height=(expanded?height-32:Math.min(kind==='chat'?620:680,Math.floor(height*.78)))+'px';panel.style.top=expanded?'16px':'auto';panel.style.bottom=expanded?'auto':'16px';
    }
  }
  function focusWindow(kind,focus=false){const panel=windows.get(kind);if(!panel||panel.hidden)return;foreground=kind;panel.style.zIndex=String(1100+(++sequence));for(const [key,w]of windows)w.classList.toggle('is-foreground',key===kind);if(focus)panel.querySelector('[data-utility-close]').focus();}
  function ensure(kind){
    if(windows.has(kind))return windows.get(kind);const view=document.querySelector('#view-'+kind);if(!view)return null;
    const anchor=document.createComment('original '+kind+' view');view.before(anchor);anchors.set(kind,anchor);
    const panel=document.createElement('section');panel.id='utility-'+kind;panel.className='utility-window';panel.dataset.tool=kind;panel.dataset.size='compact';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-labelledby','utility-title-'+kind);
    panel.innerHTML=`<header class="utility-window-header"><h2 id="utility-title-${kind}">${icon(icons[kind])}${names[kind]}</h2><div><button type="button" class="icon-button" data-utility-size aria-label="بزرگ کردن ${names[kind]}" aria-pressed="false">${icon('i-window-expand')}</button><button type="button" class="icon-button" data-utility-close aria-label="بستن ${names[kind]}">${icon('i-close')}</button></div></header><div class="utility-window-body"></div>`;
    document.body.append(panel);windows.set(kind,panel);
    panel.addEventListener('pointerdown',()=>focusWindow(kind));panel.addEventListener('focusin',()=>focusWindow(kind));
    panel.querySelector('[data-utility-close]').onclick=()=>close(kind);panel.querySelector('[data-utility-size]').onclick=()=>resize(kind);
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();close(kind);}});return panel;
  }
  function open(kind){
    if(!allowed()||ending||!names[kind])return;const panel=ensure(kind);if(!panel)return;
    if(isOpen(kind)){focusWindow(kind,true);return;}
    const view=document.querySelector('#view-'+kind);view.classList.remove('active');panel.querySelector('.utility-window-body').append(view);view.hidden=false;panel.hidden=false;
    if(panel.dataset.size==='expanded')resize(kind);
    document.querySelector('#sidebar')?.classList.remove('open');document.querySelector('#mobileOverlay')?.classList.remove('open');placeNavigation();layout();focusWindow(kind,true);
    window.dispatchEvent(new CustomEvent('panel:utility',{detail:{kind,open:true,size:panel.dataset.size}}));
  }
  function close(kind,restoreFocus=true){
    const panel=windows.get(kind);if(!panel||panel.hidden)return;panel.hidden=true;const view=document.querySelector('#view-'+kind),anchor=anchors.get(kind);if(view&&anchor?.parentNode)anchor.after(view);
    if(foreground===kind)foreground=[...windows].find(([key,p])=>key!==kind&&!p.hidden)?.[0]||null;placeNavigation();layout();if(restoreFocus)document.querySelector(`[data-view="${kind}"]`)?.focus();
    window.dispatchEvent(new CustomEvent('panel:utility',{detail:{kind,open:false,size:panel.dataset.size}}));
  }
  function resize(kind){
    const panel=windows.get(kind);if(!panel||panel.hidden)return;const expanded=panel.dataset.size!=='expanded';panel.dataset.size=expanded?'expanded':'compact';const button=panel.querySelector('[data-utility-size]');button.setAttribute('aria-pressed',String(expanded));button.setAttribute('aria-label',(expanded?'کوچک کردن ':'بزرگ کردن ')+names[kind]);button.innerHTML=icon(expanded?'i-window-restore':'i-window-expand');layout();focusWindow(kind);window.dispatchEvent(new CustomEvent('panel:utility-size',{detail:{kind,size:panel.dataset.size}}));
  }
  window.PanelUtilities={open,close,resize,isOpen,navHost,isForeground:kind=>foreground===kind&&isOpen(kind)};
  function sessionChanged(){for(const kind of windows.keys()){close(kind,false);windows.get(kind).dataset.size='compact';const button=windows.get(kind).querySelector('[data-utility-size]');button.innerHTML=icon('i-window-expand');button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','بزرگ کردن '+names[kind]);}foreground=null;placeNavigation();document.querySelector('#accountMenu').hidden=true;document.querySelector('#accountMenuToggle').setAttribute('aria-expanded','false');}
  window.addEventListener('panel:session',sessionChanged);window.addEventListener('resize',layout);window.addEventListener('panel:sidebar',layout);
  if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(layout);observer.observe(document.querySelector('#sidebar'));}
  const menu=document.querySelector('#accountMenu'),toggle=document.querySelector('#accountMenuToggle'),logout=document.querySelector('#panelLogout'),status=document.querySelector('#accountActionStatus');
  const changePassword=document.querySelector('#panelChangePassword');
  const syncPasswordAction=()=>{changePassword.hidden=window.PanelWorkflow?.user?.role!=='personnel';};
  window.addEventListener('panel:session',syncPasswordAction);window.addEventListener('panel:password-required',syncPasswordAction);syncPasswordAction();
  changePassword.onclick=()=>{if(window.PanelWorkflow?.user?.role!=='personnel')return;menu.hidden=true;toggle.setAttribute('aria-expanded','false');window.PanelWorkflow.go('account-security');if(!window.PanelWorkflow.demo)document.querySelector('#accountPasswordForm [name=currentPassword]').focus();};
  toggle.onclick=()=>{syncPasswordAction();menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)(changePassword.hidden?logout:changePassword).focus();};
  document.addEventListener('click',event=>{if(!event.target.closest('.sidebar-account-card')){menu.hidden=true;toggle.setAttribute('aria-expanded','false');}});
  menu.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();menu.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}};
  logout.onclick=async()=>{
    if(ending)return;if(window.PanelWorkflow.working||window.PanelAi?.working||window.PanelLifecycle?.working||window.PanelNotes?.working||window.PanelChat?.working||window.PanelScoreSettings?.working||window.PanelAnnouncements?.working){status.hidden=false;status.textContent='ابتدا منتظر پایان عملیات جاری بمانید.';return;}
    if((window.PanelNotes.hasDraft||window.PanelChat.hasDraft)&&!confirm('متن ذخیره‌نشده دارید؛ با خروج از حساب کنار گذاشته شود؟'))return;
    ending=true;logout.disabled=true;status.hidden=true;const loginProtected=window.PanelWorkflow.loginProtected;
    try{await window.PanelWorkflow.signOut();document.querySelector('.app-shell').hidden=true;if(loginProtected){window.location.replace('/login.html');return;}const screen=document.createElement('section');screen.className='panel-signed-out';screen.id='panelSignedOut';screen.innerHTML='<div class="panel"><h1>از پنل خارج شدید</h1><p>نشست قبلی بسته شد. ورود دوباره، نشست تازهٔ پنل محلی را می‌سازد.</p><button type="button">ورود دوباره به پنل</button></div>';document.body.append(screen);screen.querySelector('button').onclick=()=>window.location.reload();screen.querySelector('button').focus();}
    catch(error){status.hidden=false;status.textContent=error.message;ending=false;logout.disabled=false;}
  };
  placeNavigation();document.body.classList.add('has-sidebar-tools');
})();

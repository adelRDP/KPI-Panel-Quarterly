(() => {
  const input=document.querySelector('#globalSearch');if(!input)return;
  // Keep a fixed-size search slot in the header; the editor opens outside its scrolling strip.
  const field=input.closest('.global-search'),trigger=document.createElement('button');
  trigger.type='button';trigger.id='globalSearchToggle';trigger.className='global-search search-toggle';trigger.title='جست‌وجو';trigger.setAttribute('aria-label','باز کردن جست‌وجوی پنل');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','globalSearchField');trigger.append(field.querySelector('svg').cloneNode(true));
  field.replaceWith(trigger);field.id='globalSearchField';field.className='global-search search-field';field.hidden=true;field.dir='rtl';document.body.append(field);
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='search-dismiss';dismiss.setAttribute('aria-label','بستن جست‌وجو');dismiss.textContent='×';field.append(dismiss);
  const popup=document.createElement('section');popup.className='search-popover';popup.hidden=true;popup.dir='rtl';popup.setAttribute('aria-label','نتایج جست‌وجوی پنل');
  popup.innerHTML='<p id="globalSearchStatus" class="search-status" role="status" aria-live="polite" aria-atomic="true"></p><div id="globalSearchResults" role="listbox" aria-label="نتایج جست‌وجو"></div><p class="search-help">↑ ↓ انتخاب · Enter باز کردن · Esc بستن</p>';document.body.append(popup);
  const list=popup.querySelector('#globalSearchResults'),status=popup.querySelector('#globalSearchStatus');
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const owner=()=>window.PanelWorkflow?.user?.id,allowed=item=>!!window.PanelWorkflow?.canView(item.view);
  let items=[],selected=-1,timer=null,request=0,controller=null,navVersion=0,highlight=null;
  function positionField(){
    const rect=trigger.getBoundingClientRect(),bar=trigger.closest('.topbar').getBoundingClientRect(),right=Math.min(window.innerWidth-12,bar.width?bar.right-12:window.innerWidth-12),width=Math.min(300,right-12),left=Math.max(12,Math.min(rect.left,right-width));
    // Open below the row so search never shifts or covers any header controls.
    field.style.width=width+'px';field.style.left=left+'px';field.style.top=(bar.bottom+8)+'px';field.style.height=rect.height+'px';
  }
  function reveal(){if(field.hidden){trigger.closest('.top-actions')?.scrollIntoView?.({block:'nearest',inline:'nearest'});field.hidden=false;trigger.setAttribute('aria-expanded','true');}positionField();}
  function collapse({restore=false,clear=false}={}){close({clear});field.hidden=true;trigger.setAttribute('aria-expanded','false');input.blur();if(restore)trigger.focus({preventScroll:true});}
  function position(){
    const rect=input.closest('.global-search').getBoundingClientRect(),width=Math.min(480,window.innerWidth-24),left=Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),top=Math.max(8,rect.bottom+8);
    popup.style.width=width+'px';popup.style.left=left+'px';popup.style.top=top+'px';popup.style.maxHeight=Math.max(90,window.innerHeight-top-16)+'px';
  }
  function open(){position();popup.hidden=false;input.setAttribute('aria-expanded','true');}
  function close({clear=false}={}){request++;clearTimeout(timer);controller?.abort();controller=null;popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');input.removeAttribute('aria-busy');selected=-1;items=[];list.replaceChildren();status.textContent='';if(clear)input.value='';}
  function select(index){selected=index;list.querySelectorAll('[role="option"]').forEach((node,i)=>node.setAttribute('aria-selected',String(i===index)));const node=list.children[index];if(node){input.setAttribute('aria-activedescendant',node.id);node.scrollIntoView?.({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
  function render(data){
    items=(data.items||[]).filter(allowed);selected=-1;input.removeAttribute('aria-activedescendant');
    list.innerHTML=items.map((item,i)=>`<button type="button" role="option" aria-selected="false" tabindex="-1" id="global-search-option-${request}-${i}" data-search-index="${i}" class="search-result"><span class="search-result-kind">${esc(item.kind)}</span><strong>${esc(item.title)}</strong><small>${esc(item.description)}</small></button>`).join('');
    status.textContent=items.length?`${new Intl.NumberFormat('fa-IR').format(items.length)} نتیجه${data.total>data.limit?'؛ برای نتایج دقیق‌تر عبارت را کامل‌تر کنید.':''}`:'نتیجه‌ای در بخش‌های مجاز شما پیدا نشد.';open();
  }
  async function run(){
    clearTimeout(timer);timer=null;
    const q=input.value.trim();if(q.length<2||!owner()){close();return;}
    reveal();
    controller?.abort();controller=new AbortController();const signal=controller.signal,id=++request,account=owner();items=[];selected=-1;list.replaceChildren();input.removeAttribute('aria-activedescendant');input.setAttribute('aria-busy','true');status.textContent='در حال جست‌وجو در بخش‌های مجاز…';open();
    try{const data=await window.PanelWorkflow.api('/api/search?q='+encodeURIComponent(q),{signal});if(id!==request||account!==owner()||signal.aborted)return;render(data);}
    catch(error){if(id===request&&account===owner()&&!signal.aborted){list.replaceChildren();items=[];status.textContent='جست‌وجو انجام نشد؛ دوباره تلاش کنید. '+error.message;open();}}
    finally{if(id===request)input.removeAttribute('aria-busy');}
  }
  const targets=new Set(['data-search-person','data-search-unit','data-design-id','data-search-appeal','data-service-detail']);
  function focusTarget(item){
    if(!item.target||!targets.has(item.target.attr))return;
    const root=document.getElementById('view-'+item.view),node=[...(root?.querySelectorAll('['+item.target.attr+']')||[])].find(el=>el.getAttribute(item.target.attr)===item.target.value);if(!node)return;
    if(node.tagName==='DETAILS')node.open=true;if(node.hasAttribute('data-toggle-design')&&node.getAttribute('aria-expanded')!=='true')node.click();for(let parent=node.parentElement;parent&&parent!==root;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
    const requestDetail=node.querySelector?.('[data-incoming-detail]');if(requestDetail&&requestDetail.getAttribute('aria-expanded')!=='true')requestDetail.click();
    const focus=node.closest('tr,article,.org-unit')||node;if(highlight)highlight.classList.remove('search-match');highlight=focus;focus.classList.add('search-match');focus.scrollIntoView?.({block:'center',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});focus.setAttribute('tabindex','-1');focus.focus({preventScroll:true});
    window.setTimeout(()=>{focus.classList.remove('search-match');if(highlight===focus)highlight=null;},5000);
  }
  async function activate(item){
    if(item?.view==='appeals'&&window.PanelWorkflow?.user?.role==='hr')item={...item,view:'incoming'};
    if(item?.view==='surveys'&&item.target?.attr==='data-service-detail'&&window.PanelWorkflow?.user?.role==='manager')item={...item,view:'peer-surveys'};
    if(!item||!allowed(item))return;
    if([window.PanelAi,window.PanelLifecycle,window.PanelNotes,window.PanelChat].some(panel=>panel?.working)){status.textContent='ابتدا منتظر پایان عملیات جاری بمانید.';return;}
    const account=owner(),nav=++navVersion;collapse({clear:true});window.PanelWorkflow.go(item.view);
    if(item.action==='activity'){window.PanelAi?.open(item.activityId,item.view,document.querySelector('.nav-item.active'));return;}
    if(item.action==='note'){window.dispatchEvent(new CustomEvent('panel:note-focus',{detail:item.entityId}));return;}
    if(item.action==='chat'){window.dispatchEvent(new CustomEvent('panel:chat-focus',{detail:item.entityId}));return;}
    try{if(item.target)await window.PanelLifecycle?.refresh();if(account===owner()&&nav===navVersion&&document.querySelector('.view.active')?.id==='view-'+item.view){if(window.PanelWorkflow.user?.role==='manager'&&['position-review','personnel-requests-archive'].includes(item.view))window.PanelLifecycle.revealPersonnelRequest(item.target?.value);if(item.target?.attr==='data-design-id')window.PanelLifecycle.revealDesign(item.target.value);focusTarget(item);}}
    catch{if(account===owner()&&nav===navVersion){reveal();input.focus();status.textContent='بخش باز شد اما دریافت اطلاعات کامل نشد؛ دوباره تلاش کنید.';open();}}
  }
  trigger.addEventListener('click',()=>{reveal();input.focus({preventScroll:true});});
  dismiss.addEventListener('click',()=>collapse({restore:true}));
  input.addEventListener('input',()=>{close();if(input.value.trim().length>=2)timer=window.setTimeout(run,280);});
  input.addEventListener('focus',()=>{reveal();if(input.value.trim().length>=2)run();});
  input.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();collapse({restore:true});return;}
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(popup.hidden){run();return;}if(items.length)select(selected<0?(event.key==='ArrowDown'?0:items.length-1):(selected+(event.key==='ArrowDown'?1:-1)+items.length)%items.length);}
    if(event.key==='Enter'){event.preventDefault();if(items.length)activate(items[selected<0?0:selected]);else run();}
    if(event.key==='Tab')close();
  });
  popup.addEventListener('pointerdown',event=>{if(event.target.closest('[data-search-index]'))event.preventDefault();});
  popup.addEventListener('click',event=>{const button=event.target.closest('[data-search-index]');if(button)activate(items[Number(button.dataset.searchIndex)]);});
  document.addEventListener('pointerdown',event=>{if(!popup.contains(event.target)&&!field.contains(event.target)&&!trigger.contains(event.target))collapse();});
  document.addEventListener('focusin',event=>{if(!field.hidden&&!field.contains(event.target)&&!popup.contains(event.target)&&event.target!==trigger)collapse();});
  field.addEventListener('keydown',event=>{if(event.key==='Escape'&&event.target!==input){event.preventDefault();collapse({restore:true});}});
  for(const type of ['resize','scroll'])window.addEventListener(type,()=>{if(!field.hidden)positionField();if(!popup.hidden)position();},{passive:true,capture:true});
  window.addEventListener('panel:view',()=>collapse());window.addEventListener('panel:session',()=>{navVersion++;collapse({clear:true});if(highlight)highlight.classList.remove('search-match');highlight=null;});
  window.addEventListener('pagehide',()=>collapse());
  window.PanelSearch={close:collapse,search:run};
})();

(() => {
 const nav=document.createElement('button');nav.className='nav-item';nav.dataset.view='account-security';nav.hidden=true;nav.innerHTML='<svg aria-hidden="true"><use href="#i-shield"/></svg><span>امنیت حساب</span>';nav.onclick=()=>window.PanelWorkflow?.go('account-security');document.querySelector('.main-nav').append(nav);
 const view=document.createElement('section');view.id='view-account-security';view.className='view workflow-view';view.innerHTML=`
  <div class="page-heading"><div><p class="eyebrow">حساب و دسترسی</p><h1>امنیت حساب</h1></div></div>
  <div class="panel settings-card account-security-card">
   <form id="accountPasswordForm">
    <header class="account-section-heading"><h2>تغییر رمز عبور</h2><p>رمز بین ۱۲ تا ۱۲۸ نویسه باشد. با تغییر رمز، نشست‌های قبلی شما باطل می‌شوند.</p></header>
    <div class="account-fields"><label class="account-field-wide">رمز فعلی<input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required></label><label>رمز جدید<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><label>تکرار رمز جدید<input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label></div>
    <div class="account-form-actions"><button class="primary-button" type="submit">تغییر رمز</button></div>
   </form>
  </div>
  <section id="accountManagement" class="panel settings-card account-security-card" hidden>
   <header class="account-section-heading"><h2>مدیریت حساب‌های ورود</h2><p>برای فرد ثبت‌شده حساب بسازید یا اطلاعات ورود او را ویرایش کنید. صاحب حساب در اولین ورود، رمز موقت را تغییر می‌دهد.</p></header>
   <div class="account-defaults"><div><h3>تعریف گروهی حساب‌ها</h3><p>برای افراد فاقد حساب، نام کاربری و رمز موقت اختصاصی ساخته می‌شود؛ حساب‌های موجود و افراد تسویه‌شده تغییری نمی‌کنند. اطلاعات ورود در یک فایل قابل دانلود تحویل داده می‌شود.</p></div><div class="account-default-buttons"><button type="button" id="createDefaultAccounts" class="secondary-button">ایجاد حساب پیش‌فرض برای همه</button><button type="button" id="downloadDefaultAccounts" class="secondary-button" hidden>دانلود اطلاعات حساب‌های ساخته‌شده</button></div></div>
   <form id="accountProvisionForm">
    <div class="account-fields">
     <label>انتخاب فرد<select name="userId" required></select></label>
     <label>نام کاربری<input name="username" dir="ltr" autocomplete="off" autocapitalize="none" spellcheck="false" minlength="3" maxlength="128" placeholder="مثلاً user.name" required></label>
     <label class="account-field-wide">رمز موقت<input name="password" type="password" dir="ltr" autocomplete="new-password" minlength="12" maxlength="128" aria-describedby="accountPasswordHint"><small id="accountPasswordHint">برای حساب جدید، رمز ۱۲ تا ۱۲۸ نویسه‌ای تعیین کنید؛ هنگام ویرایش، برای حفظ رمز فعلی خالی بگذارید.</small></label>
    </div>
    <div class="account-form-actions"><label class="account-enabled"><input type="checkbox" name="enabled" checked><span>حساب فعال باشد</span></label><button type="submit" class="primary-button">ذخیره حساب</button></div>
    <p class="account-delivery-note">رمز موقت را فقط از مسیر امن به صاحب حساب تحویل دهید.</p>
   </form>
   <section class="account-list-section" aria-labelledby="accountListTitle"><h3 id="accountListTitle">حساب‌های ثبت‌شده</h3><p class="account-delivery-note">رمز فعلی قابل نمایش نیست. برای تعیین رمز موقت جدید، «تغییر» را بزنید و رمز جدید را در فرم وارد و ذخیره کنید.</p><div id="accountCredentialsList"></div></section>
   <section class="account-list-section"><h3>گزارش امنیت حساب‌ها</h3><p class="account-delivery-note">آخرین ورود، تلاش‌های ناموفق و تغییرات حساب‌ها؛ سوابق از زمان فعال‌شدن این گزارش ثبت می‌شوند.</p><button type="button" id="loadAccountSecurity" class="secondary-button">نمایش / تازه‌سازی گزارش امنیت</button><div id="accountSecurityReport" hidden></div></section>
  </section>
  <p id="accountSecurityStatus" role="status" aria-live="polite"></p>`;document.querySelector('main').append(view);
 const passwordForm=view.querySelector('#accountPasswordForm'),provision=view.querySelector('#accountProvisionForm'),management=view.querySelector('#accountManagement'),status=view.querySelector('#accountSecurityStatus');let busy=false,version=0,rows=[];
 const workflow=()=>window.PanelWorkflow;
 const defaultsButton=view.querySelector('#createDefaultAccounts'),downloadDefaults=view.querySelector('#downloadDefaultAccounts');let defaultsCsv='';
 function clear(){version++;rows=[];defaultsCsv='';downloadDefaults.hidden=true;passwordForm.reset();provision.reset();view.querySelector('#accountCredentialsList').replaceChildren();view.querySelector('#accountSecurityReport').replaceChildren();view.querySelector('#accountSecurityReport').hidden=true;status.textContent='';}
 const securityReport=view.querySelector('#accountSecurityReport'),loadSecurity=view.querySelector('#loadAccountSecurity');
 const securityDate=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'}):'ثبت نشده';
 loadSecurity.onclick=async()=>{if(busy||workflow()?.user?.role!=='hr')return;const current=version;loadSecurity.disabled=true;try{const report=await workflow().api('/api/auth/security');if(current!==version)return;
  const labels={'login.success':'ورود موفق','login.failure':'ورود ناموفق','password.change.failure':'تلاش ناموفق تغییر رمز','session.switched':'تغییر نقش / فرد',logout:'خروج','account.updated':'تغییر حساب','account.bootstrap':'ساخت ادمین','account.default-created':'ساخت حساب گروهی','account.password-changed':'تغییر رمز','account.shared-sessions-revoked':'بستن نشست‌های ورود اصلی'};
  securityReport.innerHTML='<p>آخرین ورود اصلی: '+escapeHtml(securityDate(report.main.lastLoginAt))+' · نشست فعال: '+escapeHtml(report.main.activeSessions)+'</p><button type="button" id="revokeMainSessions" class="secondary-button">بستن همهٔ نشست‌های ورود اصلی</button><div class="workflow-table-wrap"><table class="workflow-table"><thead><tr><th>فرد</th><th>آخرین ورود</th><th>آخرین تلاش ناموفق</th><th>تعداد ناموفق</th></tr></thead><tbody>'+report.accounts.map(row=>'<tr><td>'+escapeHtml(row.name)+'</td><td>'+escapeHtml(securityDate(row.lastLoginAt))+'</td><td>'+escapeHtml(securityDate(row.lastFailedAt))+'</td><td>'+escapeHtml(row.failedAttempts)+'</td></tr>').join('')+'</tbody></table></div><h3>آخرین رویدادها</h3><div class="workflow-table-wrap"><table class="workflow-table"><thead><tr><th>زمان</th><th>فرد</th><th>رویداد</th></tr></thead><tbody>'+report.events.map(row=>'<tr><td>'+escapeHtml(securityDate(row.createdAt))+'</td><td>'+escapeHtml(row.name)+'</td><td>'+escapeHtml(labels[row.action]||'تغییر حساب')+(row.viewedName?' · نمایش '+escapeHtml(row.viewedName):'')+(row.actorName?' · '+escapeHtml(row.actorName):'')+'</td></tr>').join('')+'</tbody></table></div>';securityReport.hidden=false;
  securityReport.querySelector('#revokeMainSessions').onclick=async()=>{if(busy||!window.confirm('همهٔ نشست‌های ورود اصلی بسته شوند؟ کاربران این ورود باید دوباره وارد شوند. حساب‌های شخصی باز می‌مانند.'))return;busy=true;try{const result=await workflow().post('/api/auth/security/revoke-main',{});if(current!==version)return;if(result.loggedOut)window.location.replace('/login.html');else{status.textContent='نشست‌های ورود اصلی بسته شدند.';busy=false;await loadSecurity.onclick();}}catch(error){if(current===version)status.textContent=error.message;}finally{busy=false;}};
 }catch(error){if(current===version)status.textContent=error.message;}finally{loadSecurity.disabled=false;}};
 function downloadCredentials(){if(!defaultsCsv)return;const url=URL.createObjectURL(new Blob(['\uFEFF'+defaultsCsv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='kpi-new-accounts.csv';document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
 downloadDefaults.onclick=downloadCredentials;
 defaultsButton.onclick=async()=>{
  if(busy||workflow()?.user?.role!=='hr')return;
  busy=true;defaultsButton.disabled=true;provision.querySelector('button').disabled=true;const current=version;
  status.textContent='در حال ساخت حساب‌های فاقد نام کاربری؛ لطفاً منتظر بمانید…';
  try{
   const result=await workflow().post('/api/auth/accounts/defaults',{});if(current!==version)return;
   if(result.credentials?.length){
    const cell=value=>'"'+String(value??'').replace(/^[=+\-@\t\r\n]/,"'$&").replaceAll('"','""')+'"';
    const roles={hr:'ادمین',manager:'مدیر',personnel:'پرسنل'};
    defaultsCsv=[['نام فرد','دسترسی','کد پرسنلی','نام کاربری','رمز موقت'],...result.credentials.map(row=>[row.name,roles[row.role]||row.role,row.employeeCode,row.username,row.password])].map(row=>row.map(cell).join(',')).join('\r\n');downloadDefaults.hidden=false;
    try{downloadCredentials();}catch{status.textContent='حساب‌ها ساخته شدند؛ برای دریافت رمزها از دکمه دانلود اطلاعات استفاده کنید.';}
   }
   await refresh();status.textContent=result.created?result.created+' حساب ساخته شد. فایل اطلاعات ورود را نگه دارید و رمز هر فرد را فقط به خود او تحویل دهید؛ پس از خروج یا بارگذاری دوباره، رمزهای موقت در این صفحه قابل دریافت نیستند.':'همهٔ افراد واجد شرایط حساب دارند؛ حساب جدیدی ساخته نشد.';
  }catch(error){if(current===version)status.textContent=error.message;}finally{busy=false;defaultsButton.disabled=false;provision.querySelector('button').disabled=false;}
 };
 function selectAccount(){const row=rows.find(r=>r.userId===provision.elements.userId.value);provision.elements.username.value=row?.username||'';provision.elements.password.value='';provision.elements.enabled.checked=row?.enabled!==false;}
 provision.elements.userId.onchange=selectAccount;
 view.querySelector('#accountCredentialsList').onclick=event=>{
  const button=event.target.closest('button[data-edit-account]');
  if(!button||busy||management.hidden||workflow()?.user?.role!=='hr')return;
  const userId=button.dataset.editAccount;
  if(!rows.some(row=>row.userId===userId)||![...provision.elements.userId.options].some(option=>option.value===userId))return;
  provision.elements.userId.value=userId;selectAccount();
  provision.scrollIntoView({behavior:'smooth',block:'center'});
  provision.elements.username.focus({preventScroll:true});
 };
 async function refresh(){
  const api=workflow(),current=++version;if(!api?.user||api.demo&&!api.canManageAccounts)return;
  management.hidden=api.user.role!=='hr'||api.mustChangePassword;
  if(management.hidden)return;
  try{const result=await api.api('/api/auth/accounts');if(current!==version)return;rows=result;provision.elements.userId.innerHTML=api.accounts.map(p=>'<option value="'+escapeHtml(p.id)+'">'+escapeHtml(p.name)+' · '+escapeHtml(({hr:'ادمین',manager:'مدیر',personnel:'پرسنل'})[p.role]||'پرسنل')+(p.employeeCode?' · '+escapeHtml(p.employeeCode):'')+'</option>').join('');selectAccount();view.querySelector('#accountCredentialsList').innerHTML=rows.length?'<div class="workflow-table-wrap"><table class="workflow-table"><thead><tr><th scope="col">فرد</th><th scope="col">نام کاربری</th><th scope="col">رمز</th><th scope="col">وضعیت</th><th scope="col">عملیات</th></tr></thead><tbody>'+rows.map(row=>'<tr><td>'+escapeHtml(api.accounts.find(p=>p.id===row.userId)?.name||'فرد ثبت‌شده')+'</td><td><bdi>'+escapeHtml(row.username)+'</bdi></td><td><span>قابل نمایش نیست</span>'+(row.mustChangePassword?'<br><small class="workflow-muted">موقت؛ نیازمند تغییر</small>':'')+'</td><td><span class="account-status" data-enabled="'+String(row.enabled===true)+'">'+(row.enabled?'فعال':'غیرفعال')+'</span></td><td><button type="button" class="secondary-button" data-edit-account="'+escapeHtml(row.userId)+'" aria-label="تغییر حساب '+escapeHtml(api.accounts.find(p=>p.id===row.userId)?.name||row.username)+'">تغییر</button></td></tr>').join('')+'</tbody></table></div>':'<p class="workflow-muted account-empty">هنوز حساب ورودی ثبت نشده است. از فرم بالا اولین حساب را بسازید.</p>';}catch(error){if(current===version)status.textContent=error.message;}
 }
 function sessionChanged(){clear();nav.hidden=!workflow()?.user||workflow().demo&&!workflow().canManageAccounts;passwordForm.parentElement.hidden=workflow()?.demo!==false;management.hidden=true;if(workflow()?.mustChangePassword)status.textContent='برای ادامه استفاده از پنل، ابتدا رمز موقت را تغییر دهید.';}
 passwordForm.onsubmit=async event=>{event.preventDefault();if(busy||!passwordForm.reportValidity())return;if(passwordForm.elements.password.value!==passwordForm.elements.confirmation.value){status.textContent='تکرار رمز جدید یکسان نیست.';return;}busy=true;const button=passwordForm.querySelector('button');button.disabled=true;try{await workflow().post('/api/auth/password',{currentPassword:passwordForm.elements.currentPassword.value,password:passwordForm.elements.password.value});passwordForm.reset();status.textContent='رمز تغییر کرد؛ در حال بارگذاری دوباره…';window.location.replace('/');}catch(error){status.textContent=error.message;}finally{busy=false;button.disabled=false;}};
 provision.onsubmit=async event=>{event.preventDefault();if(busy||!provision.reportValidity())return;busy=true;const button=provision.querySelector('button'),userId=provision.elements.userId.value;button.disabled=true;try{await workflow().post('/api/auth/accounts',{userId,username:provision.elements.username.value,enabled:provision.elements.enabled.checked,...(provision.elements.password.value?{password:provision.elements.password.value}:{})});provision.elements.password.value='';if(userId===workflow().user.id&&!workflow().demo){window.location.replace('/login.html');return;}await refresh();status.textContent='حساب ذخیره شد؛ نشست‌های شخصی قبلی این فرد دیگر معتبر نیستند.';}catch(error){status.textContent=error.message;}finally{busy=false;button.disabled=false;}};
 window.addEventListener('panel:session',sessionChanged);window.addEventListener('panel:password-required',sessionChanged);window.addEventListener('panel:view',event=>{if(event.detail==='account-security')refresh();});
 window.PanelAccountSecurity={get working(){return busy;}};
})();

(() => {
  const form=document.querySelector('#loginForm'),status=document.querySelector('#loginStatus'),button=form.querySelector('[type=submit]'),password=form.elements.password;let busy=false;
  document.querySelector('#togglePassword').onclick=event=>{const control=event.currentTarget,visible=password.type==='password';password.type=visible?'text':'password';control.setAttribute('aria-pressed',String(visible));control.setAttribute('aria-label',visible?'پنهان کردن رمز عبور':'نمایش رمز عبور');control.querySelector('use').setAttribute('href',visible?'#login-eye':'#login-eye-off');};
  document.querySelector('#loginHelp').onclick=()=>{const help=document.querySelector('#loginHelpText');help.hidden=!help.hidden;};
  const access=form.elements.access,labels={main:'پنل اصلی',admin:'پنل ادمین',manager:'پنل مدیر',personnel:'پنل پرسنل'};
  const requested=new URLSearchParams(window.location.search).get('access');
  if(Object.hasOwn(labels,requested))access.value=requested;
  const updateAccess=()=>{document.querySelector('#loginTitle').textContent='ورود به '+labels[access.value]+' · فصلی';status.textContent='';password.value='';};
  access.onchange=updateAccess;updateAccess();
  if(typeof window.fetch==='function')fetch('/api/auth/options').then(r=>r.ok?r.json():null).then(options=>{if(!options)return;const previous=access.value;for(const option of access.options)option.disabled=option.value==='main'?!options.shared:!options.personal;if(access.selectedOptions[0]?.disabled){const available=Array.from(access.options).find(option=>!option.disabled);if(available)access.value=available.value;}if(access.value!==previous)updateAccess();}).catch(()=>{});
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;busy=true;button.disabled=true;status.textContent='در حال ورود…';
    try{const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access:access.value,username:form.elements.username.value,password:password.value,remember:form.elements.remember.checked})});
      let result;try{result=await response.json();}catch{throw Error('پاسخ معتبر دریافت نشد؛ دوباره تلاش کنید.');}
      if(!response.ok)throw Error(result.error||'ورود ناموفق بود.');password.value='';window.location.replace('/');
    }catch(error){status.textContent=error instanceof TypeError?'ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید.':error.message;}
    finally{busy=false;button.disabled=false;}
  };
})();

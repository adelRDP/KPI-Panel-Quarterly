import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {assess,providerConfig,providerKey,providerStatus,providerIds} from './providers.mjs';
import {buildPrompt,finalizeReview} from './evaluation.mjs';

const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const timestamp=()=>new Date().toISOString();
const empty=()=>({defaultProvider:'codex',providers:{}});
const sample={title:'Synthetic delivery',description:'Verify delivery of the blue sample report.',criteria:[{id:'C1',text:'The blue sample report was delivered.'}]};
const evidence={chunks:[{id:'sample-1',text:'The blue sample report was delivered.'}],incomplete:false,totalChunks:1,omittedChunks:0};

export function windowsProviderVault(root){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)return null;
  const instance=createHash('sha256').update(realpathSync.native(root).toLowerCase()).digest('hex').slice(0,20);
  const file=join(process.env.LOCALAPPDATA,'KPI-Panel-Quarterly',instance,'ai-settings.dpapi');
  function dpapi(action,input){
    const script=[
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName System.Security',
      '$data=[Convert]::FromBase64String([Console]::In.ReadToEnd())',
      '[Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::'+action+'($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'
    ].join('; ');
    return execFileSync(join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoProfile','-NonInteractive','-Command',script],{input,encoding:'ascii',windowsHide:true,timeout:10000});
  }
  return {
    load(){
      let encrypted;
      try{encrypted=readFileSync(file,'ascii');}catch(error){if(error.code==='ENOENT')return empty();throw error;}
      return JSON.parse(Buffer.from(dpapi('Unprotect',encrypted),'base64').toString('utf8'));
    },
    save(settings){
      const encrypted=dpapi('Protect',Buffer.from(JSON.stringify(settings)).toString('base64'));
      mkdirSync(dirname(file),{recursive:true});
      const temporary=file+'.'+randomUUID();
      try{writeFileSync(temporary,encrypted,{flag:'wx',mode:0o600});renameSync(temporary,file);}
      finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
    }
  };
}

export function createAiProviderSettings({vault,runModel=assess}={}){
  let settings=empty(),unavailable=false;
  try{if(vault)settings=vault.load();}catch{unavailable=true;}
  let testing=false;
  const entry=provider=>settings.providers[provider];
  const key=provider=>entry(provider)?.apiKey??providerKey(provider);
  function config(provider){
    const base=providerConfig(provider);
    return {...base,model:entry(provider)?.model||base.model};
  }
  const active=provider=>!unavailable&&(entry(provider)?.enabled??(provider==='codex'));
  const defaultProvider=()=>settings.defaultProvider;
  function assertActive(provider){
    config(provider);
    if(!active(provider))fail('این ارائه‌دهنده در تنظیمات AI غیرفعال است.',503);
  }
  async function status({admin=false,allowKeyEntry=false}={}){
    const base=await providerStatus();
    return {defaultProvider:defaultProvider(),...(admin?{editable:!!vault&&!unavailable,allowKeyEntry}:{}),providers:base.providers.map(item=>{
      const {provider}=item,enabled=active(provider),model=config(provider).model,lastTest=entry(provider)?.lastTest||null;
      const configured=provider==='codex'?item.ready:!!(key(provider)&&model);
      const ready=enabled&&configured;
      const message=provider==='codex'?item.message:configured?'مدل و کلید API روی سرور تنظیم شده‌اند.':'برای اتصال، مدل و کلید API را تنظیم کنید.';
      return {provider,ready,enabled,message,...(admin?{model,lastTest,hasKey:provider!=='codex'&&!!key(provider)}:{})};
    })};
  }
  function persist(next){
    try{vault.save(next);}catch{fail('ذخیرهٔ امن تنظیمات AI روی سرور انجام نشد.',503);}
    settings=next;
  }
  function update(provider,patch){
    persist({...settings,providers:{...settings.providers,[provider]:{...entry(provider),...patch}}});
  }
  async function change(provider,action,input,{allowKeyEntry=false}={}){
    if(!vault||unavailable)fail('مخزن امن تنظیمات AI روی این سرور در دسترس نیست.',503);
    if(!providerIds.includes(provider))fail('ارائه‌دهندهٔ مدل معتبر نیست.',400);
    if(testing)fail('تست اتصال در حال اجراست. پس از پایان آن دوباره تلاش کنید.');
    const current=entry(provider);
    if(action==='save'){
      if(typeof input.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(input.model))fail('نام مدل معتبر نیست.',400);
      const hasNewKey=Object.hasOwn(input,'apiKey');
      if(hasNewKey&&(!allowKeyEntry||provider==='codex'))fail('ثبت کلید API فقط از مسیر امن مجاز است.',403);
      if(hasNewKey&&(typeof input.apiKey!=='string'||!/^\S{1,2048}$/.test(input.apiKey)))fail('کلید API معتبر نیست.',400);
      const changed=input.model!==config(provider).model||(hasNewKey&&input.apiKey!==key(provider));
      if(changed)update(provider,{model:input.model,...(hasNewKey?{apiKey:input.apiKey}:{}),enabled:false,lastTest:null});
      return {message:changed?'تنظیمات ذخیره شد. اتصال را تست و دوباره فعال کنید.':'تنظیمات از قبل ذخیره شده است.'};
    }
    if(action==='test'){
      const model=config(provider).model,apiKey=key(provider);
      if(!model||(provider!=='codex'&&!apiKey))fail('ابتدا مدل و کلید API را ثبت کنید.',400);
      testing=true;
      try{
        let ok=false;
        try{
          const {result}=await runModel({provider,prompt:buildPrompt(sample,evidence),timeoutMs:60000},{model,apiKey});
          ok=finalizeReview(result,sample,evidence).decision==='completed';
        }catch{}
        const message=ok?'تست موفق بود. پاسخ و ارجاع نمونه معتبر است.':'تست ناموفق بود. مدل، اعتبار ورود یا کلید، سهمیه و ارتباط سرور را بررسی کنید.';
        update(provider,{model,...(provider!=='codex'?{apiKey}:{}),lastTest:{ok,at:timestamp(),message}});
        return {message,ok};
      }finally{testing=false;}
    }
    if(action==='toggle'){
      if(typeof input.enabled!=='boolean')fail('وضعیت فعال‌سازی معتبر نیست.',400);
      if(input.enabled&&!active(provider)&&!current?.lastTest?.ok)fail('برای فعال‌سازی، ابتدا تست اتصال باید موفق شود.');
      update(provider,{enabled:input.enabled});
      return {message:input.enabled?'ارائه‌دهنده فعال شد.':'ارائه‌دهنده غیرفعال شد.'};
    }
    if(action==='default'){
      if(!active(provider)||!current?.lastTest?.ok)fail('ابتدا اتصال این ارائه‌دهنده را تست و آن را فعال کنید.');
      persist({...settings,defaultProvider:provider});
      return {message:'ارائه‌دهندهٔ پیش‌فرض تغییر کرد.'};
    }
    fail('عملیات تنظیمات AI معتبر نیست.',400);
  }
  async function run(input){
    assertActive(input.provider);
    return runModel(input,{model:config(input.provider).model,apiKey:key(input.provider)});
  }
  return {status,change,config,active,assertActive,defaultProvider,run};
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import {fileURLToPath} from 'node:url';
import { resultSchema } from './evaluation.mjs';
const exec = promisify(execFile);
const DEFAULT_CODEX_MODEL = 'gpt-6-luna';
const DEFAULT_CODEX_REASONING = 'medium';
export const providerIds=['codex','openai','gemini'];
export const providerKey=provider=>provider==='codex'?undefined:process.env[provider.toUpperCase()+'_API_KEY'];
async function codexPath() {
  if(process.env.CODEX_PATH){if(!isAbsolute(process.env.CODEX_PATH))throw new Error('CODEX_PATH باید مسیر مطلق باشد.');return process.env.CODEX_PATH;}
  const result=await exec(process.platform==='win32'?'where.exe':'which',['codex'],{timeout:5000,windowsHide:true});
  const path=result.stdout.trim().split(/\r?\n/).find(p=>process.platform!=='win32'||p.toLowerCase().endsWith('.exe'));
  if(!path||!isAbsolute(path))throw new Error('مسیر Codex پیدا نشد؛ CODEX_PATH را تنظیم کنید.');return path;
}
export function providerConfig(provider) {
  if(!providerIds.includes(provider))throw new Error('ارائه‌دهنده مدل معتبر نیست.');
  return {provider,model:process.env[provider==='codex'?'CODEX_MODEL':provider==='openai'?'OPENAI_MODEL':'GEMINI_MODEL']|| (provider==='codex'?DEFAULT_CODEX_MODEL:null)};
}
export async function providerStatus() {
  let codex={provider:'codex',ready:false,message:'ورود محلی Codex بررسی نشد.'};
  try {
    const result=await exec(await codexPath(),['login','status'],{timeout:10000,windowsHide:true});
    const ready=/ChatGPT/i.test(result.stdout+result.stderr);
    codex={provider:'codex',ready,message:ready?'ورود با حساب ChatGPT فعال است.':'برای استفاده از اشتراک، codex login را اجرا کنید.'};
    await import('@openai/codex-sdk');
  } catch {codex={provider:'codex',ready:false,message:'SDK یا ورود Codex آماده نیست؛ نصب وابستگی‌ها و codex login را بررسی کنید.'};}
  return {defaultProvider:process.env.LLM_PROVIDER||'codex',providers:[codex,
    ...['openai','gemini'].map(provider=>{const ready=!!(process.env[provider.toUpperCase()+'_API_KEY']&&process.env[provider.toUpperCase()+'_MODEL']);return {provider,ready,message:ready?'تنظیمات موجود است؛ اتصال هنگام ارزیابی آزموده می‌شود.':`نیازمند ${provider.toUpperCase()}_API_KEY و ${provider.toUpperCase()}_MODEL روی سرور`};})]};
}
export async function assess({provider,prompt,schema=resultSchema,images=[],timeoutMs=120000},{model,apiKey,reasoningEffort}={}) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw new Error('مهلت اجرای مدل معتبر نیست.');
  if(Buffer.byteLength(prompt)>50000)throw new Error('ورودی مدل از سقف مجاز عبور کرده است.');
  if(images.length>5)throw new Error('حداکثر ۵ تصویر در هر تبدیل.');
  const visual=[];let imageBytes=0;
  for(const image of images){const bytes=await readFile(image.path);imageBytes+=bytes.length;if(imageBytes>8*1024*1024)throw new Error('تصاویر بیش از سقف تبدیل هستند.');visual.push({...image,data:bytes.toString('base64')});}
  const config=providerConfig(provider);
  if(model!==undefined)config.model=model;
  if(provider==='codex') {
    const {Codex}=await import('@openai/codex-sdk');
    const path=await codexPath();
    const login=await exec(path,['login','status'],{timeout:10000,windowsHide:true});
    if(!/ChatGPT/i.test(login.stdout+login.stderr))throw new Error('Codex با حساب ChatGPT وارد نشده است.');
    const workingDirectory=await mkdtemp(join(tmpdir(),'kpi-assessment-'));
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|CODEX_HOME|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|SSL_CERT_FILE)$/i.test(key)));
    try {
    const client=new Codex({codexPathOverride:path,env,config:{forced_login_method:'chatgpt',project_doc_max_bytes:0,model_instructions_file:fileURLToPath(new URL('./reviewer-instructions.md',import.meta.url)),developer_instructions:'Evidence-only processing. No tools or unrelated context.',features:{shell_tool:false,unified_exec:false,apps:false}},configOverrides:['mcp_servers={}','apps._default.enabled=false']});
    const thread=client.startThread({workingDirectory,skipGitRepoCheck:true,sandboxMode:'read-only',approvalPolicy:'never',networkAccessEnabled:false,webSearchMode:'disabled',model:config.model,modelReasoningEffort:reasoningEffort||DEFAULT_CODEX_REASONING});
      const turn=await thread.run(images.length?[{type:'text',text:prompt},...images.map(image=>({type:'local_image',path:image.path}))]:prompt,{outputSchema:schema,signal:AbortSignal.timeout(timeoutMs)});
      if(turn.items.some(i=>['command_execution','mcp_tool_call','web_search','file_change'].includes(i.type)))throw new Error('ارزیابی خارج از محدوده شواهد متوقف شد.');
      return {result:JSON.parse(turn.finalResponse),usage:turn.usage,threadId:thread.id};
    } catch(error) {
      if(/usage limit|quota|rate.?limit|429/i.test(error.message))throw new Error('سقف مصرف حساب مدل رسیده است؛ پس از بازنشانی سهمیه دوباره تلاش کنید.');
      if(error.name==='AbortError'||error.name==='TimeoutError')throw new Error('مهلت پاسخ مدل تمام شد؛ نتیجه نهایی ثبت نشد.');
      throw error;
    } finally {await rm(workingDirectory,{recursive:true,force:true,maxRetries:3}).catch(()=>{});}
  }
  if(!config.model)throw new Error('نام مدل در تنظیمات سرور تعیین نشده است.');
  const key=apiKey??providerKey(provider);
  if(!key)throw new Error('کلید API ارائه‌دهنده روی سرور تنظیم نشده است.');
  const request=provider==='openai'?{
    url:'https://api.openai.com/v1/responses', headers:{Authorization:`Bearer ${key}`},
    body:{model:config.model,...(reasoningEffort?{reasoning:{effort:reasoningEffort}}:{}),input:images.length?[{role:'user',content:[{type:'input_text',text:prompt},...visual.map(image=>({type:'input_image',image_url:`data:${image.mime};base64,${image.data}`,detail:'auto'}))]}]:prompt,store:false,text:{format:{type:'json_schema',name:'activity_review',strict:true,schema}}}
  }:{
    url:`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,headers:{'x-goog-api-key':key},
    body:{contents:[{role:'user',parts:[{text:prompt},...visual.map(image=>({inlineData:{mimeType:image.mime,data:image.data}}))]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema}}
  };
  const response=await fetch(request.url,{method:'POST',headers:{'Content-Type':'application/json',...request.headers},body:JSON.stringify(request.body),signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw new Error(`اتصال مدل ناموفق بود (HTTP ${response.status}).`);
  const data=await response.json();
  const text=provider==='openai'?(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''):(data.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('');
  return {result:JSON.parse(text),usage:data.usage||data.usageMetadata||null};
}

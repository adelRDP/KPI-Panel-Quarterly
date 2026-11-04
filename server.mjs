import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import {existsSync} from 'node:fs';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { extname, join, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openStore } from './backend/store.mjs';
import { extractDocument } from './backend/extract.mjs';
import { validateActivity, sha256 } from './backend/evaluation.mjs';
import { assess, providerStatus, providerConfig } from './backend/providers.mjs';
import { createWorkflow } from './backend/quarterly-workflow.mjs';
import { createOrganizationWorkflow } from './backend/organization-workflow.mjs';
import { createNotificationCenter } from './backend/notifications.mjs';
import { createEvaluationSettings } from './backend/evaluation-settings.mjs';
import {createScoreSettings,submissionRules,submissionQuota} from './backend/score-rules.mjs';
import { createAiLog } from './backend/ai-log.mjs';
import { createPersonalNotes } from './backend/personal-notes.mjs';
import { createChat } from './backend/chat.mjs';
import { createPanelSearch } from './backend/panel-search.mjs';
import { createIncomingArchive } from './backend/incoming-archive.mjs';
import {createAutomaticReview} from './backend/automatic-review.mjs';
import {createActivityHistory} from './backend/activity-history.mjs';
import {createActivityHumanReview,activityHumanFinal,assertActivityHumanWritable} from './backend/activity-human-review.mjs';
import {reviewSummary,reviewReport} from './backend/activity-read.mjs';
import {createReviewRetention,reviewEvidenceMatches} from './backend/review-retention.mjs';
import {loadDemoLogin,verifyDemoLogin} from './backend/demo-login.mjs';
import {createAnnouncements} from './backend/announcements.mjs';
import {createLocalAccounts,createSessionRegistry} from './backend/local-accounts.mjs';
import {createAuthSecurity} from './backend/auth-security.mjs';
import {panelInstance} from './backend/panel-health.mjs';
import {createBackupScheduler} from './backend/panel-backup.mjs';

export function createPanelServer({root=process.cwd(),dataRoot,uploadRoot,publicOrigin,publicOrigins=[],runModel=assess,autoAssessment=true,archiveRejectedEvidence=true,demoLogin,authMode=process.env.PANEL_AUTH_MODE}={}) {
  if(authMode!==undefined&&!['demo','local','hybrid'].includes(authMode))throw Error('PANEL_AUTH_MODE must be demo, local or hybrid');
  const hostedOrigins=new Map();
  for(const origin of [publicOrigin,...publicOrigins].filter(Boolean)){
    const parsed=new URL(origin);
    if(parsed.protocol!=='https:'||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.username||parsed.password)throw new Error('PANEL_PUBLIC_ORIGIN must be an HTTPS origin');
    hostedOrigins.set(parsed.host,parsed.origin);
  }
  // Explicit dataRoot keeps tests isolated; normal operation follows the project data policy.
  const isolated=!!dataRoot;
  // Real local panel is gated by default. Synthetic fixtures can explicitly supply a login.
  let loginConfig=demoLogin===false?null:demoLogin||(isolated&&authMode===undefined?null:loadDemoLogin(root));const loginAttempts=new Map();let loginInFlight=0;
  dataRoot ||= join(root,'data','processed','kpi-panel');
  if(existsSync(join(dataRoot,'RESTORE_IN_PROGRESS')))throw Error('بازیابی این پایگاه داده کامل نشده است؛ ابتدا بازیابی سالم را تکمیل کنید.');
  uploadRoot ||= isolated?join(dataRoot,'uploads'):join(root,'data','raw','kpi-panel');
  const store=openStore(dataRoot); const busy=new Set();
  const workflow=createWorkflow(store),announcements=createAnnouncements(store,workflow),notifications=createNotificationCenter(store,workflow,{announcements}),organization=createOrganizationWorkflow(store,workflow,{runModel,notifications,busy}),evaluationSettings=createEvaluationSettings(store);
  // Hybrid keeps the original shared entry alongside fixed personal identities.
  const hybrid=authMode==='hybrid'||authMode===undefined&&!isolated;
  const localAccounts=authMode==='local'||hybrid?createLocalAccounts(store,workflow):null;
  if(authMode==='local')loginConfig={localAccounts:true};
  const sharedSessions=createSessionRegistry(store,{mode:'demo',revision:()=>sha256(JSON.stringify(loginConfig))});
  const authSecurity=createAuthSecurity(store,workflow);
  const personalSessions=localAccounts?createSessionRegistry(store,{mode:'local',revision:localAccounts.sessionRevision}):null;
  const sessions={get:token=>{const row=personalSessions?.get(token)||(authMode!=='local'?sharedSessions.get(token):null);return row?{...row,authKind:row.mode==='local'?'local':'demo'}:undefined;},set:(token,value)=>(value.authKind==='local'?personalSessions:sharedSessions).set(token,value),delete:token=>{sharedSessions.delete(token);personalSessions?.delete(token);}};
  organization.consolidateDesignDrafts();
  const aiLog=createAiLog(store,workflow);
  const personalNotes=createPersonalNotes(store,workflow,notifications);
  const scoreSettings=createScoreSettings(store);
  const chat=createChat(store,workflow,notifications);
  announcements.setChatDelivery(chat.deliverAnnouncement);
  const panelSearch=createPanelSearch(store,workflow,organization,chat);
  const incomingArchive=createIncomingArchive(store,workflow);
  const automaticReview=createAutomaticReview(store,workflow,{runModel,notifications,busy,uploadRoot,enabled:autoAssessment,archiveRejectedEvidence});
  const activityHistory=createActivityHistory(store);
  const activityHuman=createActivityHumanReview(store,workflow,{notifications,busy});
  const quotaFor=activity=>{const quota=submissionQuota(store,activity);let blockedReason=null;try{assertActivityHumanWritable(store,activity);submissionRules(store,activity,store.list('document',activity.id).filter(d=>!d.archivedAt));}catch(error){blockedReason=error.publicMessage||error.message;}return {...quota,canUpload:quota.remaining!==0&&!blockedReason,blockedReason:blockedReason||(quota.remaining===0?'سقف تحویل این شاخص تکمیل شده است.':null)};};
  for(const attempt of store.list('ai-preprocess-attempt').filter(row=>row.status==='running'))store.put('ai-preprocess-attempt',{...attempt,status:'failed',finishedAt:new Date().toISOString(),error:'پیش‌پردازش با توقف سرویس قطع شد.'},attempt.activitySnapshot?.id);
  async function extractWithLog(path,extension,id,activity,metadata,provider,visualConsent=false){
    if(!['pdf','png','jpg','jpeg','webp','bmp'].includes(extension))return extractDocument(path,extension,id,{provider,sourceHash:metadata.sha256});
    let attempt=store.put('ai-preprocess-attempt',{documentId:id,activitySnapshot:{id:activity.id,title:activity.title,period:activity.period,ownerId:activity.ownerId,unitId:activity.unitId},document:metadata,status:'running',stage:'local_extract',startedAt:new Date().toISOString()},activity.id);
    try{
      const extraction=await extractDocument(path,extension,id,{provider,sourceHash:metadata.sha256,visualConsent,onStage:()=>{attempt=store.put('ai-preprocess-attempt',{...attempt,stage:'visual_transcribe',visualConsent:visualConsent===true,provider:process.env.PREPROCESS_PROVIDER||'local'},activity.id);}});
      const status=extraction.conversion?.status==='disabled'||extraction.status==='needs_conversion'?'blocked':extraction.conversionFailed||extraction.status==='failed'?'failed':'done';
      store.put('ai-preprocess-attempt',{...attempt,status,extraction,finishedAt:new Date().toISOString()},activity.id);return extraction;
    }catch(error){store.put('ai-preprocess-attempt',{...attempt,status:'failed',error:'پیش‌پردازش کامل نشد؛ فایل و اتصال را بررسی کنید.',finishedAt:new Date().toISOString()},activity.id);throw error;}
  }
  const sessionPayload=(sessionToken,actor,authKind='demo')=>({token:sessionToken,user:{...workflow.publicUser(actor),phone:actor.phone||null,employeeCode:actor.employeeCode||null},accounts:workflow.accounts().filter(person=>authKind!=='local'||workflow.canRead(actor,person.id)),demo:authKind!=='local',canManageAccounts:!!localAccounts&&actor.role==='hr',credentialLogin:!!loginConfig,mustChangePassword:authKind==='local'&&(localAccounts?.requiresChange(actor.id)||false),period:workflow.currentPeriod});
  function newSession(res,userId,{remember=false,expires,authKind=authMode==='local'?'local':'demo'}={}){
    const duration=remember?7*24*3600000:12*3600000,sessionToken=randomBytes(32).toString('hex');sessions.set(sessionToken,{userId,remember,authKind,expires:expires||Date.now()+duration});
    res.setHeader('Set-Cookie',`quarterly-panel-session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/${remember||!loginConfig?`; Max-Age=${Math.floor(((expires||Date.now()+duration)-Date.now())/1000)}`:''}${hostedOrigins.size?'; Secure':''}`);
    return sessionPayload(sessionToken,workflow.user(userId),authKind);
  }
  // Interrupted model turns cannot be resumed after a server restart.
  for(const review of store.list('review').filter(r=>r.status==='running')) {const failed=store.put('review',{...review,status:'failed',error:'اجرای قبلی با توقف سرور قطع شد.',finishedAt:new Date().toISOString()},review.activitySnapshot.id);if(archiveRejectedEvidence&&review.inputsVersion==='task-evidence-context-v1')createReviewRetention(store).cleanup(failed);}
  const publicFiles=new Set(['index.html','src/theme.css','src/styles.css','src/theme-mode.js','src/assets/dashboard-glass-bg.svg','src/assets/performance-panel-mark.svg','src/assets/holding-5040.webp','src/assets/holding-5040-collapsed.png','src/assets/kpi-holding-header.png','src/assets/kpi-holding-transparent.png','src/assets/kpi-sidebar-background.png','src/assets/kpi-sidebar-background-day.png','src/assets/Vazirmatn-Variable.woff2','src/app.js','src/excel-profile.js','src/excel-upload.js','src/excel-worker.js','src/kpi-dashboard.js','src/ai-ui.js','src/vendor/xlsx.full.min.js']);
  for(const file of ['src/performance-model.js','src/workflow-ui.js','src/lifecycle-ui.js','src/notifications-ui.js'])publicFiles.add(file);
  publicFiles.add('src/utility-windows.js');
  publicFiles.add('src/announcements-ui.js');
  publicFiles.add('src/persian-date-picker.js');
  publicFiles.add('src/persian-money.js');
  for(const file of ['login.html','src/login.css','src/login.js'])publicFiles.add(file);
  publicFiles.add('src/assets/emerald_kpi_dashboard_login.svg');
  publicFiles.add('src/assets/5040-neon-vector.svg');
  publicFiles.add('src/assets/kpi-analytics-emblem.png');
  publicFiles.add('src/assets/kpi-growth-collapsed.png');
  publicFiles.add('src/ai-log-ui.js');
  publicFiles.add('src/notes-ui.js');
  publicFiles.add('src/chat-ui.js');
  publicFiles.add('src/search-ui.js');
  publicFiles.add('src/score-settings-ui.js');
  publicFiles.add('src/account-security-ui.js');
  for(const name of ['kpi-sidebar-background','kpi-sidebar-background-day','kpi-holding-transparent','holding-5040-collapsed'])publicFiles.add(`src/assets/${name}.webp`);
  const staticCache=new Map();
  const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  const body=async(req,max=65536)=>{const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('حجم درخواست بیش از حد مجاز است.');parts.push(chunk);}return Buffer.concat(parts);};
  const server=createServer(async(req,res)=>{
    try {
      const host=req.headers.host||'';
      const localHost=/^(127\.0\.0\.1|localhost):\d+$/.test(host);
      const hostedOrigin=hostedOrigins.get(host),hosted=!!hostedOrigin;
      if(!localHost&&!hosted)return send(res,403,{error:'Host rejected'});
      if(localHost&&Number(host.split(':')[1])!==server.address()?.port)return send(res,403,{error:'Port rejected'});
      const url=new URL(req.url,`http://${host}`); const path=decodeURIComponent(url.pathname);
      // Public document navigation is safe; cross-site API and mutation requests are not.
      if(req.headers['sec-fetch-site']==='cross-site'&&(path.startsWith('/api/')||!['GET','HEAD'].includes(req.method)))return send(res,403,{error:'Cross-site request rejected'});
      if(req.headers.origin && req.headers.origin!==(hosted?hostedOrigin:`http://${host}`))return send(res,403,{error:'Origin rejected'});
      const cookie=req.headers.cookie?.match(/(?:^|;\s*)quarterly-panel-session=([a-f0-9]{64})(?:;|$)/)?.[1],cookieSession=sessions.get(cookie),validCookie=cookieSession&&cookieSession.expires>Date.now();
      if(loginConfig&&['/','/index.html'].includes(path)&&!validCookie){res.writeHead(302,{Location:'/login.html','Cache-Control':'no-store'});return res.end();}
      if(loginConfig&&path==='/login.html'&&validCookie){res.writeHead(302,{Location:'/','Cache-Control':'no-store'});return res.end();}
      if(path.startsWith('/api/')) {
        if(path==='/api/health'&&req.method==='GET')return send(res,200,{status:'ok',service:'kpi-quarterly-panel',evaluationMode:'quarterly',instance:panelInstance(root)});
        if(path==='/api/auth/options'&&req.method==='GET')return send(res,200,{shared:authMode!=='local'&&!!loginConfig&&!loginConfig.unavailable,personal:!!localAccounts});
        if(path==='/api/login'&&req.method==='POST'){
          if(!loginConfig&&!localAccounts)return send(res,404,{error:'ورود مشترک در این نمونه فعال نیست.'});
          const key=req.socket.remoteAddress||'local',now=Date.now(),attempt=loginAttempts.get(key);
          if(attempt&&attempt.until>now&&attempt.count>=5){res.setHeader('Retry-After',String(Math.ceil((attempt.until-now)/1000)));return send(res,429,{error:'تلاش‌های ناموفق زیاد است؛ چند دقیقه دیگر دوباره امتحان کنید.'});}
          let input;try{input=JSON.parse((await body(req,4096)).toString('utf8'));}catch{return send(res,400,{error:'درخواست ورود معتبر نیست.'});}
          if(!input||typeof input!=='object'||Array.isArray(input))return send(res,400,{error:'درخواست ورود معتبر نیست.'});
          if(loginInFlight>=4)return send(res,429,{error:'ورودهای هم‌زمان زیاد است؛ کمی بعد تلاش کنید.'});
          const access=input.access??(authMode==='local'?'personal':'main'),roles={admin:'hr',manager:'manager',personnel:'personnel'};
          if(!['main','personal',...Object.keys(roles)].includes(access)||access==='main'&&authMode==='local'||access!=='main'&&!localAccounts)return send(res,400,{error:'مسیر ورود معتبر نیست.'});
          const authKind=access==='main'?'demo':'local';
          if(authKind==='demo'&&(!loginConfig||loginConfig.unavailable))return send(res,503,{error:'ورود اصلی روی سرور پیکربندی نشده است.'});
          let loginUserId;loginInFlight++;try{loginUserId=authKind==='local'?await localAccounts.verify(input):verifyDemoLogin(loginConfig,input)?workflow.defaultUserId:null;if(loginUserId&&roles[access]&&workflow.user(loginUserId)?.role!==roles[access])loginUserId=null;}finally{loginInFlight--;}
          if(!loginUserId){
            authSecurity.record('login.failure',{authKind,input});
            if(loginAttempts.size>=1000){for(const [id,row]of loginAttempts)if(row.until<=now)loginAttempts.delete(id);if(loginAttempts.size>=1000)loginAttempts.delete(loginAttempts.keys().next().value);}
            loginAttempts.set(key,{count:attempt&&attempt.until>now?attempt.count+1:1,until:attempt&&attempt.until>now?attempt.until:now+5*60000});return send(res,401,{error:'نام کاربری یا رمز عبور نادرست است.'});
          }
          authSecurity.record('login.success',{authKind,userId:loginUserId});loginAttempts.delete(key);if(validCookie)sessions.delete(cookie);return send(res,200,newSession(res,loginUserId,{remember:input.remember===true,authKind}));
        }
        if(path==='/api/session' && req.method==='GET'){
          if(loginConfig&&!validCookie)return send(res,401,{loginRequired:true,error:'برای ادامه وارد پنل شوید.'});
          return send(res,200,validCookie?sessionPayload(cookie,workflow.user(cookieSession.userId),cookieSession.authKind):newSession(res,workflow.defaultUserId));
        }
        const sessionToken=req.headers['x-panel-token'],session=sessions.get(sessionToken);
        if(!session||session.expires<=Date.now())return send(res,403,{loginRequired:!!loginConfig,error:'نشست منقضی شده؛ دوباره وارد پنل شوید.'});
        const actor=workflow.user(session.userId);
        if(path==='/api/session'&&req.method==='DELETE'){
          authSecurity.record('logout',{authKind:session.authKind,userId:actor.id});
          sessions.delete(sessionToken);res.setHeader('Set-Cookie',`quarterly-panel-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${hostedOrigins.size?'; Secure':''}`);return send(res,200,{loggedOut:true});
        }
        if(session.authKind==='local'&&path==='/api/auth/password'&&req.method==='POST'){
          await localAccounts.changePassword(actor,JSON.parse((await body(req,4096)).toString('utf8')));sessions.delete(sessionToken);return send(res,200,newSession(res,actor.id,{remember:session.remember,expires:session.expires,authKind:'local'}));
        }
        if(session.authKind==='local'&&localAccounts?.requiresChange(actor.id))return send(res,403,{passwordChangeRequired:true,error:'پیش از ادامه، رمز موقت حساب را تغییر دهید.'});
        if(path==='/api/auth/security'&&req.method==='GET')return send(res,200,authSecurity.report(actor));
        if(path==='/api/auth/security/revoke-main'&&req.method==='POST'){const result=authSecurity.revokeShared(actor);if(session.authKind==='demo')res.setHeader('Set-Cookie','quarterly-panel-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return send(res,200,{...result,loggedOut:session.authKind==='demo'});}
        if(path==='/api/auth/accounts/defaults'&&localAccounts&&req.method==='POST')return send(res,200,await localAccounts.createDefaults(actor));
        if(path==='/api/auth/accounts'&&localAccounts){
          if(req.method==='GET')return send(res,200,localAccounts.list(actor));
          if(req.method==='POST')return send(res,200,await localAccounts.save(actor,JSON.parse((await body(req,4096)).toString('utf8'))));
        }
        if(path==='/api/search'&&req.method==='GET')return send(res,200,panelSearch.search(actor,url.searchParams.get('q')||''));
        if(path==='/api/announcements'&&req.method==='GET')return send(res,200,announcements.list(actor));
        const announcementDelete=path.match(/^\/api\/announcements\/([\w-]+)$/);
        if(announcementDelete&&req.method==='DELETE')return send(res,200,announcements.remove(actor,announcementDelete[1]));
        if(path==='/api/announcements'&&req.method==='POST'){
          let input;try{input=JSON.parse((await body(req,32768)).toString('utf8'));}catch{return send(res,400,{error:'درخواست اطلاعیه معتبر نیست.'});}
          const saved=announcements.create(actor,input);clearTimeout(announcementChatTimer);deliverAnnouncementChat();return send(res,201,saved);
        }
        if(path==='/api/session'&&req.method==='POST'){
          if(session.authKind==='local')return send(res,403,{error:'تغییر حساب یا نقش مجاز نیست؛ از حساب خود خارج شوید و با حساب دیگر وارد شوید.'});
          const input=JSON.parse((await body(req)).toString('utf8'));
          if(!workflow.user(input.userId))return send(res,400,{error:'حساب نمایشی معتبر نیست.'});
          authSecurity.record('session.switched',{authKind:'demo',userId:input.userId});
          sessions.delete(sessionToken);return send(res,200,newSession(res,input.userId,{remember:session.remember,expires:session.expires}));
        }
        if(path==='/api/notifications'&&req.method==='GET'){if(['personnel','manager'].includes(actor.role))personalNotes.scan(actor.id);return send(res,200,notifications.list(actor));}
        if(path==='/api/chat/contacts'&&req.method==='GET'){announcements.scanChat();return send(res,200,chat.contacts(actor));}
        const chatMatch=path.match(/^\/api\/chat\/([\w-]+)\/(messages|read)$/);
        if(chatMatch?.[2]==='messages'&&req.method==='GET')return send(res,200,chat.conversation(actor,chatMatch[1],url.searchParams.has('before')?Number(url.searchParams.get('before')):null));
        if(chatMatch?.[2]==='messages'&&req.method==='POST')return send(res,201,chat.send(actor,chatMatch[1],JSON.parse((await body(req,24576)).toString('utf8'))));
        if(chatMatch?.[2]==='read'&&req.method==='POST')return send(res,200,chat.read(actor,chatMatch[1],JSON.parse((await body(req,1024)).toString('utf8')).through));
        if(path==='/api/notes'&&req.method==='GET')return send(res,200,personalNotes.list(actor));
        if(path==='/api/notes'&&req.method==='POST')return send(res,201,personalNotes.save(actor,JSON.parse((await body(req)).toString('utf8'))));
        const noteMatch=path.match(/^\/api\/notes\/([\w-]+)$/);
        if(noteMatch&&req.method==='PUT')return send(res,200,personalNotes.save(actor,JSON.parse((await body(req)).toString('utf8')),noteMatch[1]));
        if(noteMatch&&req.method==='DELETE')return send(res,200,personalNotes.remove(actor,noteMatch[1],JSON.parse((await body(req)).toString('utf8')).revision));
        if(path==='/api/notifications/read-all'&&req.method==='POST')return send(res,200,notifications.markAllRead(actor));
        const notificationRead=path.match(/^\/api\/notifications\/([a-f0-9]{64})\/read$/);
        if(notificationRead&&req.method==='POST')return send(res,200,notifications.markRead(actor,notificationRead[1]));
        if(path==='/api/workflow/me'&&req.method==='GET')return store.withReadCache(()=>send(res,200,workflow.snapshot(actor,actor.id,url.searchParams.get('period')||workflow.currentPeriod)));
        if(path==='/api/workflow/team'&&req.method==='GET')return store.withReadCache(()=>send(res,200,workflow.team(actor,url.searchParams.get('period')||workflow.currentPeriod)));
        const employeeMatch=path.match(/^\/api\/workflow\/employees\/([\w-]+)$/);
        if(employeeMatch&&req.method==='GET')return store.withReadCache(()=>send(res,200,workflow.snapshot(actor,employeeMatch[1],url.searchParams.get('period')||workflow.currentPeriod)));
        if(path==='/api/workflow/surveys'&&req.method==='POST'){const saved=workflow.saveSurvey(actor,JSON.parse((await body(req)).toString('utf8')));notifications.publish({eventKey:`manager-survey:${saved.id}`,recipientIds:[saved.employeeId],actorId:actor.id,kind:'info',title:'ارزیابی مدیر ثبت شد',description:'امتیاز ارزیابی مدیر برای دوره به‌روز شد.',view:'dashboard',entityId:saved.id});return send(res,201,saved);}
        if(path==='/api/workflow/proposals'&&req.method==='GET')return send(res,200,workflow.proposals(actor));
        if(path==='/api/workflow/proposals'&&req.method==='POST')return send(res,201,workflow.submitProposal(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/positions'&&req.method==='GET')return send(res,200,organization.listPositions(actor));
        if(path==='/api/org/settlements'&&req.method==='GET')return send(res,200,organization.settlementPeople(actor));
        if(path==='/api/org/settlements/preview'&&req.method==='POST')return send(res,200,organization.settlementPreview(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/settlements'&&req.method==='POST')return send(res,201,organization.registerSettlement(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/ai-capabilities'&&req.method==='GET')return send(res,200,organization.aiCapabilities(actor));
        const jobAnalysisRoute=path.match(/^\/api\/org\/positions\/([\w-]+)\/analysis$/);
        if(jobAnalysisRoute&&req.method==='GET')return send(res,200,organization.jobAnalysisState(actor,jobAnalysisRoute[1]));
        if(jobAnalysisRoute&&req.method==='POST')return send(res,200,await organization.analyzeJobPosition(actor,jobAnalysisRoute[1],JSON.parse((await body(req)).toString('utf8')||'{}').provider||'codex'));
        const correctionDraft=path.match(/^\/api\/org\/designs\/([\w-]+)\/correction-draft$/);
        if(correctionDraft&&req.method==='POST')return send(res,201,organization.openDesignCorrectionDraft(actor,correctionDraft[1],JSON.parse((await body(req)).toString('utf8'))));
        const acceptedChange=path.match(/^\/api\/org\/designs\/([\w-]+)\/accept-change$/);
        if(acceptedChange&&req.method==='POST')return send(res,201,organization.acceptDesignChange(actor,acceptedChange[1],JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/score-settings'&&req.method==='GET')return send(res,200,scoreSettings.state(actor));
        const scoreAction=path.match(/^\/api\/org\/score-settings\/(save|preview|publish|discard)$/);
        if(scoreAction&&req.method==='POST')return send(res,200,scoreSettings[scoreAction[1]](actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/evaluation-settings'&&req.method==='GET')return send(res,200,evaluationSettings.state(actor));
        if(path==='/api/org/evaluation-settings/draft'&&req.method==='POST')return send(res,200,evaluationSettings.saveDraft(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/evaluation-settings/draft/delete'&&req.method==='POST')return send(res,200,evaluationSettings.deleteDraft(actor,JSON.parse((await body(req)).toString('utf8')||'{}').id));
        if(path==='/api/org/evaluation-settings/preview'&&req.method==='POST')return send(res,200,evaluationSettings.preview(actor,JSON.parse((await body(req)).toString('utf8')||'{}').id));
        if(path==='/api/org/evaluation-settings/publish'&&req.method==='POST')return send(res,200,evaluationSettings.publish(actor,JSON.parse((await body(req)).toString('utf8')||'{}').id));
        if(path==='/api/org/evaluation-settings/published/delete'&&req.method==='POST')return send(res,200,evaluationSettings.deletePublished(actor,JSON.parse((await body(req)).toString('utf8')||'{}').id));
        if(path==='/api/org/units'&&req.method==='GET')return send(res,200,organization.units(actor));
        if(path==='/api/org/incoming/archive'&&req.method==='GET')return send(res,200,incomingArchive.list(actor,{type:url.searchParams.get('type')||'all',search:url.searchParams.get('search')||'',page:url.searchParams.get('page')||'1'}));
        const incomingArchiveDetail=path.match(/^\/api\/org\/incoming\/archive\/(position|design|quarter|appeal)\/([\w-]+)$/);
        if(incomingArchiveDetail&&req.method==='GET')return send(res,200,incomingArchive.detail(actor,incomingArchiveDetail[1],incomingArchiveDetail[2]));
        if(path==='/api/org/units'&&req.method==='POST')return send(res,201,organization.createUnit(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/sections'&&req.method==='GET')return send(res,200,organization.sections(actor));
        if(path==='/api/org/sections'&&req.method==='POST')return send(res,201,organization.createSection(actor,JSON.parse((await body(req)).toString('utf8'))));
        const structureDelete=path.match(/^\/api\/org\/(units|sections)\/([^/]+)$/);
        if(structureDelete&&req.method==='DELETE'){let id;try{id=decodeURIComponent(structureDelete[2]);}catch{return send(res,400,{error:'شناسه معتبر نیست.'});}return send(res,200,structureDelete[1]==='units'?organization.removeUnit(actor,id):organization.removeSection(actor,id));}
        if(path==='/api/org/chart'&&req.method==='GET')return send(res,200,organization.chart(actor));
        if(path==='/api/org/positions'&&req.method==='POST')return send(res,201,organization.proposePosition(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/people'&&req.method==='POST')return send(res,201,organization.createPerson(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/task-deadlines'&&req.method==='GET')return send(res,200,organization.taskDeadlines(actor));
        if(path==='/api/org/positions/review'&&req.method==='GET')return send(res,200,organization.positionProposals(actor));
        if(path==='/api/org/position-closeouts'&&req.method==='GET')return send(res,200,organization.closeoutHistory(actor,actor.role==='hr'?undefined:actor.id));
        const positionCloseout=path.match(/^\/api\/org\/positions\/([\w-]+)\/closeout$/);
        if(positionCloseout&&req.method==='GET')return store.withReadCache(()=>send(res,200,organization.positionCloseoutPreview(actor,positionCloseout[1])));
        if(path==='/api/org/personnel-requests'&&req.method==='GET')return send(res,200,organization.personnelRequests(actor));
        const positionDuties=path.match(/^\/api\/org\/positions\/([\w-]+)\/duties$/);
        if(positionDuties&&req.method==='POST')return send(res,200,organization.updatePositionDuties(actor,positionDuties[1],JSON.parse((await body(req)).toString('utf8'))));
        const positionAction=path.match(/^\/api\/org\/positions\/([\w-]+)\/(review|approval)$/);
        if(positionAction&&req.method==='POST'){
          const input=JSON.parse((await body(req)).toString('utf8'));
          return send(res,200,positionAction[2]==='review'?organization.reviewPosition(actor,positionAction[1],input):organization.approvePosition(actor,positionAction[1],input));
        }
        const positionRevision=path.match(/^\/api\/org\/positions\/([\w-]+)\/revision$/);
        if(positionRevision&&req.method==='POST')return send(res,201,organization.revisePosition(actor,positionRevision[1],JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/designs'&&req.method==='GET')return send(res,200,organization.listDesigns(actor));
        if(path==='/api/org/designs'&&req.method==='POST')return send(res,201,organization.submitDesign(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/designs/drafts'&&req.method==='POST')return send(res,201,organization.saveDesignDraft(actor,JSON.parse((await body(req,1024*1024)).toString('utf8'))));
        const designAction=path.match(/^\/api\/org\/designs\/([\w-]+)\/(analyze|review|approval|revision|draft|publish|delete|copy-next-month|clarifications)$/);
        if(designAction&&req.method==='POST'){
          const input=JSON.parse((await body(req,['clarifications','draft','revision'].includes(designAction[2])?1024*1024:65536)).toString('utf8'));
          if(designAction[2]==='publish'&&!Number.isSafeInteger(input?.draftRevision))return send(res,409,{error:'برای انتشار، نسخهٔ پیش‌نویس لازم است؛ فهرست را تازه کنید.'});
          const result=designAction[2]==='clarifications'?organization.saveDesignClarifications(actor,designAction[1],input):designAction[2]==='draft'?organization.saveDesignDraft(actor,input,designAction[1]):
            designAction[2]==='copy-next-month'?organization.copyDesignToNextMonth(actor,designAction[1],input):
            designAction[2]==='publish'?await organization.publishDesignDraft(actor,designAction[1],input.provider||'codex',input.draftRevision):
            designAction[2]==='delete'?organization.removeDesign(actor,designAction[1]):
            designAction[2]==='analyze'?await organization.analyzeDesign(actor,designAction[1],input.provider||'codex'):
            designAction[2]==='review'?organization.managerReviewDesign(actor,designAction[1],input):
            designAction[2]==='approval'?organization.hrReviewDesign(actor,designAction[1],input):organization.reviseDesign(actor,designAction[1],input);
          return send(res,200,result);
        }
        const quarterEmployee=path.match(/^\/api\/org\/quarters\/(14\d{2}-Q[1-4])\/employees\/([\w-]+)\/submit$/);
        if(quarterEmployee&&req.method==='POST')return send(res,201,organization.submitQuarter(actor,quarterEmployee[1],quarterEmployee[2]));
        const quarterRoute=path.match(/^\/api\/org\/quarters\/(14\d{2}-Q[1-4])$/);
        const quarterProgress=path.match(/^\/api\/org\/quarters\/(14\d{2}-Q[1-4])\/progress$/);
        if(quarterProgress&&req.method==='GET')return send(res,200,organization.quarterProgress(actor,quarterProgress[1],url.searchParams.get('period')));
        if(quarterRoute&&req.method==='GET')return send(res,200,organization.quarterTeam(actor,quarterRoute[1]));
        if(path==='/api/org/evaluations'&&req.method==='GET')return send(res,200,organization.listEvaluations(actor));
        const evaluationApproval=path.match(/^\/api\/org\/evaluations\/([\w-]+)\/approval$/);
        if(evaluationApproval&&req.method==='POST')return send(res,200,organization.approveQuarter(actor,evaluationApproval[1],JSON.parse((await body(req)).toString('utf8'))));
        const finalExcel=path.match(/^\/api\/org\/export\/final\/(14\d{2}-Q[1-4])$/);
        if(finalExcel&&req.method==='GET'){const output=organization.finalExcel(actor,finalExcel[1]);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${output.filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(Buffer.from(output.data));}
        if(path==='/api/org/appeals'&&req.method==='GET')return send(res,200,organization.listAppeals(actor));
        if(path==='/api/org/appeals'&&req.method==='POST')return send(res,201,organization.submitAppeal(actor,JSON.parse((await body(req)).toString('utf8'))));
        const appealFiles=path.match(/^\/api\/org\/appeals\/([a-f0-9-]{36})\/files(?:\/([a-f0-9-]{36}))?$/);
        if(appealFiles&&req.method==='POST'&&!appealFiles[2]){
          organization.canUploadAppealFile(actor,appealFiles[1]);
          const name=url.searchParams.get('name');if(!name||name.length>200||/[/\\\x00-\x1f]/.test(name))return send(res,400,{error:'نام فایل معتبر نیست.'});
          const bytes=await body(req,10*1024*1024);if(!bytes.length)return send(res,400,{error:'فایل خالی است.'});
          const id=randomUUID(),directory=join(uploadRoot,'appeals'),filePath=join(directory,id);await mkdir(directory,{recursive:true});await writeFile(filePath,bytes,{flag:'wx'});
          try{return send(res,201,organization.addAppealFile(actor,appealFiles[1],{id,name,size:bytes.length,sha256:sha256(bytes)}));}
          catch(error){await unlink(filePath);throw error;}
        }
        if(appealFiles&&req.method==='GET'&&appealFiles[2]){
          const file=organization.appealFile(actor,appealFiles[1],appealFiles[2]),bytes=await readFile(join(uploadRoot,'appeals',file.id));
          const encodedName=encodeURIComponent(file.name).replace(/[!'()*]/g,character=>`%${character.charCodeAt(0).toString(16).toUpperCase()}`);
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="appeal-file"; filename*=UTF-8''${encodedName}`,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
        }
        const appealResubmit=path.match(/^\/api\/org\/appeals\/([\w-]+)\/resubmit$/);
        if(appealResubmit&&req.method==='POST')return send(res,200,organization.resubmitAppeal(actor,appealResubmit[1],JSON.parse((await body(req)).toString('utf8'))));
        const appealReview=path.match(/^\/api\/org\/appeals\/([\w-]+)\/review$/);
        if(appealReview&&req.method==='POST')return send(res,200,organization.reviewAppeal(actor,appealReview[1],JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/evaluation-models'&&req.method==='GET')return send(res,200,organization.evaluationModels(actor,url.searchParams.get('period')||workflow.currentPeriod));
        if(path==='/api/org/surveys'&&req.method==='GET')return send(res,200,organization.serviceCampaigns(actor));
        if(path==='/api/org/surveys/service'&&req.method==='POST')return send(res,201,organization.createServiceCampaign(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/surveys/service/publish-month'&&req.method==='POST')return send(res,200,organization.publishServiceCampaignMonth(actor,JSON.parse((await body(req)).toString('utf8')).period));
        if(path==='/api/org/surveys/service/remove-month'&&req.method==='POST')return send(res,200,organization.removeServiceCampaignMonth(actor,JSON.parse((await body(req)).toString('utf8')).period));
        const serviceSurveyAction=path.match(/^\/api\/org\/surveys\/service\/([\w-]+)\/(response|publish|remove|close)$/);
        if(serviceSurveyAction&&req.method==='POST'){
          const input=JSON.parse((await body(req)).toString('utf8'));
          const action=serviceSurveyAction[2],result=action==='response'?organization.submitServiceResponse(actor,serviceSurveyAction[1],input):action==='publish'?organization.publishServiceCampaign(actor,serviceSurveyAction[1]):action==='remove'?organization.removeServiceCampaign(actor,serviceSurveyAction[1]):organization.closeServiceCampaign(actor,serviceSurveyAction[1]);
          return send(res,200,result);
        }
        if(path==='/api/org/sources'&&req.method==='GET')return send(res,200,organization.sourceCatalog(actor));
        if(path==='/api/org/exams/imports'&&req.method==='GET')return send(res,200,organization.listExamImports(actor));
        if(path==='/api/org/exams/imports/remove'&&req.method==='POST')return send(res,200,organization.removeExamImport(actor,JSON.parse((await body(req)).toString('utf8')).id));
        if(path==='/api/org/exams/import'&&req.method==='POST')return send(res,201,organization.importExamBatch(actor,JSON.parse((await body(req)).toString('utf8'))));
        if(path==='/api/org/ai-log'&&req.method==='GET')return send(res,200,aiLog.list(actor,Object.fromEntries(url.searchParams)));
        const aiLogArchive=path.match(/^\/api\/org\/ai-log\/([^/]+)\/archive$/);
        if(aiLogArchive&&req.method==='POST')return send(res,200,aiLog.setArchived(actor,aiLogArchive[1],JSON.parse((await body(req)).toString('utf8'))));
        if(path.startsWith('/api/org/ai-log/')&&req.method==='GET')return send(res,200,aiLog.detail(actor,path.slice('/api/org/ai-log/'.length)));
        if(path==='/api/providers' && req.method==='GET')return send(res,200,{...await providerStatus(),automaticReview:autoAssessment});
        if(path==='/api/activity-human-reviews'&&req.method==='GET')return send(res,200,activityHuman.list(actor));
        const humanMatch=path.match(/^\/api\/activities\/([a-f0-9-]+)\/human-review(?:\/(submit|decision|documents)(?:\/([a-f0-9-]+))?)?$/);
        if(humanMatch){
          const a=store.get(humanMatch[1],'activity');if(!a||a.removedAt)return send(res,404,{error:'شاخص پیدا نشد.'});
          if(req.method==='GET'&&!humanMatch[2])return store.withReadCache(()=>send(res,200,activityHuman.state(actor,a)));
          if(req.method==='GET'&&humanMatch[2]==='documents'&&humanMatch[3]){const d=activityHuman.document(actor,a.id,humanMatch[3]),bytes=await readFile(d.path);if(sha256(bytes)!==d.sha256)return send(res,409,{error:'محتوای فایل با نسخه ثبت‌شده مطابقت ندارد.'});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});return res.end(bytes);}
          if(req.method==='POST'&&!humanMatch[3]&&['submit','decision'].includes(humanMatch[2])){const input=JSON.parse((await body(req)).toString('utf8'));return send(res,200,humanMatch[2]==='submit'?activityHuman.submit(actor,a.id,input):activityHuman.decide(actor,a.id,input));}
          return send(res,405,{error:'روش درخواست پشتیبانی نمی‌شود.'});
        }
        if(path==='/api/activities' && req.method==='GET')return send(res,200,store.list('activity').filter(a=>!a.removedAt&&workflow.canRead(actor,a.ownerId)).map(a=>({...a,ownerName:workflow.user(a.ownerId)?.name})));
        if(path==='/api/activities' && req.method==='POST') {
          const activity=validateActivity(JSON.parse((await body(req)).toString('utf8')));
          if(actor.role==='personnel'&&(workflow.user(actor.id)?.isSettled||(/^14\d{2}-Q[1-4]$/.test(activity.period)?workflow.userAt(actor.id,activity.period):workflow.user(actor.id))?.isKpiEligible===false))return send(res,403,{error:'این فرد خارج از فرایند KPI است.'});
          if(actor.role!=='personnel')return send(res,403,{error:'تخصیص فعالیت توسط مدیر از مسیر پیشنهاد انجام می‌شود.'});
          return send(res,201,store.put('activity',{...activity,ownerId:actor.id,unitId:actor.unitId,assignmentStatus:'personal',createdAt:new Date().toISOString()}));
        }
        const reportMatch=path.match(/^\/api\/activities\/([a-f0-9-]+)\/reviews\/([^/]+)$/);
        if(reportMatch&&req.method==='GET'){
          const activity=store.get(reportMatch[1],'activity');
          if(!activity||activity.removedAt)return send(res,404,{error:'فعالیت پیدا نشد.'});
          if(!workflow.canRead(actor,activity.ownerId))return send(res,403,{error:'دسترسی مجاز نیست.'});
          const review=store.get(decodeURIComponent(reportMatch[2]),'review',activity.id);
          if(!review)return send(res,404,{error:'تحلیل این نوبت پیدا نشد.'});
          return send(res,200,{...reviewReport(review),resumeAvailable:automaticReview.canResume(actor,activity,review.id)});
        }
        const match=path.match(/^\/api\/activities\/([a-f0-9-]+)(?:\/(documents|reviews|quota)(?:\/([a-f0-9-]+))?)?$/);
        if(!match)return send(res,404,{error:'مسیر پیدا نشد.'});
        const activity=store.get(match[1],'activity'); if(!activity||activity.removedAt)return send(res,404,{error:'فعالیت پیدا نشد.'});
        if(!workflow.canRead(actor,activity.ownerId))return send(res,403,{error:'دسترسی به این فعالیت مجاز نیست.'});
        if(req.method!=='GET'&&actor.id!==activity.ownerId)return send(res,403,{error:'ثبت مستند و ارزیابی فقط برای فعالیت خود فرد مجاز است.'});
        if(req.method!=='GET')assertActivityHumanWritable(store,activity);
        if(req.method!=='GET'&&workflow.user(activity.ownerId)?.role==='personnel'&&(workflow.user(activity.ownerId)?.isSettled||(/^14\d{2}-Q[1-4]$/.test(activity.period)?workflow.userAt(activity.ownerId,activity.period):workflow.user(activity.ownerId))?.isKpiEligible===false))return send(res,403,{error:'این فرد خارج از فرایند KPI است.'});
        if(match[2]==='quota'&&req.method==='GET'&&!match[3])return store.withReadCache(()=>send(res,200,url.searchParams.get('humanReview')==='1'?{submissionQuota:quotaFor(activity),humanReview:activityHuman.state(actor,activity)}:quotaFor(activity)));
        if(!match[2]&&req.method==='GET')return store.withReadCache(()=>{
          const documents=store.list('document',activity.id).filter(d=>!d.archivedAt),reviews=store.list('review',activity.id),latest=reviews.find(r=>r.status==='done');
          return send(res,200,{activity,documents:documents.map(({path,...d})=>({...d,extractionHash:sha256(JSON.stringify(d.extraction))})),reviews:url.searchParams.get('summary')==='1'?reviews.map(reviewSummary):reviews,history:activityHistory.list(activity),submissionQuota:quotaFor(activity),humanReview:activityHuman.state(actor,activity),humanFinal:activityHumanFinal(store,activity)?.result||null,...(latest?{reviewMatchesCurrentEvidence:reviewEvidenceMatches(store,activity,latest)}:{})});
        });
        const documents=store.list('document',activity.id).filter(d=>!d.archivedAt);
        const batchId=url.searchParams.get('batchId')||randomUUID();
        const uploaded=async(doc,code=200)=>{const submittedDocuments=store.list('document',activity.id).filter(d=>!d.archivedAt),deferred=url.searchParams.get('deferReview')==='1',autoReview=deferred?null:await automaticReview.afterUpload(actor,activity,url.searchParams.get('provider')||process.env.LLM_PROVIDER||'codex',{privacyConfirmed:url.searchParams.get('workEvidence')==='true'});activityHistory.upload(actor,activity,{batchId,document:doc,documents:submittedDocuments,deferred,review:autoReview,error:autoReview?.error});return send(res,code,{...doc,path:undefined,autoReview});};
        if(match[3]) {
          if(match[2]!=='documents'||req.method!=='DELETE')return send(res,405,{error:'روش درخواست پشتیبانی نمی‌شود.'});
          if(busy.has(activity.id))return send(res,409,{error:'پردازش در حال اجرا است.'});
          const doc=documents.find(d=>d.id===match[3]);if(!doc)return send(res,404,{error:'مستند پیدا نشد.'});
          store.put('document',{...doc,archivedAt:new Date().toISOString()},activity.id);
          notifications.publish({eventKey:`document-archived:${doc.id}`,recipientIds:[workflow.user(activity.ownerId)?.managerId],actorId:actor.id,kind:'info',title:'مستند فعالیت تغییر کرد',description:'یک مستند از فعالیت پرسنل بایگانی شد.',view:'team',entityId:activity.id});
          return send(res,200,{archived:true});
        }
        if(match[2]==='documents' && req.method==='POST') {
          if(busy.has(activity.id))return send(res,409,{error:'ارزیابی در حال اجرا است؛ پس از پایان فایل اضافه کنید.'});
          submissionRules(store,activity,documents);
          if(documents.length>=20)throw new Error('حداکثر ۲۰ مستند برای هر فعالیت.');
          const name=url.searchParams.get('name');if(!name||name.length>200||/[\x00-\x1f]/.test(name))throw new Error('نام فایل معتبر نیست.');
          activityHistory.start(actor,activity,batchId);
          busy.add(activity.id);
          try {
            const bytes=await body(req,25*1024*1024);if(!bytes.length)throw new Error('فایل خالی است.');
            assertActivityHumanWritable(store,store.get(activity.id,'activity'));
            const digest=sha256(bytes); const old=documents.find(d=>d.sha256===digest);
            if(!old&&submissionQuota(store,activity).remaining===0)throw Object.assign(Error('سقف نوبت‌های تحویل این شاخص طبق تنظیمات امتیاز تکمیل شده است.'),{status:409});
            const provider=url.searchParams.get('provider')||process.env.LLM_PROVIDER||'codex';providerConfig(provider);
            if(old){
              if(old.extraction.conversionFailed||['failed','needs_conversion'].includes(old.extraction.status)) {
                const extraction=await extractWithLog(old.path,extname(name).slice(1).toLowerCase(),old.id,activity,{id:old.id,name:old.name,size:old.size,sha256:old.sha256},provider,url.searchParams.get('visualConsent')==='true');
                assertActivityHumanWritable(store,store.get(activity.id,'activity'));
                return await uploaded(store.put('document',{...old,extraction},activity.id));
              }
              return await uploaded(old);
            }
            const id=randomUUID(); await mkdir(uploadRoot,{recursive:true});
            const filePath=join(uploadRoot,id); await writeFile(filePath,bytes,{flag:'wx'});
            const extraction=await extractWithLog(filePath,extname(name).slice(1).toLowerCase(),id,activity,{id,name,size:bytes.length,sha256:digest},provider,url.searchParams.get('visualConsent')==='true');
            // The quarter can be locked while streamed input or extraction awaits.
            // Only remove this newly created, still-unregistered file on rejection.
            try{assertActivityHumanWritable(store,store.get(activity.id,'activity'));}catch(error){await unlink(filePath);throw error;}
            const doc=store.put('document',{id,name,size:bytes.length,sha256:digest,path:filePath,extraction,createdAt:new Date().toISOString()},activity.id);
            notifications.publish({eventKey:`document-uploaded:${id}`,recipientIds:[workflow.user(activity.ownerId)?.managerId],actorId:actor.id,kind:'info',title:'مستند جدید بارگذاری شد',description:'برای یک فعالیت پرسنلی مستند تازه ثبت شده است.',view:'team',entityId:activity.id});
            return await uploaded(doc,201);
          } catch(error){activityHistory.failed(activity,batchId,error.publicMessage||(/^[\u0600-\u06ff]/.test(error.message)?error.message:'بارگذاری کامل نشد.'));throw error;} finally {busy.delete(activity.id);}
        }
        if(match[2]==='reviews' && req.method==='POST') {
          if(busy.size)return send(res,409,{error:'یک پردازش دیگر در حال اجرا است؛ کمی بعد تلاش کنید.'});
          // Lock before awaiting a streamed body, including cached and invalid requests.
          busy.add(activity.id);
          try {
          const input=JSON.parse((await body(req)).toString('utf8'));
          let review;try{review=input.resumeReviewId?await automaticReview.resume(actor,activity,input.resumeReviewId):await automaticReview.queue(actor,activity,input.provider||process.env.LLM_PROVIDER||'codex',{retry:true});}catch(error){if(error.evidenceDisposition?.archivedDocumentIds?.length)activityHistory.blockedAnalysis(actor,activity,documents,error);throw error;}
          activityHistory.analysis(actor,activity,review);
          return send(res,200,input.resumeReviewId?review:review.status==='queued'?await automaticReview.execute(review):review);
          } finally {busy.delete(activity.id);}
        }
        return send(res,405,{error:'روش درخواست پشتیبانی نمی‌شود.'});
      }
      if(!['GET','HEAD'].includes(req.method))return send(res,405,{error:'Method not allowed'});
      const relative=path==='/'?'index.html':path.slice(1);
      if(!publicFiles.has(relative))return send(res,404,{error:'Not found'});
      const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml; charset=utf-8','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'};
      const filePath=join(root,relative),fileStat=await stat(filePath);
      let asset=staticCache.get(relative);
      if(!asset||asset.mtimeMs!==fileStat.mtimeMs||asset.size!==fileStat.size){
        const data=await readFile(filePath);
        asset={data,hash:sha256(data),mtimeMs:fileStat.mtimeMs,size:fileStat.size,encodings:new Map()};staticCache.set(relative,asset);
      }
      const contentType=mime[extname(relative)],compressible=/^(text\/|image\/svg\+xml)/.test(contentType);
      const encodings=(req.headers['accept-encoding']||'').split(',').map(value=>{
        const [name,...parameters]=value.trim().split(';'),quality=parameters.find(parameter=>parameter.trim().startsWith('q='));
        return {name,quality:quality===undefined?1:Number(quality.trim().slice(2))};
      }).filter(value=>['br','gzip'].includes(value.name)&&value.quality>0).sort((a,b)=>b.quality-a.quality||(a.name==='br'?-1:1));
      const encoding=compressible&&asset.data.length>512?encodings[0]?.name:undefined;
      const headers={'Content-Type':contentType,'Cache-Control':url.searchParams.get('v')===asset.hash.slice(0,12)?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff',ETag:`W/"${asset.hash}"`};
      if(['index.html','login.html'].includes(relative))headers['Cache-Control']='no-store';
      if(compressible)headers.Vary='Accept-Encoding';
      if((req.headers['if-none-match']||'').split(',').map(value=>value.trim()).some(value=>value==='*'||value===headers.ETag||value===headers.ETag.slice(2))){res.writeHead(304,headers);return res.end();}
      let data=asset.data;
      if(encoding){
        if(!asset.encodings.has(encoding))asset.encodings.set(encoding,encoding==='br'?brotliCompressSync(asset.data,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:4}}):gzipSync(asset.data));
        data=asset.encodings.get(encoding);headers['Content-Encoding']=encoding;
      }
      headers['Content-Length']=data.length;
      res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data);
    } catch(error) {
      if(!error.status&&!error.publicMessage&&!/^[\u0600-\u06ff]/.test(error.message||'')){
        console.error('[panel] unexpected request error',req.method,new URL(req.url,'http://localhost').pathname,error);
      }
      send(res,error.status||400,{error:error.publicMessage||(/^[\u0600-\u06ff]/.test(error.message)?error.message:'پردازش ناموفق بود. اتصال مدل یا ساختار فایل را بررسی کنید.')});
    }
  });
  organization.scanDeadlines();const deadlineTimer=setInterval(()=>{try{organization.scanDeadlines();}catch{}},60*60*1000);deadlineTimer.unref();
  personalNotes.scan();const noteTimer=setInterval(()=>{try{personalNotes.scan();}catch{}},30000);noteTimer.unref();
  let announcementChatTimer;
  function deliverAnnouncementChat(){let next=null;try{next=announcements.scanChat().nextStartAt;}catch{console.error('[announcement-chat] Delivery unavailable; retry scheduled.');}announcementChatTimer=setTimeout(deliverAnnouncementChat,next?Math.min(30000,Math.max(50,next-Date.now()+25)):30000);announcementChatTimer.unref();}
  deliverAnnouncementChat();
  const backupScheduler=createBackupScheduler({dataRoot,uploadRoot,backupRoot:process.env.PANEL_BACKUP_ROOT||join(root,'data/local/backups'),enabled:process.env.PANEL_BACKUP_ENABLED==='true'||!isolated&&process.env.PANEL_BACKUP_ENABLED!=='false',isBusy:()=>busy.size>0||['ai-design-attempt','ai-preprocess-attempt','ai-role-run'].some(kind=>store.list(kind).some(row=>['queued','running'].includes(row.status))),onError:()=>console.error('[backup] Complete backup unavailable; will retry. Previous backups were preserved.')});
  server.on('close',()=>{automaticReview.stop();backupScheduler.stop();clearInterval(deadlineTimer);clearInterval(noteTimer);clearTimeout(announcementChatTimer);store.close();});return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const port=Number(process.env.PORT||4273),bindHost=process.env.PANEL_BIND_HOST||'127.0.0.1';
  createPanelServer({dataRoot:process.env.PANEL_DATA_ROOT,uploadRoot:process.env.PANEL_UPLOAD_ROOT,publicOrigin:process.env.PANEL_PUBLIC_ORIGIN,publicOrigins:(process.env.PANEL_PUBLIC_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean)}).listen(port,bindHost,()=>console.log(`KPI Panel listening on ${bindHost}:${port}`));
}

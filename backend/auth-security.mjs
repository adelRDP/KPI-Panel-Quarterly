const admin=actor=>{if(actor?.role!=='hr')throw Object.assign(Error('گزارش امنیت فقط برای ادمین مجاز است.'),{status:403});};
export function createAuthSecurity(store,workflow){
 function record(action,{authKind='local',userId=null,input}={}){
  // Never retain arbitrary usernames, passwords, raw tokens or request bodies.
  if(!userId&&authKind==='local'&&typeof input?.username==='string'){const normalized=input.username.normalize('NFKC').trim().toLocaleLowerCase('en-US');userId=store.list('local-account').find(row=>row.username===normalized)?.userId||null;}
  const at=new Date().toISOString(),subject=authKind==='demo'?'main':userId;
  return store.transaction(()=>{
   const event=store.put('auth-event',{action,authKind,userId:authKind==='demo'?null:userId,...(action==='session.switched'?{viewedUserId:userId}:{}),createdAt:at});
   if(subject&&['login.success','login.failure'].includes(action)){const id='auth-state-'+subject,previous=store.get(id,'auth-security-state')||{};store.put('auth-security-state',{...previous,id,userId:authKind==='demo'?null:userId,authKind,...(action==='login.success'?{lastLoginAt:at}:{lastFailedAt:at,failedAttempts:(previous.failedAttempts||0)+1})});}
   return event;
  });
 }
 const name=(id,kind)=>kind==='demo'?'ورود اصلی':workflow.user(id)?.name||'حساب ناشناس';
 function report(actor){admin(actor);return {
  main:{...store.get('auth-state-main','auth-security-state'),name:'ورود اصلی',activeSessions:store.list('auth-session').filter(row=>row.mode==='demo'&&row.expires>Date.now()).length},
  accounts:store.list('local-account').map(row=>{const state=store.get('auth-state-'+row.userId,'auth-security-state');return {userId:row.userId,name:name(row.userId,'local'),username:row.username,enabled:row.enabled,lastLoginAt:state?.lastLoginAt||null,lastFailedAt:state?.lastFailedAt||null,failedAttempts:state?.failedAttempts||0};}),
  events:[...store.recent('auth-event',100).map(row=>({id:row.id,action:row.action,name:name(row.userId,row.authKind),...(row.viewedUserId?{viewedName:workflow.user(row.viewedUserId)?.name||'فرد ثبت‌شده'}:{}),createdAt:row.createdAt})),...store.recent('audit-event',300).filter(row=>row.entityType==='account').slice(0,100).map(row=>({id:row.id,action:row.action,name:row.action==='account.shared-sessions-revoked'?'ورود اصلی':name(row.entityId,'local'),actorName:workflow.user(row.actorId)?.name||'سیستم',createdAt:row.createdAt}))].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,100)
 };}
 function revokeShared(actor){admin(actor);return store.transaction(()=>{let revoked=0;for(const row of store.list('auth-session').filter(row=>row.mode==='demo')){store.remove(row.id,'auth-session',null);revoked++;}store.put('audit-event',{actorId:actor.id,action:'account.shared-sessions-revoked',entityType:'account',entityId:null,details:{revoked},createdAt:new Date().toISOString()});return {revoked};});}
 return {record,report,revokeShared};
}

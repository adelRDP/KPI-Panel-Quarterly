import {randomBytes,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt),digest=async(password,salt)=>Buffer.from(await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}));
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const username=value=>typeof value==='string'?value.normalize('NFKC').trim().toLocaleLowerCase('en-US'):'';
const key=id=>'local-account-'+id;
const passwordValid=value=>typeof value==='string'&&value.length>=12&&value.length<=128;
export function createLocalAccounts(store,workflow){
 let defaultsRunning=false;
 const account=id=>store.get(key(id),'local-account');
 const metadata=row=>({userId:row.userId,username:row.username,enabled:row.enabled,revision:row.revision,mustChangePassword:row.mustChangePassword,updatedAt:row.updatedAt});
 const isAdmin=actor=>{if(actor?.role!=='hr')fail('مدیریت حساب‌ها فقط برای ادمین مجاز است.',403);};
 function sessionRevision(id){const row=account(id);return row?.enabled&&workflow.user(id)?row.revision:null;}
 function requiresChange(id){return account(id)?.mustChangePassword===true;}
 async function verify(input){
  if(typeof input?.password!=='string'||input.password.length>512||typeof input?.username!=='string'||input.username.length>128)return null;
  const normalized=username(input.username),row=store.list('local-account').find(a=>a.username===normalized),salt=row?.salt||'0'.repeat(32),candidate=await digest(input.password,salt),expected=Buffer.from(row?.digest||'0'.repeat(128),'hex');
  return timingSafeEqual(candidate,expected)&&row?.enabled&&workflow.user(row.userId)?row.userId:null;
 }
 async function save(actor,input,{bootstrap=false}={}){
  if(!bootstrap)isAdmin(actor);else if(store.list('local-account').length)fail('حساب اولیه قبلاً ساخته شده است.',409);
  const person=workflow.user(input.userId);if(!person)fail('فرد معتبر نیست.',404);if(bootstrap&&person.role!=='hr')fail('حساب اولیه باید متعلق به ادمین باشد.');
  const normalized=username(input.username);if(!/^[\p{L}\p{N}_.@-]{3,128}$/u.test(normalized))fail('نام کاربری باید ۳ تا ۱۲۸ نویسه و بدون فاصله باشد.');
  const previous=account(person.id),enabled=input.enabled!==false;
  if(!previous&&!passwordValid(input.password)||input.password!==undefined&&!passwordValid(input.password))fail('رمز عبور باید بین ۱۲ تا ۱۲۸ نویسه باشد.');
  if(!enabled&&person.role==='hr'&&!store.list('local-account').some(a=>a.userId!==person.id&&a.enabled&&workflow.user(a.userId)?.role==='hr'))fail('آخرین حساب ادمین را نمی‌توان غیرفعال کرد.',409);
  const salt=input.password!==undefined?randomBytes(16).toString('hex'):previous.salt,hash=input.password!==undefined?(await digest(input.password,salt)).toString('hex'):previous.digest;
  return store.transaction(()=>{
   if(bootstrap&&store.list('local-account').length)fail('حساب اولیه قبلاً ساخته شده است.',409);
   if((account(person.id)?.revision||0)!==(previous?.revision||0))fail('حساب هم‌زمان تغییر کرده است؛ دوباره دریافت کنید.',409);
   if(!enabled&&person.role==='hr'&&!store.list('local-account').some(a=>a.userId!==person.id&&a.enabled&&workflow.user(a.userId)?.role==='hr'))fail('آخرین حساب ادمین را نمی‌توان غیرفعال کرد.',409);
   if(store.list('local-account').some(a=>a.userId!==person.id&&a.username===normalized))fail('نام کاربری قبلاً استفاده شده است.',409);
   const updated=store.put('local-account',{id:key(person.id),userId:person.id,username:normalized,salt,digest:hash,enabled,revision:(previous?.revision||0)+1,mustChangePassword:!bootstrap&&(input.password!==undefined||previous?.mustChangePassword===true),updatedAt:new Date().toISOString()});
   store.put('audit-event',{actorId:actor?.id||person.id,action:bootstrap?'account.bootstrap':'account.updated',entityType:'account',entityId:person.id,details:{enabled,revision:updated.revision},createdAt:updated.updatedAt});return metadata(updated);
  });
 }
 async function changePassword(actor,input){
  const previous=account(actor.id);if(!previous?.enabled)fail('حساب فعال نیست.',403);
  if(!passwordValid(input.password))fail('رمز جدید باید بین ۱۲ تا ۱۲۸ نویسه باشد.');
  if(await verify({username:previous.username,password:input.currentPassword})!==actor.id)fail('رمز فعلی نادرست است.',403);
  if(input.currentPassword===input.password)fail('رمز جدید باید با رمز قبلی متفاوت باشد.');
  const salt=randomBytes(16).toString('hex'),hash=(await digest(input.password,salt)).toString('hex');
  return store.transaction(()=>{if(account(actor.id)?.revision!==previous.revision)fail('حساب هم‌زمان تغییر کرده است.',409);const updated=store.put('local-account',{...previous,salt,digest:hash,revision:previous.revision+1,mustChangePassword:false,updatedAt:new Date().toISOString()});store.put('audit-event',{actorId:actor.id,action:'account.password-changed',entityType:'account',entityId:actor.id,details:{revision:updated.revision},createdAt:updated.updatedAt});return metadata(updated);});
 }
 async function createDefaults(actor){
  isAdmin(actor);if(defaultsRunning)fail('ساخت گروهی حساب‌ها در حال اجراست؛ منتظر پایان آن بمانید.',409);defaultsRunning=true;
  try{
   const people=workflow.accounts().map(p=>workflow.user(p.id)),prepared=[];
   for(const person of people){
    if(!person||person.isSettled||!['hr','manager','personnel'].includes(person.role)||account(person.id))continue;
    const password='Kpi!'+randomBytes(18).toString('base64url'),salt=randomBytes(16).toString('hex');
    const base=person.employeeCode?username('user.'+person.employeeCode).replace(/[^\p{L}\p{N}_.@-]/gu,'').slice(0,110):({hr:'admin',manager:'manager',personnel:'staff'})[person.role]+'.'+createHash('sha256').update(person.id).digest('hex').slice(0,10);
    prepared.push({userId:person.id,base,password,salt,digest:(await digest(password,salt)).toString('hex')});
   }
   return store.transaction(()=>{
    const used=new Set(store.list('local-account').map(row=>row.username)),credentials=[];
    for(const item of prepared){
     const person=workflow.user(item.userId);if(!person||person.isSettled||!['hr','manager','personnel'].includes(person.role)||account(person.id))continue;
     let login=item.base,suffix=1;while(used.has(login))login=item.base+'.'+(++suffix);used.add(login);
     const updatedAt=new Date().toISOString();
     store.put('local-account',{id:key(person.id),userId:person.id,username:login,salt:item.salt,digest:item.digest,enabled:true,revision:1,mustChangePassword:true,updatedAt});
     store.put('audit-event',{actorId:actor.id,action:'account.default-created',entityType:'account',entityId:person.id,details:{enabled:true,revision:1},createdAt:updatedAt});
     credentials.push({userId:person.id,name:person.name,role:person.role,employeeCode:person.employeeCode||'',username:login,password:item.password});
    }
    return {created:credentials.length,skipped:people.length-credentials.length,credentials};
   });
  }finally{defaultsRunning=false;}
 }
 return {verify,save,createDefaults,bootstrap:input=>save(null,input,{bootstrap:true}),changePassword,sessionRevision,requiresChange,list:actor=>{isAdmin(actor);return store.list('local-account').map(metadata);}};
}

// Only hashes of bearer tokens are persisted. A password reset or mode change
// invalidates every previous session, including cookies kept across restarts.
export function createSessionRegistry(store,{revision=()=>1,mode='demo'}={}){
 const id=token=>'auth-session-'+createHash('sha256').update(token).digest('hex');
 return {
  set(token,value){store.put('auth-session',{id:id(token),...value,mode,credentialRevision:revision(value.userId)});},
  get(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return undefined;const row=store.get(id(token),'auth-session');if(!row||row.mode!==mode||row.expires<=Date.now()||row.credentialRevision!==revision(row.userId)||row.credentialRevision===null)return undefined;return row;},
  delete(token){if(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token))store.remove(id(token),'auth-session',null);}
 };
}

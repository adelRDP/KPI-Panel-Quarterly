import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/quarterly-workflow.mjs';
import {createLocalAccounts} from '../backend/local-accounts.mjs';
import {passwordDigest} from '../backend/demo-login.mjs';
const root=resolve('.'),runtime=join(root,'.runtime'),file=join(runtime,'demo-login.json');
if(existsSync(file))throw Error('ورود اصلی پروژهٔ دوم قبلاً ساخته شده است؛ بازنویسی نمی‌شود.');
mkdirSync(runtime,{recursive:true});
const store=openStore(join(root,'data/processed/kpi-panel'));
try{
 const workflow=createWorkflow(store),accounts=createLocalAccounts(store,workflow),actor=workflow.accounts().find(p=>p.role==='hr');
 if(!actor)throw Error('Administrator organizational identity required');
 const password='Qtr!'+randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex');
 const result=await accounts.createDefaults(actor);
 const quote=v=>'"'+String(v).replaceAll('"','""')+'"';
 const lines=[['نام','دسترسی','نام کاربری','رمز موقت'],['ورود اصلی پروژهٔ فصلی','main','quarterly.main',password],...result.credentials.map(r=>[r.name,r.role,r.username,r.password])];
 writeFileSync(join(runtime,'initial-access.csv'),'\ufeff'+lines.map(r=>r.map(quote).join(',')).join('\r\n'),{flag:'wx',mode:0o600});
 writeFileSync(file,JSON.stringify({version:1,username:'quarterly.main',salt,digest:passwordDigest(password,salt)}),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({created:result.created,sharedEntry:true,credentialsFile:'.runtime/initial-access.csv',copiedPasswords:false}));
}finally{store.close();}

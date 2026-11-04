import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {createLocalAccounts} from '../backend/local-accounts.mjs';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
if(!args.includes('--user-id')||!args.includes('--username')||!process.stdin.isTTY){console.error('Usage (interactive terminal only): node scripts/create-local-admin.mjs --user-id EXISTING_ADMIN_ID --username USERNAME');process.exit(1);}
const root=resolve(process.env.PANEL_DATA_ROOT||'data/processed/kpi-panel');
if(!existsSync(join(root,'panel.sqlite'))){console.error('Existing panel database is required.');process.exit(1);}
let muted=false;const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}}),reader=createInterface({input:process.stdin,output,terminal:true});
const secret=async label=>{process.stdout.write(label);muted=true;try{return await reader.question('');}finally{muted=false;process.stdout.write('\n');}};
const store=openStore(root);
try{
 const workflow=createWorkflow(store),accounts=createLocalAccounts(store,workflow);
 if(store.list('local-account').length)throw Error('Initial account already exists; use the account-management panel.');
 const password=await secret('New admin password (12-128 characters, hidden): '),confirmation=await secret('Repeat password (hidden): ');
 if(password!==confirmation)throw Error('Passwords do not match.');
 await accounts.bootstrap({userId:option('--user-id'),username:option('--username'),password});
 console.log('Independent admin account created. Restart the panel in local authentication mode. No password was logged.');
}catch(error){console.error(error.message);process.exitCode=1;}finally{reader.close();store.close();}

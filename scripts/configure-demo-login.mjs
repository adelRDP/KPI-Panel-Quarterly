// Local provisioning only. Credentials arrive on stdin, never in browser assets or tracked files.
import {mkdir,writeFile,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {passwordDigest} from '../backend/demo-login.mjs';
let data='';for await(const chunk of process.stdin)data+=chunk;
const {username,password}=JSON.parse(data);
if(typeof username!=='string'||!username||username.length>128||typeof password!=='string'||password.length<8||password.length>512)throw Error('Invalid local demo credentials');
const root=resolve('.runtime'),target=join(root,'demo-login.json');await mkdir(root,{recursive:true});
try{await access(target);throw Error('Config already exists; refusing to overwrite');}catch(error){if(error.code!=='ENOENT')throw error;}
const salt=randomBytes(16).toString('hex');await writeFile(target,JSON.stringify({version:1,username,salt,digest:passwordDigest(password,salt)},null,2),{flag:'wx',mode:0o600});
console.log('Local demo login configured; no plaintext password stored.');

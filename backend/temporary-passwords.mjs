
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

// The encryption key stays beside the local database, protected by DPAPI on Windows.
export function createTemporaryPasswordCipher(root){
 let key;
 function dpapi(action,data){
  const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::"+action+"($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
  return Buffer.from(execFileSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{input:data.toString('base64'),encoding:'ascii',windowsHide:true,timeout:10000}),'base64');
 }
 function getKey(){
  if(key)return key;
  const path=join(root,'.temporary-password-key');
  const decode=data=>process.platform==='win32'?dpapi('Unprotect',data):data;
  try{key=decode(readFileSync(path));}
  catch(error){
   if(error.code!=='ENOENT')throw error;
   const candidate=randomBytes(32),encoded=process.platform==='win32'?dpapi('Protect',candidate):candidate;
   try{writeFileSync(path,encoded,{flag:'wx',mode:0o600});key=candidate;}
   catch(error){if(error.code!=='EEXIST')throw error;key=decode(readFileSync(path));}
  }
  if(key.length!==32)throw Error('Invalid temporary password key');
  return key;
 }
 return {
  seal(value){
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',getKey(),iv);
   const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
   return Buffer.concat([iv,encrypted,cipher.getAuthTag()]).toString('base64');
  },
  open(value){
   try{
    const bytes=Buffer.from(value,'base64');
    const cipher=createDecipheriv('aes-256-gcm',getKey(),bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8');
   }catch{return null;}
  }
 };
}

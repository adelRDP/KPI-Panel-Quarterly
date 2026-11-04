import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {scryptSync,timingSafeEqual,createHash} from 'node:crypto';

export const passwordDigest=(password,salt)=>scryptSync(password,salt,64).toString('hex');
export function loadDemoLogin(root){
  try{const config=JSON.parse(readFileSync(join(root,'.runtime','demo-login.json'),'utf8'));
    if(typeof config.username!=='string'||!config.username||!/^[a-f0-9]{32}$/.test(config.salt)||!/^[a-f0-9]{128}$/.test(config.digest))throw Error('Invalid config');
    return config;
  }catch{return {unavailable:true};}
}
export function verifyDemoLogin(config,input){
  if(config.unavailable||typeof input.username!=='string'||typeof input.password!=='string'||input.username.length>128||input.password.length>512)return false;
  const candidate=Buffer.from(passwordDigest(input.password,config.salt),'hex'),expected=Buffer.from(config.digest,'hex');
  const username=value=>createHash('sha256').update(value).digest();
  return timingSafeEqual(candidate,expected)&&timingSafeEqual(username(input.username),username(config.username));
}

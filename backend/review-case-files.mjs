import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {sha256} from './evaluation.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:400,publicMessage:message});};
export async function submitReviewCaseWithFiles(engine,actor,input,uploadRoot){
 engine.authorizeSubmission(actor,input);
 const attachments=input.attachments??[];
 if(!Array.isArray(attachments)||attachments.length>5)fail('حداکثر ۵ فایل می‌توانید پیوست کنید.');
 const decoded=attachments.map(f=>{
  if(!f||typeof f.name!=='string'||!f.name.trim()||f.name.length>200||/[/\\\x00-\x1f]/.test(f.name))fail('نام فایل معتبر نیست.');
  if(typeof f.data!=='string'||f.data.length>Math.ceil(10*1024*1024/3)*4)fail('فایل معتبر با حجم حداکثر ۱۰ مگابایت انتخاب کنید.');
  const bytes=Buffer.from(f.data,'base64');if(!bytes.length||bytes.length>10*1024*1024||bytes.toString('base64')!==f.data)fail('فایل خالی، نامعتبر یا بیش از ۱۰ مگابایت است.');
  const id=randomUUID();return {bytes,file:{id,name:f.name,size:bytes.length,sha256:sha256(bytes),path:join(uploadRoot,'review-cases',id)}};
 });
 const written=[];
 try{if(decoded.length)await mkdir(join(uploadRoot,'review-cases'),{recursive:true});for(const {bytes,file} of decoded){await writeFile(file.path,bytes,{flag:'wx'});written.push(file.path);}return engine.create(actor,input,decoded.map(x=>x.file));}
 catch(error){for(const path of written)await unlink(path).catch(()=>{});throw error;}
}

import {createHash,createHmac,randomInt} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status,publicMessage:message});};
const code=value=>String(value??'').trim().replace(/[۰-۹٠-٩]/g,c=>String(c.charCodeAt(0)-(c>='۰'?1776:1632)));
const shuffle=rows=>{const copy=[...rows];for(let i=copy.length-1;i>0;i--){const j=randomInt(i+1);[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;};
export function createPeerSurveyImport({store,workflow,secret,canRespond,assertWritable,respondentToken,deadline,today,required,complete,audit}){
 const admin=actor=>{if(actor?.role!=='hr')fail('ورود گروهی پاسخ‌ها فقط برای ادمین مجاز است.',403);};
 const digest=value=>createHmac('sha256',secret).update(JSON.stringify(value)).digest('hex');
 const list=actor=>{admin(actor);return store.list('peer-survey-import').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));};
 function process(actor,input){
  admin(actor);
  if(!input||!/^14\d{2}-Q[1-4]$/.test(input.period||''))fail('فصل ارزیابی معتبر نیست.');
  if(!Array.isArray(input.rows)||input.rows.length<1||input.rows.length>500)fail('فایل باید ۱ تا ۵۰۰ پاسخ داشته باشد.');
  if(typeof input.batchKey!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(input.batchKey))fail('شناسه بسته معتبر نیست.');
  if(typeof input.fileName!=='string'||input.fileName.length>200||!input.fileName.toLowerCase().endsWith('.xlsx')||/[\\/\x00-\x1f]/.test(input.fileName))fail('نام فایل XLSX معتبر نیست.');
  const rows=input.rows.map((r,i)=>({rowNumber:i+2,targetCode:code(r?.targetCode),respondentCode:code(r?.respondentCode),score:typeof r?.score==='number'?r.score:typeof r?.score==='string'&&r.score.trim()?Number(code(r.score)):null}));
  if(rows.some(r=>r.targetCode.length>60||r.respondentCode.length>60))fail('کد پرسنلی بیش از حد مجاز است.');
  const payloadHash=digest({period:input.period,rows,fileName:input.fileName}),id='peer-import-'+createHash('sha256').update(input.batchKey).digest('hex').slice(0,24),old=store.get(id,'peer-survey-import');
  if(old){if(old.payloadHash!==payloadHash)fail('شناسه بسته قبلاً با محتوای متفاوت استفاده شده است.',409);return {...old,replayed:true};}
  const people=store.list('workflow-user'),findPerson=(value)=>{if(!value)fail('کد پرسنلی وارد نشده است.');const matches=people.filter(p=>code(p.employeeCode)===value);if(matches.length!==1)fail(matches.length?'کد پرسنلی تکراری است؛ ابتدا اطلاعات افراد را اصلاح کنید.':'کد پرسنلی پیدا نشد.');return workflow.user(matches[0].id);};
  const quarantined=[],accepted=[],seen=new Set(),campaigns=new Map();
  for(const r of rows){try{
   const target=findPerson(r.targetCode),respondent=findPerson(r.respondentCode);
   if(target.role!=='personnel')fail('فرد هدف باید پرسنل باشد.');
   const candidates=store.list('service-survey-campaign').filter(c=>c.employeeId===target.id&&c.period===input.period&&!c.removedAt&&c.status==='open');
   if(candidates.length!==1)fail('برای فرد هدف دقیقاً یک نظرسنجی منتشرشده و باز در این فصل لازم است.');
   const campaign=candidates[0];assertWritable(campaign);
   if(today()>deadline(campaign))fail('مهلت پاسخ این نظرسنجی پایان یافته است.');
   if(!canRespond(respondent,campaign))fail('پاسخ‌دهنده عضو جامعه مجاز این نظرسنجی نیست.');
   if(r.score===null||!Number.isFinite(r.score)||r.score<0||r.score>100)fail('امتیاز باید عددی بین صفر تا صد باشد.');
   const respondentHash=respondentToken(campaign.id,respondent.id),pair=campaign.id+':'+respondentHash;
   if(seen.has(pair)||store.list('service-survey-ballot',campaign.id).some(b=>b.respondentHash===respondentHash))fail('پاسخ این فرد به این نظرسنجی قبلاً ثبت شده یا در فایل تکراری است.');
   seen.add(pair);accepted.push({rowNumber:r.rowNumber,campaignId:campaign.id,respondentHash,score:r.score});campaigns.set(campaign.id,campaign);
  }catch(error){if(!error.publicMessage)throw error;quarantined.push({rowNumber:r.rowNumber,reason:error.publicMessage});}}
  const fingerprint=digest({payloadHash,accepted,quarantined,campaigns:[...campaigns.values()].map(c=>({campaign:c,ballots:store.list('service-survey-ballot',c.id).map(b=>b.id).sort(),responses:store.list('service-survey-response',c.id).map(r=>r.id).sort()}))});
  const preview={rowCount:rows.length,importedCount:accepted.length,quarantined,campaignCount:campaigns.size,fingerprint,preview:true};
  if(input.preview===true)return preview;
  if(input.confirm!==true||input.fingerprint!==fingerprint)fail('پیش‌نمایش تغییر کرده است؛ فایل را دوباره اعتبارسنجی و تأیید کنید.',409);
  if(!accepted.length)fail('هیچ پاسخ معتبری برای ثبت وجود ندارد.');
  return (()=>{
   const createdAt=new Date().toISOString();
   // Separate anonymous scores and voter tokens, with unrelated order and a
   // shared timestamp. Never persist the source file or identity-to-score rows.
   for(const r of shuffle(accepted))store.put('service-survey-ballot',{campaignId:r.campaignId,respondentHash:r.respondentHash,createdAt},r.campaignId);
   for(const r of shuffle(accepted))store.put('service-survey-response',{campaignId:r.campaignId,score:r.score,source:'excel-import',createdAt},r.campaignId);
   let completedCount=0;
   for(const campaign of campaigns.values())if(store.list('service-survey-response',campaign.id).length>=required(campaign)){complete(actor,campaign.id);completedCount++;}
   const batch=store.put('peer-survey-import',{id,period:input.period,fileName:input.fileName,payloadHash,rowCount:rows.length,importedCount:accepted.length,quarantined,campaignCount:campaigns.size,completedCount,status:quarantined.length?'partial':'complete',createdAt,createdBy:actor.id});
   audit(actor,'service-survey.imported','peer-survey-import',id,{period:input.period,importedCount:accepted.length,quarantinedCount:quarantined.length});
   return batch;
  })();
 }
 function run(actor,input){admin(actor);return input?.preview===true?process(actor,input):store.transaction(()=>process(actor,input));}
 return {run,list};
}

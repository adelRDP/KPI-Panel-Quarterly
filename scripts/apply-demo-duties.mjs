// Explicit local test-data update only. Never use as an organizational approval endpoint.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {currentPeriod,periodBounds} from '../backend/personnel-workflow.mjs';

const headers=['کد پرسنلی','نام و نام خانوادگی','سمت فعلی','واحد','مافوق مستقیم','شرح وظایف پیشنهادی','شناسه فرد در پنل','نسخه مبنای سمت'];
const demoIds=['employee-mohammad','employee-sara','employee-reza','employee-maryam','employee-ops-4','employee-ops-5','employee-ops-6','employee-finance-2','employee-finance-3','employee-finance-4','employee-service-1','employee-service-2','employee-service-3','employee-service-4','employee-service-5'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const ensure=(value,message)=>{if(!value)throw new Error(message);};
const code=value=>String(value??'').trim().replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632));
const records=db=>db.prepare('SELECT kind,parent,value FROM records').all().map(row=>({...row,value:JSON.parse(row.value)}));

export function readDemoWorkbook(path,python){
  const source=readFileSync(path);ensure(source.length<2*1024*1024,'فایل بیش از حد مجاز است.');
  const program=`import sys,json,openpyxl
w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=False)
s=w['شرح وظایف']
rows=[]
for row in s:
 if len(rows)>100: raise ValueError('Too many rows')
 if any(c.data_type=='f' for c in row): raise ValueError('Formula cells are not accepted')
 rows.append([c.value for c in row])
w.close()
print(json.dumps(rows,ensure_ascii=True))`;
  const result=spawnSync(python,['-X','utf8','-c',program,resolve(path)],{encoding:'utf8',maxBuffer:1024*1024,windowsHide:true});
  ensure(!result.error&&result.status===0,'خواندن اکسل ناموفق بود؛ داده‌ای ثبت نشد.');
  return {rows:JSON.parse(result.stdout),sourceHash:sha(source)};
}

export function planDemoDuties(db,{rows,sourceHash,effectiveFrom}){
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)&&periodBounds(currentPeriod()).start===effectiveFrom,'شروع اثر باید ابتدای ماه باز محلی باشد.');
  ensure(Array.isArray(rows)&&JSON.stringify(rows[0])===JSON.stringify(headers)&&rows.length===16,'قالب اکسل یا تعداد پرسنل نمونه معتبر نیست.');
  ensure(typeof sourceHash==='string'&&/^[a-f0-9]{64}$/.test(sourceHash),'هش منبع معتبر نیست.');
  const all=records(db),people=new Map(all.filter(r=>r.kind==='workflow-user').map(r=>[r.value.id,r.value]));
  ensure(!all.some(r=>['review','ai-role-run','ai-design-attempt','ai-preprocess-attempt'].includes(r.kind)&&['running','queued'].includes(r.value.status)),'عملیات AI فعال است؛ بعد از پایان آن دوباره تلاش کنید.');
  const imported=all.find(r=>r.kind==='demo-duties-import'&&r.value.sourceHash===sourceHash&&r.value.effectiveFrom===effectiveFrom);
  const seen=new Set(),changes=[];
  for(const values of rows.slice(1)){
    ensure(values.length===8,'تعداد ستون‌های سطر معتبر نیست.');
    const [employeeCode,name,jobTitle,unitName,managerName,duties,id,version]=values;
    ensure(demoIds.includes(id)&&!seen.has(id),'شناسه نمونه ناشناخته یا تکراری است.');seen.add(id);
    const person=people.get(id),positions=all.filter(r=>r.kind==='position-assignment'&&r.parent===id).map(r=>r.value),active=positions.find(p=>p.status==='published'&&p.effectiveFrom<=effectiveFrom&&(!p.effectiveTo||effectiveFrom<p.effectiveTo));
    ensure(person?.role==='personnel'&&code(person.employeeCode)===code(employeeCode)&&person.name===name,'شناسه، نام و کد پرسنلی تطبیق ندارد.');
    ensure(active&&active.jobTitle===jobTitle&&active.unitName===unitName&&people.get(active.managerId)?.name===managerName,'سمت، واحد یا مافوق فایل با پنل تطبیق ندارد.');
    ensure(typeof duties==='string'&&duties.trim()===duties&&duties.length<=6000&&duties.length>100&&duties.split(/\r?\n/).filter(Boolean).length<=80&&duties.split(/\r?\n/).every(line=>line.length<=2000),'شرح وظایف نامعتبر است.');
    if(imported){ensure(active.id===imported.value.positions.find(p=>p.employeeId===id)?.newPositionId&&active.duties===duties&&active.version===version+1,'فایل قبلاً اعمال شده ولی نسخه جاری تغییر کرده است.');continue;}
    ensure(Number.isInteger(version)&&version===active.version&&active.version===1&&positions.length===1&&active.events?.length===1&&active.events[0].by==='migration'&&active.duties==='شرح وظایف نمونه برای تکمیل توسط HR','این ابزار فقط نسخه پایهٔ دست‌نخوردهٔ پرسنل نمونه را به‌روز می‌کند.');
    ensure(active.effectiveFrom<effectiveFrom&&!active.effectiveTo,'نسخه پایهٔ نمونه بازه مناسبی ندارد.');
    ensure(!all.some(r=>r.value.employeeId===id&&r.value.status==='locked'),'پرسنل نمونه نتیجه قفل‌شده دارد؛ تغییر خودکار مجاز نیست.');
    changes.push({employeeId:id,employeeCode:code(employeeCode),previous:active,duties});
  }
  ensure(seen.size===demoIds.length,'پرسنل نمونه کامل نیستند.');
  return {sourceHash,effectiveFrom,changes,alreadyApplied:!!imported,importId:imported?.value.id};
}

export function applyDemoDuties(db,input){
  db.exec('BEGIN IMMEDIATE');
  try{
    const plan=planDemoDuties(db,input);if(plan.alreadyApplied){db.exec('COMMIT');return {alreadyApplied:true,updated:0,importId:plan.importId};}
    const importId=randomUUID(),at=new Date().toISOString(),saved=[];
    const put=(kind,value,parent=null)=>db.prepare('INSERT OR REPLACE INTO records (id,kind,parent,value) VALUES (?,?,?,?)').run(value.id,kind,parent,JSON.stringify(value));
    for(const {employeeId,previous,duties} of plan.changes){
      const id=randomUUID(),source={kind:'local-test-fixture',importId,sourceHash:plan.sourceHash,sheet:'شرح وظایف',authorizedBy:'user-request',notOrganizationalApproval:true};
      const next={...previous,id,version:previous.version+1,duties,effectiveFrom:plan.effectiveFrom,effectiveTo:null,supersedes:previous.id,createdBy:'local-test-fixture',createdAt:at,publishedAt:at,testDataSource:source,events:[{state:'published',by:'local-test-fixture',at,note:'داده نمونه برای تست AI؛ طبق درخواست کاربر، نه تصویب سازمانی'}]};
      put('position-assignment',{...previous,effectiveTo:plan.effectiveFrom,supersededBy:id,events:[...(previous.events||[]),{state:'effective-period-closed',by:'local-test-fixture',at,next:id}]},employeeId);
      put('position-assignment',next,employeeId);
      put('audit-event',{id:randomUUID(),actorId:'local-test-fixture',action:'position.demo-duties-imported',entityType:'position-assignment',entityId:id,details:{importId,previousPositionId:previous.id,version:next.version,sourceHash:plan.sourceHash},createdAt:at});
      saved.push({employeeId,previousPositionId:previous.id,newPositionId:id});
    }
    put('demo-duties-import',{id:importId,sourceHash:plan.sourceHash,effectiveFrom:plan.effectiveFrom,positions:saved,createdAt:at,scope:'local-demo-only',authorizedBy:'user-request'});
    db.exec('COMMIT');return {alreadyApplied:false,updated:saved.length,importId,effectiveFrom:plan.effectiveFrom};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),sourcePath=args[0],apply=args.includes('--apply'),backupArg=args.find(arg=>arg.startsWith('--backup='));
  ensure(sourcePath,'مسیر اکسل لازم است.');
  const python=process.env.KPI_BUNDLED_PYTHON;ensure(python&&existsSync(python),'مسیر Python بستهٔ workspace لازم است.');
  if(apply){const backup=backupArg&&resolve(root,backupArg.slice(9)),inside=backup&&relative(resolve(root,'data/processed/kpi-panel/backups'),backup);ensure(backup&&inside&&!inside.startsWith('..')&&!isAbsolute(inside)&&existsSync(backup),'پشتیبان موجود در مسیر backups لازم است.');const check=new DatabaseSync(backup,{readOnly:true});try{ensure(check.prepare('PRAGMA quick_check').get().quick_check==='ok','پشتیبان سالم نیست.');}finally{check.close();}}
  const input={...readDemoWorkbook(sourcePath,python),effectiveFrom:periodBounds(currentPeriod()).start},db=new DatabaseSync(resolve(root,'data/processed/kpi-panel/panel.sqlite'),{readOnly:!apply});
  try{const result=apply?applyDemoDuties(db,input):planDemoDuties(db,input);console.log(JSON.stringify(apply?result:{dryRun:true,alreadyApplied:result.alreadyApplied,count:result.changes.length,effectiveFrom:result.effectiveFrom,sourceHash:result.sourceHash}));}finally{db.close();}
}

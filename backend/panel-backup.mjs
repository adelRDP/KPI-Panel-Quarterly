import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,readdir,lstat,realpath,copyFile,readFile,writeFile,stat,unlink} from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
const hash=async path=>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');};
const inside=(root,path)=>{const rel=relative(root,path);if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Backup path is outside the allowed directory.');return rel;};
const portable=value=>value.split(sep).join('/');
const contains=(root,path)=>{const rel=relative(root,path);return !rel||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
async function files(root){const result=[];async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Backup does not follow symbolic links.');if(entry.isDirectory())await visit(path);else if(entry.isFile())result.push(path);else throw Error('Unsupported file in uploads.');}}await visit(root);return result;}
export async function verifyPanelBackup(folder){
 const root=await realpath(folder),manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
 if(!['panel-backup-v1','panel-backup-v2'].includes(manifest.version)||manifest.complete!==true||!Array.isArray(manifest.files))throw Error('Backup manifest is incomplete.');
 const database=join(root,'panel.sqlite');if((await lstat(database)).isSymbolicLink()||await hash(database)!==manifest.database.sha256)throw Error('Backup database checksum mismatch.');
 const db=new DatabaseSync(database,{readOnly:true});try{if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Backup database integrity failed.');if(db.prepare('SELECT count(*) AS n FROM records').get().n!==manifest.database.records)throw Error('Backup record count mismatch.');}finally{db.close();}
 const known=new Set();for(const item of manifest.files){if(typeof item.path!=='string'||item.path.includes('\\')||isAbsolute(item.path)||known.has(item.path)||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<0)throw Error('Backup file path is invalid.');known.add(item.path);const target=resolve(root,'uploads',item.path);inside(resolve(root,'uploads'),target);inside(resolve(root,'uploads'),await realpath(target));if((await lstat(target)).isSymbolicLink()||await hash(target)!==item.sha256||(await stat(target)).size!==item.size)throw Error('Backup attachment checksum mismatch.');}
 return {records:manifest.database.records,files:manifest.files.length,createdAt:manifest.createdAt};
}
export async function createPanelBackup({dataRoot,uploadRoot,backupRoot}){
 const source=await realpath(dataRoot),uploads=await realpath(uploadRoot),destination=resolve(backupRoot);if(contains(source,destination)||contains(uploads,destination))throw Error('Backup must not be inside the uploads or database directory.');
 await mkdir(destination,{recursive:true});const actualDestination=await realpath(destination);if(contains(source,actualDestination)||contains(uploads,actualDestination))throw Error('Backup destination resolves inside source data.');const folder=join(actualDestination,'panel-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());await mkdir(folder,{mode:0o700});await mkdir(join(folder,'uploads'),{mode:0o700});
 const db=new DatabaseSync(join(source,'panel.sqlite'),{readOnly:true});try{if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Source database integrity failed.');await backup(db,join(folder,'panel.sqlite'));}finally{db.close();}
 const manifest={version:'panel-backup-v2',uploadRoot:uploads,createdAt:new Date().toISOString(),complete:false,database:{sha256:await hash(join(folder,'panel.sqlite')),records:0},files:[]};
 const snapshot=new DatabaseSync(join(folder,'panel.sqlite'),{readOnly:true});let documents,appeals;try{manifest.database.records=snapshot.prepare('SELECT count(*) AS n FROM records').get().n;documents=snapshot.prepare("SELECT value FROM records WHERE kind='document'").all().map(r=>JSON.parse(r.value));appeals=snapshot.prepare("SELECT value FROM records WHERE kind='quarter-appeal-file'").all().map(r=>JSON.parse(r.value));}finally{snapshot.close();}
 for(const sourceFile of await files(uploads)){const real=await realpath(sourceFile),name=inside(uploads,real),target=join(folder,'uploads',name);await mkdir(resolve(target,'..'),{recursive:true});await copyFile(real,target,constants.COPYFILE_EXCL);manifest.files.push({path:portable(name),size:(await stat(target)).size,sha256:await hash(target)});}
 const copied=new Map(manifest.files.map(file=>[file.path,file]));for(const record of [...documents,...appeals]){const name=record.path?portable(inside(uploads,resolve(record.path))):'appeals/'+record.id,file=copied.get(name);if(!file||file.sha256!==record.sha256)throw Error('A referenced attachment is missing or changed; backup is not complete.');}
 manifest.complete=true;await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});const verification=await verifyPanelBackup(folder);return {folder,...verification};
}
// Restore into a brand new directory only. Original snapshots are never edited.
export async function restorePanelBackup({folder,destination}){
 const verified=await verifyPanelBackup(folder),source=await realpath(folder),target=resolve(destination);
 if(contains(source,target))throw Error('Restore destination must be outside the backup.');
 await mkdir(resolve(target,'..'),{recursive:true});
 const parent=await realpath(resolve(target,'..')),actual=join(parent,target.slice(resolve(target,'..').length+1));
 if(contains(source,actual))throw Error('Restore destination resolves inside the backup.');
 await mkdir(actual); // EEXIST refuses even an empty existing destination.
 const dataRoot=join(actual,'data/processed/kpi-panel'),uploadRoot=join(actual,'data/raw/kpi-panel');await mkdir(dataRoot,{recursive:true});await mkdir(uploadRoot,{recursive:true});
 await writeFile(join(dataRoot,'RESTORE_IN_PROGRESS'),'Restore is not complete. Do not start this database.',{flag:'wx'});
 const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
 for(const file of manifest.files){const path=resolve(uploadRoot,file.path);inside(uploadRoot,path);await mkdir(resolve(path,'..'),{recursive:true});await copyFile(join(source,'uploads',file.path),path,constants.COPYFILE_EXCL);if(await hash(path)!==file.sha256)throw Error('Restored attachment checksum mismatch.');}
 const database=join(dataRoot,'panel.sqlite');await copyFile(join(source,'panel.sqlite'),database,constants.COPYFILE_EXCL);const db=new DatabaseSync(database),normalize=p=>String(p).replaceAll('\\','/'),paths=new Map();let rebound=0,revoked=0;
 try{
  if(manifest.uploadRoot)for(const file of manifest.files)paths.set(normalize(manifest.uploadRoot).replace(/\/$/,'')+'/'+file.path,join(uploadRoot,file.path));
  for(const {value}of db.prepare("SELECT value FROM records WHERE kind IN ('document','quarter-appeal-file')").all()){
   const record=JSON.parse(value);if(!record.path)continue;
   const old=normalize(record.path);const candidates=manifest.files.filter(f=>old.endsWith('/'+f.path)&&record.sha256===f.sha256);
   if(candidates.length!==1)throw Error('Cannot unambiguously rebind a stored attachment path.');paths.set(old,join(uploadRoot,candidates[0].path));
  }
  const rewrite=value=>{if(Array.isArray(value))return value.map(rewrite);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([k,v])=>{
   if(k==='path'&&typeof v==='string'){
    const old=normalize(v);if(paths.has(old))return [k,paths.get(old)];
    if(typeof value.sha256==='string'){const candidates=manifest.files.filter(f=>old.endsWith('/'+f.path)&&f.sha256===value.sha256);if(candidates.length!==1)throw Error('Cannot rebind a historical attachment path.');return [k,join(uploadRoot,candidates[0].path)];}
   }
   return [k,rewrite(v)];
  }));};
  db.exec('BEGIN IMMEDIATE');
  for(const row of db.prepare('SELECT id,kind,value FROM records').all()){
   if(row.kind==='auth-session'){db.prepare('DELETE FROM records WHERE id=?').run(row.id);revoked++;continue;}
   const old=JSON.parse(row.value),next=rewrite(old);if(JSON.stringify(old)!==JSON.stringify(next)){db.prepare('UPDATE records SET value=? WHERE id=?').run(JSON.stringify(next),row.id);rebound++;}
  }
  db.exec('COMMIT');if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Restored database integrity failed.');
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
 const report={...verified,destination:actual,dataRoot,uploadRoot,rebound,revokedSessions:revoked,sourcePreserved:true};await writeFile(join(actual,'RESTORE_REPORT.json'),JSON.stringify(report,null,2),{flag:'wx'});await unlink(join(dataRoot,'RESTORE_IN_PROGRESS'));return report;
}
export function createBackupScheduler({dataRoot,uploadRoot,backupRoot,enabled=false,isBusy=()=>false,intervalMs=86400000,onError=()=>{},now=()=>Date.now()}){
 let running=null,stopped=false,lastSuccess=0,initialized=false;
 async function run(){
  if(stopped||!enabled||running||isBusy())return null;
  running=(async()=>{try{if(!initialized){initialized=true;try{const old=JSON.parse(await readFile(join(backupRoot,'last-success.json'),'utf8'));if(Number.isFinite(old.at)&&old.at<=now())lastSuccess=old.at;}catch{}}
   if(lastSuccess&&now()-lastSuccess<intervalMs)return null;await mkdir(uploadRoot,{recursive:true});const result=await createPanelBackup({dataRoot,uploadRoot,backupRoot});lastSuccess=now();await writeFile(join(backupRoot,'last-success.json'),JSON.stringify({at:lastSuccess,folder:result.folder}));return result;
  }catch(error){onError(error);return null;}})();const attempt=running;try{return await attempt;}finally{if(running===attempt)running=null;}
 }
 const timer=enabled?setInterval(()=>{run();},60000):null;timer?.unref();
 return {run,get running(){return !!running;},stop(){stopped=true;if(timer)clearInterval(timer);}};
}

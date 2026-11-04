import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,copyFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createPanelServer} from '../server.mjs';
import {openStore} from '../backend/store.mjs';
import {sha256} from '../backend/evaluation.mjs';
import {createPanelBackup,verifyPanelBackup,createBackupScheduler,restorePanelBackup} from '../backend/panel-backup.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'kpi-backup-')),dataRoot=join(root,'data'),uploadRoot=join(root,'raw'),backupRoot=join(root,'backups');await mkdir(join(uploadRoot,'appeals'),{recursive:true});const store=openStore(dataRoot);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});const path=join(uploadRoot,'synthetic-file');await writeFile(path,'Synthetic evidence');store.put('document',{id:'doc',path,sha256:sha256('Synthetic evidence')});await writeFile(join(uploadRoot,'appeals','file'),'Synthetic appeal');store.put('quarter-appeal-file',{id:'file',sha256:sha256('Synthetic appeal')});await writeFile(join(uploadRoot,'unreferenced'),'Original unreferenced evidence');return {root,store,dataRoot,uploadRoot,backupRoot};}
test('complete backup preserves database, active/archived/unreferenced files and appeal attachments, and is independently readable',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.store.list('document')),result=await createPanelBackup(f);assert.equal(result.files,3);assert.equal(result.records,2);assert.equal(JSON.stringify(f.store.list('document')),before);assert.equal((await verifyPanelBackup(result.folder)).files,3);
 const restored=join(f.root,'isolated-restored.sqlite');await copyFile(join(result.folder,'panel.sqlite'),restored);const db=new DatabaseSync(restored,{readOnly:true});try{assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n,2);}finally{db.close();}
 assert.equal(await readFile(join(result.folder,'uploads','appeals','file'),'utf8'),'Synthetic appeal');await writeFile(join(result.folder,'uploads','synthetic-file'),'corrupted');await assert.rejects(verifyPanelBackup(result.folder),/checksum/);
});
test('missing/altered referenced raw files never produce a successful backup and nested destinations are rejected',async t=>{
 const f=await fixture(t);await assert.rejects(createPanelBackup({...f,backupRoot:join(f.uploadRoot,'backups')}),/inside/);await assert.rejects(createPanelBackup({...f,backupRoot:join(f.dataRoot,'backups')}),/inside/);await writeFile(join(f.uploadRoot,'synthetic-file'),'Changed evidence');await assert.rejects(createPanelBackup(f),/missing or changed/);
});
test('portable restore rebinds live and historical file paths, invalidates sessions and never overwrites a destination',async t=>{
 const f=await fixture(t),document=f.store.get('doc','document');f.store.put('review',{id:'historic',documents:[document,{path:join(f.uploadRoot,'unreferenced'),sha256:sha256('Original unreferenced evidence')}]});f.store.put('quarter-evaluation',{id:'locked',status:'locked',lockedSnapshot:{earned:12345}});f.store.put('auth-session',{id:'old-session',expires:Date.now()+10000});const result=await createPanelBackup(f),source=await readFile(join(result.folder,'panel.sqlite')),destination=join(f.root,'new-location');await rename(f.uploadRoot,join(f.root,'original-raw-unavailable'));const restored=await restorePanelBackup({folder:result.folder,destination});assert.equal(restored.revokedSessions,1);assert.ok(restored.rebound>=2);
 const store=openStore(restored.dataRoot);try{const doc=store.get('doc','document');assert.ok(doc.path.startsWith(restored.uploadRoot));assert.equal(await readFile(doc.path,'utf8'),'Synthetic evidence');assert.equal(store.get('historic','review').documents[0].path,doc.path);assert.equal(store.get('locked','quarter-evaluation').lockedSnapshot.earned,12345);assert.equal(store.list('auth-session').length,0);}finally{store.close();}
 assert.deepEqual(await readFile(join(result.folder,'panel.sqlite')),source);assert.equal(f.store.get('doc','document').path,document.path);await assert.rejects(restorePanelBackup({folder:result.folder,destination}),/EEXIST/);await assert.rejects(restorePanelBackup({folder:result.folder,destination:join(result.folder,'nested')}),/outside/);
 // Existing version-1 snapshots remain restorable without reading original paths.
 const manifestPath=join(result.folder,'manifest.json'),legacy=JSON.parse(await readFile(manifestPath));legacy.version='panel-backup-v1';delete legacy.uploadRoot;await writeFile(manifestPath,JSON.stringify(legacy));const older=await restorePanelBackup({folder:result.folder,destination:join(f.root,'legacy-location')});assert.equal(older.files,3);
});
test('scheduler skips busy work, verifies a daily backup, survives repeated due checks and preserves earlier snapshots',async t=>{
 const f=await fixture(t);let busy=true,stamp=1000000000000;const errors=[],scheduler=createBackupScheduler({...f,enabled:true,isBusy:()=>busy,now:()=>stamp,onError:e=>errors.push(e.message)});t.after(()=>scheduler.stop());assert.equal(await scheduler.run(),null);busy=false;const first=await scheduler.run();assert.equal(first.files,3);assert.equal(await scheduler.run(),null);assert.equal(scheduler.running,false);assert.equal(await scheduler.run(),null);stamp+=86400001;const second=await scheduler.run();assert.notEqual(first.folder,second.folder);assert.equal((await verifyPanelBackup(first.folder)).files,3);assert.equal(errors.length,0);
});
test('an ambiguous restored historical locator leaves an incomplete marker and cannot start as a panel',async t=>{
 const f=await fixture(t);f.store.put('review',{id:'bad-reference',documents:[{path:'C:/unknown-source/missing-file',sha256:sha256('Synthetic evidence')}]});const result=await createPanelBackup(f),destination=join(f.root,'incomplete');await assert.rejects(restorePanelBackup({folder:result.folder,destination}),/historical attachment/);assert.throws(()=>createPanelServer({dataRoot:join(destination,'data/processed/kpi-panel'),autoAssessment:false}),/بازیابی/);assert.equal(await readFile(join(f.uploadRoot,'synthetic-file'),'utf8'),'Synthetic evidence');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {auditFixture} from './quarterly-audit-fixture.mjs';
import {createReviewCases} from '../backend/review-cases.mjs';
import {submitReviewCaseWithFiles} from '../backend/review-case-files.mjs';
import {createPanelBackup,restorePanelBackup} from '../backend/panel-backup.mjs';
import {openStore} from '../backend/store.mjs';
import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
async function fixture(t){const f=await auditFixture(t),a=f.store.put('activity',{ownerId:'e',positionId:'p',unitId:'u',period:f.q,kind:'routine',assignmentStatus:'approved',title:'Synthetic',dueDate:'2025-10-01'},'e'),uploads=join(f.root,'uploads');await mkdir(uploads);return {...f,a,uploads,engine:createReviewCases(f.store,f.workflow,{audit:f.org.audit}),input:{activityId:a.id,type:'extension',dueDate:'2025-10-03',category:'outage',reason:'قطعی مستند سامانه کاری',attachments:[{name:'synthetic.txt',data:Buffer.from('Synthetic case evidence').toString('base64')}]}};}
test('case files are atomic with the request and a rejected or failed submission leaves no raw orphan or record',async t=>{
 const f=await fixture(t),submit=input=>submitReviewCaseWithFiles(f.engine,f.employee,input,f.uploads);
 for(const attachments of [[{name:'../bad',data:'YQ=='}],[{name:'x',data:''}],[{name:'x',data:'not-base64'}],Array(6).fill(f.input.attachments[0]),[{name:'x',data:Buffer.alloc(10*1024*1024+1).toString('base64')}]] )await assert.rejects(submit({...f.input,attachments}),{status:400});
 await assert.rejects(submitReviewCaseWithFiles(f.engine,f.workflow.user('n'),f.input,f.uploads),{status:403});assert.equal(f.store.list('review-case-file').length,0);
 const put=f.store.put;f.store.put=(kind,...args)=>{if(kind==='audit-event')throw Error('simulated failure');return put(kind,...args);};await assert.rejects(submit(f.input),/simulated failure/);f.store.put=put;assert.equal(f.store.list('review-case-file').length,0);assert.equal(f.store.list('review-case').length,0);assert.equal((await readdir(join(f.uploads,'review-cases'))).length,0);
 const saved=await submit(f.input);assert.equal(saved.files.length,1);assert.equal(saved.files[0].path,undefined);await assert.rejects(submit(f.input),{status:409});assert.equal((await readdir(join(f.uploads,'review-cases'))).length,1);assert.equal(await readFile(f.engine.file(f.hr,saved.id,saved.files[0].id).path,'utf8'),'Synthetic case evidence');
});
test('case attachments survive a portable backup/restore and missing evidence prevents a complete backup',async t=>{
 const f=await fixture(t),row=await submitReviewCaseWithFiles(f.engine,f.employee,f.input,f.uploads),dbRoot=join(f.root,'source-db');await mkdir(dbRoot);
 const source=new DatabaseSync(join(f.root,'panel.sqlite'),{readOnly:true});try{await sqliteBackup(source,join(dbRoot,'panel.sqlite'));}finally{source.close();}
 const options={dataRoot:dbRoot,uploadRoot:f.uploads,backupRoot:join(f.root,'backups')};
 const backup=await createPanelBackup(options),restored=await restorePanelBackup({folder:backup.folder,destination:join(f.root,'restored')}),db=openStore(restored.dataRoot);try{const file=db.list('review-case-file')[0];assert.ok(file.path.startsWith(restored.uploadRoot));assert.equal(await readFile(file.path,'utf8'),'Synthetic case evidence');}finally{db.close();}
 await writeFile(f.engine.file(f.hr,row.id,row.files[0].id).path,'changed');await assert.rejects(createPanelBackup(options),/missing or changed/);
});

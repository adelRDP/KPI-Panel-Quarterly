import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';
import {openStore} from '../backend/store.mjs';
import {createWorkflow} from '../backend/quarterly-workflow.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {createPanelServer} from '../server.mjs';
function setup(t){
 const root=mkdtempSync(join(tmpdir(),'peer-import-')),fixture=seedQuarterlyFixture(root),store=openStore(root),servers=[];t.after(async()=>{for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}store.close();rmSync(root,{recursive:true,force:true});});
 for(const [i,p] of fixture.people.entries())store.put('workflow-user',{...store.get(p.id,'workflow-user'),employeeCode:String(1000+i)});
 store.put('workflow-policy',{id:'active-policy',version:'peer-import-test',weights:{exam:0,manager:0,routine:0,project:0,peer:100}});
 const w=createWorkflow(store),org=createOrganizationWorkflow(store,w,{runModel:()=>{throw Error('No live AI');}}),hr=w.user('admin');
 const draft=org.createServiceCampaign(hr,{employeeId:'employee-0',period:fixture.period,minParticipation:60});org.publishServiceCampaign(hr,draft.id);
 const input={period:fixture.period,batchKey:'synthetic-batch-1234',fileName:'synthetic.xlsx',rows:[{targetCode:'1003',respondentCode:'1005',score:60},{targetCode:'1003',respondentCode:'1006',score:80},{targetCode:'1003',respondentCode:'1007',score:100},{targetCode:'1003',respondentCode:'1002',score:0}]};
 const preview=data=>org.importPeerResponses(hr,{...data,preview:true}),commit=data=>org.importPeerResponses(hr,{...data,confirm:true,fingerprint:preview(data).fingerprint});
 return {root,store,w,org,hr,draft,input,preview,commit,servers};
}
test('preview is read-only, imports every valid vote before aggregation and retries without duplicate votes',t=>{
 const {store,org,hr,draft,input,preview,commit}=setup(t),before=store.list('service-survey-response');
 const p=preview(input);assert.equal(p.importedCount,4);assert.deepEqual(store.list('service-survey-response'),before);assert.equal(store.list('peer-survey-import').length,0);
 const result=commit(input);assert.equal(result.importedCount,4);assert.equal(result.completedCount,1);assert.equal(store.get(draft.id,'service-survey-campaign').aggregate,60);
 assert.equal(store.list('service-survey-aggregate','employee-0')[0].score,60);assert.equal(org.importPeerResponses(hr,{...input,confirm:true,fingerprint:p.fingerprint}).replayed,true);assert.equal(store.list('service-survey-response').length,4);
 assert.throws(()=>org.importPeerResponses(hr,{...input,rows:input.rows.slice(1)}),{status:409});
 const archive=JSON.stringify(org.listPeerImports(hr));assert.ok(!archive.includes('respondentCode'));assert.ok(!archive.includes('respondentHash'));assert.ok(!archive.includes('"score"'));
 for(const row of store.list('service-survey-response')){assert.equal(row.source,'excel-import');assert.equal(row.respondentHash,undefined);assert.equal(row.importId,undefined);}
 for(const row of store.list('service-survey-ballot')){assert.equal(row.score,undefined);assert.equal(row.rowNumber,undefined);assert.equal(row.respondentId,undefined);}
});
test('partial rows preserve quorum and reject self, same-unit, unknown, duplicate and missing scores',t=>{
 const {store,input,preview,commit}=setup(t);
 const data={...input,rows:[input.rows[0],input.rows[0],{targetCode:'1003',respondentCode:'1003',score:90},{targetCode:'1003',respondentCode:'1004',score:80},{targetCode:'1003',respondentCode:'99999',score:80},{targetCode:'1003',respondentCode:'1006',score:''},{targetCode:'1003',respondentCode:'1007',score:101}]};
 const p=preview(data);assert.equal(p.importedCount,1);assert.equal(p.quarantined.length,6);assert.equal(p.quarantined[0].rowNumber,3);
 const saved=commit(data);assert.equal(saved.completedCount,0);assert.equal(store.list('service-survey-aggregate').length,0);assert.equal(store.list('service-survey-response').length,1);
});
test('new interactive votes invalidate the preview; mixed interactive and imported votes share duplicate protection',t=>{
 const {store,w,org,hr,draft,input,preview,commit}=setup(t),data={...input,rows:input.rows.slice(1,3)},p=preview(data);
 org.submitServiceResponse(w.user('employee-2'),draft.id,{score:20});
 assert.throws(()=>org.importPeerResponses(hr,{...data,confirm:true,fingerprint:p.fingerprint}),{status:409});assert.equal(store.list('service-survey-response').length,1);
 const saved=commit(input);assert.equal(saved.importedCount,3);assert.equal(saved.quarantined.length,1);assert.equal(store.list('service-survey-response').length,4);
});
test('Persian codes and scores are normalized and the first response is not silently treated as zero',t=>{
 const {input,preview,commit,store}=setup(t),data={...input,rows:[{targetCode:'۱۰۰۳',respondentCode:'١٠٠٥',score:'۸۰'}]};
 assert.equal(preview(data).importedCount,1);commit(data);assert.equal(store.list('service-survey-response')[0].score,80);
});
test('different targets aggregate separately and oversized or unconfirmed requests never write votes',t=>{
 const {store,org,hr,input,preview,commit}=setup(t);
 const second=org.createServiceCampaign(hr,{employeeId:'employee-1',period:input.period,minParticipation:60});org.publishServiceCampaign(hr,second.id);
 assert.throws(()=>preview({...input,rows:Array.from({length:501},()=>input.rows[0])}),{status:400});
 assert.throws(()=>org.importPeerResponses(hr,{...input,confirm:true,fingerprint:'stale'}),{status:409});assert.equal(store.list('service-survey-response').length,0);
 const saved=commit({...input,rows:[...input.rows,...input.rows.map(r=>({...r,targetCode:'1004',score:50}))]});
 assert.equal(saved.importedCount,8);assert.equal(saved.completedCount,2);assert.equal(store.list('service-survey-aggregate','employee-0')[0].score,60);assert.equal(store.list('service-survey-aggregate','employee-1')[0].score,50);
});
test('locked quarters, closed positions, deadlines and unpublished campaigns block imports',t=>{
 const {store,input,preview,draft}=setup(t);
 store.put('quarter-evaluation',{id:'locked',employeeId:'employee-0',quarter:input.period,status:'locked'},'employee-0');assert.equal(preview(input).importedCount,0);store.remove('locked','quarter-evaluation','employee-0');
 store.put('position-closeout',{id:'closed',positionId:'position-employee-0',status:'locked'},'employee-0');assert.equal(preview(input).importedCount,0);store.remove('closed','position-closeout','employee-0');
 const original=store.get(draft.id,'service-survey-campaign');store.put('service-survey-campaign',{...original,dueAt:'2000-01-01'});assert.equal(preview(input).importedCount,0);
 store.put('service-survey-campaign',{...original,status:'draft'});assert.equal(preview(input).importedCount,0);
});
test('write failure rolls back scores, voter tokens, completion, archive and audit together',t=>{
 const {store,input,preview,org,hr}=setup(t),p=preview(input),put=store.put;
 store.put=(kind,...args)=>{if(kind==='peer-survey-import')throw Error('simulated database failure');return put(kind,...args);};
 assert.throws(()=>org.importPeerResponses(hr,{...input,confirm:true,fingerprint:p.fingerprint}),/simulated database failure/);store.put=put;
 for(const kind of ['service-survey-response','service-survey-ballot','service-survey-aggregate','peer-survey-import'])assert.equal(store.list(kind).length,0);
 assert.equal(store.list('service-survey-campaign')[0].status,'open');
});
test('HTTP protects admin-only import and archive and permits an authorized preview and confirmation',async t=>{
 const {root,input,servers}=setup(t),s=createPanelServer({root:process.cwd(),dataRoot:root,demoLogin:false,autoAssessment:false,runModel:()=>{throw Error('No AI');}});
 servers.push(s);s.listen(0,'127.0.0.1');await once(s,'listening');const base='http://127.0.0.1:'+s.address().port;
 const session=await(await fetch(base+'/api/session')).json();
 async function req(path,body,token=session.token){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'x-panel-token':token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
 const preview=await req('/api/org/surveys/import',{...input,preview:true});assert.equal(preview.status,200);assert.equal(preview.data.importedCount,4);
 assert.equal((await req('/api/org/surveys/import',{...input,confirm:true,fingerprint:preview.data.fingerprint})).data.importedCount,4);
 for(const userId of ['manager','employee-0']){const switched=await req('/api/session',{userId});const token=switched.data.token;assert.equal((await req('/api/org/surveys/imports',null,token)).status,403);assert.equal((await req('/api/org/surveys/import',{...input,preview:true},token)).status,403);session.token=token;}
});

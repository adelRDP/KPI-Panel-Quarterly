import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {seedQuarterlyFixture} from './quarterly-fixture.mjs';
import {createWorkflow} from '../backend/quarterly-workflow.mjs';
import {createPositionHistory} from '../backend/position-history.mjs';
import {createPanelServer} from '../server.mjs';
import {once} from 'node:events';

test('history deletion is reversible, audited, idempotent and leaves position/money unchanged',()=>{
  const root=mkdtempSync(join(tmpdir(),'position-history-'));
  const {period}=seedQuarterlyFixture(root),store=openStore(root);
  try{
    const workflow=createWorkflow(store),history=createPositionHistory(store),actor=workflow.user('admin'),id='position-employee-0';
    const before=workflow.snapshotForSystem('employee-0',period),position=store.get(id,'position-assignment');
    assert.equal(history.list(actor,[position])[0].historyHidden,false);
    history.hide(actor,id);history.hide(actor,id);
    assert.equal(history.list(actor,[position])[0].historyHidden,true);
    assert.deepEqual(store.get(id,'position-assignment'),position);
    assert.deepEqual(workflow.snapshotForSystem('employee-0',period),before);
    assert.equal(store.list('audit-event').filter(r=>r.action==='position.history-hidden').length,1);
    history.restore(actor,id);history.restore(actor,id);
    assert.equal(history.list(actor,[position])[0].historyHidden,false);
    assert.deepEqual(workflow.snapshotForSystem('employee-0',period),before);
    assert.equal(store.list('audit-event').filter(r=>r.action==='position.history-restored').length,1);
    for(const actor of [workflow.user('manager'),workflow.user('employee-0'),null])for(const action of ['hide','restore'])assert.throws(()=>history[action](actor,id),{status:403});
    assert.throws(()=>history.hide(workflow.user('admin'),'missing'),{status:404});
    assert.equal(store.list('position-history-visibility').length,1);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('HTTP requires admin for history visibility and preserves the position list contract',async()=>{
  const root=mkdtempSync(join(tmpdir(),'position-history-http-'));seedQuarterlyFixture(root);
  const server=createPanelServer({dataRoot:root,demoLogin:false,autoAssessment:false,runModel:()=>{throw Error('No live AI');}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  try{
    let session=await(await fetch(base+'/api/session')).json();
    const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{'x-panel-token':session.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const path='/api/org/positions/position-employee-0/history';
    assert.equal((await request(path,'DELETE')).status,200);
    let rows=await(await request('/api/org/positions')).json();
    assert.equal(rows.find(p=>p.id==='position-employee-0').historyHidden,true);
    assert.equal((await request(path+'/restore','POST')).status,200);
    assert.equal((await request('/api/org/positions/unknown/history','DELETE')).status,404);
    for(const userId of ['manager','employee-0']){
      session=await(await request('/api/session','POST',{userId})).json();
      assert.equal((await request(path,'DELETE')).status,403);
      assert.equal((await request(path+'/restore','POST')).status,403);
    }
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});}
});

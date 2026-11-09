import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {priorContext} from '../backend/alignment-stability.mjs';

test('a revised KPI can be analyzed when earlier runs or correction proofs are missing',t=>{
  const root=mkdtempSync(join(tmpdir(),'quarterly-history-'));
  const store=openStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const original={id:'old',employeeId:'employee',managerId:'manager',period:'1405-Q3',version:1};
  const revised={...original,id:'new',version:2,revises:original.id};
  const task={id:'project',criteria:['Changed acceptance criterion']};
  const context=()=>priorContext(store,revised,[task],'context','codex','model',run=>run?.validationStatus==='valid');

  store.put('kpi-design',original);
  assert.deepEqual(context(),{locks:[],history:[],corrections:[],rounds:0});

  const run=store.put('ai-role-run',{
    id:'run',provider:'codex',model:'model',status:'succeeded',validationStatus:'valid',
    inputs:{stagePayload:{stabilityContextHash:'context',proposals:[{...task,criteria:['Original acceptance criterion']}]}}
  });
  store.put('kpi-design',{...original,aiReview:{runId:run.id,result:{reviews:[
    {proposalId:task.id,recommendation:'needs_information',checks:[],changes:[],missingInformation:['Clarify responsibility']}
  ]}}});
  const result=context();
  assert.deepEqual(result.locks,[]);
  assert.deepEqual(result.history.map(row=>row.runId),[run.id]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {createPanelServer} from '../server.mjs';

test('only admin can configure providers and activation requires a validated synthetic review',async t=>{
  const dataRoot=await mkdtemp(join(tmpdir(),'quarterly-provider-settings-'));
  const store=openStore(dataRoot);
  store.put('workflow-user',{id:'admin',name:'Admin',role:'hr'});
  store.put('workflow-user',{id:'employee',name:'Employee',role:'personnel'});
  store.close();

  let saved={defaultProvider:'codex',providers:{}};
  let correct=false;
  const calls=[];
  const vault={load:()=>structuredClone(saved),save:value=>{saved=structuredClone(value);}};
  const server=createPanelServer({dataRoot,demoLogin:false,providerVault:vault,runModel:async(input,config)=>{
    calls.push({provider:input.provider,...config});
    return {result:{summary:'Synthetic',criteria:[{id:'C1',status:'met',score:100,reason:'Synthetic',citations:[
      {chunkId:'sample-1',quote:correct?'The blue sample report was delivered.':'Invented quotation'}
    ]}]}};
  }});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dataRoot,{recursive:true,force:true});});

  const base='http://127.0.0.1:'+server.address().port;
  const api=async(path,{token,input,headers}={})=>{
    const response=await fetch(base+path,{method:input?'POST':'GET',headers:{'x-panel-token':token||'',...headers},
      body:input?JSON.stringify(input):undefined});
    return {status:response.status,data:await response.json()};
  };
  const session=(await api('/api/session')).data;
  const actor=async(userId,token)=>session.user.id===userId&&!token?session:
    (await api('/api/session',{token:token||session.token,input:{userId}})).data;
  const employee=await actor('employee');
  const path='/api/providers/settings';
  assert.equal((await api(path,{token:employee.token})).status,403);
  assert.equal((await api(path+'/openai/save',{token:employee.token,input:{model:'sample-model'}})).status,403);
  const {token}=await actor('admin',employee.token);
  const get=()=>api(path,{token});
  const post=(provider,action,input={})=>api(path+'/'+provider+'/'+action,{token,input});

  const start=await get();
  assert.equal(start.data.defaultProvider,'codex');
  assert.equal(start.data.providers.find(row=>row.provider==='codex').enabled,true);
  assert.equal((await post('openai','save',{model:'sample-model',apiKey:'synthetic-secret'})).status,200);
  assert.equal((await post('openai','toggle',{enabled:true})).status,409);
  assert.equal((await post('openai','test')).data.ok,false);
  correct=true;
  assert.equal((await post('openai','test')).data.ok,true);
  assert.deepEqual(calls.at(-1),{provider:'openai',model:'sample-model',apiKey:'synthetic-secret'});
  const state=await get();
  assert.equal(state.data.providers.find(row=>row.provider==='openai').hasKey,true);
  assert.equal(JSON.stringify(state).includes('synthetic-secret'),false);
  assert.equal((await post('openai','toggle',{enabled:true})).status,200);
  assert.equal((await post('openai','default')).status,200);
  assert.equal((await get()).data.defaultProvider,'openai');
  assert.equal((await post('openai','save',{model:'updated-model'})).status,200);
  assert.equal((await get()).data.automaticReview,false);
  assert.equal((await post('openai','toggle',{enabled:true})).status,409);
  assert.equal(saved.providers.openai.apiKey,'synthetic-secret');
  assert.equal((await post('gemini','save',{model:'gemini-sample',apiKey:'other-secret'})).status,200);
  assert.equal((await post('gemini','test')).data.ok,true);
  assert.equal((await post('gemini','toggle',{enabled:true})).status,200);
  assert.equal((await post('codex','test')).data.ok,true);
  assert.equal((await post('codex','toggle',{enabled:false})).status,200);
  assert.equal((await post('codex','toggle',{enabled:true})).status,200);
  assert.equal((await post('codex','default')).status,200);
  assert.equal((await get()).data.defaultProvider,'codex');
});

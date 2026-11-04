import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../backend/store.mjs';

test('read scopes reuse parsed records and respect parent boundaries, writes, rollback and scope exit',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kpi-read-cache-')),store=openStore(dir);
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 store.put('review',{id:'r',value:1},'a');
 store.withReadCache(()=>{
  const first=store.list('review','a')[0];
  assert.equal(store.get('r','review'),first);assert.equal(store.get('r','review','a'),first);
  assert.equal(store.get('r','review','b'),null);
  store.withReadCache(()=>assert.equal(store.list('review','a')[0],first));
  store.list('review','a').pop();assert.equal(store.list('review','a').length,1);
  store.put('review',{id:'r',value:2},'b');
  assert.equal(store.get('r','review','a'),null);assert.equal(store.list('review','a').length,0);
  assert.equal(store.get('r','review','b').value,2);
  assert.throws(()=>store.transaction(()=>{store.put('review',{id:'r',value:3},'b');assert.equal(store.get('r','review').value,3);throw Error('rollback');}));
  assert.equal(store.get('r','review').value,2);
  store.remove('r','review','b');assert.equal(store.get('r','review'),null);
 });
 store.put('review',{id:'r',value:4},'a');let cached;
 store.withReadCache(()=>{cached=store.get('r','review');});
 assert.notEqual(store.get('r','review'),cached);assert.equal(store.get('r','review').value,4);
 const readonly=openStore(dir,{readOnly:true});try{assert.equal(readonly.get('r','review').value,4);assert.throws(()=>readonly.put('review',{id:'r',value:5},'a'));}finally{readonly.close();}
});

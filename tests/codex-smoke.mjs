// Explicit opt-in: real account usage; synthetic non-sensitive fixtures only.
import {createPanelServer} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {preprocessConfig} from '../backend/preprocess-harness.mjs';
if(process.argv.includes('--vision'))assert.equal(preprocessConfig().enabled,true,'Vision smoke test requires explicitly authorized preprocessing configuration.');
const dir=await mkdtemp(join(tmpdir(),'kpi-live-test-'));
const server=createPanelServer({dataRoot:dir});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
try {
  const {token}=await(await fetch(base+'/api/session')).json();
  const api=async(path,body)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'x-panel-token':token},body});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
  const providers=await api('/api/providers');assert.equal(providers.providers.find(p=>p.provider==='codex').ready,true);
  const activity=await api('/api/activities',JSON.stringify({kind:'task',title:'Synthetic completion report',description:'Assess only whether a completion date is written in the submitted report.',period:'',criteria:['The report explicitly states the completion date 2026-09-19.']}));
  const route=`/api/activities/${activity.id}`;
  if(process.argv.includes('--vision')) {
    const canvas=createCanvas(700,180),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,700,180);ctx.fillStyle='black';ctx.font='30px sans-serif';ctx.fillText('Report completed on 2026-09-19.',20,80);
    const doc=await api(route+'/documents?name=report.png',canvas.toBuffer('image/png'));assert.equal(doc.extraction.status,'ready',JSON.stringify(doc.extraction));console.log('Vision usage:',doc.extraction.conversion.usage);
  } else await api(route+'/documents?name=report.txt','Report completed on 2026-09-19.');
  const review=await api(route+'/reviews',JSON.stringify({provider:'codex'}));
  assert.equal(review.status,'done');assert.equal(review.result.decision,'completed');assert.equal(review.result.employmentDecision,false);
  const cached=await api(route+'/reviews',JSON.stringify({provider:'codex'}));assert.equal(cached.cached,true);
  console.log(JSON.stringify({passed:true,decision:review.result.decision,score:review.result.qualityScore,usage:review.usage,cached:cached.cached},null,2));
} finally {await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true,maxRetries:3});}

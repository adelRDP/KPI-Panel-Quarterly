import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {preprocessConfig,preprocessVisuals,validateVisualPages,PREPROCESS_VERSION} from '../backend/preprocess-harness.mjs';
import {extractDocument} from '../backend/extract.mjs';
import {sha256} from '../backend/evaluation.mjs';
import {createCanvas} from '@napi-rs/canvas';
import {once} from 'node:events';
import {createPanelServer} from '../server.mjs';
import {comparePreprocessRuns} from '../scripts/benchmark-preprocess.mjs';

const config={PREPROCESS_PROVIDER:'ling',PREPROCESS_NETWORK_ENABLED:'true',PREPROCESS_DATA_AUTHORIZED:'true',LING_API_KEY:'TEST_KEY',PREPROCESS_LING_MODEL:'Ling-3.0-flash-VL',PREPROCESS_INPUT_USD_PER_MTOK:'0.10',PREPROCESS_OUTPUT_USD_PER_MTOK:'0.20',PREPROCESS_MAX_COST_USD:'0.01'};

test('remote preprocessing is disabled by default and needs explicit data authorization, key, and cost rates',()=>{
  assert.equal(preprocessConfig({}).enabled,false);
  for(const missing of ['PREPROCESS_NETWORK_ENABLED','PREPROCESS_DATA_AUTHORIZED','LING_API_KEY','PREPROCESS_INPUT_USD_PER_MTOK','PREPROCESS_OUTPUT_USD_PER_MTOK','PREPROCESS_MAX_COST_USD']){
    const copy={...config};delete copy[missing];assert.throws(()=>preprocessConfig(copy),missing);
  }
  assert.throws(()=>preprocessConfig({...config,PREPROCESS_MAX_COST_USD:'0.00001'}),/سقف هزینه/);
  assert.equal(preprocessConfig(config).model,'Ling-3.0-flash-VL');
});

test('configured remote OCR still needs consent for this upload and never calls the network without it',async t=>{
 const previous=Object.fromEntries(Object.keys(config).map(key=>[key,process.env[key]])),originalFetch=globalThis.fetch,dir=await mkdtemp(join(tmpdir(),'kpi-ocr-consent-'));Object.assign(process.env,config);let calls=0;
 t.after(async()=>{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;await rm(dir,{recursive:true,force:true});});
 globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({pages:[{index:1,text:'Synthetic work evidence',complete:true}]})}}],usage:{prompt_tokens:100,completion_tokens:50}});};
 const path=join(dir,'image.png');await writeFile(path,createCanvas(10,10).toBuffer('image/png'));const blocked=await extractDocument(path,'png','synthetic');assert.equal(blocked.status,'needs_conversion');assert.equal(blocked.conversion.reason,'visual-consent-required');assert.equal(calls,0);
 const allowed=await extractDocument(path,'png','synthetic',{visualConsent:true});assert.equal(allowed.status,'ready');assert.equal(calls,1);assert.ok(allowed.chunks.some(c=>c.text==='Synthetic work evidence'));
 await extractDocument(path,'png','synthetic');assert.equal(calls,1);
});

test('strict visual schema rejects missing, duplicate, extra, and unsupported page claims',()=>{
  assert.deepEqual(validateVisualPages({pages:[{index:1,text:'visible',complete:true}]},1),[{index:1,text:'visible',complete:true}]);
  for(const raw of [{pages:[]},{pages:[{index:1,text:'',complete:true}]},{pages:[{index:1,text:'x',complete:true,decision:'completed'}]},{pages:[{index:1,text:'x',complete:false},{index:1,text:'x',complete:false}]}])assert.throws(()=>validateVisualPages(raw,raw.pages.length===2?2:1));
});

test('Ling visual adapter uses only allowlisted image input, meters cost, and records provenance',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-preprocess-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'image.png');const png=createCanvas(10,10).toBuffer('image/png');await writeFile(path,png);
  const sourceHash=sha256('source');let calls=0;
  const fetchImpl=async(url,options)=>{
    calls++;assert.equal(url,'https://api.ant-ling.com/v1/chat/completions');assert.match(options.headers.Authorization,/TEST_KEY/);
    const body=JSON.parse(options.body);assert.equal(body.model,'Ling-3.0-flash-VL');assert.equal(body.stream,false);assert.equal(body.messages.length,1);assert.equal(body.messages[0].content[1].type,'image_url');assert.match(body.messages[0].content[1].image_url.url,/^data:image\/png;base64,/);assert.ok(!options.body.includes('TEST_KEY'));
    return Response.json({choices:[{message:{content:JSON.stringify({pages:[{index:1,text:'Visible 2026-09-19',complete:true}]})}}],usage:{prompt_tokens:100,completion_tokens:50}});
  };
  const output=await preprocessVisuals({images:[{path,mime:'image/png'}],labels:['تصویر'],documentId:'d1',sourceHash,env:config,fetchImpl});
  assert.equal(calls,1);assert.equal(output.result.pages[0].text,'Visible 2026-09-19');assert.equal(output.audit.version,PREPROCESS_VERSION);assert.equal(output.audit.sourceHash,sourceHash);assert.equal(output.audit.images[0].sha256,sha256(png));assert.equal(output.audit.calls,1);assert.deepEqual(output.audit.allowedSteps,['local_extract','visual_transcribe','validate']);assert.equal(output.audit.estimatedCostUsd,0.00002);
  await assert.rejects(preprocessVisuals({images:[{path,mime:'image/png'}],labels:['تصویر'],documentId:'d1',sourceHash,env:config,fetchImpl:async()=>Response.json({choices:[{message:{content:'{"pages":[]}'}}],usage:{prompt_tokens:100,completion_tokens:10}})}),error=>{assert.match(error.message,/ساختار پاسخ/);assert.equal(error.audit.usage.inputTokens,100);assert.equal(error.audit.status,'failed');return true;});
  await assert.rejects(preprocessVisuals({images:[{path,mime:'image/png'}],labels:['تصویر'],documentId:'d1',sourceHash,env:config,fetchImpl:async()=>Response.json({choices:[{message:{content:'{"pages":[]}'}}]})}),/مصرف توکن/);
  await assert.rejects(preprocessVisuals({images:[{path,mime:'image/png'}],labels:['تصویر'],documentId:'d1',sourceHash,env:config,fetchImpl:async()=>Response.json({choices:[{message:{content:'{"pages":[]}'}}],usage:{prompt_tokens:12001,completion_tokens:10}})}),/سقف مصرف/);
});

test('image upload stays local and non-final when remote preprocessing is off',async t=>{
  const old=process.env.PREPROCESS_PROVIDER;delete process.env.PREPROCESS_PROVIDER;t.after(()=>{if(old===undefined)delete process.env.PREPROCESS_PROVIDER;else process.env.PREPROCESS_PROVIDER=old;});
  const dir=await mkdtemp(join(tmpdir(),'kpi-preprocess-off-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const canvas=createCanvas(10,10);const path=join(dir,'source.png');await writeFile(path,canvas.toBuffer('image/png'));
  const result=await extractDocument(path,'png','d1');assert.equal(result.status,'needs_conversion');assert.equal(result.chunks.length,0);assert.equal(result.conversion.status,'disabled');
});

test('OpenAI and Gemini preprocessing models are configured independently of final review',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kpi-preprocess-adapter-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'image.png');await writeFile(path,createCanvas(5,5).toBuffer('image/png'));
  const expected={pages:[{index:1,text:'Visible fact',complete:true}]};
  for(const provider of ['openai','gemini']){
    const env={...config,PREPROCESS_PROVIDER:provider,[`${provider.toUpperCase()}_API_KEY`]:'TEST_KEY',[`PREPROCESS_${provider.toUpperCase()}_MODEL`]:'budget-vision-model'};
    const output=await preprocessVisuals({images:[{path,mime:'image/png'}],labels:['تصویر'],documentId:'d1',sourceHash:sha256('source'),env,fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body);
      if(provider==='openai'){
        assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(body.store,false);assert.equal(body.model,'budget-vision-model');assert.equal(body.text.format.strict,true);
        return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(expected)}]}],usage:{input_tokens:100,output_tokens:20}});
      }
      assert.match(url,/budget-vision-model:generateContent$/);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.maxOutputTokens,6000);
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(expected)}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20}});
    }});
    assert.deepEqual(output.result,expected);assert.equal(output.audit.provider,provider);assert.equal(output.audit.model,'budget-vision-model');
  }
});

test('benchmark compares only matching source images and never asserts quality savings',()=>{
  const baseline={provider:'openai',model:'small-vision',sourceHash:'a',images:[{sha256:'x'}],usage:{inputTokens:500,outputTokens:100},durationMs:2000,estimatedCostUsd:0.004};
  const candidate={...baseline,provider:'ling',model:'Ling-3.0-flash-VL',usage:{inputTokens:300,outputTokens:60},durationMs:1500,estimatedCostUsd:0.003};
  const comparison=comparePreprocessRuns(baseline,candidate);
  assert.equal(comparison.change.tokenReductionPercent,40);assert.equal(comparison.change.estimatedCostReductionPercent,25);assert.equal(comparison.qualityVerified,false);
  assert.throws(()=>comparePreprocessRuns(baseline,{...candidate,sourceHash:'b'}),/یکسان/);
});

test('HTTP image upload stays unreviewable without preprocessing authorization',async t=>{
  const old=process.env.PREPROCESS_PROVIDER;delete process.env.PREPROCESS_PROVIDER;t.after(()=>{if(old===undefined)delete process.env.PREPROCESS_PROVIDER;else process.env.PREPROCESS_PROVIDER=old;});
  const dir=await mkdtemp(join(tmpdir(),'kpi-preprocess-http-'));
  const server=createPanelServer({dataRoot:dir});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;const {token}=await(await fetch(base+'/api/session')).json();
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'x-panel-token':token},body});
  const activity=await(await post('/api/activities',JSON.stringify({kind:'task',title:'Synthetic image',description:'',period:'',criteria:['A visible date.']}))).json();
  const canvas=createCanvas(10,10);const document=await(await post(`/api/activities/${activity.id}/documents?name=image.png&provider=codex`,canvas.toBuffer('image/png'))).json();
  assert.equal(document.extraction.status,'needs_conversion');assert.equal(document.extraction.conversion.status,'disabled');
  const response=await post(`/api/activities/${activity.id}/reviews`,JSON.stringify({provider:'codex'}));assert.equal(response.status,400);assert.match((await response.json()).error,/فایل خوانده نشد؛ استخراج\/خوانش کامل آن باید تکمیل شود/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assess,providerConfig} from '../backend/providers.mjs';
test('Codex defaults to Luna when no override is configured',()=>{
  const previous=process.env.CODEX_MODEL;delete process.env.CODEX_MODEL;
  try {assert.equal(providerConfig('codex').model,'gpt-6-luna');}
  finally {if(previous===undefined)delete process.env.CODEX_MODEL;else process.env.CODEX_MODEL=previous;}
});
test('API adapters use configured model, schema and server-only credentials',async t=>{
  const old=globalThis.fetch;const keys=['OPENAI_API_KEY','OPENAI_MODEL','GEMINI_API_KEY','GEMINI_MODEL'];const env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  t.after(()=>{globalThis.fetch=old;for(const k of keys){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}});
  const answer={summary:'test',criteria:[]};
  for(const provider of ['openai','gemini']){
    const upper=provider.toUpperCase();process.env[upper+'_API_KEY']='TEST_SECRET';process.env[upper+'_MODEL']='test-model';
    globalThis.fetch=async(url,options)=>{
      const body=JSON.parse(options.body);assert.equal(options.method,'POST');assert.ok(!options.body.includes('TEST_SECRET'));assert.equal(options.signal.aborted,false);
      if(provider==='openai'){assert.equal(body.model,'test-model');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.match(options.headers.Authorization,/TEST_SECRET/);return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(answer)}]}],usage:{input_tokens:1}});}
      assert.match(url,/test-model:generateContent$/);assert.equal(options.headers['x-goog-api-key'],'TEST_SECRET');assert.ok(body.generationConfig.responseJsonSchema);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(answer)}]}}]});
    };
    assert.deepEqual((await assess({provider,prompt:'test'})).result,answer);
    globalThis.fetch=async()=>new Response('secret server details',{status:429});await assert.rejects(assess({provider,prompt:'test'}),/HTTP 429/);
    delete process.env[upper+'_API_KEY'];await assert.rejects(assess({provider,prompt:'test'}));
  }
  assert.throws(()=>providerConfig('bad'));
  await assert.rejects(assess({provider:'codex',prompt:'x'.repeat(50001)}));
  for(const timeoutMs of [0,999,300001,Infinity,2000.5])await assert.rejects(assess({provider:'codex',prompt:'test',timeoutMs}),/مهلت اجرای مدل معتبر نیست/);
});

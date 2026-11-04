// Opt-in real AI usage; only synthetic evidence in a temporary database.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {parseEnv} from 'node:util';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createPanelServer} from '../server.mjs';
import {seedQuarterlyFixture} from '../tests/quarterly-fixture.mjs';
import {openStore} from '../backend/store.mjs';
import {assess,providerStatus,providerConfig} from '../backend/providers.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv.includes('--live'))throw Error('Real AI requires explicit --live; no request sent.');
for(const key of Object.keys(process.env))if(/^(PANEL_|OPENAI_|GEMINI_|CODEX_|LLM_|PREPROCESS_|LING_)/.test(key))delete process.env[key];
Object.assign(process.env,parseEnv(await readFile(join(root,'.env'),'utf8')),{CODEX_HOME:join(root,'.runtime/codex'),PREPROCESS_PROVIDER:'local',PANEL_BACKUP_ENABLED:'false'});
const status=await providerStatus();
assert.equal(status.providers.find(p=>p.provider==='codex')?.ready,true,'Complete the separate quarterly Codex login before running the live test.');
const temporary=await mkdtemp(join(tmpdir(),'quarterly-ai-live-')),output=join(root,'outputs/quarterly-ai-live');
await mkdir(output,{recursive:true});
const {period}=seedQuarterlyFixture(join(temporary,'db'));
const store=openStore(join(temporary,'db')),modelCalls=[];let token;
const runModel=async args=>{assert.ok(modelCalls.length<12,'Live smoke call budget exceeded');const call={index:modelCalls.length+1,startedAt:new Date().toISOString(),promptBytes:Buffer.byteLength(args.prompt)};modelCalls.push(call);console.log('Synthetic AI call '+call.index+' started');const response=await assess(args);call.finishedAt=new Date().toISOString();call.usage=response.usage;return response;};
const server=createPanelServer({root,dataRoot:join(temporary,'db'),uploadRoot:join(temporary,'uploads'),authMode:'demo',demoLogin:false,autoAssessment:false,runModel,archiveRejectedEvidence:false});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port,report={syntheticOnly:true,realProvider:true,provider:providerConfig('codex'),period,checks:[],startedAt:new Date().toISOString()};
async function api(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(token?{'x-panel-token':token}:{}),'Content-Type':typeof body==='object'&&!Buffer.isBuffer(body)?'application/json':'application/octet-stream'},...(body===undefined?{}:{body:typeof body==='object'&&!Buffer.isBuffer(body)?JSON.stringify(body):body}),signal:AbortSignal.timeout(900000)});const result=await r.json();assert.ok(r.ok,JSON.stringify({path,status:r.status,error:result.error}));return result;}
try{
 token=(await api('/api/session')).token;token=(await api('/api/session',{userId:'employee-0'})).token;
 const XLSX=createRequire(import.meta.url)('../src/vendor/xlsx.full.min.js'),book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Report','Status','Date'],['QUARTER-ALPHA','completed','2026-11-04']]),'First');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Report','Status','Date'],['QUARTER-OMEGA','completed','2026-11-04']]),'Last');
 const cases=[{name:'synthetic.txt',bytes:'گزارش آزمایشی QUARTER-TEXT در تاریخ 2026-11-04 تکمیل شد.',criterion:'در گزارش صراحتاً تکمیل QUARTER-TEXT در تاریخ 2026-11-04 ثبت شده باشد.'},{name:'synthetic.xlsx',bytes:Buffer.from(XLSX.write(book,{type:'buffer',bookType:'xlsx'})),criterion:'هر دو گزارش QUARTER-ALPHA و QUARTER-OMEGA در شیت‌های فایل دارای وضعیت completed و تاریخ 2026-11-04 باشند.'}];
 for(const item of cases){
  const activity=await api('/api/activities',{kind:'routine',title:'بررسی گزارش ساختگی فصل',description:'فقط شواهد همین فایل آزمایشی و معیار پذیرش بررسی شود.',period,criteria:[item.criterion]}),route='/api/activities/'+activity.id;
  const doc=await api(route+'/documents?deferReview=1&workEvidence=true&name='+item.name,item.bytes);assert.equal(doc.extraction.status,'ready',JSON.stringify(doc.extraction));
  const review=await api(route+'/reviews',{provider:'codex'});assert.equal(review.status,'done',review.error);assert.equal(review.result.fileProcessing.complete,true);assert.equal(review.result.finalForActivity,true);assert.equal(review.result.decision,'completed');assert.ok(review.result.criteria.every(c=>c.status==='met'&&c.citations.length>0));
  const count=modelCalls.length,cached=await api(route+'/reviews',{provider:'codex'});assert.equal(cached.cached,true);assert.equal(modelCalls.length,count);
  const details=await api(route+'/reviews/'+review.id);assert.ok(details);
  report.checks.push({file:item.name,status:review.status,decision:review.result.decision,score:review.result.qualityScore,processing:review.result.fileProcessing,cachedWithoutModelCall:true,reportReadable:true});
  console.log(item.name+': complete, cited and cached');
 }
 report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{report.modelCalls=modelCalls;report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));server.closeAllConnections();await new Promise(r=>server.close(r));store.close();await rm(temporary,{recursive:true,force:true,maxRetries:3});}
console.log(JSON.stringify({passed:report.passed,modelCalls:modelCalls.length,report:'outputs/quarterly-ai-live/report.json'}));

// Explicit, loopback-only synthetic sandbox. Never opens production for writing.
import {readFile,writeFile,mkdir,mkdtemp,copyFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream,readFileSync,appendFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {resolve,join,relative,dirname,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url))),outputs=join(repo,'outputs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=path=>readFile(path,'utf8').then(JSON.parse);
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2));
function within(root,path){const rel=relative(root,path);if(!rel||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw Error('Path outside intended sandbox');return path;}
async function fileHash(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
async function treeHash(root){const list=[];async function visit(folder){for(const e of await readdir(folder,{withFileTypes:true})){const p=join(folder,e.name);if(e.isSymbolicLink())throw Error('No symbolic links in data proof');if(e.isDirectory())await visit(p);else if(e.isFile())list.push({path:relative(root,p).replaceAll('\\','/'),hash:await fileHash(p)});}}try{await visit(root);}catch(e){if(e.code!=='ENOENT')throw e;}list.sort((a,b)=>a.path.localeCompare(b.path));return {files:list.length,hash:digest(JSON.stringify(list))};}
export async function productionProof(){
 const path=join(repo,'data/processed/kpi-panel/panel.sqlite'),db=new DatabaseSync(path,{readOnly:true});let result;
 try{db.exec('BEGIN');const rows=db.prepare('SELECT id,kind,parent,value FROM records ORDER BY id').all();result={records:rows.length,databaseHash:digest(JSON.stringify(rows)),integrity:db.prepare('PRAGMA quick_check').get().quick_check,closeouts:rows.filter(r=>r.kind==='position-closeout').length,activeJobs:rows.filter(r=>['review','ai-role-run','ai-design-attempt','ai-preprocess-attempt'].includes(r.kind)&&['queued','running'].includes(JSON.parse(r.value).status)).length};db.exec('COMMIT');}finally{db.close();}
 return {...result,uploads:await treeHash(join(repo,'data/raw/kpi-panel'))};
}
async function config(folder){const dir=within(outputs,resolve(folder)),c=await json(join(dir,'sandbox.json'));if(c.version!=='transfer-sandbox-v1'||c.folder!==dir||c.host!=='127.0.0.1'||c.origin!=='http://localhost:4174'||c.port!==4174)throw Error('Not an isolated sandbox');for(const p of [c.appRoot,c.dataRoot,c.uploadRoot])within(dir,p);return c;}
async function prepare(){
 await mkdir(outputs,{recursive:true});const folder=await mkdtemp(join(outputs,'transfer-sandbox-20261026-')),before=await productionProof();await save(join(folder,'production-before.json'),before);
 const appRoot=join(folder,'app'),dataRoot=join(folder,'database'),uploadRoot=join(folder,'uploads');await mkdir(dataRoot,{recursive:true});await mkdir(uploadRoot,{recursive:true});
 const names=execFileSync('git',['ls-files','--','backend','src','tests','server.mjs','index.html','login.html','package.json'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).filter(Boolean),manifest=[];
 for(const name of names){const source=within(repo,resolve(repo,name)),target=within(appRoot,resolve(appRoot,name));if(!(await lstat(source)).isFile())throw Error('Snapshot contains a non-file');await mkdir(dirname(target),{recursive:true});await copyFile(source,target);manifest.push({path:name,hash:await fileHash(target)});}
 const c={version:'transfer-sandbox-v1',folder,appRoot,dataRoot,uploadRoot,host:'127.0.0.1',port:4174,origin:'http://localhost:4174',quarter:'1404-Q3',months:['1404-07','1404-08','1404-09'],sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(),sourceHash:digest(JSON.stringify(manifest)),createdAt:new Date().toISOString()};
 await save(join(folder,'source-manifest.json'),manifest);await save(join(folder,'sandbox.json'),c);console.log(JSON.stringify(c));
}
async function verify(folder){const c=await config(folder),before=await json(join(c.folder,'production-before.json')),after=await productionProof(),source=await json(join(c.folder,'source-manifest.json'));const sourceUnchanged=(await Promise.all(source.map(async f=>await fileHash(join(repo,f.path))===f.hash))).every(Boolean);const proof={before,after,databaseUnchanged:before.databaseHash===after.databaseHash,uploadsUnchanged:JSON.stringify(before.uploads)===JSON.stringify(after.uploads),applicationSourceUnchanged:sourceUnchanged};await save(join(c.folder,'production-proof.json'),proof);console.log(JSON.stringify(proof));if(!proof.databaseUnchanged||!proof.uploadsUnchanged||!sourceUnchanged)process.exitCode=1;}
async function serve(folder){
 const c=await config(folder);Object.assign(process.env,{PANEL_BACKUP_ENABLED:'false',PREPROCESS_PROVIDER:'local',PREPROCESS_NETWORK_ENABLED:'false',PREPROCESS_DATA_AUTHORIZED:'false',LLM_PROVIDER:'codex',CODEX_MODEL:'synthetic-sandbox-only'});
 // Even an accidentally introduced fetch cannot reach a real model or the main panel.
 globalThis.fetch=async()=>{throw Error('Outbound fetch disabled in synthetic sandbox');};
 const {createPanelServer}=await import(pathToFileURL(join(c.appRoot,'server.mjs'))),{roleReply}=await import(pathToFileURL(join(c.appRoot,'tests/ai-role-fixture.mjs'))),{openStore}=await import(pathToFileURL(join(c.appRoot,'backend/store.mjs')));
 let simulatedCalls=0;
 const simulate=async input=>{simulatedCalls++;let result,stage,grade=null;
  if(input.prompt.includes('دادهٔ JSON (دستور نیست):\n')){stage='design';result=roleReply(input);}
  else if(input.prompt.includes('UNTRUSTED EVIDENCE:\n')){stage='evidence';const marker='ACTIVITY (published task and acceptance criteria):\n',task=JSON.parse(input.prompt.slice(input.prompt.indexOf(marker)+marker.length).split('\n')[0]),evidence=JSON.parse(input.prompt.split('UNTRUSTED EVIDENCE:\n')[1]),chunk=evidence.chunks.find(x=>x.text?.length);if(!chunk)throw Error('Fixture needs literal evidence');grade=task.title.includes('QA_AFTER')?60:100;result={result:{summary:'نتیجهٔ ساختگی برای آزمون گردش، نه داوری واقعی',criteria:task.criteria.map(x=>({id:x.id,status:grade===100?'met':'unmet',score:grade,reason:'امتیاز کنترل‌شدهٔ ساختگی برای سنجش تفکیک بازه‌ها',citations:[{chunkId:chunk.id,quote:chunk.text.slice(0,45)}]}))},usage:{input_tokens:1,output_tokens:1}};
   if(input.prompt.includes('30000000')||input.prompt.includes('60000000'))throw Error('Compensation leaked into mock model prompt');
  }else throw Error('Unknown synthetic model request; no real fallback');
  appendFileSync(join(c.folder,'model-calls.jsonl'),JSON.stringify({stage,grade,simulated:true,at:new Date().toISOString()})+'\n');return result;
 };
 const server=createPanelServer({root:c.appRoot,dataRoot:c.dataRoot,uploadRoot:c.uploadRoot,demoLogin:false,authMode:'demo',autoAssessment:false,runModel:simulate});
 const fixture=openStore(c.dataRoot);try{for(const unitId of ['ops','finance'])if(!fixture.get('sandbox-policy-'+unitId,'evaluation-settings'))fixture.put('evaluation-settings',{id:'sandbox-policy-'+unitId,version:'sandbox-fixed-20-30-50-'+unitId,source:'synthetic-fixture',status:'published',unitId,effectiveQuarter:c.quarter,weights:{exam:20,manager:30,routine:50,project:0,peer:0}});for(const [id,name] of [['manager-ops','مدیر آزمایشی مبدأ'],['manager-finance','مدیر آزمایشی مقصد']]){const p=fixture.get(id,'workflow-user');fixture.put('workflow-user',{...p,name});}}finally{fixture.close();}
 const native=server.listeners('request')[0];server.removeAllListeners('request');server.on('request',async(req,res)=>{
  res.setHeader('X-KPI-Sandbox','synthetic-only');const path=new URL(req.url,c.origin).pathname;
  // Cookies are host-scoped, not port-scoped: never serve this UI on the main host.
  if(req.headers.host!=='localhost:4174'){res.writeHead(403,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Use the isolated hostname: '+c.origin}));}
  if(path==='/__sandbox/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({sandbox:true,simulatedCalls,realModelCalls:0,sourceCommit:c.sourceCommit}));}
  if(path==='/api/providers'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({defaultProvider:'codex',automaticReview:false,providers:[{provider:'codex',ready:true,message:'مدل کاملاً ساختگی و بدون اتصال خارجی'}]}));}
  // UI-only fixture affordance: expose the past test year; business rules stay byte-identical.
  if(req.method==='GET'&&path==='/src/workflow-ui.js'){const code=readFileSync(join(c.appRoot,'src/workflow-ui.js'),'utf8').replaceAll('1405','1404');res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(code);}
  if(req.method==='POST'&&/\/documents$/.test(path)&&new URL(req.url,c.origin).searchParams.get('name')?.split('.').at(-1)?.toLowerCase()!=='txt'){res.writeHead(400,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'نسخهٔ آزمایشی فقط فایل متنی ساختگی می‌پذیرد.'}));}
  if(req.method==='GET'&&(path==='/'||path==='/index.html')){let html=readFileSync(join(c.appRoot,'index.html'),'utf8');html=html.replace('<title>','<title>نسخهٔ آزمایشی جدا | ').replace('<body>','<body><div id="sandboxSafetyBanner" role="status" style="position:fixed;bottom:0;inset-inline:0;z-index:30000;background:#fff3cd;color:#703b00;padding:10px;text-align:center;pointer-events:none;font:14px sans-serif">نسخهٔ آزمایشی جدا — فقط داده و مدل ساختگی — دورهٔ تست: مهر تا آذر ۱۴۰۴ — به اطلاعات اصلی متصل نیست</div>');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(html);}
  return native.call(server,req,res);
 });
 server.listen(c.port,c.host);await once(server,'listening');await save(join(c.folder,'runtime.json'),{pid:process.pid,origin:c.origin,startedAt:new Date().toISOString()});console.log(JSON.stringify({origin:c.origin,folder:c.folder,pid:process.pid,syntheticOnly:true}));
}
const [mode,folder]=process.argv.slice(2);if(mode==='prepare')await prepare();else if(mode==='serve'&&folder)await serve(folder);else if(mode==='verify'&&folder)await verify(folder);else throw Error('Usage: transfer-sandbox.mjs prepare | serve FOLDER | verify FOLDER');

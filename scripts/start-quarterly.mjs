import {dirname,resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync,mkdirSync,realpathSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createPanelSupervisor} from './panel-supervisor.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Never inherit another project's data locations or provider credentials.
for(const key of Object.keys(process.env))if(/^(PANEL_|OPENAI_|GEMINI_|CODEX_|LLM_|PREPROCESS_|LING_)/.test(key))delete process.env[key];
if(existsSync(join(root,'.env')))Object.assign(process.env,parseEnv(readFileSync(join(root,'.env'),'utf8')));
const canonicalRoot=realpathSync.native(root);
const configuredDataRoot=process.env.PANEL_DATA_ROOT;
if(configuredDataRoot&&!isAbsolute(configuredDataRoot))throw Error('PANEL_DATA_ROOT must be an absolute path.');
const dataRoot=configuredDataRoot||join(canonicalRoot,'data/processed/kpi-panel');
if(process.platform==='win32'&&realpathSync.native(dataRoot).startsWith('\\'))throw Error('PANEL_DATA_ROOT must be on a local disk.');
Object.assign(process.env,{PORT:'4273',PANEL_SUPERVISOR_PORT:'4272',PANEL_AUTH_MODE:'hybrid',PANEL_DATA_ROOT:dataRoot,PANEL_UPLOAD_ROOT:join(canonicalRoot,'data/raw/kpi-panel'),PANEL_BACKUP_ROOT:join(canonicalRoot,'data/local/backups'),PANEL_BACKUP_ENABLED:'true',CODEX_HOME:join(root,'.runtime/codex')});
mkdirSync(process.env.CODEX_HOME,{recursive:true});
if(!existsSync(join(process.env.PANEL_DATA_ROOT,'panel.sqlite')))throw Error('ابتدا اطلاعات سازمانی را به پایگاه دادهٔ مستقل وارد کنید.');
const supervisor=createPanelSupervisor({root,port:4273,lockPort:4272});await supervisor.start();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await supervisor.stop();process.exit();});

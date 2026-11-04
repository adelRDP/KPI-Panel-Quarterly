import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createPanelSupervisor} from './panel-supervisor.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Never inherit another project's data locations or provider credentials.
for(const key of Object.keys(process.env))if(/^(PANEL_|OPENAI_|GEMINI_|CODEX_|LLM_|PREPROCESS_|LING_)/.test(key))delete process.env[key];
if(existsSync(join(root,'.env')))Object.assign(process.env,parseEnv(readFileSync(join(root,'.env'),'utf8')));
Object.assign(process.env,{PORT:'4273',PANEL_SUPERVISOR_PORT:'4272',PANEL_AUTH_MODE:'hybrid',PANEL_DATA_ROOT:join(root,'data/processed/kpi-panel'),PANEL_UPLOAD_ROOT:join(root,'data/raw/kpi-panel'),PANEL_BACKUP_ROOT:join(root,'data/local/backups'),PANEL_BACKUP_ENABLED:'true',CODEX_HOME:join(root,'.runtime/codex')});
mkdirSync(process.env.CODEX_HOME,{recursive:true});
if(!existsSync(join(process.env.PANEL_DATA_ROOT,'panel.sqlite')))throw Error('ابتدا اطلاعات سازمانی را به پایگاه دادهٔ مستقل وارد کنید.');
const supervisor=createPanelSupervisor({root,port:4273,lockPort:4272});await supervisor.start();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await supervisor.stop();process.exit();});

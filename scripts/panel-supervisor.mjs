import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdirSync,openSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {panelInstance} from '../backend/panel-health.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function createPanelSupervisor({root=process.cwd(),port=4273,lockPort=4272,pollMs=5000,spawnChild,log=console.log}={}){
 root=resolve(root);const mutex=createServer(socket=>socket.end('KPI supervisor\n'));let child=null,stopped=false,loop,missing=0,restarts=0;
 async function health(){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)}),v=await r.json();return r.ok&&v.service==='kpi-quarterly-panel'&&v.instance===panelInstance(root);}catch{return false;}}
 const occupied=()=>new Promise(resolve=>{import('node:net').then(({connect})=>{const socket=connect(port,'127.0.0.1');socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(true);});});});
 function launch(){
  if(spawnChild)return spawnChild();mkdirSync(join(root,'.runtime'),{recursive:true});const output=openSync(join(root,'.runtime/panel-service.stdout.log'),'a'),error=openSync(join(root,'.runtime/panel-service.stderr.log'),'a');
  try{return spawn(process.execPath,['--env-file-if-exists=.env','server.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:['ignore',output,error]});}finally{closeSync(output);closeSync(error);}
 }
 async function run(){while(!stopped){
  if(await health()){missing=0;restarts=0;}
  else if(child&&child.exitCode===null&&child.signalCode===null){/* Do not kill slow model work or busy extraction. */}
  else if(++missing>=2&&!await occupied()){
   if(restarts)await pause(Math.min(30000,1000*2**Math.min(restarts,5)));if(stopped)break;
   log('Starting KPI panel');const launched=launch();child=launched;launched.on('error',e=>{log('Panel launch failed: '+e.message);if(child===launched)child=null;});restarts++;missing=0;
  }
  await pause(pollMs);
 }}
 return {health,get child(){return child;},get lockPort(){return mutex.address()?.port;},async start(){await new Promise((resolve,reject)=>{mutex.once('error',reject);mutex.listen(lockPort,'127.0.0.1',resolve);});loop=run();},async stop(){stopped=true;if(child&&child.exitCode===null&&child.signalCode===null){const finished=new Promise(r=>child.once('exit',r));child.kill();await finished;}await loop;await new Promise(r=>mutex.close(r));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const supervisor=createPanelSupervisor({port:Number(process.env.PORT||4273),lockPort:Number(process.env.PANEL_SUPERVISOR_PORT||4272)});try{await supervisor.start();}catch(error){console.error('Supervisor not started: '+error.message);process.exitCode=1;}
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await supervisor.stop();process.exit();});
}

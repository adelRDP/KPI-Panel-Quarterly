import {resolve,join} from 'node:path';
import {createPanelBackup,verifyPanelBackup,restorePanelBackup} from '../backend/panel-backup.mjs';
const args=process.argv.slice(2);
try{
 if(args[0]==='--verify'&&args[1])console.log(JSON.stringify(await verifyPanelBackup(resolve(args[1]))));
 else if(args[0]==='--restore'&&args[1]&&args[2])console.log(JSON.stringify(await restorePanelBackup({folder:resolve(args[1]),destination:resolve(args[2])})));
 else if(args[0]==='--create'){const root=process.cwd(),result=await createPanelBackup({dataRoot:process.env.PANEL_DATA_ROOT||join(root,'data/processed/kpi-panel'),uploadRoot:process.env.PANEL_UPLOAD_ROOT||join(root,'data/raw/kpi-panel'),backupRoot:process.env.PANEL_BACKUP_ROOT||join(root,'data/local/backups')});console.log(JSON.stringify(result));}
 else {console.error('Usage: node scripts/panel-backup.mjs --create | --verify BACKUP_FOLDER | --restore BACKUP_FOLDER NEW_DESTINATION');process.exitCode=1;}
}catch(error){console.error(error.message);process.exitCode=1;}

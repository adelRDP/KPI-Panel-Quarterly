import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=['server.mjs','scripts/check.mjs'];
for(const directory of ['backend','src','tests']) for(const file of await readdir(directory)) if(/\.(?:mjs|cjs|js)$/.test(file))files.push(`${directory}/${file}`);
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);}
console.log(`Syntax checked: ${files.length} JavaScript files.`);

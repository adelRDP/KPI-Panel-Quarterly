// Explicit, one-time organization export/import. No evaluations or credentials.
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync,readdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {openStore} from '../backend/store.mjs';
import {periodAtDate} from '../backend/quarter-period.mjs';
const source=resolve(process.argv[2]||''),root=resolve(process.cwd());
if(!process.argv[2]||source===root)throw Error('An independent source project is required');
const destination=join(root,'data/processed/kpi-panel');
if(existsSync(join(destination,'panel.sqlite')))throw Error('Destination database already exists; import refused');
const db=new DatabaseSync(join(source,'data/processed/kpi-panel/panel.sqlite'),{readOnly:true});
const rows=db.prepare('SELECT * FROM records ORDER BY id').all();db.close();
const digest=value=>createHash('sha256').update(value).digest('hex');
const files=(dir,prefix='')=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(join(dir,x.name),prefix+x.name+'/'):[{path:prefix+x.name,sha256:digest(readFileSync(join(dir,x.name)))}]):[];
const proof={records:rows.length,recordsHash:digest(JSON.stringify(rows)),files:files(join(source,'data/raw/kpi-panel'))};
const list=kind=>rows.filter(r=>r.kind===kind).map(r=>JSON.parse(r.value));
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
const now=new Date().toISOString(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran'}).format(new Date());
const users=list('workflow-user'),positions=list('position-assignment');
const selected=users.map(person=>({person,position:positions.filter(p=>p.employeeId===person.id&&p.status==='published'&&p.effectiveFrom<=today&&(!p.effectiveTo||p.effectiveTo>today)).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0]}));
const store=openStore(destination),counts={};
store.transaction(()=>{
 for(const kind of ['org-unit','org-section'])for(const row of list(kind).filter(r=>!r.removedAt)){store.put(kind,{...pick(row,['id','name','unitId']),createdAt:now,createdBy:'organization-import'});counts[kind]=(counts[kind]||0)+1;}
 for(const {person,position} of selected){
  const value=pick(person,['id','name','role','employeeCode','phone','email','unitId','unitName','sectionId','managerId','level','jobTitle','jobFamily','baseSalary','hasProjects','isKpiEligible','isSettled','settlementDate']);
  if(position)Object.assign(value,pick(position,['unitId','unitName','sectionId','managerId','jobTitle','jobFamily','baseSalary','hasProjects','isKpiEligible']),{level:position.jobLevel});
  store.put('workflow-user',{...value,createdAt:now});counts['workflow-user']=(counts['workflow-user']||0)+1;
  if(position){store.put('position-assignment',{...pick(position,['employeeId','jobTitle','jobFamily','sectionId','jobLevel','unitId','unitName','managerId','duties','isManager','isKpiEligible','hasProjects','baseSalary']),id:randomUUID(),status:'published',effectiveFrom:today,effectiveTo:null,version:1,createdAt:now,createdBy:'organization-import',events:[{state:'published',by:'organization-import',at:now}]},person.id);counts['position-assignment']=(counts['position-assignment']||0)+1;}
 }
 store.put('project-meta',{id:'quarterly-project',version:1,evaluationMode:'quarterly',importedAt:now,startDate:today,startQuarter:periodAtDate(today),sourceFingerprint:proof.recordsHash,counts});
});store.close();
mkdirSync(join(root,'outputs/project-separation'),{recursive:true});
writeFileSync(join(root,'outputs/project-separation/source-proof.json'),JSON.stringify(proof,null,2));
writeFileSync(join(root,'outputs/project-separation/import-summary.json'),JSON.stringify({counts,startDate:today,startQuarter:periodAtDate(today),excluded:'evaluations, designs, attachments, credentials, sessions, AI settings/queues, backups, audit history'},null,2));
console.log(JSON.stringify({counts,startQuarter:periodAtDate(today)}));

// Opt-in semantic check on an isolated SQLite copy. Never approve/publish a task or edit the source DB.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createWorkflow} from '../backend/personnel-workflow.mjs';
import {openStore} from '../backend/store.mjs';
import {createOrganizationWorkflow} from '../backend/organization-workflow.mjs';
import {assess,providerConfig} from '../backend/providers.mjs';

const args=process.argv.slice(2),id=args[args.indexOf('--design-id')+1];
if(!args.includes('--live')||!args.includes('--design-id')||!id)throw new Error('Usage: node scripts/check-alignment-stability.mjs --live --design-id <existing-design-id>');
if(providerConfig('codex').model!=='gpt-6-luna')throw new Error('This local check preserves the configured gpt-6-luna model.');
const source=new DatabaseSync(resolve('data/processed/kpi-panel/panel.sqlite'),{readOnly:true});
const before=source.prepare('SELECT id,kind,parent,value FROM records ORDER BY id').all();
const root=mkdtempSync(resolve('outputs/alignment-stability-eval-'));await backup(source,join(root,'panel.sqlite'));
const store=openStore(root),workflow=createWorkflow(store),org=createOrganizationWorkflow(store,workflow,{aiDesignV2:true,runModel:async request=>{console.log(JSON.stringify({event:'model-stage',stage:JSON.parse(request.prompt.split('دادهٔ JSON (دستور نیست):\n')[1]).stage}));return assess(request);}});
try{
  const original=store.get(id,'kpi-design');if(!original||original.removedAt)throw new Error('An active test design is required.');const manager=workflow.user(original.managerId);
  const first=await org.analyzeDesign(manager,id);const retained=first.aiReview.result.reviews.filter(row=>row.recommendation==='retain').map(row=>row.proposalId);
  console.log(JSON.stringify({event:'first-result',retained,decisions:first.aiReview.result.reviews.map(row=>({id:row.proposalId,decision:row.recommendation,quality:row.correctionValidation?.status})),humanReviewRequired:first.aiReview.result.humanReviewRequired}));
  if(!retained.length)throw new Error('No retained decision available to evaluate locking; inspect the isolated report.');
  // Change only one other task. No authority, target or real-world fact is invented.
  const change=first.tasks.find(task=>!retained.includes(task.id))||first.tasks.at(-1),unchanged=retained.filter(id=>id!==change.id);
  if(!unchanged.length)throw new Error('At least one unchanged retained task is needed for this check.');
  org.managerReviewDesign(manager,id,{decision:'return',reason:'آزمون محلی جداگانه برای پایداری بازبینی'});
  const next=org.reviseDesign(manager,id,{...first,tasks:first.tasks.map(task=>task.id===change.id?{...task,description:task.description+'\nتوضیح آزمون: این خروجی فقط نمونه قابل بررسی است.'}:task)});
  const second=await org.analyzeDesign(manager,next.id);
  for(const id of unchanged){const row=second.aiReview.result.reviews.find(row=>row.proposalId===id);if(row.recommendation!=='retain'||!row.lock)throw new Error('An unchanged retained task lost its server lock.');}
  if(store.list('activity').some(row=>row.designId===next.id))throw new Error('The check must never publish or assign a task.');
  console.log(JSON.stringify({event:'semantic-check',passed:true,model:providerConfig('codex').model,unchangedRetains:unchanged.length,locked:second.aiReview.result.reviews.filter(row=>row.lock).length,sourceUnchanged:JSON.stringify(before)===JSON.stringify(source.prepare('SELECT id,kind,parent,value FROM records ORDER BY id').all()),isolatedDb:join(root,'panel.sqlite')}));
}finally{store.close();source.close();}

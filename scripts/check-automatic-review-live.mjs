// Explicit real-model check. All definitions/files are synthetic and the database is temporary.
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createPanelServer} from '../server.mjs';
import {openStore} from '../backend/store.mjs';
import {currentPeriod} from '../backend/personnel-workflow.mjs';
if(!process.argv.includes('--authorize-live'))throw Error('--authorize-live لازم است.');
const root=await mkdtemp(join(tmpdir(),'kpi-auto-live-')),server=createPanelServer({dataRoot:root}),store=openStore(root);
const partial=process.argv.includes('--partial');
const activity=store.put('activity',{kind:'routine',title:'SYNTHETIC ONLY: documented task completion',description:'Two independent required outputs: A must be done and B must be done. Judge only the supplied complete synthetic written record. For each individual output, done means fully fulfilled (100), explicitly not_done means not fulfilled (0).',period:currentPeriod(),ownerId:'employee-mohammad',unitId:'ops',assignmentStatus:'approved',criteria:partial?[{id:'C1',text:'Output A is explicitly done.'},{id:'C2',text:'Output B is explicitly done.'}]:[{id:'C1',text:'Both A=done and B=done are explicitly written in the record.'}]});
server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
try{
 const session=await(await fetch(base+'/api/session')).json();const res=await fetch(base+'/api/activities/'+activity.id+'/documents?name=synthetic.txt&workEvidence=true',{method:'POST',headers:{'x-panel-token':session.token},body:`SYNTHETIC RECORD, no real-world personal data. A=done; B=${partial?'not_done':'done'}. END OF COMPLETE RECORD.`});
 const doc=await res.json();assert.equal(res.status,201);assert.equal(doc.autoReview.status,'queued');let review;
 for(let i=0;i<150;i++){review=store.list('review',activity.id)[0];if(['done','failed'].includes(review?.status))break;await new Promise(r=>setTimeout(r,1000));}
 assert.equal(review.status,'done',review.error);assert.equal(review.result.qualityScore,partial?50:100);assert.equal(review.result.attainmentScore,partial?50:100);assert.equal(store.list('metric-contract').length,0);
 console.log(JSON.stringify({passed:true,automatic:true,partial,score:review.result.finalScore,provider:review.provider,model:review.model,usage:review.usage,syntheticOnly:true,contracts:0}));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();await rm(root,{recursive:true,force:true,maxRetries:3});}

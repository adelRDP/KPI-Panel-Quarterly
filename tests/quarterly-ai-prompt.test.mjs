import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAnalysisPrompt} from '../backend/job-design-analysis.mjs';
import {taskFrequencies,validateTaskRecurrence} from '../backend/task-definition.mjs';
import {analysisDataMarker} from '../backend/analysis-input.mjs';
test('AI alignment instructions permit every backend recurrence including quarterly, preserving task input',()=>{
 const task={category:'routine',frequency:'فصلی',timeLimit:{time:'09:00'},targetVolume:1,targetUnit:'گزارش',dueDate:'2026-12-21',criteria:['گزارش کامل فصل ثبت شود']};
 const envelope={stagePayload:{proposals:[task]},sourceManifest:[]};
 const {prompt}=buildAnalysisPrompt('kpi-alignment-v4',envelope),[instructions,data]=prompt.split(analysisDataMarker);
 const allowed=/تناوب فقط ([^ ]+) باشد/.exec(instructions)?.[1].split('/');
 assert.deepEqual(new Set(allowed),new Set(taskFrequencies));
 assert.match(instructions,/دورهٔ ارزیابی همیشه فصلی است/);assert.match(instructions,/در تناوب فصلی، timeLimit فقط ساعت دارد/);
 assert.deepEqual(JSON.parse(data),envelope);
 assert.deepEqual(validateTaskRecurrence(task,{requireTimeLimit:true}).timeLimit,{time:'09:00'});
});

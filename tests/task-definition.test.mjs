import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTaskWeights,validateTaskRecurrence,taskWeightVersion} from '../backend/task-definition.mjs';

test('project quantities need no recurring frequency or time and discard stale routine fields',()=>{
  const base={category:'project',targetVolume:2,targetUnit:'گزارش'};
  assert.deepEqual(validateTaskRecurrence(base),{targetVolume:2,targetUnit:'گزارش',frequency:null,timeLimit:null,recurrenceVersion:'project-deadline-v1'});
  assert.deepEqual(validateTaskRecurrence({...base,frequency:'ماهانه',timeLimit:{dayOfMonth:15,time:'10:30'},recurrenceVersion:'required-task-time-v2'}),validateTaskRecurrence(base));
  assert.throws(()=>validateTaskRecurrence({...base,targetVolume:0}),/تعداد/);assert.throws(()=>validateTaskRecurrence({...base,targetUnit:'غیرمجاز'}),/واحد هدف/);
});

test('relative points normalize independently per category and ignore a supplied percentage',()=>{
  const rows=normalizeTaskWeights([{category:'routine',weightPoints:2,weight:99},{category:'routine',weightPoints:3},{category:'project',weightPoints:5},{category:'project',weightPoints:1}]);
  assert.deepEqual(rows.slice(0,2).map(task=>task.weight),[40,60]);
  assert.ok(Math.abs(rows[2].weight-100*5/6)<1e-10);assert.ok(Math.abs(rows[3].weight-100/6)<1e-10);
  assert.ok(rows.every(task=>task.weightVersion===taskWeightVersion));
  assert.equal(normalizeTaskWeights([{category:'project',weightPoints:1}])[0].weight,100);
  for(const weightPoints of [0,6,1.5,'',null,undefined,NaN])assert.throws(()=>normalizeTaskWeights([{category:'routine',weightPoints:2},{category:'routine',weightPoints}]),/۱ تا ۵/);
  assert.deepEqual(normalizeTaskWeights([{category:'routine',weight:60},{category:'routine',weight:40}]).map(task=>task.weight),[60,40]);
  assert.throws(()=>normalizeTaskWeights([{category:'routine',weight:60}]),/مجموع وزن/);
});

test('recurrence constraints accept exactly the fields applicable to each frequency',()=>{
  const base={targetVolume:3,targetUnit:'گزارش'};
  const limits={ماهانه:{dayOfMonth:31,dayOfWeek:0,time:'09:30'},هفتگی:{dayOfWeek:6,time:'23:59'},روزانه:{time:'00:00'},ساعتی:{time:'12:45'}};
  for(const [frequency,timeLimit] of Object.entries(limits)){
    assert.deepEqual(validateTaskRecurrence({...base,frequency,timeLimit}),{...base,frequency,timeLimit});
    assert.equal(validateTaskRecurrence({...base,frequency}).timeLimit,null);
  }
  for(const task of [
    {...base,frequency:'نامعتبر'}, {...base,frequency:'ماهانه',targetVolume:0}, {...base,frequency:'روزانه',targetVolume:1.5},
    {...base,frequency:'روزانه',targetUnit:'متن آزاد'}, {...base,frequency:'روزانه',timeLimit:{time:'24:00'}},
    {...base,frequency:'روزانه',timeLimit:{dayOfWeek:1,time:'12:00'}}, {...base,frequency:'هفتگی',timeLimit:{time:'12:00'}},
    {...base,frequency:'ماهانه',timeLimit:{dayOfMonth:32,dayOfWeek:1,time:'12:00'}}, {...base,frequency:'ماهانه',timeLimit:{dayOfMonth:1,dayOfWeek:'',time:'12:00'}}
  ])assert.throws(()=>validateTaskRecurrence(task),error=>error.status===400);
});

test('required timing uses month/day separately from week/day and preserves historical optional records',()=>{
  const base={targetVolume:1,targetUnit:'عدد',recurrenceVersion:'required-task-time-v2'};
  for(const [frequency,timeLimit] of [['ماهانه',{dayOfMonth:31,time:'00:00'}],['هفتگی',{dayOfWeek:0,time:'23:59'}],['روزانه',{time:'12:45'}],['ساعتی',{time:'10:30'}]])assert.deepEqual(validateTaskRecurrence({...base,frequency,timeLimit}).timeLimit,timeLimit);
  assert.throws(()=>validateTaskRecurrence({...base,frequency:'روزانه'}),/زمان انجام/);
  assert.throws(()=>validateTaskRecurrence({...base,frequency:'ماهانه',timeLimit:{dayOfMonth:15,dayOfWeek:0,time:'10:30'}}),/تناوب/);
  assert.equal(validateTaskRecurrence({...base,recurrenceVersion:undefined,frequency:'روزانه'}).timeLimit,null);
});

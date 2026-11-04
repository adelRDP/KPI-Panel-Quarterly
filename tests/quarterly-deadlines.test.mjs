import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),ui=readFileSync(new URL('../src/workflow-ui.js',import.meta.url),'utf8');
const context=vm.createContext({window:{PanelWorkflow:{}},Intl,Date});
vm.runInContext(app.slice(0,app.indexOf('})();')+5),context);
vm.runInContext(ui.slice(ui.indexOf('  const isoDay='),ui.indexOf('  function renderOperations(')),context);
const due=(task,quarter,now)=>{context.args={task,quarter,now};return vm.runInContext('taskDue(args.task,args.quarter,new Date(args.now))',context);};
const monthly={frequency:'ماهانه',timeLimit:{dayOfMonth:20,time:'09:00'}};
const gregorian=day=>context.window.PanelDate.toGregorian(day);
test('monthly deadlines follow the selected quarter current month, bounded for past and future quarters',()=>{
 for(const [now,day] of [['2026-10-01','1405/7/20'],['2026-11-10','1405/8/20'],['2026-12-10','1405/9/20'],['2026-01-01','1405/7/20'],['2027-01-01','1405/9/20']]){
  const result=due(monthly,'1405-Q3',now+'T10:00:00Z');assert.equal(result.day,gregorian(day));assert.equal(result.time,'09:00');
 }
});
test('short months use their last day, including leap-year Esfand and Tehran month boundaries',()=>{
 const task={...monthly,timeLimit:{...monthly.timeLimit,dayOfMonth:31}};
 for(const [quarter,now,last] of [['1405-Q3','2026-11-10T10:00:00Z','1405/8/30'],['1403-Q4','2025-03-10T10:00:00Z','1403/12/30'],['1404-Q4','2026-03-10T10:00:00Z','1404/12/29']])assert.equal(due(task,quarter,now).day,gregorian(last));
 const monthStart=gregorian('1405/8/1'),stamp=Date.parse(monthStart+'T00:00:00+03:30');
 assert.equal(due(monthly,'1405-Q3',stamp-1).day,gregorian('1405/7/20'));
 assert.equal(due(monthly,'1405-Q3',stamp).day,gregorian('1405/8/20'));
});
test('explicit quarterly dates retain the hour and become overdue at that hour',()=>{
 const task={id:'q',frequency:'فصلی',dueDate:gregorian('1405/9/30'),timeLimit:{time:'09:00'},score:null};
 assert.equal(due(task,'1405-Q3','2026-12-21').time,'09:00');
 const summary=context.window.PanelWorkflow.operationsSummary,reports=new Map([['q',{count:0}]]);
 assert.equal(summary([task],reports,[],'1405-Q3',new Date(task.dueDate+'T08:59:00+03:30')).overdue.length,0);
 assert.equal(summary([task],reports,[],'1405-Q3',new Date(task.dueDate+'T09:01:00+03:30')).overdue.length,1);
 assert.equal(due({...task,timeLimit:null},'1405-Q3','2026-12-21').time,null);
});
test('daily, weekly and quarterly recurrence still produce dates within the selected quarter',()=>{
 for(const task of [{frequency:'روزانه',timeLimit:{time:'10:00'}},{frequency:'هفتگی',timeLimit:{time:'10:00',dayOfWeek:0}},{frequency:'فصلی',timeLimit:{time:'10:00'}}]){
  const result=due(task,'1405-Q3','2026-11-10T10:00:00Z');assert.ok(result.day>=gregorian('1405/7/1')&&result.day<=gregorian('1405/9/30'));assert.equal(result.time,'10:00');
 }
});

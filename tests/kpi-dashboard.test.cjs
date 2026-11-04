const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sample,calculate}=require('../src/kpi-dashboard.js');

test('sample KPI compensation reconciles indicator amounts and final salary',()=>{
  const result=calculate(sample);
  assert.equal(result.overallPerformance,83);
  assert.equal(result.weightedPerformance,83.2);
  assert.equal(result.maxKpi,14400000);
  assert.equal(result.kpiAmount,11980800);
  assert.equal(result.finalSalary,83980800);
  assert.equal(result.maxFinalSalary,86400000);
  assert.equal(result.remainingKpi,2419200);
  assert.equal(result.kpiAttainment,83.2);
  assert.equal(result.finalAttainment,97.2);
  assert.ok(Math.abs(result.baseShare-100*72000000/83980800)<1e-9);
  assert.deepEqual(result.indicators.map(item=>item.remainingAmount),[345600,259200,432000,1382400]);
  assert.equal(result.indicators.reduce((sum,item)=>sum+item.earnedAmount,0),result.kpiAmount);
  assert.deepEqual(result.indicators.map(item=>item.earnedAmount),[1814400,1900800,3888000,4377600]);
});

test('zero available KPI does not create invalid dashboard percentages',()=>{
  const result=calculate({...sample,baseSalary:0,indicators:sample.indicators.map(item=>({...item,maxAmount:0}))});
  assert.equal(result.kpiAttainment,0);
  assert.equal(result.finalAttainment,0);
  assert.equal(result.baseShare,0);
});

test('KPI calculation rejects invalid rates, negative pay and weights not totaling 100',()=>{
  assert.throws(()=>calculate({...sample,baseSalary:-1}));
  assert.throws(()=>calculate({...sample,indicators:sample.indicators.map((item,index)=>({...item,weight:index?item.weight:29}))}));
  assert.throws(()=>calculate({...sample,indicators:sample.indicators.map((item,index)=>({...item,performance:index?item.performance:101}))}));
});

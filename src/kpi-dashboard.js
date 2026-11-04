(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.KpiDashboard=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const sample={
    source:'synthetic',employee:{name:'محمد رضایی',role:'مدیر سامانه'},baseSalary:72000000,
    indicators:[
      {id:'exam',name:'آزمون پرسنلی',description:'نتیجه آزمون تأییدشده در دوره',weight:15,performance:84,maxAmount:2160000},
      {id:'manager',name:'رضایت‌سنجی مدیر',description:'ارزیابی مدیر مستقیم',weight:15,performance:88,maxAmount:2160000},
      {id:'routine',name:'KPI روتین',description:'تسک‌های روتین مصوب و شواهد انجام',weight:30,performance:90,maxAmount:4320000},
      {id:'project',name:'KPI پروژه‌ای',description:'خروجی پروژه و معیارهای پذیرش',weight:40,performance:76,maxAmount:5760000}
    ]
  };
  function calculate(snapshot){
    if(!snapshot||!Array.isArray(snapshot.indicators)||!snapshot.indicators.length||!Number.isFinite(snapshot.baseSalary)||snapshot.baseSalary<0)throw new Error('KPI snapshot is invalid');
    let weight=0,weighted=0,maxKpi=0,kpiAmount=0;
    const indicators=snapshot.indicators.map(item=>{
      if(!item||!item.id||!item.name||!Number.isFinite(item.weight)||item.weight<=0||!Number.isFinite(item.performance)||item.performance<0||item.performance>100||!Number.isFinite(item.maxAmount)||item.maxAmount<0)throw new Error('KPI indicator is invalid');
      const earnedAmount=Math.round(item.maxAmount*item.performance/100);
      weight+=item.weight;weighted+=item.weight*item.performance;maxKpi+=item.maxAmount;kpiAmount+=earnedAmount;
      return {...item,earnedAmount,remainingAmount:item.maxAmount-earnedAmount};
    });
    if(Math.abs(weight-100)>0.001)throw new Error('KPI weights must total 100');
    const finalSalary=snapshot.baseSalary+kpiAmount;
    const maxFinalSalary=snapshot.baseSalary+maxKpi;
    return {...snapshot,indicators,overallPerformance:Math.round(weighted/weight),weightedPerformance:weighted/weight,maxKpi,kpiAmount,finalSalary,maxFinalSalary,
      remainingKpi:maxKpi-kpiAmount,
      kpiAttainment:maxKpi?100*kpiAmount/maxKpi:0,
      finalAttainment:maxFinalSalary?100*finalSalary/maxFinalSalary:0,
      baseShare:finalSalary?100*snapshot.baseSalary/finalSalary:0};
  }
  return {sample,calculate};
});

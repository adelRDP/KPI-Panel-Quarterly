(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PerformanceModel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const sections=[{id:'exam',name:'آزمون پرسنلی'},{id:'manager',name:'رضایت‌سنجی مدیر'},{id:'routine',name:'KPI روتین'},{id:'project',name:'KPI پروژه‌ای'}];
  const serviceSections=[{id:'manager',name:'رضایت مدیر'},{id:'peer',name:'نظرسنجی همکاران'}];
  const unifiedSections=[{id:'exam',name:'آزمون پرسنلی'},{id:'manager',name:'نظر مدیر'},{id:'routine',name:'KPI روتین'},{id:'project',name:'KPI پروژه‌ای'},{id:'peer',name:'نظرسنجی همکاران'}];
  const calculationVersion='fixed-model-project-zero-v1';
  const demoPolicy={version:'diagram-general-v1',source:'synthetic',modelType:'general',weights:{exam:15,manager:15,routine:30,project:40},redistributeProjectWeight:false};
  const servicePolicy={version:'diagram-services-v1',source:'synthetic',modelType:'services',weights:{manager:40,peer:60}};
  const monthlyRate=0.20,quarterRate=0.60;
  function rateFor(rules){const rate=rules?.monthlyRate??monthlyRate;if(!Number.isFinite(rate)||rate<0||rate>1)throw new Error('Invalid incentive rate');return rate;}
  function roundEarned(value,ceiling,rules){const step=rules?.rounding??1;if(![1,100,1000].includes(step))throw new Error('Invalid rounding step');if(!rules)return Math.round(value);return Math.min(Math.floor(ceiling),Math.round(value/step)*step);}
  const quarterRateFor=rules=>Number((rateFor(rules)*3).toFixed(6));
  function validAmount(value){return Number.isSafeInteger(value)&&value>=0;}
  function validateWeights(weights,ids){const values=ids.map(id=>weights?.[id]);if(values.some(w=>!Number.isFinite(w)||w<0)||Math.abs(values.reduce((a,b)=>a+b,0)-100)>0.001)throw new Error('Weights must total 100');}
  function calculate({baseSalary,bonusCeiling,hasProjects=true,scores,policy=demoPolicy,approvedProjectExemption=false}){
    if(!validAmount(baseSalary)||!validAmount(bonusCeiling)||typeof hasProjects!=='boolean'||!scores)throw new Error('Invalid compensation input');
    const isServices=policy.modelType==='services';
    const isUnified=policy.modelType==='unified',components=isUnified?unifiedSections:isServices?serviceSections:sections;
    validateWeights(policy.weights,components.map(s=>s.id));
    // Published percentages are fixed. Legacy exemption/redistribution flags have no effect.
    const effectiveWeights={...policy.weights};
    const allocations=components.map(s=>{const weight=effectiveWeights[s.id]||0;const raw=bonusCeiling*weight/100;return {id:s.id,raw,amount:Math.floor(raw)};});
    let remainder=bonusCeiling-allocations.reduce((sum,a)=>sum+a.amount,0);
    for(const allocation of [...allocations].sort((a,b)=>(b.raw-b.amount)-(a.raw-a.amount)))if(remainder>0){allocation.amount++;remainder--;}
    const rows=components.map(section=>{
      const applicable=(effectiveWeights[section.id]||0)>0;
      const score=applicable?(section.id==='project'&&!hasProjects?(policy.amountRules?.noProject==='pending'?null:0):scores[section.id]??null):null;
      if(score!==null&&(!Number.isFinite(score)||score<0||score>100))throw new Error('Score must be between 0 and 100');
      const weight=applicable?(effectiveWeights[section.id]||0):0,ceiling=applicable?(allocations.find(a=>a.id===section.id)?.amount||0):0;
      return {...section,applicable,weight,score,ceiling,earned:applicable&&score!==null?roundEarned(ceiling*score/100,ceiling,policy.amountRules):null,status:!applicable?'not_applicable':score===null?'pending':'scored'};
    });
    const complete=rows.filter(c=>c.applicable&&c.weight>0).every(c=>c.score!==null);
    const performance=complete?rows.reduce((sum,c)=>sum+c.weight*(c.score||0),0)/100:null;
    const earned=rows.reduce((sum,c)=>sum+(c.earned||0),0),ceiling=rows.reduce((sum,c)=>sum+c.ceiling,0);
    return {components:rows,complete,performance,earned,ceiling,baseSalary,knownTotal:baseSalary+earned,finalSalary:complete?baseSalary+earned:null,maxFinalSalary:baseSalary+ceiling,policyVersion:policy.version,calculationVersion,modelType:policy.modelType||'general'};
  }
  function calculateMonthly({baseSalary,scores,policy=demoPolicy,hasProjects=true,approvedProjectExemption=false}){
    if(!validAmount(baseSalary))throw new Error('Invalid compensation input');
    const rate=rateFor(policy.amountRules),bonusCeiling=Math.round(baseSalary*rate);
    return {...calculate({baseSalary,bonusCeiling,hasProjects,scores,policy,approvedProjectExemption}),periodCapRate:rate,finalSalary:null,estimatedMonthly:true};
  }
  function aggregateQuarterScores({modelType='general',monthlyScores,examScore=null,policy=modelType==='services'?servicePolicy:demoPolicy,hasProjects=true,approvedProjectExemption=false}){
    if(!Array.isArray(monthlyScores)||monthlyScores.length!==3)throw new Error('A quarter requires exactly three monthly assessments');
    if(!['general','services','unified'].includes(modelType)||policy.modelType!==modelType&&policy.modelType!=='unified')throw new Error('Evaluation model and policy do not match');
    const unified=policy.modelType==='unified',monthlyIds=unified?['manager','routine','project','peer']:modelType==='services'?['manager','peer']:['manager','routine','project'];
    const scores={};
    if(modelType==='general'||unified)scores.exam=examScore??null;
    for(const id of monthlyIds){
      const values=monthlyScores.map(row=>row?.[id]??null);
      for(const value of values)if(value!==null&&(!Number.isFinite(value)||value<0||value>100))throw new Error('Score must be between 0 and 100');
      scores[id]=values.some(value=>value===null)?null:values.reduce((sum,value)=>sum+value/3,0);
    }
    if(scores.exam!==undefined&&scores.exam!==null&&(!Number.isFinite(scores.exam)||scores.exam<0||scores.exam>100))throw new Error('Score must be between 0 and 100');
    if((modelType==='general'||unified)&&!hasProjects)scores.project=policy.amountRules?.noProject==='pending'?null:0;
    return {scores,policyVersion:policy.version,calculationVersion,aggregationVersion:'exam-once-monthly-thirds-v1',monthShares:{manager:1/3,routine:unified||modelType==='general'?1/3:undefined,project:unified||modelType==='general'?1/3:undefined,peer:unified||modelType==='services'?1/3:undefined}};
  }
  function calculateQuarter({baseSalary,modelType='general',monthlyScores,examScore=null,policy=modelType==='services'?servicePolicy:demoPolicy,hasProjects=true,approvedProjectExemption=false}){
    if(!validAmount(baseSalary))throw new Error('Invalid compensation input');
    const aggregate=aggregateQuarterScores({modelType,monthlyScores,examScore,policy,hasProjects,approvedProjectExemption});
    const calculated=calculate({baseSalary,bonusCeiling:Math.round(baseSalary*quarterRateFor(policy.amountRules)),hasProjects,approvedProjectExemption,policy,scores:aggregate.scores});
    return {...calculated,periodCapRate:quarterRateFor(policy.amountRules),aggregationVersion:aggregate.aggregationVersion,monthShares:aggregate.monthShares,estimatedMonthly:false,estimatedQuarter:true,finalSalary:null};
  }
  function calculateQuarterly({intervals,totalDays,policyVersion,oneTimeContribution=null,amountRules=null}){
    if(!Array.isArray(intervals)||!intervals.length||!Number.isSafeInteger(totalDays)||totalDays<1)throw new Error('Invalid quarter intervals');
    if(oneTimeContribution!==null){const {score,weight}=oneTimeContribution||{};if(!Number.isFinite(weight)||weight<0||weight>100)throw new Error('Invalid one-time component weight');if(score!==null&&score!==undefined&&(!Number.isFinite(score)||score<0||score>100))throw new Error('Invalid one-time component score');}
    const ordered=[...intervals].sort((a,b)=>a.startDay-b.startDay);let cursor=0,knownEarned=0,totalCeiling=0,complete=true;
    const breakdown=ordered.map(interval=>{
      const {startDay,endDay,baseSalary,score,eligible=true,employeeId,positionId,modelType='general',periodDays}=interval;
      if(!Number.isSafeInteger(startDay)||!Number.isSafeInteger(endDay)||startDay!==cursor||endDay<=startDay||endDay>totalDays||!validAmount(baseSalary)||typeof eligible!=='boolean')throw new Error('Quarter intervals must be contiguous, non-overlapping and valid');
      cursor=endDay;const days=endDay-startDay;
      if(periodDays!==undefined&&(!Number.isSafeInteger(periodDays)||periodDays<days))throw new Error('Monthly compensation interval is invalid');
      const ceiling=eligible?Math.floor(baseSalary*(periodDays?rateFor(amountRules)*days/periodDays:quarterRateFor(amountRules)*days/totalDays)):0;totalCeiling+=ceiling;
      if(eligible&&(score===null||score===undefined)){complete=false;return {employeeId,positionId,modelType,startDay,endDay,days,eligible,score:null,ceiling,earned:null};}
      if(eligible&&(!Number.isFinite(score)||score<0||score>100))throw new Error('Score must be between 0 and 100');
      const earned=eligible?roundEarned(ceiling*score/100,ceiling,amountRules):0;knownEarned+=earned;
      return {employeeId,positionId,modelType,startDay,endDay,days,eligible,score:eligible?score:null,ceiling,earned};
    });
    if(cursor!==totalDays)throw new Error('Quarter intervals must cover every calendar day exactly once');
    let oneTimeResult=null;
    if(oneTimeContribution){const score=oneTimeContribution.score??null,weight=oneTimeContribution.weight,earned=score===null?null:roundEarned(totalCeiling*weight*score/10000,totalCeiling*weight/100,amountRules);if(score===null)complete=false;else knownEarned+=earned;oneTimeResult={weight,score,ceiling:totalCeiling,earned};}
    const monthlyReplay=ordered.every(interval=>Number.isSafeInteger(interval.periodDays));
    const formulaVersion=oneTimeContribution?(monthlyReplay?'quarter-cap-20-monthly-thirds-exam-once-v3':'quarter-cap-60-prorated-exam-once-v3'):(monthlyReplay?'quarter-cap-20-monthly-replay-v2':'quarter-cap-60-prorated-v1');
    return {complete,finalized:complete,earned:complete?knownEarned:null,knownEarned,ceiling:totalCeiling,breakdown,oneTimeContribution:oneTimeResult,policyVersion:policyVersion||demoPolicy.version,calculationVersion,formulaVersion,...(amountRules?{amountRules}:{})};
  }
  return {sections,serviceSections,demoPolicy,servicePolicy,calculationVersion,monthlyRate,quarterRate,calculate,calculateMonthly,aggregateQuarterScores,calculateQuarter,calculateQuarterly,validateWeights};
});

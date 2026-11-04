import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function comparePreprocessRuns(baseline,candidate){
  for(const run of [baseline,candidate]){
    if(!run||typeof run.sourceHash!=='string'||!Array.isArray(run.images)||!Number.isFinite(run.usage?.inputTokens)||!Number.isFinite(run.usage?.outputTokens)||!Number.isFinite(run.durationMs)||!Number.isFinite(run.estimatedCostUsd))throw new Error('گزارش مصرف پیش‌پردازش معتبر نیست.');
  }
  if(baseline.sourceHash!==candidate.sourceHash||JSON.stringify(baseline.images.map(image=>image.sha256))!==JSON.stringify(candidate.images.map(image=>image.sha256)))throw new Error('دو اجرا روی تصاویر یکسان انجام نشده‌اند.');
  const total=run=>run.usage.inputTokens+run.usage.outputTokens;
  const percent=(oldValue,newValue)=>oldValue?Math.round((oldValue-newValue)/oldValue*1000)/10:null;
  return {sourceHash:baseline.sourceHash,baseline:{provider:baseline.provider,model:baseline.model,tokens:total(baseline),durationMs:baseline.durationMs,estimatedCostUsd:baseline.estimatedCostUsd},candidate:{provider:candidate.provider,model:candidate.model,tokens:total(candidate),durationMs:candidate.durationMs,estimatedCostUsd:candidate.estimatedCostUsd},change:{tokenReductionPercent:percent(total(baseline),total(candidate)),latencyReductionPercent:percent(baseline.durationMs,candidate.durationMs),estimatedCostReductionPercent:percent(baseline.estimatedCostUsd,candidate.estimatedCostUsd)},qualityVerified:false,note:'این مقایسه فقط مصرف گزارش‌شده و هزینه بر پایه نرخ‌های دستی را نشان می‌دهد؛ دقت OCR و کیفیت شواهد باید جداگانه بررسی شود.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==4)throw new Error('کاربرد: node scripts/benchmark-preprocess.mjs baseline.json candidate.json');
  const [baseline,candidate]=await Promise.all(process.argv.slice(2).map(async path=>JSON.parse(await readFile(path,'utf8'))));
  process.stdout.write(JSON.stringify(comparePreprocessRuns(baseline,candidate),null,2)+'\n');
}

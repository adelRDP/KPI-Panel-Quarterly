// Fail closed for recognizable secrets, payroll records and private-message exports.
// The uploader separately declares that the selected files are permitted work evidence.
export function requireWorkEvidence(value,{referenceOnly=false}={}){
 const text=(typeof value==='string'?value:JSON.stringify(value)).replace(/\\?["']/g,'');
 const patterns=[
  /-----BEGIN[\w ]*PRIVATE KEY-----/i,
  /\b(?:sk-(?:proj-)?[a-zA-Z0-9_-]{16,}|AIza[a-zA-Z0-9_-]{24,}|gh[pousr]_[a-zA-Z0-9]{20,})\b/,
  /(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password|رمز\s*(?:عبور|ورود)|کلید\s*(?:خصوصی|API))\s*[:=：]\s*\S{4,}/i,
  /(?:baseSalary|netSalary|grossSalary|salaryAmount|حقوق\s*(?:خالص|ناخالص|پایه|پرداختی)|مبلغ\s*حقوق)\s*[:=：|\t]\s*[\d۰-۹٠-٩]/i,
  ...(!referenceOnly?[/((?:فیش\s*حقوق|لیست\s*حقوق\s*(?:پرسنل|کارکنان)|payroll\s*(?:report|register)|salary\s*slip))/i,
  /(?:گفتگوی\s*(?:شخصی|خصوصی)|گفت‌وگوی\s*(?:شخصی|خصوصی)|private\s*chat|chat\s*export|whatsapp\s*chat|telegram\s*chat)/i]:[]),
  /\[\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]\s*[^\n]{1,60}:/
 ];
 if(patterns.some(pattern=>pattern.test(text)))throw Object.assign(new Error('ارسال به مدل متوقف شد: مستند یا شرح شامل نشانه‌های حقوق، کلید یا گفتگوی شخصی است. نسخه کاریِ بدون این اطلاعات را بارگذاری کنید.'),{status:422});
}

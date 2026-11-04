// Fail closed for recognizable secrets, payroll records and private-message exports.
// The uploader separately declares that the selected files are permitted work evidence.
const normalizeText=value=>String(value).normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u064b-\u065f\u0670]/g,'').replace(/[\u200c\u200d\u200e\u200f\ufeff]/g,' ');
const normalizeField=value=>normalizeText(value).replace(/\s+/g,' ').trim().toLowerCase();
export function restrictedEvidenceField(value,{header=false}={}){
 if(typeof value!=='string')return false;
 const field=normalizeField(value).replace(/\s*[（(]\s*(?:تومان|ریال|irr|irt)\s*[）)]\s*$/u,'').replace(/\s*[:：]\s*$/u,'').trim();
 // Exact labels avoid rejecting task descriptions about legal/customer rights.
 return /^(?:(?:مبلغ|مجموع|جمع)\s*)?حقوق(?:\s*(?:پایه|خالص|ناخالص|پرداختی|ماهانه|ماهیانه|دریافتی|و\s+(?:دستمزد|مزایا)))?$/u.test(field)
  ||/^(?:فیش\s*حقوق|password|api[_ -]?key|access[_ -]?token|client[_ -]?secret|(?:base|net|gross|monthly)[_ -]?salary|salary(?:[_ -]?amount)?|payroll)$/iu.test(field)
  ||header&&/(?:موبایل|تلفن|شماره\s*تماس|phone|mobile|telephone|contact[_ -]?number)/iu.test(field);
}
function restrictedWorkbookCells(value){
 if(typeof value==='string'){
  // Recheck stored extraction chunks too: an older manifest may say unrestricted.
  if(!value.trimStart().startsWith('{')||!value.includes('"cells"'))return false;
  try{return restrictedWorkbookCells(JSON.parse(value));}catch{return false;}
 }
 if(!value||typeof value!=='object')return false;
 if(typeof value.sheet==='string'&&Array.isArray(value.cells)){
  if(value.cells.some(cell=>restrictedEvidenceField(cell?.value))||(value.headerContext||[]).some(cell=>restrictedEvidenceField(cell?.value,{header:true})))return true;
 }
 return Object.values(value).some(restrictedWorkbookCells);
}
export function requireWorkEvidence(value,{referenceOnly=false}={}){
 const text=normalizeText((typeof value==='string'?value:JSON.stringify(value)).replace(/\\?["']/g,''));
 const patterns=[
  /-----BEGIN[\w ]*PRIVATE KEY-----/i,
  /\b(?:sk-(?:proj-)?[a-zA-Z0-9_-]{16,}|AIza[a-zA-Z0-9_-]{24,}|gh[pousr]_[a-zA-Z0-9]{20,})\b/,
  /(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password|رمز\s*(?:عبور|ورود)|کلید\s*(?:خصوصی|API))\s*[:=：]\s*\S{4,}/i,
  /(?:baseSalary|netSalary|grossSalary|salaryAmount|حقوق(?:\s*(?:خالص|ناخالص|پایه|پرداختی|ماهانه|ماهیانه|دریافتی))?|مبلغ\s*حقوق)\s*[:=：|\t]\s*[\d۰-۹٠-٩]/i,
  ...(!referenceOnly?[/((?:فیش\s*حقوق|لیست\s*حقوق\s*(?:پرسنل|کارکنان)|payroll\s*(?:report|register)|salary\s*slip))/i,
  /(?:گفتگوی\s*(?:شخصی|خصوصی)|گفت\s*وگوی\s*(?:شخصی|خصوصی)|private\s*chat|chat\s*export|whatsapp\s*chat|telegram\s*chat)/i]:[]),
  /\[\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]\s*[^\n]{1,60}:/
 ];
 if(patterns.some(pattern=>pattern.test(text))||restrictedWorkbookCells(value))throw Object.assign(new Error('ارسال به مدل متوقف شد: مستند یا شرح شامل نشانه‌های حقوق، کلید یا گفتگوی شخصی است. نسخه کاریِ بدون این اطلاعات را بارگذاری کنید.'),{status:422});
}

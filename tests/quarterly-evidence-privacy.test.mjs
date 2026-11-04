import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {extractWorkbookEvidence} from '../backend/workbook-harness.mjs';
import {requireWorkEvidence} from '../backend/evidence-privacy.mjs';
import {loadFullFileEvidence} from '../backend/file-assessment.mjs';
const XLSX=createRequire(import.meta.url)('../src/vendor/xlsx.full.min.js');
const workbook=header=>{const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['عنوان',header],['ساختگی',12345678]]),'Test');return extractWorkbookEvidence(Buffer.from(XLSX.write(b,{type:'buffer',bookType:'xlsx'})),'xlsx');};
const evidence=(result,restricted=result.manifest.restrictedFields)=>[{id:'d',name:'synthetic.xlsx',extraction:{status:'ready',warnings:result.warnings,workbook:{...result.manifest,restrictedFields:restricted},chunks:result.sections.map((s,i)=>({id:'c'+i,text:s.text}))}}];
test('salary header variants and normalized Persian labels are blocked before model submission',async()=>{
 for(const header of ['حقوق','حقوق ماهانه','حُقوق‌ماهيانه','حقوق پایه','حقوقپایه','مبلغحقوق','حقوق (تومان)','حقوق و دستمزد','مبلغ حقوق','salary','Monthly Salary','موبایل','API_key']){
  const result=workbook(header);assert.equal(result.manifest.restrictedFields,true,header);await assert.rejects(loadFullFileEvidence(evidence(result)),{status:422});
 }
});
test('old stored workbook extraction cannot bypass updated privacy rules using its false manifest flag',async()=>{
 const result=workbook('حقوق ماهانه');await assert.rejects(loadFullFileEvidence(evidence(result,false)),{status:422});
 assert.throws(()=>requireWorkEvidence({chunks:evidence(result,false)[0].extraction.chunks}),{status:422});
});
test('legal rights descriptions and ordinary report columns remain eligible evidence',async()=>{
 for(const header of ['حقوق مشتریان','بررسی حقوقی قرارداد','حقوق مالکیت فکری','شرح وظیفه','تعداد گزارش']){
  const result=workbook(header);assert.equal(result.manifest.restrictedFields,false,header);assert.ok((await loadFullFileEvidence(evidence(result))).chunks.length);
 }
 assert.doesNotThrow(()=>requireWorkEvidence({description:'بررسی حقوق و دستمزد جزو شرح وظایف این سمت است.'},{referenceOnly:true}));
});
test('plaintext salary values and previous secret/chat guards remain blocked',()=>{
 for(const text of ['گفت‌وگوی شخصی','حقوق: ۱۲۳۴۵','حقوق ماهانه\t12345','حقوق‌پایه: 12345','API_key=syntheticSecret','AIza'+'x'.repeat(30),'-----BEGIN PRIVATE KEY-----','[12/1/2026, 12:30] Synthetic: Private message'])assert.throws(()=>requireWorkEvidence(text),{status:422},text);
});

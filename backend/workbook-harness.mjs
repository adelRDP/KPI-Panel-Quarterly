import {createRequire} from 'node:module';
import {MAX_FULL_FILE_EVIDENCE_BYTES} from './evidence-limits.mjs';
const require=createRequire(import.meta.url);
const XLSX=require('../src/vendor/xlsx.full.min.js');
const {profileWorkbook}=require('../src/excel-profile.js');

export const WORKBOOK_PREPROCESS_VERSION='workbook-preprocess-v1';
export const WORKBOOK_EVIDENCE_VERSION='workbook-cells-v2';
const ZIP=Buffer.from([0x50,0x4b,0x03,0x04]);
const OLE=Buffer.from([0xd0,0xcf,0x11,0xe0]);
const isMagic=(bytes,magic)=>bytes.length>=magic.length&&magic.every((value,index)=>bytes[index]===value);

// Discovery remains available for historical records/tools. Assessment uses
// literal cell evidence, never a schema-only profile or a sample of rows.
export function extractWorkbookEvidence(buffer,extension){
  const binary=isMagic(buffer,ZIP)||isMagic(buffer,OLE),tabular=['csv','tsv'].includes(extension);
  if(!binary&&!tabular)throw Error('Invalid workbook');
  const content=binary?buffer:new TextDecoder('utf-8',{fatal:true}).decode(buffer);
  if(typeof content==='string'&&content.includes('\0'))throw Error('Invalid delimited text');
  const book=XLSX.read(content,{type:binary?'buffer':'string',raw:!binary,cellDates:true,cellFormula:true,cellHTML:false,cellStyles:false,bookVBA:false,sheetRows:50000,FS:extension==='tsv'&&!binary?'\t':undefined});
  if(!book.SheetNames.length||book.SheetNames.length>100)throw Error('Workbook sheet limit');
  const sections=[],sheets=[];let count=0,formulas=0,bytes=0,partial=false,restricted=false;
  for(const name of book.SheetNames){
    const sheet=book.Sheets[name],cells=Object.entries(sheet).filter(([address,cell])=>!address.startsWith('!')&&(cell.v!==undefined||cell.f)).sort((a,b)=>{const x=XLSX.utils.decode_cell(a[0]),y=XLSX.utils.decode_cell(b[0]);return x.r-y.r||x.c-y.c;});
    if(sheet['!fullref'])partial=true;
    const headerRowIds=[...new Set(cells.map(([address])=>XLSX.utils.decode_cell(address).r))].slice(0,3);
    const headers=cells.filter(([address])=>headerRowIds.includes(XLSX.utils.decode_cell(address).r)).map(([address,cell])=>({address,value:cell.v instanceof Date?cell.v.toISOString():cell.v??null,...(cell.w!=null?{display:cell.w}:{})}));
    const headerContext=Buffer.byteLength(JSON.stringify(headers))<=4000?headers:[];
    let sheetCount=0,group=[],groupBytes=0,first=null,last=null;
    const flush=()=>{if(!group.length)return;sections.push({label:`شیت ${name} · سلول‌های ${first}:${last}`,text:JSON.stringify({sheet:name,headerContext,cells:group})});group=[];groupBytes=0;first=last=null;};
    for(const [address,cell] of cells){
      if(++count>100000)throw Error('Workbook cell limit');sheetCount++;
      const value=cell.v instanceof Date?cell.v.toISOString():cell.v??null;
      const item={address,type:cell.t,value,...(cell.w!=null?{display:cell.w}:{}),...(cell.f?{formula:cell.f,formulaValue:'stored-not-recalculated'}:{})};
      if(cell.f)formulas++;
      // Never expose contact/payroll/secret fields merely because full reading
      // replaced discovery. The caller fails closed before any model call.
      if(typeof value==='string'&&(/^(?:حقوق\s*(?:پایه|خالص|ناخالص|پرداختی)|مبلغ\s*حقوق|فیش\s*حقوق|password|api[_ -]?key|access[_ -]?token|client[_ -]?secret|salary|payroll)$/iu.test(value.trim())||headerRowIds.includes(XLSX.utils.decode_cell(address).r)&&/(?:موبایل|تلفن|شماره\s*تماس|phone|mobile|telephone|contact[_ -]?number)/iu.test(value)))restricted=true;
      const size=Buffer.byteLength(JSON.stringify(item));bytes+=size;if(bytes>MAX_FULL_FILE_EVIDENCE_BYTES||size>18000)throw Error('Workbook evidence limit');
      if(groupBytes+size>5000)flush();first??=address;last=address;group.push(item);groupBytes+=size;
    }
    flush();sheets.push({name,range:sheet['!ref']||null,cells:sheetCount,truncated:!!sheet['!fullref']});
  }
  const manifest={version:WORKBOOK_EVIDENCE_VERSION,totalSheets:sheets.length,totalCells:count,formulaCells:formulas,sheets,restrictedFields:restricted};
  return {version:WORKBOOK_EVIDENCE_VERSION,sections,manifest,partial,warnings:[...(formulas?['متن فرمول و مقدار ذخیره‌شده ارسال می‌شوند؛ فایل در Excel دوباره محاسبه نشده است.']:[]),...(partial?['بخشی از کتاب‌کار از محدودیت خوانش عبور کرده است؛ نتیجهٔ قطعی مجاز نیست.']:[])]};
}

export function preprocessWorkbook(buffer,extension){
  const tabular=['csv','tsv'].includes(extension);
  const binary=isMagic(buffer,ZIP)||isMagic(buffer,OLE);
  if(!tabular&&!binary)throw new Error('Invalid workbook');
  let encoding=null,content=buffer,format=binary?'workbook':'delimited-text';
  if(tabular&&!binary){
    // Only UTF-8 text is accepted. A misleading .csv extension must not bypass binary validation.
    encoding='utf-8';
    content=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
    if(content.includes('\0'))throw new Error('Invalid delimited text');
  }
  const book=XLSX.read(content,{type:binary?'buffer':'string',raw:!binary,cellDates:true,cellFormula:true,cellHTML:false,cellStyles:false,bookVBA:false,sheetRows:50000,FS:extension==='tsv'&&!binary?'\t':undefined});
  if(!book.SheetNames.length)throw new Error('Empty workbook');
  const result=profileWorkbook(book,XLSX);
  const summary=result.summary;
  summary.preprocessVersion=WORKBOOK_PREPROCESS_VERSION;
  summary.detectedFormat=format;
  summary.declaredExtension=extension;
  summary.encoding=encoding;
  summary.dataPolicy='Identifiers and contact fields are schema-only; no row values are exported.';
  for(const sheet of summary.sheets){
    sheet.truncatedByParser=Boolean(book.Sheets[book.SheetNames.find(name=>name===sheet.name)]?.['!fullref']);
    for(const col of sheet.columns){
      // Even aggregate min/max for numeric identifiers can disclose personal data.
      if(/(?:شناسه|شماره|موبایل|تلفن|تماس گیرنده|مقصد|(?:^|\b)(?:id|phone|mobile|caller|destination)(?:\b|$))/iu.test(col.name))delete col.numeric;
    }
  }
  let context=JSON.stringify(summary);
  while(Buffer.byteLength(context)>12000){
    const sheet=[...summary.sheets].reverse().find(item=>item.columns.length);
    if(!sheet)throw new Error('Workbook summary exceeds limit');
    sheet.columns.pop();sheet.omittedColumns++;
    context=JSON.stringify(summary);
  }
  let cells=0,formulas=false,limited=summary.omittedSheets>0||summary.sheets.some(sheet=>sheet.skippedCells||sheet.omittedColumns||sheet.truncatedByParser);
  const evidence=[];
  outer:for(const name of book.SheetNames){
    for(const [address,cell] of Object.entries(book.Sheets[name])){
      if(address.startsWith('!'))continue;
      if(cell.f)formulas=true;
      if(cell.v!==undefined){cells++;if(cells<=100)evidence.push([name,address,cell.v]);}
      if(cells>100){limited=true;break outer;}
    }
  }
  const compact=JSON.stringify(evidence);
  // Small workbooks may support row-level review; large ones never export contact records.
  const includeCells=!limited&&Buffer.byteLength(compact)<=6000;
  return {version:WORKBOOK_PREPROCESS_VERSION,context,format,encoding,includeCells,cells:includeCells?compact:null,
    partial:limited||formulas||!includeCells,warnings:[
      ...(tabular&&binary?['پسوند فایل متنی است، اما محتوای واقعی آن کتاب‌کار Excel تشخیص داده شد.']:[]),
      ...(formulas?['مقادیر فرمول ذخیره‌شده‌اند و دوباره محاسبه نشده‌اند.']:[]),
      ...(!includeCells?['فایل بزرگ فقط خلاصه آماری دارد؛ برای نتیجه قطعی، خروجی کوچک و مرتبط با معیارها پیوست کنید.']:[])
    ]};
}

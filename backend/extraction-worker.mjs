import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {extractWorkbookEvidence} from './workbook-harness.mjs';
import {MAX_FULL_FILE_EVIDENCE_BYTES} from './evidence-limits.mjs';
import {dirname,join} from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
const require = createRequire(import.meta.url);
async function extract() {
  const { path, extension } = workerData;
  const buffer = await readFile(path);
  let workbookNonCellContent=false;
  // Reject oversized Office archives before a parser expands their contents.
  if(buffer[0]===0x50 && buffer[1]===0x4b) {
    let expanded=0, entries=0;
    unzipSync(buffer,{filter:entry=>{expanded+=entry.originalSize;entries++;if(/^xl\/(?:media|drawings|charts|embeddings)\//i.test(entry.name)||/^xl\/vbaProject\.bin$/i.test(entry.name))workbookNonCellContent=true;if(expanded>40*1024*1024||entries>10000)throw new Error('Archive limit');return false;}});
  }
  const sections = []; const warnings=[]; const visuals=[];let partial=false,visualLimited=false,workbookManifest=null;
  const add = (label,text) => { if (text.trim()) sections.push({label,text}); };
  const capture=(label,canvas)=>{if(visuals.length>=5){partial=true;visualLimited=true;return;}visuals.push({label,bytes:canvas.toBuffer('image/png')});};
  if(['png','jpg','jpeg','webp','bmp'].includes(extension)) {
    // Reject truncated headers before invoking the native decoder (which may abort on tiny input).
    if(buffer.length<12)throw new Error('Image header incomplete');
    const {loadImage,createCanvas}=await import('@napi-rs/canvas');
    const img=await loadImage(buffer);if(img.width*img.height>25000000)throw new Error('Image limit');
    const scale=Math.min(1,1600/Math.max(img.width,img.height));const canvas=createCanvas(Math.max(1,Math.round(img.width*scale)),Math.max(1,Math.round(img.height*scale)));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);capture('تصویر',canvas);
  } else
  if (['xlsx','xls','xlsb','xlsm','csv','tsv'].includes(extension)) {
    const result=extractWorkbookEvidence(buffer,extension);workbookManifest=result.manifest;
    for(const section of result.sections)add(section.label,section.text);
    partial=result.partial||workbookNonCellContent;
    workbookManifest.nonCellContentUnprocessed=workbookNonCellContent;
    if(workbookNonCellContent)warnings.push('سلول‌ها خوانده شدند؛ تصویر، نمودار یا محتوای تعبیه‌شدهٔ اکسل هنوز خوانش کامل نشده و نتیجهٔ قطعی مجاز نیست.');
    warnings.push(...result.warnings);
  } else if (['txt','md','json','xml','html','htm','log'].includes(extension)) {
    const decoder = new TextDecoder('utf-8',{fatal:true});
    let text=decoder.decode(buffer);
    if (text.includes('\0')) throw new Error('این فایل متن UTF-8 نیست.');
    if (['html','htm'].includes(extension)) text=text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ');
    add('متن',text);
  } else if (extension==='docx') {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({buffer});
    add('متن Word',result.value);
    if (result.messages.length) { partial=true; warnings.push('بعضی اجزای Word استخراج نشدند.'); }
    unzipSync(buffer,{filter:entry=>{if(/^word\/(media|embeddings)\//.test(entry.name))partial=true;return false;}});
    warnings.push('تصاویر، چیدمان و اصالت سند با استخراج متن تأیید نمی‌شوند.');
  } else if (extension==='pdf') {
    const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfRoot=dirname(require.resolve('pdfjs-dist/package.json'));
    const resource=folder=>join(pdfRoot,folder).replaceAll('\\','/')+'/';
    const pdf=await getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,standardFontDataUrl:resource('standard_fonts'),cMapUrl:resource('cmaps'),cMapPacked:true,wasmUrl:resource('wasm')}).promise;
    try {
      for(let page=1;page<=Math.min(pdf.numPages,100);page++) {
        const pdfPage=await pdf.getPage(page);
        const content=await pdfPage.getTextContent();
        const operators=await pdfPage.getOperatorList();
        const hasImage=operators.fnArray.some(op=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject].includes(op));
        const text=content.items.map(item=>item.str||'').join(' ');
        if (!text.trim()||hasImage) {
          if(visuals.length<5){const {createCanvas}=await import('@napi-rs/canvas');const natural=pdfPage.getViewport({scale:1});const viewport=pdfPage.getViewport({scale:Math.min(2,1600/Math.max(natural.width,natural.height))});const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport}).promise;capture(`صفحه ${page}`,canvas);}
          else {partial=true;visualLimited=true;}
        }
        add(`صفحه ${page}`,text);
      }
      if (pdf.numPages>100) {partial=true;warnings.push('بیش از ۱۰۰ صفحه؛ بخش باقی‌مانده بررسی نشده است.');}
    } finally { await pdf.destroy(); }
  } else if (['pptx','odt','odp','ods'].includes(extension)) {
    const {XMLParser}=await import('fast-xml-parser');
    const entries=unzipSync(buffer,{filter:entry=> {
      if(entry.originalSize>20*1024*1024) throw new Error('فایل فشرده بیش از حد بزرگ است.');
      if(/(?:media|embeddings|Pictures)\//.test(entry.name))partial=true;
      return extension==='pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(entry.name) : entry.name==='content.xml';
    }});
    const parser=new XMLParser({ignoreAttributes:true,processEntities:false,trimValues:false});
    const texts=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(texts).join(' '):node&&typeof node==='object'?Object.values(node).map(texts).join(' '):'';
    for(const name of Object.keys(entries).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))) add(name,texts(parser.parse(strFromU8(entries[name]))));
    warnings.push('فقط متن استخراج شده است؛ تصاویر و نمودارها نیاز به بررسی دیداری دارند.');
  } else {
    return {status:'unsupported',chunks:[],warnings:['این فرمت ذخیره شد اما مبدل آن فعال نیست. صوت، ویدئو و فرمت‌های قدیمی به مبدل جداگانه نیاز دارند.'],version:'extract-v2'};
  }
  let evidenceBytes=0; const chunks=[];
  for (const section of sections) {
    const clean=section.text.replace(/\r\n/g,'\n').trim();
    if(workbookManifest){chunks.push({id:`${workerData.documentId}:${chunks.length+1}`,label:section.label,text:clean});continue;}
    for(let offset=0;offset<clean.length;offset+=1600) {
      const chunk={id:`${workerData.documentId}:${chunks.length+1}`,label:`${section.label} / بخش ${Math.floor(offset/1600)+1}`,text:clean.slice(offset,offset+1600)};
      evidenceBytes+=Buffer.byteLength(JSON.stringify({...chunk,documentId:workerData.documentId}));
      if(evidenceBytes>MAX_FULL_FILE_EVIDENCE_BYTES)throw Error('Text evidence limit');
      chunks.push(chunk);
    }
  }
  if(visualLimited)warnings.push('بیش از ۵ صفحه دیداری؛ پوشش ناقص است.');
  return {status:chunks.length||visuals.length?(partial?'partial':'ready'):'needs_conversion',chunks,visuals,warnings,version:workbookManifest?'extract-v3':'extract-v4-full-text',...(workbookManifest?{workbook:workbookManifest}:{})};
}
extract().then(result=>parentPort.postMessage(result)).catch(error=>parentPort.postMessage({status:'failed',chunks:[],warnings:[/Workbook .*limit|Archive limit|Text evidence limit/.test(error.message)?'فایل از ظرفیت خواندن کامل عبور کرد؛ داده‌ای به‌عنوان بررسی کامل یا نمرهٔ قطعی ارائه نمی‌شود.':'استخراج ناموفق؛ فایل خراب، رمزدار یا ناسازگار است.'],version:'extract-v3'}));

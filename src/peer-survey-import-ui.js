(() => {
 const columns=['کد پرسنلی فرد هدف','کد پرسنلی پاسخ‌دهنده','امتیاز'];
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fa=new Intl.NumberFormat('fa-IR');
 window.PanelPeerSurveyImport={mount({container,loadExcelLibrary,verifyZip,attachPicker,compactActions,refresh,onBusy}){
  const panel=document.createElement('section');panel.id='peerSurveyExcelPanel';panel.className='panel settings-card lifecycle-section';panel.hidden=true;
  panel.innerHTML='<h2>ورود گروهی پاسخ‌های نظرسنجی همکاران با اکسل</h2><p class="workflow-muted">برای هر پاسخ یک سطر با کد پرسنلی فرد هدف، کد پرسنلی پاسخ‌دهنده و امتیاز ۰ تا ۱۰۰ وارد کنید. ابتدا نظرسنجی را منتشر کنید؛ جامعهٔ مجاز، مهلت و حدنصاب مشارکت مانند ثبت تکی کنترل می‌شوند. فایل اصلی نگهداری نمی‌شود.</p><p id="peerImportPeriod" class="formula-note"></p><div class="design-form-actions"><button type="button" class="secondary-button" id="downloadPeerTemplate">دریافت قالب اکسل</button></div><form id="peerExcelForm"><label>فایل پاسخ‌ها<input name="file" type="file" accept=".xlsx" required></label><button class="primary-button">اعتبارسنجی و پیش‌نمایش</button></form><div id="peerExcelResult" role="status" aria-live="polite"></div><div class="design-form-actions"><button type="button" class="primary-button" id="confirmPeerImport" hidden>تأیید ثبت پاسخ‌های معتبر</button></div><details class="activity-criteria"><summary>آرشیو ورود گروهی پاسخ‌ها</summary><div id="peerImportArchive"></div></details>';
  container.append(panel);
  attachPicker('peerExcelForm','فایل پاسخ‌ها · یک برگه XLSX تا ۲ مگابایت و ۵۰۰ پاسخ','peerExcelFileName','انتخاب اکسل پاسخ‌های نظرسنجی همکاران');
  compactActions('downloadPeerTemplate','peerExcelForm','peer-import-actions');
  const form=panel.querySelector('form'),output=panel.querySelector('#peerExcelResult'),confirm=panel.querySelector('#confirmPeerImport'),archive=panel.querySelector('#peerImportArchive');
  const api=()=>window.PanelWorkflow,period=()=>document.querySelector('#workflowPeriod').value;
  let version=0,prepared=null,busy=false;
  function reset(){version++;prepared=null;confirm.hidden=true;output.replaceChildren();archive.replaceChildren();form.reset();sync();}
  function sync(){panel.hidden=api()?.user?.role!=='hr';panel.querySelector('#peerImportPeriod').textContent='فصل ورود پاسخ‌ها: '+api().quarterLabel(period());}
  function setBusy(value){busy=value;onBusy(value);for(const control of panel.querySelectorAll('button,input'))control.disabled=value;}
  const quarantine=rows=>rows.length?'<div class="workflow-table-wrap"><table class="workflow-table"><thead><tr><th>سطر اکسل</th><th>علت ثبت‌نشدن</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+fa.format(r.rowNumber)+'</td><td>'+esc(r.reason)+'</td></tr>').join('')+'</tbody></table></div>':'';
  async function history(){if(panel.hidden)return;const v=version;try{const rows=await api().api('/api/org/surveys/imports');if(v!==version)return;archive.innerHTML=rows.filter(r=>r.period===period()).map(r=>'<article class="proposal-item"><p>'+esc(r.fileName)+' · '+esc(new Date(r.createdAt).toLocaleString('fa-IR'))+'</p><p>ثبت‌شده: '+fa.format(r.importedCount)+' · ثبت‌نشده: '+fa.format(r.quarantined.length)+' · نظرسنجی تکمیل‌شده: '+fa.format(r.completedCount)+'</p>'+quarantine(r.quarantined)+'</article>').join('')||'<p class="workflow-muted">هنوز فایلی برای این فصل ثبت نشده است.</p>';}catch(e){if(v===version)archive.textContent=e.message;}}
  panel.querySelector('#downloadPeerTemplate').onclick=async()=>{const v=version;try{const XLSX=await loadExcelLibrary();if(v!==version||panel.hidden)return;const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([columns]);sheet['!cols']=[{wch:28},{wch:30},{wch:16}];XLSX.utils.book_append_sheet(book,sheet,'پاسخ نظرسنجی');const url=URL.createObjectURL(new Blob([XLSX.write(book,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download='peer-survey-responses-template.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){if(v===version)output.textContent=e.message;}};
  form.elements.file.addEventListener('change',()=>{version++;prepared=null;confirm.hidden=true;output.replaceChildren();});
  form.onsubmit=async event=>{
   event.preventDefault();if(busy||panel.hidden)return;const v=version,at=period(),file=form.elements.file.files[0];prepared=null;confirm.hidden=true;setBusy(true);
   try{
    if(!file||!file.name.toLowerCase().endsWith('.xlsx')||file.size>2*1024*1024)throw Error('فقط فایل XLSX تا ۲ مگابایت پذیرفته می‌شود.');
    const bytes=new Uint8Array(await file.arrayBuffer());verifyZip(bytes);const XLSX=await loadExcelLibrary();
    const book=XLSX.read(bytes,{type:'array',cellFormula:true,cellDates:false,sheetRows:502,bookVBA:false});
    if(book.SheetNames.length!==1)throw Error('فایل باید فقط یک برگه پاسخ داشته باشد.');
    const sheet=book.Sheets[book.SheetNames[0]],range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');
    if(range.e.r>500||range.e.c>2)throw Error('حداکثر ۵۰۰ پاسخ و دقیقاً سه ستون قالب مجاز است.');
    if(Object.values(sheet).some(c=>c&&typeof c==='object'&&c.f))throw Error('فرمول مجاز نیست؛ فقط مقدار ثابت وارد کنید.');
    const data=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:true});while(data.length&&data.at(-1).every(v=>!String(v).trim()))data.pop();
    if(JSON.stringify(data[0]?.map(v=>String(v).trim()))!==JSON.stringify(columns))throw Error('عنوان ستون‌ها با قالب نمونه مطابقت ندارد.');
    if(data.length<2||data.length>501)throw Error('فایل باید ۱ تا ۵۰۰ پاسخ داشته باشد.');
    const input={period:at,batchKey:crypto.randomUUID(),fileName:file.name,rows:data.slice(1).map(r=>({targetCode:String(r[0]??'').trim(),respondentCode:String(r[1]??'').trim(),score:String(r[2]??'').trim()}))};
    if(v!==version||at!==period()||panel.hidden)return;
    const result=await api().post('/api/org/surveys/import',{...input,preview:true});if(v!==version||at!==period()||panel.hidden)return;
    output.innerHTML='<p>پاسخ معتبر: '+fa.format(result.importedCount)+' · ثبت‌نشده: '+fa.format(result.quarantined.length)+' · نظرسنجی: '+fa.format(result.campaignCount)+'</p>'+quarantine(result.quarantined)+'<p class="workflow-muted">هنوز پاسخی ثبت نشده است. با تأیید، فقط پاسخ‌های معتبر ثبت می‌شوند.</p>';
    prepared={...input,fingerprint:result.fingerprint,confirm:true};confirm.hidden=!result.importedCount;
   }catch(e){if(v===version)output.textContent=e.message;}finally{setBusy(false);}
  };
  confirm.onclick=async()=>{
   if(busy||!prepared||panel.hidden||prepared.period!==period())return;const v=version,input=prepared;setBusy(true);
   try{const result=await api().post('/api/org/surveys/import',input);if(v!==version||panel.hidden)return;prepared=null;confirm.hidden=true;form.reset();output.innerHTML='<p>ثبت‌شده: '+fa.format(result.importedCount)+' · ثبت‌نشده: '+fa.format(result.quarantined.length)+' · نظرسنجی تکمیل‌شده: '+fa.format(result.completedCount)+'</p>'+quarantine(result.quarantined);await refresh();await history();}
   catch(e){if(v===version){output.textContent=e.message;/* A lost response can safely retry the same batch. */}}
   finally{setBusy(false);}
  };
  window.addEventListener('panel:session',reset);window.addEventListener('panel:password-required',reset);
  document.querySelector('#workflowPeriod').addEventListener('change',()=>{reset();if(container.classList.contains('active'))history();});
  window.addEventListener('panel:view',event=>{sync();if(event.detail==='surveys'&&!panel.hidden)history();});
  sync();
 }};
})();

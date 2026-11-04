// UI dates are Persian; API date fields remain Gregorian ISO for stable storage and comparisons.
window.PanelDocumentFormats=Object.freeze({excel:'اکسل',powerpoint:'پاورپوینت',word:'ورد',pdf:'پی‌دی‌اف',image:'عکس',html:'HTML',powerbi:'Power BI',other:'سایر'});
(() => {
  const timeZone = 'Asia/Tehran';
  const longDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone, year: 'numeric', month: 'long', day: 'numeric'
  });
  const numericDate = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const hourMinute = new Intl.DateTimeFormat('fa-IR', {timeZone, hour: '2-digit', minute: '2-digit'});
  const latin = value => String(value).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632));
  const parts = date => Object.fromEntries(numericDate.formatToParts(date)
    .filter(part => ['year', 'month', 'day'].includes(part.type))
    .map(part => [part.type, Number(part.value)]));
  const validGregorian = value => /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value);
  const dateValue = value => {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value !== 'string' || !validGregorian(value)) return new Date(NaN);
    return new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  };
  const input = value => {
    if (!value) return '';
    const date = dateValue(value);
    if (Number.isNaN(date.getTime())) return '';
    const {year, month, day} = parts(date);
    return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
  };
  const format = value => {
    if (!value) return '—';
    const date = dateValue(value);
    return Number.isNaN(date.getTime()) ? '—' : longDate.format(date);
  };
  const formatEmbedded = value => String(value ?? '').replace(/\b\d{4}-\d{2}-\d{2}\b/g, iso => {
    const date = dateValue(iso);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? iso : longDate.format(date);
  });
  const formatDateTime = value => {
    const date = dateValue(value);
    if (Number.isNaN(date.getTime())) return '—';
    const hour = hourMinute.format(date);
    return `${longDate.format(date)}، ${hour}`;
  };
  const toGregorian = (value, optional = false) => {
    if (!String(value || '').trim()) {
      if (optional) return '';
      throw new Error('تاریخ شمسی الزامی است.');
    }
    const match = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(latin(value).trim());
    if (!match) throw new Error('تاریخ شمسی را به صورت ۱۴۰۵/۰۷/۰۶ وارد کنید.');
    const [year, month, day] = match.slice(1).map(Number);
    if (year < 1300 || year > 1600 || month < 1 || month > 12 || day < 1 || day > 31)
      throw new Error('تاریخ شمسی معتبر نیست.');
    const start = Date.UTC(year + 621, 2, 19, 12);
    for (let offset = 0; offset < 370; offset++) {
      const date = new Date(start + offset * 86400000);
      const candidate = parts(date);
      if (candidate.year === year && candidate.month === month && candidate.day === day)
        return date.toISOString().slice(0, 10);
    }
    throw new Error('تاریخ شمسی معتبر نیست.');
  };
  const nextDay = value => {
    const date = new Date(`${toGregorian(value)}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return input(date);
  };
  const hourOnly=value=>/^(?:[01]\d|2[0-3])(?::[0-5]\d)?$/.test(String(value||''))?String(value).split(':')[0]:'—';
  window.PanelDate = {format, formatEmbedded, formatDateTime, input, toGregorian, nextDay, hourOnly, today: () => input(new Date())};
})();
const fa = new Intl.NumberFormat('fa-IR');
const faDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tehran' });
const faWeekday = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', timeZone: 'Asia/Tehran' });
const faMonth = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', timeZone: 'Asia/Tehran' });
const faMoney = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const faPercent = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });

// The header shows the real Tehran date/time, not the selected assessment period.
(() => {
  const dateNode=document.querySelector('#headerDate'),timeNode=document.querySelector('#headerTime');
  if(!dateNode||!timeNode)return;
  const timeFormat=new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const isoFormat=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'});
  let timer=null;
  function stop(){window.clearTimeout(timer);timer=null;}
  function update(){
    stop();const now=new Date();
    dateNode.textContent=`${faWeekday.format(now)} ${faDate.format(now)}`;
    const parts=Object.fromEntries(isoFormat.formatToParts(now).map(part=>[part.type,part.value]));
    dateNode.dateTime=`${parts.year}-${parts.month}-${parts.day}`;
    timeNode.textContent=timeFormat.format(now);timeNode.dateTime=now.toISOString();
    if(!document.hidden)timer=window.setTimeout(update,60000-now.getTime()%60000);
  }
  document.addEventListener('visibilitychange',()=>document.hidden?stop():update());
  window.addEventListener('focus',update);window.addEventListener('pagehide',stop);window.addEventListener('pageshow',update);
  update();
})();

// A read-only calendar: browsing dates must never change the clock or assessment period.
(() => {
  const toggle=document.querySelector('#headerCalendarToggle');if(!toggle)return;
  const calendar=document.createElement('section');calendar.id='headerCalendar';calendar.className='persian-calendar header-calendar';calendar.hidden=true;calendar.setAttribute('role','dialog');calendar.setAttribute('aria-label','تقویم شمسی');document.body.append(calendar);
  const months=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];let year,month;
  const today=()=>window.PanelDate.today().split('/').map(Number);
  function position(){const r=toggle.getBoundingClientRect(),width=Math.min(300,innerWidth-24);calendar.style.width=width+'px';calendar.style.left=Math.max(12,Math.min(r.right-width,innerWidth-width-12))+'px';calendar.style.top=(r.bottom+8)+'px';calendar.style.maxHeight=Math.max(100,innerHeight-r.bottom-24)+'px';}
  function close(restore=false){calendar.hidden=true;toggle.setAttribute('aria-expanded','false');if(restore)toggle.focus({preventScroll:true});}
  function render(){
    const first=window.PanelDate.toGregorian(`${year}/${month}/1`),start=new Date(first+'T12:00:00Z'),offset=(start.getUTCDay()+1)%7,current=window.PanelDate.today();let days='';
    for(let i=0;i<31;i++){const date=new Date(start.getTime()+i*86400000),iso=date.toISOString().slice(0,10),persian=window.PanelDate.input(iso);if(Number(persian.split('/')[1])!==month)break;days+=`<span class="header-calendar-day"${persian===current?' aria-current="date"':''} title="${window.PanelDate.format(iso)}">${fa.format(i+1)}</span>`;}
    calendar.innerHTML=`<div class="persian-calendar-header"><button type="button" data-header-shift="-1" aria-label="ماه قبل"${year===1300&&month===1?' disabled':''}>›</button><select data-header-month aria-label="ماه تقویم">${months.map((name,i)=>`<option value="${i+1}"${month===i+1?' selected':''}>${name}</option>`).join('')}</select><select data-header-year aria-label="سال تقویم">${Array.from({length:301},(_,i)=>1300+i).map(y=>`<option value="${y}"${year===y?' selected':''}>${fa.format(y).replace(/٬/g,'')}</option>`).join('')}</select><button type="button" data-header-shift="1" aria-label="ماه بعد"${year===1600&&month===12?' disabled':''}>‹</button></div><div class="persian-calendar-weekdays" aria-hidden="true">${['ش','ی','د','س','چ','پ','ج'].map(d=>`<span>${d}</span>`).join('')}</div><div class="persian-calendar-days" role="group" aria-label="روزهای ${months[month-1]} ${fa.format(year)}">${'<span></span>'.repeat(offset)}${days}</div><div class="persian-calendar-footer"><button type="button" data-header-today>امروز</button><button type="button" data-header-close>بستن</button></div>`;position();
  }
  toggle.addEventListener('click',()=>{if(!calendar.hidden){close();return;}[year,month]=today();calendar.hidden=false;toggle.setAttribute('aria-expanded','true');render();calendar.querySelector('[data-header-month]').focus({preventScroll:true});});
  calendar.addEventListener('change',event=>{const key=event.target.hasAttribute('data-header-month')?'month':event.target.hasAttribute('data-header-year')?'year':null;if(!key)return;if(key==='month')month=Number(event.target.value);else year=Number(event.target.value);render();calendar.querySelector(`[data-header-${key}]`).focus({preventScroll:true});});
  calendar.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.disabled)return;if(button.hasAttribute('data-header-close'))return close(true);if(button.hasAttribute('data-header-today'))[year,month]=today();else if(button.hasAttribute('data-header-shift')){const value=year*12+month-1+Number(button.dataset.headerShift);year=Math.floor(value/12);month=value%12+1;}else return;render();calendar.querySelector(button.hasAttribute('data-header-today')?'[data-header-today]':`[data-header-shift="${button.dataset.headerShift}"]`).focus({preventScroll:true});});
  calendar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(true);}});
  document.addEventListener('pointerdown',event=>{if(!calendar.hidden&&!calendar.contains(event.target)&&!toggle.contains(event.target))close();});
  document.addEventListener('focusin',event=>{if(!calendar.hidden&&!calendar.contains(event.target)&&!toggle.contains(event.target))close();});
  for(const type of ['resize','scroll'])window.addEventListener(type,()=>{if(!calendar.hidden)position();},{passive:true,capture:true});
  for(const type of ['panel:view','panel:session','pagehide'])window.addEventListener(type,()=>close());
})();

const seedDocuments = [
  { id: 1, name: 'آیین‌نامه منابع انسانی.pdf', title: 'آیین‌نامه منابع انسانی', type: 'pdf', size: 2840000, category: 'منابع انسانی', access: 'همه اعضای سازمان', uploader: 'نرگس زمانی', createdAt: Date.now() - 36e5 * 2, status: 'تأیید شده' },
  { id: 2, name: 'فرم درخواست خرید.xlsx', title: 'فرم درخواست خرید', type: 'xlsx', size: 740000, category: 'مالی', access: 'فقط مدیران', uploader: 'علی کریمی', createdAt: Date.now() - 36e5 * 20, status: 'تأیید شده' },
  { id: 3, name: 'راهنمای گردش مکاتبات.docx', title: 'راهنمای گردش مکاتبات', type: 'docx', size: 1210000, category: 'فرایندها', access: 'همه اعضای سازمان', uploader: 'سارا احمدی', createdAt: Date.now() - 36e5 * 27, status: 'در انتظار' },
  { id: 4, name: 'نمونه قرارداد همکاری.pdf', title: 'نمونه قرارداد همکاری', type: 'pdf', size: 960000, category: 'حقوقی', access: 'فقط مدیران', uploader: 'مریم اکبری', createdAt: Date.now() - 36e5 * 48, status: 'تأیید شده' }
];

const seedUsers = [
  { name: 'محمد رضایی', unit: 'مدیریت', role: 'مدیر سامانه', status: 'فعال', initials: 'مر' },
  { name: 'نرگس زمانی', unit: 'منابع انسانی', role: 'مدیر', status: 'فعال', initials: 'نز' },
  { name: 'علی کریمی', unit: 'مالی', role: 'مدیر', status: 'فعال', initials: 'عک' },
  { name: 'سارا احمدی', unit: 'فناوری اطلاعات', role: 'همکار', status: 'فعال', initials: 'سا' },
  { name: 'مریم اکبری', unit: 'حقوقی', role: 'همکار', status: 'دعوت شده', initials: 'ما' }
];

let documents = [];
function readUiStorage(key){try{return localStorage.getItem(key);}catch{return null;}}
function writeUiStorage(key,value){try{localStorage.setItem(key,value);}catch{/* Optional UI preferences must not block the server-backed panel. */}}
function readStoredRows(key,fallback){try{const rows=JSON.parse(readUiStorage(key)||'null');return Array.isArray(rows)&&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row))?rows:fallback;}catch{return fallback;}}
let users = readStoredRows('hamkar-users',seedUsers);
let activities = readStoredRows('hamkar-activities',[
  { icon: 'i-file', actor: 'نرگس زمانی', action: 'مستند «آیین‌نامه منابع انسانی» را بارگذاری کرد.', time: Date.now() - 36e5 * 2 },
  { icon: 'i-users', actor: 'محمد رضایی', action: 'دسترسی علی کریمی را به «مدیر» تغییر داد.', time: Date.now() - 36e5 * 5 },
  { icon: 'i-download', actor: 'سارا احمدی', action: 'فایل «فرم درخواست خرید» را دریافت کرد.', time: Date.now() - 36e5 * 21 },
  { icon: 'i-file', actor: 'مریم اکبری', action: 'نسخه جدید «نمونه قرارداد همکاری» را ثبت کرد.', time: Date.now() - 36e5 * 48 }
]);

let db;
try {
  const dbRequest = indexedDB.open('hamkar-workspace', 1);
  dbRequest.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
  };
  dbRequest.onsuccess = e => { db = e.target.result; loadDocuments(); };
  dbRequest.onerror = () => { documents = seedDocuments; renderAll(); toast('ذخیره‌سازی مرورگر در دسترس نیست؛ حالت نمایشی فعال شد.'); };
} catch { documents = seedDocuments; /* Optional legacy storage must not prevent the server-backed panel from starting. */ }

function tx(mode = 'readonly') { return db.transaction('documents', mode).objectStore('documents'); }
function loadDocuments() {
  const request = tx().getAll();
  request.onsuccess = () => {
    if (!request.result.length && !readUiStorage('hamkar-seeded')) {
      const store = tx('readwrite');
      seedDocuments.forEach(({ id, ...doc }) => store.add(doc));
      store.transaction.oncomplete = () => { writeUiStorage('hamkar-seeded', '1'); loadDocuments(); };
      return;
    }
    documents = request.result.sort((a,b) => b.createdAt - a.createdAt);
    renderAll();
  };
}

function icon(id) { return `<svg><use href="#${id}"/></svg>`; }
function fileType(name = '') { return (name.split('.').pop() || 'other').toLowerCase(); }
function sizeLabel(bytes = 0) { return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} مگابایت` : `${Math.max(1, Math.round(bytes / 1024))} کیلوبایت`; }
function timeAgo(ts) {
  const hours = Math.floor((Date.now() - ts) / 36e5);
  if (hours < 1) return 'لحظاتی پیش';
  if (hours < 24) return `${fa.format(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${fa.format(days)} روز پیش` : faDate.format(new Date(ts));
}

function documentRow(doc, header = false) {
  if (header) return `<div class="document-row table-header"><span>نام مستند</span><span>دسته‌بندی</span><span>بارگذار</span><span>سطح دسترسی</span><span>عملیات</span></div>`;
  const ext = doc.type || fileType(doc.name);
  return `<div class="document-row" data-doc-id="${doc.id}">
    <div class="document-main"><span class="file-icon ${['pdf','doc','docx','xls','xlsx'].includes(ext) ? ext : 'other'}">${ext.toUpperCase().slice(0,4)}</span><span><strong>${escapeHtml(doc.title || doc.name)}</strong><small>${sizeLabel(doc.size)} · ${timeAgo(doc.createdAt)}</small></span></div>
    <span class="category-pill">${escapeHtml(doc.category)}</span><span class="row-meta">${escapeHtml(doc.uploader)}</span><span class="access-pill">${escapeHtml(doc.access)}</span>
    <span class="row-actions">${['xlsx','xls','xlsm','xlsb'].includes(ext) && doc.blob ? `<button data-summary="${doc.id}" title="${doc.preprocessing ? 'مشاهده خلاصه اکسل' : 'پیش‌پردازش اکسل'}" aria-label="خلاصه اکسل">${icon('i-pulse')}</button>` : ''}<button data-download="${doc.id}" title="دانلود">${icon('i-download')}</button><button class="danger" data-delete="${doc.id}" title="حذف">${icon('i-trash')}</button></span>
  </div>`;
}

function renderDocuments() {
  const q = document.querySelector('#documentSearch')?.value.trim().toLowerCase() || '';
  const cat = document.querySelector('#categoryFilter')?.value || '';
  const list = documents.filter(d => (!q || `${d.title} ${d.name} ${d.uploader}`.toLowerCase().includes(q)) && (!cat || d.category === cat));
  const recent=document.querySelector('#recentDocuments');
  if(recent)recent.innerHTML = documents.length ? documents.slice(0,3).map(d => documentRow(d)).join('') : emptyDocuments();
  document.querySelector('#documentsTable').innerHTML = list.length ? documentRow({}, true) + list.map(d => documentRow(d)).join('') : emptyDocuments();
  document.querySelector('#navDocCount').textContent = fa.format(documents.length);
}
function emptyDocuments() { return `<div class="empty-state"><span class="empty-icon">${icon('i-folder')}</span><h3>هنوز مستندی پیدا نشد</h3><p>اولین فایل فضای کاری را بارگذاری کنید.</p></div>`; }

function renderUsers() {
  document.querySelector('#usersTable').innerHTML = `<div class="user-row table-header"><span>کاربر</span><span>واحد</span><span>نقش</span><span>وضعیت</span><span></span></div>` + users.map((u,i) => `<div class="user-row"><div class="user-main"><span class="avatar">${u.initials}</span><span><strong>${escapeHtml(u.name)}</strong></span></div><span class="row-meta">${escapeHtml(u.unit)}</span><span class="row-meta">${escapeHtml(u.role)}</span><span class="status-pill ${u.status === 'فعال' ? 'active' : 'pending'}">${u.status}</span><span class="row-actions"><button data-remove-user="${i}" class="danger">${icon('i-trash')}</button></span></div>`).join('');
}

function renderActivities() {
  document.querySelector('#activityTimeline').innerHTML = activities.map(a => `<div class="timeline-item"><span class="timeline-icon">${icon(a.icon)}</span><div><p><b>${escapeHtml(a.actor)}</b> ${escapeHtml(a.action)}</p><small>ثبت سیستمی رویداد</small></div><time>${timeAgo(a.time)}</time></div>`).join('');
}
function renderKpiDashboard() {
  if(window.PanelWorkflow)return window.PanelWorkflow.renderDashboard();
  const data=KpiDashboard.calculate(KpiDashboard.sample);
  const month=faMonth.format(new Date());
  document.querySelector('#kpiMonth').textContent=month;
  document.querySelector('#kpiPeriod').textContent=month;
  document.querySelector('#overallPerformance').textContent=`${fa.format(data.overallPerformance)}٪`;
  const donut=document.querySelector('#performanceDonut');
  donut.style.setProperty('--progress',`${data.weightedPerformance}%`);
  donut.setAttribute('aria-label',`عملکرد کل KPI: ${faPercent.format(data.weightedPerformance)} درصد از ۱۰۰ درصد`);
  document.querySelector('#baseSalary').textContent=faMoney.format(data.baseSalary);
  document.querySelector('#kpiAmount').textContent=faMoney.format(data.kpiAmount);
  document.querySelector('#kpiPotential').textContent=`از سقف ${faMoney.format(data.maxKpi)} تومان`;
  document.querySelector('#finalSalary').textContent=faMoney.format(data.finalSalary);
  document.querySelector('#finalPotential').textContent=`از سقف ${faMoney.format(data.maxFinalSalary)} تومان · مدل نمایشی`;
  for(const [labelId,barId,value] of [['baseShare','baseProgress',data.baseShare],['kpiAttainment','kpiProgress',data.kpiAttainment],['finalAttainment','finalProgress',data.finalAttainment]]){
    document.querySelector(`#${labelId}`).textContent=`${faPercent.format(value)}٪`;
    const bar=document.querySelector(`#${barId}`);
    bar.style.setProperty('--progress',`${value}%`);
    bar.setAttribute('aria-valuenow',String(Math.round(value*10)/10));
    bar.setAttribute('aria-valuetext',`${faPercent.format(value)} درصد`);
  }
  document.querySelector('#payBase').textContent=`${faMoney.format(data.baseSalary)} تومان`;
  document.querySelector('#payMaxKpi').textContent=`${faMoney.format(data.maxKpi)} تومان`;
  document.querySelector('#payEarnedKpi').textContent=`${faMoney.format(data.kpiAmount)} تومان`;
  document.querySelector('#payFinal').textContent=`${faMoney.format(data.finalSalary)} تومان`;
  document.querySelector('#kpiList').innerHTML=data.indicators.map(item=>`<article class="kpi-item" data-kpi="${escapeHtml(item.id)}">
    <div class="kpi-title"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p></div><span class="kpi-score">${fa.format(item.performance)}٪</span></div>
    <div class="kpi-progress" role="progressbar" aria-label="${escapeHtml(item.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${item.performance}"><i style="--progress:${item.performance}%"></i></div>
    <div class="kpi-meta"><span>وزن: <b>${fa.format(item.weight)}٪</b></span><span>سقف: <b>${faMoney.format(item.maxAmount)} تومان</b></span><span>دریافتی: <strong>${faMoney.format(item.earnedAmount)} تومان</strong></span></div>
  </article>`).join('');
  const composition=document.querySelector('#kpiComposition');
  composition.setAttribute('aria-label',`ترکیب ${faMoney.format(data.kpiAmount)} تومان دریافتی KPI: `+data.indicators.map(item=>`${item.name} ${faMoney.format(item.earnedAmount)} تومان`).join('، '));
  composition.innerHTML=data.indicators.map((item,index)=>`<span class="composition-segment series-${index%4+1}" style="--share:${data.kpiAmount?100*item.earnedAmount/data.kpiAmount:0}%" title="${escapeHtml(item.name)}: ${faMoney.format(item.earnedAmount)} تومان"></span>`).join('');
  document.querySelector('#compositionLegend').innerHTML=data.indicators.map((item,index)=>`<div class="composition-item"><span class="composition-dot series-${index%4+1}" aria-hidden="true"></span><span>${escapeHtml(item.name)}</span><strong>${faMoney.format(item.earnedAmount)} <small>تومان</small></strong></div>`).join('');
  const gaps=[...data.indicators].sort((a,b)=>b.remainingAmount-a.remainingAmount);
  const largestGap=Math.max(...gaps.map(item=>item.remainingAmount));
  const gapSeries=new Map(data.indicators.map((item,index)=>[item.id,index%4+1]));
  document.querySelector('#kpiGapList').innerHTML=gaps.map(item=>`<div class="gap-item" data-component="${escapeHtml(item.id)}"><div class="gap-item-label"><span>${escapeHtml(item.name)}</span><strong>${faMoney.format(item.remainingAmount)} <small>تومان</small></strong></div><div class="gap-track" role="img" aria-label="فاصله ${escapeHtml(item.name)} تا سقف: ${faMoney.format(item.remainingAmount)} تومان"><i class="series-${gapSeries.get(item.id)||1}" style="--progress:${largestGap?100*item.remainingAmount/largestGap:0}%"></i></div></div>`).join('');
}
function renderAll() { renderDocuments(); renderUsers(); renderActivities(); renderKpiDashboard(); }

function showView(name) {
  if(name==='appeals'&&window.PanelWorkflow?.user?.role==='hr')name='incoming';
  if(window.PanelWorkflow&&!window.PanelWorkflow.canView(name))return;
  if(window.PanelUtilities&&['chat','notes'].includes(name))return window.PanelUtilities.open(name);
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#mobileOverlay').classList.remove('open');
  window.scrollTo({ top: 0, behavior: name==='dashboard'?'instant':'smooth' });
  window.dispatchEvent(new CustomEvent('panel:view',{detail:name}));
}
function openModal(el) { el.classList.add('open'); el.setAttribute('aria-hidden','false'); }
function closeModals() { document.querySelectorAll('.modal-backdrop').forEach(m => { m.classList.remove('open'); m.setAttribute('aria-hidden','true'); }); }
let toastTimer;
function toast(message) { const el = document.querySelector('#toast'); el.querySelector('p').textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000); }
function escapeHtml(value='') { const el = document.createElement('div'); el.textContent = value; return el.innerHTML; }
function addActivity(iconId, actor, action) { activities.unshift({ icon: iconId, actor, action, time: Date.now() }); activities = activities.slice(0,20); writeUiStorage('hamkar-activities', JSON.stringify(activities)); }

document.querySelector('#todayLabel').textContent = `${faWeekday.format(new Date())}، ${faDate.format(new Date())}`;
renderKpiDashboard();
const sidebar=document.querySelector('#sidebar');
const sidebarToggle=document.querySelector('#sidebarToggle');
const sidebarResizer=document.querySelector('#sidebarResizer');
const sidebarStateKey='hamkar-sidebar-collapsed';
const sidebarWidthKey='hamkar-sidebar-width';
const sidebarWidthMin=230,sidebarWidthMax=310,sidebarWidthDefault=258;
let sidebarWidth=Math.min(sidebarWidthMax,Math.max(sidebarWidthMin,Number(readUiStorage(sidebarWidthKey))||sidebarWidthDefault));
function setSidebarWidth(width,{persist=true}={}) {
  sidebarWidth=Math.round(Math.min(sidebarWidthMax,Math.max(sidebarWidthMin,width)));
  document.documentElement.style.setProperty('--sidebar-width',`${sidebarWidth}px`);
  sidebarResizer.setAttribute('aria-valuenow',String(sidebarWidth));
  if(persist)writeUiStorage(sidebarWidthKey,String(sidebarWidth));
}
function setSidebarCollapsed(collapsed,{persist=true}={}) {
  sidebar.classList.toggle('is-collapsed',collapsed);
  sidebarToggle.setAttribute('aria-expanded',String(!collapsed));
  const label=collapsed?'باز کردن نوار کناری':'بستن نوار کناری';
  sidebarToggle.setAttribute('aria-label',label);sidebarToggle.title=label;
  if(persist)writeUiStorage(sidebarStateKey,String(collapsed));
  window.dispatchEvent(new CustomEvent('panel:sidebar',{detail:{collapsed}}));
}
setSidebarWidth(sidebarWidth,{persist:false});
setSidebarCollapsed(readUiStorage(sidebarStateKey)==='true',{persist:false});
sidebarToggle.addEventListener('click',()=>setSidebarCollapsed(!sidebar.classList.contains('is-collapsed')));
let resizeStartX=0,resizeStartWidth=sidebarWidth,resizing=false;
sidebarResizer.addEventListener('pointerdown',event=>{
  if(event.button!==0||sidebar.classList.contains('is-collapsed')||window.innerWidth<=820)return;
  resizing=true;resizeStartX=event.clientX;resizeStartWidth=sidebarWidth;
  document.body.classList.add('sidebar-resizing');sidebarResizer.setPointerCapture?.(event.pointerId);event.preventDefault();
});
window.addEventListener('pointermove',event=>{if(resizing)setSidebarWidth(resizeStartWidth+(resizeStartX-event.clientX),{persist:false});});
window.addEventListener('pointerup',event=>{if(!resizing)return;resizing=false;document.body.classList.remove('sidebar-resizing');sidebarResizer.releasePointerCapture?.(event.pointerId);setSidebarWidth(sidebarWidth);});
sidebarResizer.addEventListener('keydown',event=>{
  const next={ArrowLeft:sidebarWidth+8,ArrowRight:sidebarWidth-8,Home:sidebarWidthMin,End:sidebarWidthMax}[event.key];
  if(next===undefined)return;event.preventDefault();setSidebarWidth(next);
});
sidebarResizer.addEventListener('dblclick',()=>setSidebarWidth(sidebarWidthDefault));
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => { if(window.PanelUtilities&&el.closest('#sidebarQuickActions'))return;showView(el.dataset.view); }));
document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => showView(el.dataset.go)));
document.querySelectorAll('[data-open-upload]').forEach(el => el.addEventListener('click', () => openModal(document.querySelector('#uploadModal'))));
['inviteButton','quickInvite','inviteFromDashboard'].forEach(id => document.querySelector(`#${id}`)?.addEventListener('click', () => openModal(document.querySelector('#inviteModal'))));
document.querySelectorAll('.modal-close').forEach(el => el.addEventListener('click', closeModals));
document.querySelectorAll('.modal-backdrop').forEach(el => el.addEventListener('click', e => { if (e.target === el) closeModals(); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
document.querySelector('#mobileMenu').addEventListener('click', () => { document.querySelector('#sidebar').classList.add('open'); document.querySelector('#mobileOverlay').classList.add('open'); });
document.querySelector('#mobileOverlay').addEventListener('click', () => { document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#mobileOverlay').classList.remove('open'); });

const fileInput = document.querySelector('#fileInput');
const dropZone = document.querySelector('#dropZone');
fileInput.addEventListener('change', () => setChosenFile(fileInput.files[0]));
['dragenter','dragover'].forEach(type => dropZone.addEventListener(type,e => { e.preventDefault(); dropZone.classList.add('drag'); }));
['dragleave','drop'].forEach(type => dropZone.addEventListener(type,e => { e.preventDefault(); dropZone.classList.remove('drag'); }));
dropZone.addEventListener('drop', e => { if (e.dataTransfer.files[0]) { fileInput.files = e.dataTransfer.files; setChosenFile(e.dataTransfer.files[0]); } });
function setChosenFile(file) { if (!file) return; document.querySelector('#dropTitle').textContent = `${file.name} — ${sizeLabel(file.size)}`; if (!document.querySelector('#documentTitle').value) document.querySelector('#documentTitle').value = file.name.replace(/\.[^.]+$/, ''); }

let uploadBusy = false;
document.querySelector('#uploadForm').addEventListener('submit', async e => {
  e.preventDefault(); const file = fileInput.files[0]; if (!file) return toast('لطفاً یک فایل انتخاب کنید.');
  if (uploadBusy) return;
  if (file.size > 25 * 1048576) return toast('حجم فایل بیشتر از ۲۵ مگابایت است.');
  const doc = { name: file.name, title: document.querySelector('#documentTitle').value.trim() || file.name, type: fileType(file.name), size: file.size, category: document.querySelector('#documentCategory').value, access: document.querySelector('#documentAccess').value, description: document.querySelector('#documentDescription').value.trim(), uploader: 'محمد رضایی', createdAt: Date.now(), status: 'در انتظار', blob: file };
  const status = document.querySelector('#preprocessStatus');
  uploadBusy = true;
  const controls = [...e.target.querySelectorAll('input, select, textarea, button')];
  controls.forEach(c => c.disabled = true);
  try {
    if (['xlsx','xls','xlsm','xlsb'].includes(doc.type)) {
      status.textContent = 'در حال خواندن شیت‌ها و ساخت خلاصه کم‌حجم…';
      doc.preprocessing = await preprocessExcel(file);
    }
    await saveDocument(doc);
    addActivity('i-upload','محمد رضایی',`مستند «${doc.title}» را بارگذاری کرد.`);
    closeModals(); e.target.reset(); document.querySelector('#dropTitle').textContent = 'فایل را اینجا رها کنید';
    loadDocuments(); toast(doc.preprocessing ? 'فایل و خلاصه اکسل ذخیره شدند؛ هیچ داده‌ای به مدل ارسال نشد.' : 'مستند با موفقیت بارگذاری شد.');
    if (doc.preprocessing) showExcelSummary(doc);
    status.textContent = 'اکسل پیش از ثبت، روی همین دستگاه خلاصه‌سازی می‌شود.';
  } catch (error) {
    status.textContent = error.message + ' فایل ثبت نشد؛ دوباره تلاش کنید.';
    toast('ثبت فایل ناموفق بود. جزئیات در فرم بارگذاری نمایش داده می‌شود.');
  } finally { uploadBusy = false; controls.forEach(c => c.disabled = false); }
});

function saveDocument(doc) {
  return new Promise((resolve,reject) => {
    if (!db) return reject(new Error('ذخیره‌سازی مرورگر آماده نیست.'));
    const transaction = db.transaction('documents','readwrite');
    transaction.objectStore('documents').put(doc);
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(new Error('ذخیره‌سازی ناموفق بود؛ فضای مرورگر را بررسی کنید.'));
  });
}
function showExcelSummary(doc) {
  const context = ExcelProfile.modelContext(doc);
  const { metrics, summary, rowLimitedSheets = [] } = doc.preprocessing;
  const incomplete = rowLimitedSheets.length || summary.omittedSheets || summary.sheets.some(s => s.skippedCells || s.omittedColumns);
  document.querySelector('#summaryMetrics').textContent = `${fa.format(summary.totalSheets)} شیت؛ حجم ورودی مدل ${fa.format(metrics.contextBytes)} بایت (سقف ۱۲٬۰۰۰ بایت). ` +
    (metrics.reductionPercent > 0 ? `${fa.format(metrics.reductionPercent)}٪ کوچک‌تر از متن سلول‌های بررسی‌شده؛ این درصد، کاهش واقعی توکن نیست.` : 'برای فایل کوچک ممکن است خلاصه از متن اصلی بزرگ‌تر باشد.') +
    (incomplete ? ' پوشش محدود است؛ موارد حذف‌شده در خلاصه مشخص‌اند.' : '');
  document.querySelector('#summaryContent').textContent = JSON.stringify(JSON.parse(context),null,2);
  document.querySelector('#downloadSummary').onclick = () => {
    const url = URL.createObjectURL(new Blob([context], { type:'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'excel-context.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  openModal(document.querySelector('#summaryModal'));
}

document.querySelector('#inviteForm').addEventListener('submit', e => {
  e.preventDefault(); const name = document.querySelector('#inviteName').value.trim();
  users.push({ name, unit: document.querySelector('#inviteUnit').value, role: document.querySelector('#inviteRole').value, status: 'دعوت شده', initials: name.split(' ').map(x=>x[0]).join('').slice(0,2) });
  writeUiStorage('hamkar-users', JSON.stringify(users)); addActivity('i-users','محمد رضایی',`برای ${name} دعوت‌نامه همکاری ارسال کرد.`); renderAll(); closeModals(); e.target.reset(); toast('دعوت‌نامه کاربر ثبت شد.');
});

document.addEventListener('click', e => {
  const summaryButton = e.target.closest('[data-summary]');
  if (summaryButton) {
    const doc = documents.find(d => d.id === Number(summaryButton.dataset.summary));
    if (doc?.preprocessing) { showExcelSummary(doc); return; }
    if (doc?.blob) {
      summaryButton.disabled = true; toast('در حال پیش‌پردازش اکسل…');
      preprocessExcel(doc.blob).then(async result => {
        doc.preprocessing = result; await saveDocument(doc); showExcelSummary(doc); renderDocuments();
      }).catch(error => toast(error.message)).finally(() => summaryButton.disabled = false);
    }
    return;
  }
  const downloadButton = e.target.closest('[data-download]'); const deleteButton = e.target.closest('[data-delete]'); const removeUser = e.target.closest('[data-remove-user]');
  if (downloadButton) { const id = Number(downloadButton.dataset.download); const doc = documents.find(d => d.id === id); if (!doc?.blob) return toast('این فایل نمونه است و نسخه واقعی ندارد.'); const url = URL.createObjectURL(doc.blob); const a = document.createElement('a'); a.href = url; a.download = doc.name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
  if (deleteButton) { const id = Number(deleteButton.dataset.delete); const doc = documents.find(d => d.id === id); if (!confirm(`مستند «${doc.title}» حذف شود؟`)) return; const request = tx('readwrite').delete(id); request.onsuccess = () => { addActivity('i-trash','محمد رضایی',`مستند «${doc.title}» را حذف کرد.`); loadDocuments(); toast('مستند حذف شد.'); }; }
  if (removeUser) { const index = Number(removeUser.dataset.removeUser); const user = users[index]; if (!confirm(`دسترسی ${user.name} حذف شود؟`)) return; users.splice(index,1); writeUiStorage('hamkar-users',JSON.stringify(users)); addActivity('i-users','محمد رضایی',`دسترسی ${user.name} را حذف کرد.`); renderAll(); toast('دسترسی کاربر حذف شد.'); }
  const toastButton = e.target.closest('[data-toast]'); if (toastButton) toast(toastButton.dataset.toast);
});

document.querySelector('#documentSearch').addEventListener('input', renderDocuments);
document.querySelector('#categoryFilter').addEventListener('change', renderDocuments);
const helpWidget=document.querySelector('#helpWidget'),helpToggle=document.querySelector('#helpToggle'),helpPanel=document.querySelector('#helpPanel');
function setHelpOpen(open){helpPanel.hidden=!open;helpToggle.setAttribute('aria-expanded',String(open));helpToggle.setAttribute('aria-label',open?'بستن راهنما':'باز کردن راهنما');}
helpToggle.addEventListener('click',()=>setHelpOpen(helpPanel.hidden));
document.querySelector('#helpClose').addEventListener('click',()=>{setHelpOpen(false);helpToggle.focus();});
document.addEventListener('pointerdown',event=>{if(!helpPanel.hidden&&!helpWidget.contains(event.target))setHelpOpen(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!helpPanel.hidden){setHelpOpen(false);helpToggle.focus();}});

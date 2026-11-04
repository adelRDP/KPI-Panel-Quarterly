const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');

const theme=readFileSync('src/theme.css','utf8');
const css=readFileSync('src/styles.css','utf8');
const html=readFileSync('index.html','utf8');

test('activity correction sections are grounded in stored findings and draft answers require the latest owner report without automatic submission',()=>{
 const source=readFileSync('src/ai-ui.js','utf8');for(const text of ['اطلاعات لازم برای ادامه','پاسخ به ابهام‌های گزارش و شاخص','پیشنهاد اصلاحات','پیشنهاد مستقل تازه‌ای از AI تولید نشده','افزودن پاسخ‌ها به پیش‌نویس گزارش','canDraftActivityCorrection','currentDefinition','correctionAnswerDrafts.clear()','data.submissionQuota=next','consent.checked=false','combined.length>10000','draft.appliedText'])assert.ok(source.includes(text));assert.ok(source.includes("actor?.role==='personnel'"));assert.ok(source.includes('data.reviews[0]?.id===review.id'));assert.ok(source.includes('historyRows(data)[0]?.id===item.id'));assert.ok(source.includes('data.submissionQuota?.canUpload===true'));assert.ok(css.includes('.activity-correction-answer textarea'));assert.ok(css.includes('.activity-correction-guidance'));
});

test('activity history exposes a separate read-only analysis dialog with findings technical errors and accessible modal controls',()=>{
 const source=readFileSync('src/ai-ui.js','utf8');for(const text of ['data-history-analysis','نمایش تحلیل AI','activityAnalysisDialog','نواقص و ایرادهای گزارش','خطای پردازش یا اجرای تحلیل','معنی وجود ایراد در گزارش یا شاخص نیست','renderReview(review,[])','closeActivityAnalysis(false)','aria-labelledby','aria-haspopup="dialog"'])assert.ok(source.includes(text));assert.ok(source.includes("criteria.filter(c=>c.status!=='met')"));assert.ok(source.includes('snapshot?.criteria?.find'));assert.ok(css.includes('.review-history-actions'));assert.ok(css.includes('.activity-analysis-section'));assert.ok(css.includes('.activity-analysis-dialog :focus-visible'));
});

test('unit performance identifies the loaded month and refreshes on entry while the quarterly menu name is concise',()=>{
 const workflow=readFileSync('src/workflow-ui.js','utf8'),lifecycle=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(workflow.includes('id="teamPeriodNote"'));assert.ok(workflow.includes('teamPeriod=requestedPeriod'));assert.ok(workflow.includes("['dashboard','manager-dashboard','team'].includes(e.detail)"));assert.ok(workflow.includes("$('#teamRows').replaceChildren();$('#teamSummary').replaceChildren()"));assert.ok(workflow.includes('دادهٔ ناموجود صفر محسوب نمی‌شود'));assert.ok(lifecycle.includes("makeView('quarters','ارزیابی فصلی','i-pulse'"));
});

test('published design status badges have scoped semantic colors and escaped status identity',()=>{
 const lifecycle=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(lifecycle.includes('data-status="${Object.hasOwn(labels,value)?value:\'unknown\'}"'));
 for(const status of ['published','needs_revision','manager_review','hr_review','rejected','ai_failed','ai_pending'])assert.ok(css.includes('#designPublishedPanel .workflow-state[data-status="'+status+'"]'));
 for(const tone of ['published','revision','manager','admin','error','pending'])assert.ok(theme.includes('--color-design-status-'+tone+'-bg: color-mix'));
 assert.ok(css.includes('border:1px solid currentColor'));assert.ok(css.includes('color:var(--color-report-summary); background:var(--color-design-status-manager-bg)'));assert.ok(css.includes('color:var(--color-report-changes); background:var(--color-design-status-admin-bg)'));
});

test('monthly gap bars keep component identity colors rather than inheriting their sorted position',()=>{
 const workflow=readFileSync('src/workflow-ui.js','utf8'),legacy=readFileSync('src/app.js','utf8');assert.ok(workflow.includes('const gapSeries=new Map(data.components.filter'));assert.ok(workflow.includes('series-${gapSeries.get(c.id)||1}'));assert.ok(legacy.includes('const gapSeries=new Map(data.indicators.map'));assert.ok(legacy.includes('series-${gapSeries.get(item.id)||1}'));for(const [n,t] of [[1,'teal'],[2,'lavender'],[3,'blue'],[4,'mauve'],[5,'violet']])assert.ok(css.includes('#kpiGapList .gap-track i.series-'+n));assert.ok(theme.includes('--data-series-violet: var(--palette-report-violet)'));assert.ok(css.includes('background:var(--data-series-violet)'));
});

test('proposal bodies have native independent details with visible full headings and scope-safe answer reveal',()=>{
 const lifecycle=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(lifecycle.includes("proposal.querySelector(':scope > .analysis-duty-link')"));assert.ok(lifecycle.includes("proposal.querySelector(':scope > .analysis-checks')"));assert.ok(lifecycle.includes('if(dutyLink&&checks)dutyLink.after(checks)'));
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes('function collapseProposalSections(root)'));assert.ok(source.includes("node.matches('.analysis-proposal-heading,h4')"));assert.ok(source.includes("document.createElement('details')"));assert.ok(source.includes("details.removeAttribute('open')"));assert.ok(source.includes('نمایش جزئیات'));assert.ok(source.includes('بستن جزئیات'));assert.ok(source.includes('revealAnalysisElement(field)'));assert.ok(source.includes("collapseProposalSections(designAnalysisDialog.querySelector('.design-analysis-dialog-body'))"));assert.match(css,/\.analysis-detail-title[^}]*overflow-wrap:anywhere/);assert.match(css,/\.analysis-collapsible\[open\][\s\S]*analysis-detail-closed[^}]*display:none/);
});

test('unresolved findings offer grounded responses or scoped manual draft editing while terminal review stays locked',()=>{
 const ui=readFileSync('src/lifecycle-ui.js','utf8'),backend=readFileSync('backend/organization-workflow.mjs','utf8'),clarifications=readFileSync('backend/design-clarifications.mjs','utf8'),server=readFileSync('server.mjs','utf8');
 assert.ok(ui.includes('issueResolutionHtml(design,item,original)'));assert.ok(ui.includes('data-open-design-correction'));assert.ok(ui.includes('data-focus-clarifications'));assert.ok(ui.includes('data-final-review-from-analysis'));assert.ok(clarifications.includes("origin:'analysis-findings'"));assert.ok(server.includes('organization.openDesignCorrectionDraft'));const action=backend.slice(backend.indexOf('function openDesignCorrectionDraft'),backend.indexOf('function saveDesignClarifications'));assert.ok(action.includes('assertCorrectionOpen(source)'));assert.ok(action.includes('input.runId!==source.aiReview.runId'));assert.ok(action.includes('input.draftRevision!==previous.draftRevision'));assert.ok(action.includes('source.managerId!==actor.id'));assert.ok(!action.includes('analyzeDesign('));assert.match(css,/\.analysis-resolution \.design-form-actions[^}]*flex-wrap:wrap/);
});

test('terminal correction locks exclude archiving without bypassing role or running-job safety',()=>{
 const ui=readFileSync('src/lifecycle-ui.js','utf8'),backend=readFileSync('backend/organization-workflow.mjs','utf8'),locks=ui.slice(ui.indexOf('function enforceFinalReviewLocks()'),ui.indexOf('function resetDesignForm(')),remove=backend.slice(backend.indexOf('function removeDesign('),backend.indexOf('async function analyzeDesign('));
 assert.ok(!locks.includes('[data-delete-design]'));assert.ok(remove.includes('ownDesign(actor,id)'));assert.ok(!remove.includes('assertCorrectionOpen'));assert.ok(remove.includes('if(running)fail'));assert.ok(remove.includes('removedAt'));assert.ok(remove.includes("audit(actor,'kpi-design.removed'"));
});

test('admin monthly survey table names the stored campaign unit without changing survey actions',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes("table(['ماه ارزیابی','فرد هدف','واحد','وضعیت','اقدام']"));assert.ok(source.includes("<td>${esc(c.unitName||'ثبت نشده')}</td>"));
});
test('manager question responses are explicit versioned sources, inherited in drafts and never use native prompt dialogs',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes('پاسخ به ابهام‌های شاخص'));assert.ok(source.includes('data-clarification-form'));assert.ok(source.includes('ذخیرهٔ پاسخ‌ها'));assert.ok(!source.includes('ارسال پاسخ‌ها و بررسی مجدد'));assert.ok(!source.includes('data-clarification-action="analyze"'));assert.ok(!source.includes('پرسش از تحلیل نسخه'));assert.ok(source.includes('rows="2" maxlength="2000"'));assert.ok(source.includes('readClarificationAnswers(designClarificationArea)'));assert.ok(source.includes('reconfirmed:'));assert.ok(source.includes('draftRevision:design.clarificationDraft?.draftRevision'));assert.ok(source.includes('design.managerId===user.id'));assert.match(css,/\.analysis-clarifications textarea,[^{]*\{[^}]*var\(--color-input\)/);assert.ok(css.includes('.clarification-answer-text { white-space:pre-wrap;overflow-wrap:anywhere; }'));
});

test('all fifteen score-rule groups have short visible summary help without changing the rule registry',async()=>{
 const source=readFileSync('src/score-settings-ui.js','utf8'),{ruleGroups}=await import('../backend/score-rules.mjs');assert.equal(ruleGroups.length,15);
 for(const group of ruleGroups){const match=source.match(new RegExp('\\b'+group.id+":'([^']+)'"));assert.ok(match,group.id);assert.ok(match[1].length>15&&match[1].length<90,group.id);}
 assert.ok(source.includes('<span class="score-rule-group-description">'));assert.ok(source.includes('<small class="score-rule-group-state">'));assert.match(css,/\.score-rule-group summary \{ display:grid;/);assert.match(css,/\.score-rule-group-description \{[^}]*font-size:13px[^}]*var\(--color-text-secondary\)/);assert.ok(css.includes('.score-rule-group-description{grid-column:1 / -1;grid-row:3;}'));
});

test('score settings use separate Persian year and season, compact rows and explicit details text',()=>{
 const source=readFileSync('src/score-settings-ui.js','utf8');assert.ok(source.includes('<h2>دامنه و زمان اثر</h2>'));assert.ok(source.includes('name="effectiveYear" required'));assert.ok(source.includes('name="effectiveSeason" required'));assert.ok(source.includes('type="hidden" name="effectiveDate"'));assert.ok(source.includes('selectStoredEffect(row.effectiveDate)'));assert.ok(source.includes('نمایش جزئیات'));assert.ok(source.includes('بستن جزئیات'));assert.ok(!source.includes('scoreModelLink'));assert.ok(!source.includes('<p class="formula-note">'));assert.ok(!source.includes('367'));assert.match(css,/\.score-rule-groups \{[^}]*margin:20px 12px/);assert.ok(css.includes('.score-rule-groups{margin-inline:0;}'));assert.ok(!css.includes(".score-rule-group summary::after { content:'＋'"));
});

test('admin request archive uses the shorter label while retaining its existing view and permission',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes("makeView('incoming-archive','آرشیو درخواست‌ها','i-folder',roleViews.incomingArchive)"));assert.ok(source.includes('<h1>آرشیو درخواست‌ها</h1>'));assert.ok(!source.includes('آرشیو درخواست‌های ورودی'));assert.ok(source.includes("['incoming','incoming-archive']"));
});

test('published action labels clarify display and final review while deletion immediately precedes month copy',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes('بازبینی نهایی مدیر و ارسال به ادمین'));assert.ok(source.includes('>نمایش تحلیل AI</button>'));assert.ok(!source.includes('بازبینی مستند مدیر و ارسال ادمین'));assert.ok(source.includes('${actions}${analysisAction}${deleteAction}${copyAction}'));assert.ok(source.includes('const deleteAction=isManager?'));assert.ok(source.includes('data-show-design-analysis='));assert.ok(source.includes('data-copy-design='));assert.ok(source.includes('data-delete-design='));
});

test('terminal review locks correction controls and makes answers read-only using the authoritative server flag',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8'),backend=readFileSync('backend/organization-workflow.mjs','utf8');assert.ok(source.includes('enforceFinalReviewLocks();'));assert.ok(source.includes('editable=!design.finalReviewOnly'));assert.ok(source.includes('designFinalReviewNotice'));assert.ok(source.includes('const lock=formReviewLock()'));assert.ok(backend.includes('function finalReviewLock('));assert.ok(backend.includes('assertCorrectionOpen(draft)'));assert.ok(backend.includes('assertCorrectionOpen(source)'));assert.ok(backend.includes('Number(result?.correctionRound)>=maxCorrectionRounds'));assert.ok(backend.includes("if(lock&&(!finalSource||input.decision!=='approve'))"));
});

test('final manager acknowledgment clearly separates review responsibility from the independent admin decision',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes('یافته‌های باقی‌مانده را بررسی کرده‌ام و مسئولیت بازبینی نهایی این طرح را می‌پذیرم. ارسال طرح برای تصمیم‌گیری مستقل ادمین را تأیید می‌کنم.'));assert.ok(source.includes("'ثبت بازبینی نهایی و ارسال به ادمین'"));assert.ok(source.includes("'تصویب و انتشار با مسئولیت ادمین'"));assert.ok(source.includes('humanReviewForm.elements.acknowledgment.disabled=false'));
});

test('admin role terminology changes visible labels without changing internal roles or the organization data',()=>{
 const lifecycle=readFileSync('src/lifecycle-ui.js','utf8'),log=readFileSync('src/ai-log-ui.js','utf8'),workflow=readFileSync('src/workflow-ui.js','utf8');assert.ok(!lifecycle.includes('HR'));assert.ok(!lifecycle.includes('منابع انسانی'));assert.ok(!log.includes('HR'));assert.ok(lifecycle.includes("hr_review:'در انتظار بازبینی ادمین'"));assert.ok(lifecycle.includes('بازبینی نهایی مدیر و ارسال به ادمین'));assert.ok(lifecycle.includes("user?.role==='hr'"));assert.ok(workflow.includes("account.role==='hr'"));assert.ok(html.includes('<option>منابع انسانی</option>'));
});

test('final human review separates instructions findings reason and acknowledgment into scoped themed boxes',()=>{
 assert.ok(css.includes('#humanReviewHint,#humanReviewFindings,#humanReviewForm > label { min-width:0;margin:0;padding:16px;border:1px solid var(--color-border);border-radius:var(--radius-md);overflow-wrap:anywhere; }'));
 for(const token of ['color-report-summary','color-warning','color-primary-strong'])assert.ok(css.includes('border-inline-start:3px solid var(--'+token+')'));
 assert.ok(css.includes('#humanReviewStatus:empty { display:none; }'));assert.ok(css.includes('@media(max-width:580px){#humanReviewDialog .design-analysis-dialog-header'));
});
test('final review submission stays disabled until explicit acknowledgment and resynchronizes after close open and failure',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes('id="submitHumanReview" disabled'));assert.ok(source.includes('function syncHumanReviewSubmit()'));assert.ok(source.includes('!humanReviewForm.elements.acknowledgment.checked||!humanReviewContextCurrent(editor)'));assert.ok(source.includes("humanReviewForm.elements.acknowledgment.addEventListener('change',syncHumanReviewSubmit)"));assert.ok(source.includes('ack.disabled=false;syncHumanReviewSubmit();'));assert.ok(source.includes('humanReviewForm.elements.acknowledgment.checked=false;syncHumanReviewSubmit();'));
});
test('design period selector is a compact horizontal toolbar with readable mobile wrapping',()=>{
 assert.ok(css.includes('#view-tasks .design-period-filter { display:flex;align-items:center;gap:12px;flex-wrap:nowrap;padding:10px 16px; }'));assert.ok(css.includes('#view-tasks .design-period-filter > label { display:flex;align-items:center;gap:10px;min-width:0;margin:0;flex:none;white-space:nowrap; }'));assert.ok(css.includes('#view-tasks .design-period-filter select { width:190px;min-height:40px;padding:6px 10px;flex:none; }'));assert.ok(css.includes('#view-tasks .design-period-filter > p { flex-basis:100%; }'));
});
test('period-dependent lists use the shared month while retained history and periodless logs remain explicit',()=>{
 const lifecycle=readFileSync('src/lifecycle-ui.js','utf8'),workflow=readFileSync('src/workflow-ui.js','utf8'),ai=readFileSync('src/ai-log-ui.js','utf8');assert.ok(lifecycle.includes('id="designPeriodScope"'));assert.ok(lifecycle.includes('designs.filter(d=>d.period===currentPeriod())'));assert.ok(lifecycle.includes('name="periodScope"'));assert.ok(ai.includes("document.querySelector('#workflowPeriod').addEventListener('change',invalidatePeriod)"));assert.ok(ai.includes('period!==periodFilter()'));assert.ok(ai.includes('data.period!==period'));assert.ok(workflow.includes('await window.PanelAiLog?.refresh()'));assert.ok(workflow.includes('window.PanelAiLog?.working'));
});
test('documented human decisions use an accessible themed in-panel dialog instead of native prompt or confirm',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes("humanReviewDialog.id='humanReviewDialog'"));assert.ok(source.includes('name="acknowledgment" required'));assert.ok(source.includes('minlength="20" maxlength="2000"'));assert.ok(source.includes("humanReviewDialog.setAttribute('aria-modal','true')"));assert.ok(source.includes("humanReviewDialog.addEventListener('cancel'"));assert.ok(source.includes('humanReviewAcknowledgment:true'));
 for(const line of source.split('\n').filter(line=>line.includes('if(action.dataset.reviewDesign)')||line.includes('if(action.dataset.approveDesign||action.dataset.returnDesign)'))){assert.ok(line.includes('openHumanReviewDialog(action)'));assert.ok(!line.includes('prompt(')&&!line.includes('confirm('));}
 assert.match(css,/\.human-review-dialog textarea \{[^}]*var\(--color-input\)[^}]*var\(--color-text\)/);assert.match(css,/\.human-review-dialog \.design-analysis-dialog-footer \{ display: flex; flex-wrap: wrap;/);
});

test('manager personnel request search type and refresh align in three compact scoped columns',()=>{
 assert.match(css,/#managerRequestsFilters \{ grid-template-columns:minmax\(0,2fr\) minmax\(150px,1fr\) auto; align-items:end; gap:12px; \}/);assert.match(css,/#managerRequestsFilters > label \{ min-width:0; margin-bottom:0; \}/);const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes('<div id="managerRequestsFilters" class="form-grid">'));assert.match(source,/data-refresh-lifecycle>تازه‌سازی<\/button><\/div><\/section>/);assert.match(css,/@media\(max-width:580px\)\{#managerRequestsFilters/);
});

test('organization unit and section headers stick within their scroll boxes with an opaque themed background',()=>{
 assert.match(css,/\.organization-structure-grid \.workflow-table thead th \{ position: sticky; top: 0; z-index: 2; background: var\(--color-popover-opaque\); box-shadow: 0 1px 0 var\(--color-border\); \}/);assert.match(css,/\.organization-structure-grid \.workflow-table-wrap \{ max-height: 300px; \}/);assert.match(css,/\.workflow-table-wrap \{ overflow: auto; \}/);
});

test('routine and project column labels grow by two pixels without enlarging task values',()=>{
 assert.match(css,/\.assignment-column-label \{ font-size: 13px; color: var\(--color-text-secondary\); text-align: center; font-weight: 600; \}/);assert.match(css,/\.assignment-task-row \.assignment-meta \{[^}]*font-size: var\(--text-xs\)/);
});

test('organization chart heading has its own themed box without boxing unit titles or altering chart data',()=>{
 const header=css.match(/#view-chart > \.settings-card:has\(#chartContents\) > h2 \{([^}]+)\}/)[1];assert.match(header,/text-align: center; font-size: 22px/);assert.match(header,/padding: 12px 16px/);assert.match(header,/border: 1px solid var\(--color-border\)/);assert.match(header,/border-radius: var\(--radius-md\)/);assert.match(header,/background: var\(--color-primary-tint\)/);assert.match(css,/#view-chart \.org-unit > h2 \{[^}]*font-size: 20px/);
});

test('personnel operation cards tint by existing count and icon tones, including selection without affecting manager cards',()=>{
 assert.match(theme,/#operationsOverview \.operations-card \{ --personnel-card-accent: var\(--color-text\)/);for(const tone of ['error','warning'])assert.ok(theme.includes('#operationsOverview .operations-card[data-tone="'+tone+'"] { --personnel-card-accent: var(--color-'+tone+'); }'));
 assert.match(css,/#operationsOverview \.operations-card \{[^}]*var\(--personnel-card-accent\) 12%[^}]*border-inline-start: 3px solid var\(--personnel-card-accent\)/);assert.ok(css.includes('#operationsOverview .operations-card strong,#operationsOverview .operations-card svg { color: var(--personnel-card-accent); }'));assert.match(css,/#operationsOverview \.operations-card:hover,#operationsOverview \.operations-card\[aria-pressed="true"\] \{[^}]*var\(--personnel-card-accent\) 20%/);
});

test('personal information card icons are slightly larger without changing the portrait or card typography',()=>{
 assert.match(css,/#personalInfo \.personal-info-grid dt svg \{ width: 24px; height: 24px; flex: none; color: var\(--color-primary-strong\); \}/);assert.match(css,/\.personal-info-photo svg \{ width: 54px; height: 54px; \}/);assert.match(css,/#personalInfo \.personal-info-grid dt \{[^}]*font-size: 16px/);assert.match(css,/#personalInfo \.personal-info-grid dd \{ font-size: var\(--text-sm\)/);
});

test('personnel name and job identity share a themed box without changing the portrait or metadata typography',()=>{
 assert.ok(css.includes('#personalInfo .personal-info-identity { flex:1;min-height:125px;display:flex;flex-direction:column;justify-content:center;padding:16px 18px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-primary-tint); }'));assert.ok(css.includes('.personal-info-photo svg { width: 54px; height: 54px; }'));assert.ok(css.includes('#personalInfo .personal-info-identity h2 { font-size: 22px; overflow-wrap: anywhere; }'));assert.ok(css.includes('#personalInfo .personal-info-identity { min-height:100px;padding:12px; }'));
 assert.match(css,/#personalInfo \.personal-info-identity \{ flex:1;/);assert.match(css,/\.personal-info-heading \{[^}]*gap: 16px/);assert.ok(!css.includes('flex:0 1 50%;min-height:125px'));
});

test('organization chart prefixes unit headings through an escaped display-only formatter',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes('const chartUnitLabel='));assert.ok(source.includes("'واحد '+name"));assert.ok(source.includes('<h2>${esc(chartUnitLabel(unit.name))}</h2>'));assert.ok(source.includes('data-search-unit="${esc(unit.id)}"'));assert.ok(source.includes('<small>${esc(person.unitName)}</small>'));
});

test('quarter personnel filters align search unit and clear actions in a scoped responsive row',()=>{
 assert.ok(css.includes('#quarterFilters > .form-grid { grid-template-columns:minmax(0,2fr) minmax(150px,1fr) auto;align-items:end;gap:12px; }'));
 assert.ok(css.includes('#quarterFilters input,#quarterFilters select,#quarterFiltersClear { min-height:40px;margin:0; }'));
 assert.ok(css.includes('@media(max-width:580px){#quarterFilters > .form-grid'));
});
test('manager archive filters use a scoped compact search type and submit row with readable mobile wrapping',()=>{
 assert.match(css,/#managerArchiveFilters \{[^}]*grid-template-columns:minmax\(0,2fr\) minmax\(150px,1fr\) auto;[^}]*align-items:end/);assert.match(css,/#managerArchiveFilters > label \{[^}]*margin-bottom:0/);assert.match(css,/#managerArchiveFilters input,#managerArchiveFilters select,#managerArchiveFilters > button \{[^}]*min-height:40px/);assert.match(css,/@media\(max-width:580px\)\{#managerArchiveFilters/);const rules=css.match(/#managerArchiveFilters[^{}]*\{[^}]*\}/g);assert.ok(rules.every(rule=>!rule.includes('font-size')));
});

test('transfer and settlement span the same full grid and structure rows compact spacing without changing typography',()=>{
 assert.match(css,/#positionForm, #settlementForm \{ grid-column:1 \/ -1; \}/);
 const compact=css.match(/\.organization-structure-grid \.workflow-table th,\.organization-structure-grid \.workflow-table td \{([^}]+)\}/)[1];assert.match(compact,/padding: 6px 10px/);assert.doesNotMatch(compact,/font-size/);
 assert.match(css,/\.structure-delete-hint > button:disabled \{ pointer-events:none; \}/);assert.match(css,/\.structure-delete-hint:focus-visible/);
});

test('all four pay breakdown rows increase labels and amounts by two pixels without changing other cards',()=>{
 assert.match(css,/\.pay-breakdown dt \{[^}]*font-size: 12px/);assert.match(css,/\.pay-breakdown dd \{[^}]*font-size: 13px/);assert.match(css,/\.pay-breakdown \.pay-total dd \{[^}]*font-size: 16px/);
 const {JSDOM}=require('jsdom'),dom=new JSDOM(html);assert.equal(dom.window.document.querySelectorAll('.pay-breakdown > div').length,4);dom.window.close();
});

test('onboarding reuses the shared calendar and keeps units adjacent to titles with semantic amount help',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.match(source,/عنوان شغل<input name="jobTitle" required><\/label><label>واحد سازمانی/);
 assert.match(source,/تاریخ شروع به کار/);assert.match(source,/id="newPersonStart"[^>]*readonly/);assert.match(source,/id:'new-person-start-calendar'/);assert.match(source,/id="newPersonSalaryWords"/);assert.match(css,/\.salary-words[^}]*var\(--color-text-secondary\)/);
 assert.ok(html.indexOf('src/persian-date-picker.js')<html.indexOf('src/lifecycle-ui.js'));assert.ok(html.includes('src/persian-money.js'));
});

test('duties table offers a direct edit shortcut while retaining the viewing dialog and version checks',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes('data-open-duties-edit="${esc(position.id)}"'));assert.ok(source.includes("if(directEdit)setDutiesMode(true);else"));assert.ok(source.includes("user?.role!=='hr'||activeWrites"));assert.ok(source.includes('expectedVersion:editor.position.version'));
 assert.ok(css.includes('#dutiesList .duties-row-actions { display:flex;align-items:center;gap:8px; }'));assert.ok(css.includes('#dutiesList .duties-row-actions > button { flex:none;white-space:nowrap; }'));
});
test('duties dialog uses shared colors and sidebar chevrons point down closed and up expanded',()=>{
 assert.match(css,/\.nav-group-toggle \.nav-group-chevron\s*\{[^}]*rotate\(45deg\)/);
 assert.match(css,/\.nav-group-toggle\[aria-expanded="true"\] \.nav-group-chevron\s*\{[^}]*rotate\(-135deg\)/);
 assert.match(css,/\.sidebar \.nav-submenu\s*\{[^}]*border-inline-start:\s*2px solid color-mix/);
 assert.match(css,/\.personnel-duties-dialog\s*\{[^}]*width:\s*min\(780px,calc\(100vw - 32px\)\)/);
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.match(source,/data-show-duties/);assert.match(source,/maxlength="6000"/);assert.match(source,/expectedVersion:editor.position.version/);
});

test('routine and project task metadata align under a shared column heading without shrinking the page',()=>{
 assert.match(css,/\.assignment-columns\s*\{[^}]*overflow-x:\s*auto/);assert.match(css,/\.assignment-group > h3\.assignment-column-head,\.assignment-columns \.assignment-column-row\s*\{[^}]*grid-template-columns:\s*var\(--assignment-columns\)/);
 const source=readFileSync('src/workflow-ui.js','utf8');assert.match(source,/data-assignment-column/);for(const key of ['period','weight','share','frequency','target','timing','format','deadline','score'])assert.ok(source.includes("key:'"+key+"'"));
});

test('routine and project list headings separate their real count from the title',()=>{
 const source=readFileSync('src/workflow-ui.js','utf8');assert.match(source,/class="assignment-group-title">لیست \$\{title\}/);assert.match(source,/class="assignment-group-count"/);assert.match(css,/\.assignment-group-count\s*\{[^}]*margin-inline-start:\s*8px/);
});

test('published design summaries compact metadata and allocate more room to all actions without a nested scrollbar',()=>{
 assert.match(css,/#designPublishedPanel \.workflow-table \{[^}]*table-layout: fixed/);assert.match(css,/#designPublishedPanel \.design-form-actions \{[^}]*flex-wrap: wrap; gap: 4px; overflow: visible/);assert.match(css,/#designPublishedPanel \.design-task-list li \{[^}]*flex-wrap: nowrap/);
 assert.ok(css.includes('#designPublishedPanel .workflow-table th:nth-child(1) { width: 16%; }'));assert.ok(css.includes('#designPublishedPanel .workflow-table th:nth-child(5) { width: 53%; }'));assert.ok(css.includes('#designPublishedPanel .workflow-table th,#designPublishedPanel .workflow-table td { padding: 12px 6px; }'));assert.ok(css.includes('#designPublishedPanel .design-form-actions button { flex: none; white-space: nowrap; }'));
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.match(source,/data-toggle-design/);assert.match(source,/data-design-detail/);assert.match(source,/<td colspan="5"><div class="design-queue-detail">/);
});

test('notes use the supplied notepad-and-pencil shape as a transparent themed vector',()=>{
  const symbol=html.match(/<symbol id="i-note"[^>]*>[\s\S]*?<\/symbol>/)?.[0];assert.ok(symbol);
  assert.match(symbol,/M6 1\.2v2\.3/);assert.match(symbol,/M12\.5 19l7-7/);assert.match(symbol,/M18\.4 13\.1l2\.8 2\.8/);
  assert.doesNotMatch(symbol,/<image|<rect|fill="(?:white|black|#)/);
});

test('announcement pins and responsive admin/details use shared day/night semantic colors',()=>{
 assert.match(html,/id="i-megaphone"/);assert.match(html,/src="src\/announcements-ui.js"/);
 assert.match(css,/\.notification-item\[data-kind="announcement"\]\s*\{[^}]*background:\s*var\(--color-announcement-soft\)/);
 assert.match(theme,/--color-announcement:\s*var\(--palette-warning\)/);
 assert.match(css,/@media\(max-width:1000px\)\s*\{\s*\.announcement-grid\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\)/);
 assert.match(css,/\.announcement-notice-dialog:not\(\[open\]\)/);
 assert.match(html,/src="src\/persian-date-picker.js"/);assert.match(css,/\.announcement-time-selects\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\) 8px minmax\(0,1fr\)/);
 assert.match(css,/\.sidebar-quick-actions \.chat-unread\s*\{[^}]*width:\s*20px[^}]*height:\s*20px[^}]*padding:\s*0/);
 assert.match(css,/\.announcement-log-summary\s*\{[^}]*display:\s*grid/);
});

test('recipient announcement views hide their range while the admin history retains it',()=>{
 for(const file of ['src/notifications-ui.js','src/chat-ui.js']){const source=readFileSync(file,'utf8');assert.doesNotMatch(source,/item\.(?:startsAt|endsAt)|row\.announcement\.(?:startsAt|endsAt)|class="announcement-expiry"|class="announcement-dates"/);}
 const source=readFileSync('src/announcements-ui.js','utf8');assert.match(source,/PanelDate\.formatDateTime\(row\.startsAt\)/);assert.match(source,/PanelDate\.formatDateTime\(row\.endsAt\)/);assert.match(source,/data-delete-announcement/);assert.doesNotMatch(source,/زمان تهران/);
});

test('sidebar footer contains live tools and responsive two-stage windows with the restored original backgrounds',()=>{
  assert.match(html,/class="sidebar-account-card"/);assert.match(html,/id="sidebarQuickActions"/);assert.match(html,/id="panelLogout"/);assert.match(html,/src="src\/utility-windows.js"/);
  assert.match(css,/\.utility-window\s*\{[^}]*background:\s*var\(--color-popover-opaque\)/);assert.match(css,/\.sidebar \.sidebar-quick-actions \.sidebar-tool-button > svg\s*\{[^}]*width:\s*30px/);
  assert.match(theme,/--background-sidebar-image:\s*url\("\.\/assets\/kpi-sidebar-background-day\.webp/);
  assert.match(theme,/--color-sidebar-card:\s*color-mix\(in srgb,var\(--palette-sidebar\) 48%,transparent\)/);
  assert.match(css,/\.utility-window #chatPeerHeading\s*\{[^}]*display:\s*flex/);
  assert.match(css,/\.utility-window\[data-size="compact"\] #chatBackContacts:not\(\[hidden\]\)\s*\{[^}]*min-height:\s*26px[^}]*font-size:\s*10px/);
});

test('design AI report uses an isolated responsive themed dialog with internal scrolling',()=>{
  assert.match(css,/\.design-analysis-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\)[^}]*background:\s*var\(--color-popover\)/);
  assert.match(css,/\.design-analysis-dialog:not\(\[open\]\)\s*\{[^}]*display:\s*none/);
  assert.match(css,/\.design-analysis-dialog-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css,/body\.design-analysis-dialog-open\s*\{[^}]*overflow:\s*hidden/);
});

test('activity actions remain adjacent in RTL and history stays in one contained row',()=>{
  assert.match(css,/\.activity-review-buttons\s*\{[^}]*flex-wrap:\s*nowrap[^}]*gap:\s*8px/);
  assert.match(css,/\.activity-review-buttons\[hidden\]\s*\{[^}]*display:\s*none/);
  assert.match(css,/\.review-history-summary\s*\{[^}]*grid-template-columns:\s*48px 124px minmax\(130px,1fr\) 145px max-content[^}]*white-space:\s*nowrap[^}]*overflow-x:\s*auto/);
  assert.doesNotMatch(css,/\.review-history-score\s*\{[^}]*grid-row:/);
  assert.match(css,/\.review-history-summary small\s*\{[^}]*text-overflow:\s*ellipsis/);
});
const [light,dark]=theme.split(':root[data-theme="dark"]');

test('shared header clock and period controls stay in a single compact scrollable row',()=>{
  const {JSDOM}=require('jsdom'),dom=new JSDOM(html),doc=dom.window.document;
  assert.ok(doc.querySelector('#i-calendar'));assert.equal(doc.querySelector('.header-clock-date use').getAttribute('href'),'#i-calendar');assert.equal(doc.querySelector('.header-clock-time use').getAttribute('href'),'#i-clock');
  assert.match(css,/\.header-controls \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto/);
  assert.match(css,/\.header-clock \{[^}]*direction: ltr;[^}]*background: var\(--color-primary-soft\)/);
  assert.ok(!css.includes('grid-template-areas: "menu actions" "account account" "clock clock"'));assert.match(css,/#periodForm\.period-popover \{[^}]*position: fixed/);
  dom.window.close();
});

test('monthly card titles are larger and all three amounts center in the available body space',()=>{
  const {JSDOM}=require('jsdom'),dom=new JSDOM(html),doc=dom.window.document;
  assert.equal(doc.querySelectorAll('.performance-stats .metric-card-header').length,4);
  for(const id of ['baseSalary','kpiAmount','finalSalary'])assert.equal(doc.getElementById(id).parentElement.className,'metric-card-value');
  assert.equal(doc.querySelectorAll('.metric-card-value').length,3);
  assert.match(css,/\.performance-stats \.metric-card-header \{ font-size: 16px; font-weight: 700;/);
  assert.match(css,/\.metric-card-value \{ flex: 1;[^}]*justify-content: center; align-items: center;/);
  assert.match(css,/\.performance-stats \.metric-progress-label \{ margin-top: 0; padding-top: 10px;/);
  dom.window.close();
});

test('manager summary cards align full width with lower panels and retain topic colors',()=>{
  assert.ok(css.includes('#managerOperations .operations-card > strong { color: var(--manager-card-accent); }'));
  assert.match(css,/#managerOperations \.operations-card > span \{[^}]*font-size: 16px; font-weight: 700; line-height: 1\.7;/);
  assert.match(css,/@media \(max-width: 420px\) \{[^\n]*#managerOperations \.operations-card > span \{ font-size: 14px; \}/);
  assert.match(css,/#managerOperations \.operations-cards \{ width: 100%; max-width: none; grid-template-columns: repeat\(4,minmax\(0,1fr\)\); gap: 16px;/);
  assert.match(css,/\.operations-layout \{[^}]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\); gap: 16px;/);
  assert.doesNotMatch(css,/#managerOperations \.operations-cards \{[^}]*max-width: \d+px/);
  assert.match(css,/#managerOperations \.operations-card \{[^}]*background: color-mix\(in srgb,var\(--manager-card-accent\) 12%,var\(--manager-card-surface\)\)/);
  for(const id of ['overdue','definitions','today','missing','submitted','requests','evaluations'])assert.ok(theme.includes(`[data-manager-card="${id}"]`));
  assert.match(css,/@media \(max-width: 1100px\) \{ #managerOperations \.operations-cards \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
});

test('dashboard display buttons are larger, equal-sized and fit small screens',()=>{
  assert.match(css,/\.dashboard-level-switch > \.secondary-button \{[^}]*min-width:0;[^}]*min-height:56px;[^}]*font-size:17px;/);assert.match(css,/\.dashboard-level-switch \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/@media \(max-width: 580px\) \{ \.dashboard-level-switch \{ gap: 8px; \}\.dashboard-level-switch > \.secondary-button \{ flex: 1; min-width: 0;/);
});

test('dashboard cards expose keyboard shortcuts and offset scrolling below the live header without changing calculation inputs',()=>{
 const source=readFileSync('src/workflow-ui.js','utf8');assert.ok(source.includes("element.setAttribute('role','button');element.tabIndex=0"));assert.ok(source.includes("['Enter',' '].includes(event.key)"));assert.ok(source.includes("scrollDashboardTarget('#operationsOverview .operations-tasks')"));assert.ok(source.includes("scrollDashboardTarget('#managerTaskFollowup')"));assert.ok(source.includes("if(!view||!canView(view))return;"));assert.ok(source.includes('bindDashboardShortcuts(data)'));assert.ok(css.includes('.dashboard-scroll-target { scroll-margin-block-start:calc(var(--dashboard-header-height,88px) + 16px); }'));
});
test('personnel view names are explicit and all three duplicate headings are hidden without affecting managers',()=>{
 const source=readFileSync('src/workflow-ui.js','utf8');assert.ok(source.includes("['showOperations','داشبورد پرسنل','i-home']"));assert.ok(source.includes("['showQuarter','نمای عملکرد فصلی','i-chart-bars']"));assert.ok(source.includes("['showMonth','نمای عملکرد ماهانه','i-report']"));assert.ok(source.includes("dashboardHeading.querySelector('h1').hidden=personnel&&!snapshot?.notApplicable"));assert.ok(source.includes("if(snapshot.notApplicable){dashboardHeading.querySelector('h1').hidden=false;"));assert.ok(css.includes('.dashboard-level-switch > .secondary-button > span { min-width:0;white-space:normal;overflow-wrap:anywhere; }'));
});

test('operations dashboard uses responsive cards, contained task scrolling and labeled charts',()=>{
  assert.match(css,/#operationsOverview \.operations-card > span \{ font-size: 16px; font-weight: 700; line-height: 1\.7; \}/);
  assert.match(css,/@media \(max-width: 420px\) \{ #operationsOverview \.operations-card > span \{ font-size: 14px; \} \}/);
  assert.match(css,/\.operations-cards \{[^}]*grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);
  assert.ok(css.includes('.operations-tasks .workflow-table { min-width: 650px; }'));
  assert.match(css,/@media \(max-width: 680px\) \{ \.operations-layout \{ grid-template-columns: 1fr;/);
  const workflow=readFileSync('src/workflow-ui.js','utf8');assert.ok(workflow.includes('operations-distribution" role="img" aria-label='));assert.ok(workflow.includes('aria-pressed="'));
});

test('long sidebar menus scroll within their own area without shrinking the logo or profile',()=>{
  assert.match(css,/\.sidebar \{[^}]*height: 100vh; height: 100dvh; min-height: 0;/);
  assert.match(css,/\.main-nav \{[^}]*flex: 1; min-height: 0; align-content: start; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;/);
  assert.ok(css.includes('.sidebar-header,.sidebar > .profile-card,.sidebar > .nav-item { flex-shrink: 0; }'));
  assert.ok(css.includes('.sidebar-spacer { flex: 0 0 25px; min-height: 25px; }'));
});

test('selected navigation icons glow across roles without recoloring inactive icons',()=>{
  assert.match(css,/\.sidebar \.nav-item\.active > svg \{[^}]*color: var\(--color-sidebar-heading\);[^}]*filter: drop-shadow\(0 0 3px var\(--color-sidebar-active-icon\)\) drop-shadow\(0 0 8px var\(--color-sidebar-indicator\)\)/);
  assert.ok(css.includes('.sidebar .nav-item.active > svg use[href="#i-home"] { fill: currentColor; }'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce) { .sidebar .nav-item > svg { transition: none; } }'));
});

test('monthly performance donut matches its card accent without changing the quarterly donut',()=>{
  assert.match(theme,/\.metric-card\.performance \.performance-donut \{\s*--chart-performance-donut: conic-gradient\(var\(--data-series-lavender\) 0 var\(--progress\), var\(--chart-track\) var\(--progress\) 100%\);/);
  assert.match(theme,/\.performance-donut \{\s*--progress: 0%;\s*--chart-performance-donut: conic-gradient\(var\(--data-series-teal\)/);
});

test('sidebar semantic icons exist and shared glass styling keeps the current palette',()=>{
  const {JSDOM}=require('jsdom'),dom=new JSDOM(html),doc=dom.window.document;
  for(const name of ['home','chart-bars','chat','note','checklist','inbox','appeal','org-chart','ai','report','person-card'])assert.ok(doc.querySelector(`#i-${name} path, #i-${name} rect`));
  assert.equal(doc.querySelector('[data-view="dashboard"] use').getAttribute('href'),'#i-home');
  const lifecycle=readFileSync('src/lifecycle-ui.js','utf8');
  assert.ok(lifecycle.includes("chat:'i-chat'"));assert.ok(lifecycle.includes("notes:'i-note'"));assert.ok(lifecycle.includes("quarters:'i-chart-bars'"));assert.ok(lifecycle.includes("role==='hr'?'#i-org-chart':'#i-person-card'"));
  const glass=css.split('/* Reference-inspired glass navigation;')[1].split('.sidebar .profile-card { border-top-color:')[0];
  assert.ok(glass.includes('backdrop-filter: blur(12px)'));assert.ok(glass.includes('prefers-reduced-motion: reduce'));
  assert.doesNotMatch(glass,/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);dom.window.close();
});

test('AI log details and archive actions stay side by side without shrinking',()=>{
  assert.match(css,/\.ai-log-actions \{[^}]*display: inline-flex;[^}]*flex-wrap: nowrap;[^}]*min-width: max-content;/);
  assert.match(css,/\.ai-log-actions button \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/);
});

test('incoming row details and approval stay side by side while their four-line summary uses compact spacing',()=>{
  assert.match(css,/\.incoming-row-actions \{[^}]*display: inline-flex;[^}]*flex-wrap: nowrap;[^}]*gap: 8px;[^}]*min-width: max-content;/);
  assert.match(css,/\.incoming-row-actions button \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/);
  assert.match(css,/\.incoming-design-summary p \{[^}]*margin: 0;[^}]*line-height: 1.8;/);
});

test('AI log counters share status colors without recoloring unrelated period chips',()=>{
  assert.match(css,/\.ai-log-count \{ background: var\(--color-muted-bg\); color: var\(--color-text-secondary\); \}/);
  for(const [tone,color] of [['approved','success'],['pending','warning'],['error','error']]){
    assert.ok(css.includes(`.ai-log-state[data-tone="${tone}"],.ai-log-count[data-tone="${tone}"] { color: var(--color-${color}); }`));
    assert.ok(css.includes(`.ai-log-state[data-tone="${tone}"] .ai-log-state-badge,.ai-log-count[data-tone="${tone}"] { background: var(--color-${color}-soft); }`));
  }
});

test('alignment reports separate summary, proposals, check cards and changes with a responsive grid',()=>{
  assert.match(css,/\.analysis-report-summary,\.design-alignment \.analysis-proposal \{[^}]*border: 1px solid var\(--color-border\);[^}]*background: var\(--color-surface\)/);
  assert.match(css,/\.analysis-section \{[^}]*margin-top: 16px;[^}]*padding: 16px;[^}]*border: 1px solid var\(--color-border-subtle\)/);
  assert.match(css,/\.analysis-check-grid \{[^}]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media \(max-width: 760px\) \{ \.analysis-check-grid,\.analysis-candidate dl \{ grid-template-columns: 1fr; \}/);
});

test('AI report sections have scoped themed identities without recoloring outcome badges',()=>{
 const source=readFileSync('src/lifecycle-ui.js','utf8');assert.ok(source.includes('class="analysis-section analysis-rationale"'));assert.ok(source.includes('class="analysis-section analysis-duty-link"'));for(const token of ['summary','progress','duties','questions','answers','changes','checks','base','muted'])assert.ok(theme.includes('--color-report-'+token+':'));for(const token of ['blue','violet','slate','bronze'])assert.equal([...theme.matchAll(new RegExp('--palette-report-'+token+':','g'))].length,2);assert.ok(css.includes('#designAnalysisDialog .analysis-missing { --report-accent:var(--color-report-questions); }'));assert.ok(css.includes('#designAnalysisDialog .analysis-clarifications { --report-accent:var(--color-report-answers); }'));assert.ok(css.includes('border-inline-start:3px solid var(--report-accent)'));assert.ok(css.includes('var(--report-accent) 12%,var(--color-report-base)'));assert.ok(css.includes('#designAnalysisDialog .analysis-candidates { border-inline-start-style:dashed; }'));assert.ok(!css.includes('#designAnalysisDialog .analysis-status-badge {'));assert.ok(css.includes('resize:vertical;font:inherit;'));
});

test('each proposal header makes its index type and title prominent without enlarging other report metadata',()=>{
 assert.ok(css.includes('#designAnalysisDialog .analysis-proposal-heading .analysis-eyebrow { display:block;font-size:clamp(24px,2vw,28px);font-weight:800;'));assert.ok(css.includes('#designAnalysisDialog .analysis-proposal-heading h4 { font-size:clamp(18px,1.5vw,22px);'));assert.ok(css.includes('border-inline-start:5px solid var(--color-primary-strong)'));assert.ok(css.includes('#designAnalysisDialog .analysis-proposal-heading > div { flex-basis:100%; }'));assert.ok(css.includes('.analysis-eyebrow { color: var(--color-text-secondary); font-size: var(--text-xs); }'));
});

test('personnel duties use the shared table with contained horizontal scrolling and readable full text',()=>{
  assert.match(css,/#dutiesList \.workflow-table \{ min-width: 1000px; \}/);
  assert.match(css,/#dutiesList \.workflow-table td \{ vertical-align: top; \}/);
  assert.match(css,/\.workflow-table td\.personnel-duties-text \{[^}]*min-width: 240px;[^}]*max-width: 420px;[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/);
  assert.match(css,/\.workflow-table-wrap \{ overflow: auto; \}/);
  assert.match(css,/\.workflow-table tbody tr:nth-child\(even\) \{ background: var\(--color-row-hover\); \}/);
});

test('copyright footer stays at the viewport bottom on short pages and flows after long content without covering controls',()=>{
  const {JSDOM}=require('jsdom'),dom=new JSDOM(html),doc=dom.window.document,footer=doc.querySelector('.main-area > .site-copyright');
  assert.ok(footer);assert.equal(doc.querySelectorAll('.site-copyright').length,1);assert.equal(footer.tagName,'FOOTER');assert.equal(footer.previousElementSibling.tagName,'MAIN');assert.equal(footer.textContent,'© 2026 KPI HR Team — All rights reserved.');assert.equal(footer.getAttribute('lang'),'en');assert.equal(footer.getAttribute('dir'),'ltr');
  const rule=css.match(/\.site-copyright \{[^}]*\}/)[0];assert.match(rule,/text-align: center/);assert.match(rule,/color: var\(--color-text-secondary\)/);assert.match(rule,/margin-top: auto/);assert.doesNotMatch(rule,/(?:\{|;)\s*(?:position|height|width)\s*:/);const area=css.match(/\.main-area \{[^}]*\}/)[0];assert.match(area,/display: flex/);assert.match(area,/flex-direction: column/);assert.match(area,/min-height: 100dvh/);assert.match(css,/\.main-area > main \{[^}]*flex: 1 0 auto/);dom.window.close();
});

test('header search uses a fixed-size trigger and a separate editor without widening the header',()=>{
  const {JSDOM}=require('jsdom'),dom=new JSDOM(html),doc=dom.window.document;
  const search=doc.querySelector('.top-actions .global-search');assert.ok(search);assert.equal(search.nextElementSibling.id,'themeToggle');assert.equal(doc.querySelectorAll('#globalSearch').length,1);assert.ok(doc.querySelector('#globalSearch').getAttribute('aria-label'));
  assert.match(css,/\.topbar \.top-actions \.global-search \{[^}]*width: 42px/);assert.match(css,/\.search-field \{[^}]*position: fixed;[^}]*z-index: 51/);assert.doesNotMatch(css,/\.global-search:focus-within \{[^}]*width:/);assert.match(css,/prefers-reduced-motion: reduce/);dom.window.close();
});

test('quarter summary cards share compact header, value and footer rows without affecting the final salary strip',()=>{
  assert.match(css,/\.quarter-summary-card:not\(\.quarter-final-card\) > span:not\(\.quarter-summary-icon\) \{[^}]*font-size: 16px; font-weight: 700; line-height: 1\.6;/);
  assert.match(css,/\.quarter-summary-card:not\(\.quarter-final-card\) \{[^}]*display: grid;[^}]*grid-template-columns: 36px minmax\(0,1fr\);[^}]*grid-template-rows: minmax\(36px,auto\) 108px minmax\(34px,auto\)/);
  assert.match(css,/\.quarter-summary-card:not\(\.quarter-final-card\) > small \{[^}]*grid-row: 3;[^}]*align-self: stretch;[^}]*border-top: 1px solid var\(--color-border-subtle\)/);
  assert.match(css,/\.quarter-summary-card:not\(\.quarter-final-card\) > \.performance-donut \{[^}]*width: 108px;[^}]*height: 108px/);
  assert.match(css,/@media \(max-width: 1400px\) \{ \.quarter-summary \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media \(max-width: 580px\) \{ \.quarter-summary \{ grid-template-columns: 1fr/);
});

test('final salary heading sits beside its icon and activity metadata rows share the same responsive grid',()=>{
  assert.match(css,/\.quarter-final-heading \{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: 12px/);
  assert.match(css,/\.quarter-final-heading h2 \{[^}]*font-size: clamp\(18px,1\.65vw,22px\);[^}]*font-weight: 800/);
  assert.match(css,/\.quarter-final-breakdown \{[^}]*flex-wrap: wrap/);
  assert.match(css,/@media \(max-width: 700px\) \{ \.quarter-final-card \{ grid-template-columns: minmax\(0,1fr\)/);
  assert.match(css,/\.activity-info-box \.activity-task-toolbar,\.activity-info-box \.activity-detail-meta \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(4,minmax\(0,1fr\)\);[^}]*min-width: 560px;[^}]*gap: 4px 10px/);
  assert.match(css,/\.activity-info-box \.activity-task-toolbar > span,\.activity-info-box \.activity-detail-meta > span \{[^}]*display: flex;[^}]*justify-content: flex-start;[^}]*align-items: baseline/);
  assert.ok(readFileSync('src/ai-ui.js','utf8').includes('fa.format(Math.round(assignment.kpiWeight))'));
  assert.match(css,/\.activity-info-box \.activity-task-toolbar strong,\.activity-info-box \.activity-detail-meta strong \{[^}]*font-size: var\(--text-sm\);[^}]*font-weight: 700/);
  assert.match(css,/\.activity-info-box \.activity-task-toolbar strong,\.activity-info-box \.activity-detail-meta strong \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis/);
});

test('activity score shares the title row and archived evidence does not render the removed notice',()=>{
 assert.match(css,/\.activity-field-label \{[^}]*font-size: 16px;[^}]*font-weight: 700;[^}]*line-height: 1\.8/);
 const source=readFileSync('src/ai-ui.js','utf8');assert.ok(source.includes('class="activity-title-heading"'));assert.ok(!source.includes('class="activity-task-state"'));assert.ok(!source.includes('پیوست‌های غیرتأییدشده از فهرست فعال حذف'));assert.ok(source.includes("archivedEvidence?'':'<p class=\"activity-empty-evidence\">هنوز مستندی پیوست نشده است.</p>'"));assert.match(css,/\.activity-title-heading \{[^}]*display:flex;[^}]*flex-wrap:wrap/);assert.match(css,/\.activity-title-heading \.activity-score-state \{[^}]*max-width:100%;[^}]*margin-inline-start:auto/);
});

test('activity title uses a simple themed dot and metadata rows have equal columns',()=>{
  const rule=css.match(/\.activity-title-icon \{[^}]*\}/)[0];assert.match(rule,/width: 10px; height: 10px/);assert.match(rule,/flex: none/);assert.match(rule,/border-radius: 50%; background: var\(--color-primary-strong\)/);assert.match(css,/\.activity-info-box \.activity-detail-meta \{[^}]*grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);assert.doesNotMatch(css,/\.activity-status-mark/);assert.match(css,/\.activity-title-line h2 \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/);
});

test('supplied sidebar artwork is kept byte-for-byte unchanged',()=>{
  const digest=createHash('sha256').update(readFileSync('src/assets/kpi-holding-transparent.png')).digest('hex');
  assert.equal(digest,'f5d3f22e8fd7eeacc79a90b9fdba0ef9c0f452eb86fc37cb595853e947063fb5');
  const backgroundDigest=createHash('sha256').update(readFileSync('src/assets/kpi-sidebar-background.png')).digest('hex');
  assert.equal(backgroundDigest,'e6c4bd0140670f95e3fbafee9351bb70a0dd936e3ce94462481e7791d814c529');
  const dayBackgroundDigest=createHash('sha256').update(readFileSync('src/assets/kpi-sidebar-background-day.png')).digest('hex');
  assert.equal(dayBackgroundDigest,'3769196db4de13ae74a77990a89105f1ccab3b07c918919299957b63ae391023');
  const collapsedDigest=createHash('sha256').update(readFileSync('src/assets/holding-5040-collapsed.png')).digest('hex');
  assert.equal(collapsedDigest,'df6eedf07e9f2f60b521c403578be64e49aed97824704a2bf7e46f57e8d9c701');
});

test('the original 5040 vector is preserved and the approved growth image is used in the collapsed sidebar',()=>{
  const vector=readFileSync('src/assets/5040-neon-vector.svg','utf8');
  const digest=createHash('sha256').update(vector.replace(/\r\n/g,'\n').trim()).digest('hex');
  assert.equal(digest,'8655abf1a32f84e17e41399313bc7337a7b1c49189e856982673f18978304dfe');
  assert.doesNotMatch(vector,/<(?:script|foreignObject|image)\b|\bon\w+\s*=|(?:href|xlink:href)\s*=\s*["'](?!#)/i);
  const bytes=readFileSync('src/assets/kpi-growth-collapsed.png');
  const imageDigest=createHash('sha256').update(bytes).digest('hex');
  assert.equal(imageDigest,'cda1a83e34aedcfffc875737345bc5de82ba095b06074b9cf2ca973fd9f1fe16');
  assert.equal(bytes.readUInt32BE(16),1374);assert.equal(bytes.readUInt32BE(20),1145);assert.equal(bytes[25],6);
  assert.match(html,new RegExp(`<img class="sidebar-open-mark" src="src/assets/kpi-growth-collapsed.png\\?v=${imageDigest.slice(0,12)}"`));
  assert.match(html,/<link rel="icon" type="image\/svg\+xml" href="src\/assets\/performance-panel-mark\.svg"/);
  assert.doesNotMatch(html,/brand-holding-mark/);
  assert.doesNotMatch(css,/\.brand-holding-mark/);
});

test('approved performance emblem remains unchanged, uncropped and transparent in both themes',()=>{
  const bytes=readFileSync('src/assets/kpi-analytics-emblem.png');
  const digest=createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest,'6820079875ada149627ee16782d2a94415dbde34f6f945d87b500685bf4d80fc');
  assert.equal(bytes.readUInt32BE(16),1672);assert.equal(bytes.readUInt32BE(20),941);
  assert.equal(bytes[25],6,'PNG retains its alpha channel');
  assert.ok(html.includes(`src/assets/kpi-analytics-emblem.png?v=${digest.slice(0,12)}`));
  assert.match(html,/class="brand-art"[^>]*width="1672" height="941"/);
  const rule=css.match(/\.brand-art\s*\{[^}]*\}/)[0];
  assert.match(rule,/width: 90%;.*height: auto; object-fit: contain;/);
  assert.doesNotMatch(rule,/clip-path|filter|background/);
});

test('glass day and night palettes live in one theme configuration',()=>{
  assert.ok(dark,'dark palette is declared');
  for(const [token,value] of Object.entries({
    '--palette-page':'#F2F7F2','--palette-sidebar':'#D9EEE7',
    '--palette-text-primary':'#182A21','--palette-primary':'#0A805E',
    '--palette-teal':'#20C591','--palette-sand':'#D4AD7D',
    '--palette-coral':'#E88D76','--palette-seafoam':'#6AC7B7'
  }))assert.match(light,new RegExp(`${token}:\\s*${value}`,'i'));
  for(const [token,value] of Object.entries({
    '--palette-page':'#10231B','--palette-sidebar':'#06493F',
    '--palette-text-primary':'#F3F8F4','--palette-primary':'#2AD09B',
    '--palette-teal':'#3BD2A2','--palette-sand':'#D9B080',
    '--palette-coral':'#EA927D','--palette-seafoam':'#7CCFC1'
  }))assert.match(dark,new RegExp(`${token}:\\s*${value}`,'i'));
  assert.match(theme,/--background-canvas-image:\s*radial-gradient\([^;]*--palette-atmosphere-top[^;]*--palette-atmosphere-middle[^;]*--palette-atmosphere-bottom/s);
  assert.match(light,/--background-sidebar-image:\s*url\("\.\/assets\/kpi-sidebar-background-day\.webp/);
  assert.match(dark,/--background-sidebar-image:\s*url\("\.\/assets\/kpi-sidebar-background\.webp/);
  assert.match(light,/--palette-sidebar-text:\s*#16463E/);
  assert.match(dark,/--palette-sidebar-text:\s*#F7FAF9/);
  assert.match(css,/\.sidebar\s*\{[^}]*background-image:\s*var\(--background-sidebar-image\);\s*background-size:\s*cover;\s*background-position:\s*18% center/);
  assert.doesNotMatch(css,/#(?:[0-9a-f]{3,8})\b|rgba?\s*\(|hsla?\s*\(|gradient\s*\(/i);
  assert.doesNotMatch(css,/^\s*--(?:palette|color)-/m);
});

test('all component colors resolve through semantic tokens, including glass surfaces',()=>{
  const declared=new Set([...theme.matchAll(/--([\w-]+)\s*:/g)].map(([,name])=>name));
  const used=[...css.matchAll(/var\(--([\w-]+)/g)].map(([,name])=>name)
    .filter(name=>!['progress','share','value'].includes(name));
  assert.deepEqual([...new Set(used.filter(name=>!declared.has(name)))],[]);
  assert.match(theme,/--color-surface:\s*var\(--palette-surface\)/);
  assert.match(theme,/--color-text-inverse:\s*var\(--palette-on-primary\)/);
  assert.match(theme,/--color-popover:\s*var\(--palette-popover\)/);
  assert.match(css,/\.topbar\s*\{\s*backdrop-filter:\s*blur\(16px\)/);
  assert.match(css,/\.panel,\.metric-card,\.stat-card[^}]*backdrop-filter:\s*blur\(18px\)/);
  assert.match(css,/\.bar-group b,\.notification-panel,\.modal,\.toast\s*\{\s*background:\s*var\(--color-popover\)/);
});

test('personnel detail cards center their labels and values without altering the grid',()=>{
  assert.match(css,/\.personal-info-grid div\s*\{[^}]*text-align:\s*center/);
  assert.match(css,/\.personal-info-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,minmax\(180px,1fr\)\);[^}]*gap:\s*16px/);
  assert.match(css,/\.personal-info-grid dd\s*\{[^}]*margin:\s*0;[^}]*overflow-wrap:\s*anywhere/);
});

test('native select menus and shared monthly/quarterly donuts have explicit day/night contrast',()=>{
  for(const token of ['--palette-select-option','--palette-select-option-text','--palette-chart-track','--palette-chart-center']){
    assert.match(light,new RegExp(`${token}:\\s*#[0-9a-f]+`,'i'));
    assert.match(dark,new RegExp(`${token}:\\s*#[0-9a-f]+`,'i'));
  }
  assert.match(css,/select option,select optgroup\s*\{[^}]*background:\s*var\(--color-select-option\);[^}]*color:\s*var\(--color-select-option-text\)/);
  assert.match(css,/:root\[data-theme="dark"\] select\s*\{\s*color-scheme:\s*dark/);
  assert.match(css,/\.performance-donut-center\s*\{[^}]*background:\s*var\(--color-chart-center\)/);
  assert.match(theme,/\.performance-donut\s*\{[^}]*--progress:\s*0%;[^}]*--chart-performance-donut:\s*conic-gradient\(var\(--data-series-teal\)[^;]*var\(--chart-track\)/);
  assert.match(css,/\.quarter-summary-card \.performance-donut-center strong\s*\{[^}]*font-size:\s*27px;[^}]*margin:\s*0/);
  assert.match(css,/\.quarter-summary-card \.performance-donut-center span\s*\{[^}]*font-size:\s*9px/);
  assert.match(css,/\.nav-item\s*\{[^}]*font-size:\s*15px;\s*font-weight:\s*700/);
  assert.match(html,/<img class="brand-art" src="src\/assets\/kpi-analytics-emblem\.png\?v=[a-f0-9]{12}"/);
  assert.match(css,/\.brand-art\s*\{[^}]*width:\s*90%;[^}]*height:\s*auto/);
  assert.match(css,/\.sidebar-header\s*\{[^}]*background:\s*transparent/);
  assert.match(css,/\.sidebar-header \.sidebar-toggle\s*\{[^}]*order:\s*-1;\s*align-self:\s*flex-end/);
  assert.match(css,/\.sidebar\.is-collapsed \.sidebar-open-mark\s*\{[^}]*object-fit:\s*contain;\s*object-position:\s*center/);
  assert.doesNotMatch(css,/\.sidebar::(?:before|after)/);
  assert.match(css,/\.sidebar \.nav-item\.active svg\s*\{[^}]*var\(--color-sidebar-active-icon\)/);
  assert.match(css,/\.help-widget\s*\{[^}]*position:\s*fixed;[^}]*20px 20px/);
});

test('RTL, responsive layout, Vazirmatn and the holding mark remain explicit',()=>{
  assert.match(html,/<html lang="fa" dir="rtl" data-theme="dark">/);
  assert.match(html,/src\/theme-mode\.js[\s\S]*src\/theme\.css[\s\S]*src\/styles\.css/);
  assert.match(html,/id="themeToggle"[^>]*aria-pressed="true"/);
  assert.match(html,/<link rel="icon" type="image\/svg\+xml" href="src\/assets\/performance-panel-mark\.svg"/);
  assert.match(html,/<img class="brand-art" src="src\/assets\/kpi-analytics-emblem\.png\?v=[a-f0-9]{12}"/);
  assert.match(theme,/@font-face\s*\{[^}]*font-family:\s*"Vazirmatn"[^}]*Vazirmatn-Variable\.woff2/s);
  assert.match(theme,/--font-ui:\s*"Vazirmatn"/);
  assert.match(css,/body\s*\{[^}]*var\(--background-canvas-image\)/s);
  assert.match(css,/\.documents-table \.document-row:not\(\.table-header\):nth-child\(odd\)/);
  assert.match(css,/@media \(max-width: 820px\)/);
  assert.match(css,/@media \(min-width: 821px\)[\s\S]*\.sidebar\.is-collapsed[^}]*width:\s*78px/);
  assert.match(css,/\.sidebar\.is-collapsed \+ \.main-area[^}]*margin-right:\s*78px/);
  assert.match(css,/\.sidebar-resizer[^}]*cursor:\s*ew-resize/);
  assert.match(css,/\.main-area[^}]*margin-right:\s*var\(--sidebar-width\)/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/button:disabled/);
});

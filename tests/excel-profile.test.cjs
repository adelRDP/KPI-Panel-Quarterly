const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('../src/vendor/xlsx.full.min.js');
const { profileWorkbook, modelContext, LIMITS } = require('../src/excel-profile.js');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
function workbook(rows) { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Data'); return book; }
test('XLSX and XLS round-trip: blanks, numeric stats, no raw values', () => {
  for (const bookType of ['xlsx','xls']) {
    const source = workbook([['Name','Score'],['PRIVATE_NAME',10],['OTHER',0],['LAST',null]]);
    const parsed = XLSX.read(XLSX.write(source,{type:'buffer',bookType}),{type:'buffer'});
    const result = profileWorkbook(parsed,XLSX);
    const score = result.summary.sheets[0].columns[1];
    assert.equal(score.missing,1); assert.equal(score.numeric.mean,5);
    assert.equal(result.summary.sheets[0].populatedDataRowsScanned,3);
    assert.ok(!result.context.includes('PRIVATE_NAME'));
    assert.equal(modelContext({preprocessing:result,blob:'DO NOT SEND'}),result.context);
  }
});
test('large workbook has bounded valid JSON and substantial text reduction', () => {
  const rows = [['Person','Amount'], ...Array.from({length:20000},(_,i)=>['نام کارمند محرمانه '+i,i])];
  const result = profileWorkbook(workbook(rows),XLSX);
  assert.ok(result.metrics.reductionPercent > 95);
  assert.ok(result.metrics.contextBytes <= LIMITS.bytes);
  assert.equal(JSON.parse(result.context).sheets[0].columns[1].numeric.max,19999);
});
test('many wide sheets report omissions and preserve byte cap', () => {
  const book = XLSX.utils.book_new();
  for(let i=0;i<35;i++) XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([Array(128).fill('عنوان فارسی بسیار بلند'),Array(128).fill(10)]),'S'+i);
  const result = profileWorkbook(book,XLSX);
  assert.ok(result.metrics.contextBytes<=LIMITS.bytes);
  assert.equal(result.summary.omittedSheets,3);
  assert.ok(result.summary.sheets.some(s=>s.omittedColumns>0));
});
test('empty sheets and cached/missing formulas are explicit', () => {
  const book = workbook([['Score'],[4]]);
  book.Sheets.Data.A2 = {t:'n',v:4,f:'2+2'};
  book.Sheets.Data.A3 = {t:'n',f:'A2*2'};
  const result = profileWorkbook(book,XLSX);
  assert.equal(result.summary.sheets[0].columns[0].formulas,2);
  assert.equal(result.summary.sheets[0].columns[0].missing,1);
  assert.ok(!result.context.includes('A2*2'));
  assert.equal(profileWorkbook(workbook([]),XLSX).summary.sheets[0].columns.length,0);
});
test('model boundary rejects missing, stale or oversized preprocessing', () => {
  assert.throws(()=>modelContext({blob:'raw'}));
  assert.throws(()=>modelContext({preprocessing:{version:'old',status:'ready',context:'{}'}}));
  assert.throws(()=>modelContext({preprocessing:{version:'1.0.0',status:'ready',context:' '.repeat(12001)}}));
});
test('worker parses real binary Excel and rejects corrupt input without raw fallback', () => {
  let response;
  const sandbox = { XLSX, ExcelProfile: require('../src/excel-profile.js'), TextEncoder, Uint8Array,
    importScripts() {}, self: { postMessage(value) { response = value; } } };
  vm.runInNewContext(readFileSync('src/excel-worker.js','utf8'),sandbox);
  sandbox.self.onmessage({data: XLSX.write(workbook([['Amount'],[12],[8]]),{type:'array',bookType:'xlsx'})});
  assert.equal(response.result.summary.sheets[0].columns[0].numeric.mean,10);
  sandbox.self.onmessage({data: new Uint8Array([1,2,3]).buffer});
  assert.ok(response.error); assert.equal(response.result,undefined);
});

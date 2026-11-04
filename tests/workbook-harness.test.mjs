import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {preprocessWorkbook,extractWorkbookEvidence} from '../backend/workbook-harness.mjs';
const require=createRequire(import.meta.url);
const XLSX=require('../src/vendor/xlsx.full.min.js');
const workbook=rows=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Data');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});};

test('full workbook extraction preserves cells above the old 2 MB limit and refuses more than 5 MB',()=>{
 const rows=[['Evidence'],...Array.from({length:2500},(_,i)=>['SYNTHETIC_'+i+'_'+ 'x'.repeat(500)])],result=extractWorkbookEvidence(workbook(rows),'xlsx'),cells=result.sections.flatMap(s=>JSON.parse(s.text).cells);
 assert.ok(cells.reduce((sum,c)=>sum+Buffer.byteLength(JSON.stringify(c)),0)>2_000_000);assert.equal(cells.length,2501);assert.equal(result.manifest.totalCells,2501);assert.equal(result.partial,false);assert.equal(cells.at(-1).value,rows.at(-1)[0]);
 assert.throws(()=>extractWorkbookEvidence(workbook([...rows,...rows.slice(1)]),'xlsx'),/Workbook evidence limit/);
});

test('mislabeled Excel is detected by signature, summarized, and does not leak large contact rows',()=>{
  const rows=[['شناسه','تماس گیرنده','مدت مکالمه'],...Array.from({length:101},(_,i)=>[900000000+i,`PRIVATE_CALLER_${i}`,i])];
  const result=preprocessWorkbook(workbook(rows),'csv');
  const summary=JSON.parse(result.context);
  assert.equal(result.format,'workbook');
  assert.equal(summary.sheets[0].populatedDataRowsScanned,101);
  assert.equal(summary.sheets[0].columns[0].numeric,undefined);
  assert.equal(summary.sheets[0].columns[2].numeric.max,100);
  assert.equal(result.includeCells,false);
  assert.equal(result.partial,true);
  assert.ok(!result.context.includes('PRIVATE_CALLER'));
  assert.ok(result.warnings.some(message=>message.includes('پسوند')));
});

test('valid UTF-8 CSV is handled and invalid text fails closed',()=>{
  const result=preprocessWorkbook(Buffer.from('Status,Score\nDone,2\nPending,0'),'csv');
  assert.equal(result.format,'delimited-text');
  assert.equal(result.encoding,'utf-8');
  assert.equal(result.includeCells,true);
  assert.throws(()=>preprocessWorkbook(Buffer.from([0xff,0xfe]),'csv'));
  assert.throws(()=>preprocessWorkbook(Buffer.from('not a workbook'),'xlsx'));
});

/* Pure, deterministic workbook profiler. No model calls or raw row serialization. */
(function (root) {
  const VERSION = '1.0.0';
  const LIMITS = Object.freeze({ sheets: 32, rows: 50000, columns: 128, cells: 500000, bytes: 12000 });
  const bytes = value => new TextEncoder().encode(value).length;
  const short = value => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  function profileWorkbook(book, XLSX) {
    const summary = { version: VERSION, purpose: 'Workbook discovery only; not full-data analysis',
      headerRule: 'First nonempty row is a candidate header, not a verified schema',
      formulas: 'Cached values only; formulas are never executed or sent',
      totalSheets: book.SheetNames.length, omittedSheets: 0, sheets: [] };
    let inspectedCells = 0, sourceTextBytes = 0;
    for (const name of book.SheetNames.slice(0, LIMITS.sheets)) {
      const sheet = book.Sheets[name];
      const rows = new Map();
      let skippedCells = 0;
      for (const address of Object.keys(sheet)) {
        if (!/^[A-Z]+[1-9][0-9]*$/.test(address)) continue;
        const cell = sheet[address];
        if (cell.v == null && !cell.f) continue;
        const { r, c } = XLSX.utils.decode_cell(address);
        if (r >= LIMITS.rows || c >= LIMITS.columns || inspectedCells >= LIMITS.cells) { skippedCells++; continue; }
        inspectedCells++;
        sourceTextBytes += bytes(JSON.stringify(cell.v ?? '')) + 1;
        if (!rows.has(r)) rows.set(r, new Map());
        rows.get(r).set(c, cell);
      }
      const ordered = [...rows.keys()].sort((a,b) => a-b);
      const header = ordered.shift();
      const headerCells = rows.get(header) || new Map();
      const columnIds = [...new Set([...rows.values()].flatMap(row => [...row.keys()]))].sort((a,b) => a-b);
      const item = { name: short(name), candidateHeaderRow: header == null ? null : header + 1,
        populatedDataRowsScanned: ordered.length, skippedCells, mergedRanges: (sheet['!merges'] || []).length,
        omittedColumns: 0, columns: [] };
      for (const c of columnIds) {
        const col = { column: XLSX.utils.encode_col(c), name: short(headerCells.get(c)?.v) || `Column ${c+1}`,
          missing: 0, types: {}, formulas: 0 };
        let count = 0, mean = 0, min = Infinity, max = -Infinity;
        for (const r of ordered) {
          const cell = rows.get(r).get(c);
          if (cell?.f) col.formulas++;
          if (cell?.v == null || cell.v === '') { col.missing++; continue; }
          const value = cell.v;
          const type = cell.t === 'e' ? 'error' : value instanceof Date ? 'date' : typeof value;
          col.types[type] = (col.types[type] || 0) + 1;
          if (type === 'number' && Number.isFinite(value)) {
            count++; mean = mean * ((count-1)/count) + value/count;
            min = Math.min(min,value); max = Math.max(max,value);
          }
        }
        // No row samples or text-value lists are exported.
        if (count) col.numeric = { count, min, max, mean: Number(mean.toPrecision(8)) };
        item.columns.push(col);
      }
      summary.sheets.push(item);
    }
    summary.omittedSheets = summary.totalSheets - summary.sheets.length;
    let context = JSON.stringify(summary);
    while (bytes(context) > LIMITS.bytes) {
      const candidate = [...summary.sheets].reverse().find(s => s.columns.length);
      if (candidate) {
        const remove = Math.max(1, Math.ceil(candidate.columns.length / 2));
        candidate.columns.splice(-remove); candidate.omittedColumns += remove;
      }
      else { summary.sheets.pop(); summary.omittedSheets++; }
      context = JSON.stringify(summary);
    }
    return { version: VERSION, status: 'ready', context, summary,
      metrics: { contextBytes: bytes(context), scannedTextBytes: sourceTextBytes, inspectedCells,
        reductionPercent: sourceTextBytes ? Math.round((1 - bytes(context)/sourceTextBytes)*100) : null },
      limits: LIMITS };
  }
  function modelContext(doc) {
    if (doc?.preprocessing?.status !== 'ready' || doc.preprocessing.version !== VERSION) throw new Error('ابتدا فایل را پیش‌پردازش کنید.');
    const context = doc.preprocessing.context;
    if (typeof context !== 'string' || bytes(context) > LIMITS.bytes) throw new Error('خلاصه از سقف مجاز بیشتر است.');
    JSON.parse(context);
    return context; // Deliberately excludes Blob, original filename and document metadata.
  }
  const api = { profileWorkbook, modelContext, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExcelProfile = api;
})(globalThis);

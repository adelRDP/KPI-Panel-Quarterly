importScripts('vendor/xlsx.full.min.js', 'excel-profile.js');
self.onmessage = ({ data }) => {
  try {
    const input = new Uint8Array(data);
    const zip = input[0] === 0x50 && input[1] === 0x4b;
    const ole = input[0] === 0xd0 && input[1] === 0xcf && input[2] === 0x11 && input[3] === 0xe0;
    if (!zip && !ole) throw new Error('ساختار فایل اکسل معتبر نیست.');
    const book = XLSX.read(input, { type: 'array', cellDates: true, cellFormula: true,
      cellHTML: false, cellStyles: false, bookVBA: false, sheetRows: ExcelProfile.LIMITS.rows });
    if (!book.SheetNames.length) throw new Error('فایل هیچ شیتی ندارد.');
    const result = ExcelProfile.profileWorkbook(book, XLSX);
    // Parser may truncate large sheets before profiling. Preserve this warning separately.
    result.rowLimitedSheets = book.SheetNames.filter(name => !!book.Sheets[name]['!fullref']);
    if (result.rowLimitedSheets.length) {
      // Keep the bounded model input explicit about sampling even at the cap.
      const summary = JSON.parse(result.context);
      summary.rowScanLimit = ExcelProfile.LIMITS.rows;
      summary.possiblyPartial = true;
      // Reserve room by removing complete columns, never slicing JSON.
      while (new TextEncoder().encode(JSON.stringify(summary)).length > ExcelProfile.LIMITS.bytes) {
        const sheet = [...summary.sheets].reverse().find(s => s.columns.length);
        if (!sheet) break;
        sheet.columns.pop(); sheet.omittedColumns++;
      }
      result.summary = summary;
      result.context = JSON.stringify(summary);
      result.metrics.contextBytes = new TextEncoder().encode(result.context).length;
      result.metrics.reductionPercent = result.metrics.scannedTextBytes ? Math.round((1-result.metrics.contextBytes/result.metrics.scannedTextBytes)*100) : null;
    }
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: 'خواندن اکسل ناموفق بود؛ فایل خراب، رمزدار یا ناسازگار است. ' + String(error.message).slice(0,180) }); }
};

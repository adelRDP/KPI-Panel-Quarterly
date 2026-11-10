const minRunLength = 8;
const rowMarker = '{{row:';
const relativeRowReference = /"(?:[^"]|"")*"|'(?:[^']|'')*'|(?<![\w.])(\$?[A-Za-z]{1,3})([1-9]\d*)(?![\w.(])/g;

// This is an exact text encoding, not a formula evaluator. Only formulas in
// consecutive empty-result rows with identical encodings share a run.
function encodeFormula(formula, row) {
  return formula.replace(relativeRowReference, (match, column, referenceRow) =>
    column ? column + rowMarker + (Number(referenceRow) - row) + '}}' : match);
}

function emptyValue(value) {
  return value == null || value === '';
}

export function compactBlankFormulaRows(cells, decodeCell) {
  const occupiedRows = new Set();
  for (const cell of cells) {
    if (!emptyValue(cell.value) || !emptyValue(cell.display)) {
      occupiedRows.add(decodeCell(cell.address).r);
    }
  }

  const openRuns = new Map(), formulaRuns = [], packed = new Set();
  function finish(run) {
    if (!run || run.cells.length < minRunLength) return;
    const first = run.cells[0], last = run.cells.at(-1);
    const {address, formula, ...properties} = first;
    formulaRuns.push({first: address, last: last.address, count: run.cells.length,
      ...properties, formulaTemplate: run.template});
    for (const cell of run.cells) packed.add(cell.address);
  }

  for (const cell of cells) {
    const {r, c} = decodeCell(cell.address);
    if (!cell.formula || cell.formula.includes(rowMarker) || occupiedRows.has(r)) continue;
    const template = encodeFormula(cell.formula, r + 1);
    const key = JSON.stringify([template, cell.type, cell.value, cell.display]);
    const previous = openRuns.get(c);
    if (previous?.key === key && previous.row === r - 1) {
      previous.cells.push(cell);
      previous.row = r;
    } else {
      finish(previous);
      openRuns.set(c, {key, template, row: r, cells: [cell]});
    }
  }
  for (const run of openRuns.values()) finish(run);
  return {cells: cells.filter(cell => !packed.has(cell.address)), formulaRuns};
}

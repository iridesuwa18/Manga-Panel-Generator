// ============================================================
// js/data.js — Step 4
// Panel data table: row CRUD, rendering, CSV/Excel import &
// export, drag-drop, sample dataset. Moved from the original
// monolith's DATA TABLE / IMPORT FILE / SAMPLE DATA sections
// per spec Implementation Note #1 (move verbatim, adjust only
// global refs). Adjustments required by the new UI:
//   - renderTable() now targets #dataTableBody, which lives in
//     the Page Editor drawer (Row 2) per spec Section B — the
//     standalone "Data" tab from the old sidebar no longer
//     exists as a separate tab.
//   - parseCSVText() no longer calls switchTab('pages') (legacy
//     tab system, removed per Section D) — ui.js will open the
//     Pages drawer itself when wiring the import controls, if
//     desired; data.js only finishes the import + re-render.
//   - All emoji in dynamically-built markup removed (✕ stays,
//     it's a typographic char per Section F's icon policy, not
//     emoji).
//   - exportExcel()/loadSheetJS() unchanged — correct as-is.
// ============================================================

// ── Row CRUD ─────────────────────────────────────────────
function addRow(data = {}) {
  const r = {
    chp: data.chp || 'CHP 1', scn: data.scn || 'S1', pg: data.pg || 'PG 1',
    pnl: data.pnl || 'PNL 1', row: data.row || 'RW 1', lh: data.lh || '30x50',
    maxL: data.maxL || '100', maxH: data.maxH || '50'
  };
  rows.push(r);
  renderTable();
  refreshPageSettings();
}

function deleteRow(idx) {
  rows.splice(idx, 1);
  renderTable();
  refreshPageSettings();
}

function clearAllRows() {
  if (!confirm('Clear all rows?')) return;
  rows = [];
  renderTable();
  refreshPageSettings();
  const inner = document.getElementById('canvasInner');
  if (inner) inner.innerHTML = window.emptyStateHTML ? window.emptyStateHTML() : '';
}

// Pure typographic empty state per spec Section E (no emoji icon).
// Exposed so clearAllRows() and init.js can both restore it.
function emptyStateHTML() {
  return `<div class="empty-state" id="emptyState">
    <p>Import panel data or add rows manually, then generate.
    <span class="hint">Ctrl+scroll zoom &middot; Space+drag pan &middot; Ctrl+Z undo</span></p>
  </div>`;
}

// ── Table rendering ──────────────────────────────────────
// Lives inside the Page Editor drawer (Row 2, Page Editor tab)
// once ui.js builds it — #dataTableBody is that drawer's table
// body element. Safe no-op if the drawer isn't open/built yet.
function renderTable() {
  const tbody = document.getElementById('dataTableBody');
  if (!tbody) return;
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td><input value="${r.chp}" onchange="rows[${i}].chp=this.value;refreshPageSettings()"></td>
      <td><input value="${r.scn}" onchange="rows[${i}].scn=this.value"></td>
      <td><input value="${r.pg}" onchange="rows[${i}].pg=this.value;refreshPageSettings()"></td>
      <td><input value="${r.pnl}" onchange="rows[${i}].pnl=this.value"></td>
      <td><input value="${r.row}" onchange="rows[${i}].row=this.value"></td>
      <td><input value="${r.lh}" onchange="rows[${i}].lh=this.value"></td>
      <td><input value="${r.maxL}" onchange="rows[${i}].maxL=this.value"></td>
      <td><input value="${r.maxH}" onchange="rows[${i}].maxH=this.value"></td>
      <td><button class="btn small danger" onclick="deleteRow(${i})">&times;</button></td>
    </tr>`).join('');
}

// ── Excel / CSV export ───────────────────────────────────
async function exportExcel() {
  if (!rows.length) { window.showToast?.('No data to export!'); return; }
  try {
    const XLSX = await loadSheetJS();
    const headers = ['Chapter No.', 'Scene No.', 'Page No.', 'Panel No.', 'Row No.', 'Panel (L x H in %)', 'Total Max Panel L per row (/100)', 'Total Max Panel H per row (/100)'];
    const data = [headers, ...rows.map(r => [r.chp, r.scn, r.pg, r.pnl, r.row, r.lh, r.maxL, r.maxH])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Panels');
    XLSX.writeFile(wb, 'manga_panels.xlsx');
    window.showToast?.('Excel exported!');
  } catch (e) {
    const headers = 'Chapter No.,Scene No.,Page No.,Panel No.,Row No.,Panel (L x H in %),Total Max Panel L per row (/100),Total Max Panel H per row (/100)';
    const csv = [headers, ...rows.map(r => [r.chp, r.scn, r.pg, r.pnl, r.row, r.lh, r.maxL, r.maxH].join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'manga_panels.csv'; a.click();
    URL.revokeObjectURL(url);
    window.showToast?.('Exported as CSV (SheetJS unavailable)');
  }
}

function loadSheetJS() {
  return new Promise((res, rej) => {
    if (window.XLSX) { res(window.XLSX); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX);
    s.onerror = () => rej(new Error('SheetJS failed'));
    document.head.appendChild(s);
  });
}

// ── File / paste / drag-drop import ──────────────────────
function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.name.endsWith('.csv')) {
    const reader = new FileReader();
    reader.onload = e => parseCSVText(e.target.result);
    reader.readAsText(file);
  } else {
    loadSheetJS().then(XLSX => {
      const reader = new FileReader();
      reader.onload = e => {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_csv(ws);
        parseCSVText(data);
      };
      reader.readAsArrayBuffer(file);
    });
  }
  event.target.value = '';
}

function onDragOver(e) {
  e.preventDefault();
  document.getElementById('dropZone')?.classList.add('drag-over');
}
function onDragLeave(e) {
  document.getElementById('dropZone')?.classList.remove('drag-over');
}
function onDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone')?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFileImport({ target: { files: [file], value: '' } });
}

function parsePastedCSV() {
  const el = document.getElementById('pasted-csv');
  const text = (el?.value || '').trim();
  if (!text) { window.showToast?.('Nothing to parse!'); return; }
  parseCSVText(text);
}

function parseCSVText(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const firstLine = text.split('\n')[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const firstLower = lines[0].toLowerCase();
  const isHeader = firstLower.includes('chapter no') || firstLower.includes('panel no') || firstLower.includes('page no') || firstLower.includes('scene no');
  const startLine = isHeader ? 1 : 0;

  rows = [];
  for (let i = startLine; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 6) continue;

    function parseMax(val, fallback) {
      if (!val) return fallback;
      const m = val.toString().match(/[\d.]+/);
      return m ? m[0] : fallback;
    }

    const lh = (cols[5] || '').replace(/\s/g, '').replace(/[Xx*]/, 'x');

    rows.push({
      chp: cols[0] || '', scn: cols[1] || '', pg: cols[2] || '',
      pnl: cols[3] || '', row: cols[4] || '', lh: lh || '',
      maxL: parseMax(cols[6], '100'),
      maxH: parseMax(cols[7], '50')
    });
  }
  renderTable();
  refreshPageSettings();
  window.showToast?.('Imported ' + rows.length + ' rows');
}

// ── Sample data (Row 5 — Preview Options → Sample) ───────
function loadSampleData() {
  const sample = `CHP 2,S1,PG 1,PNL 1,RW 1,30x50,100,50
CHP 2,S1,PG 1,PNL 2,RW 1,30x50,100,50
CHP 2,S1,PG 1,PNL 3,RW 1,40x25,100,50
CHP 2,S1,PG 1,PNL 4,RW 1,40x25,100,50
CHP 2,S1,PG 1,PNL 5,RW 2,40x50,100,50
CHP 2,S1,PG 1,PNL 6,RW 2,30x50,100,50
CHP 2,S1,PG 1,PNL 7,RW 2,30x50,100,50
CHP 2,S1,PG 2,PNL 1,RW 1,100x40,100,40
CHP 2,S1,PG 2,PNL 2,RW 2,50x35,100,35
CHP 2,S1,PG 2,PNL 3,RW 2,50x35,100,35
CHP 2,S1,PG 2,PNL 4,RW 3,40x25,100,25
CHP 2,S1,PG 2,PNL 5,RW 3,60x25,100,25`;
  parseCSVText(sample);
}

window.addRow = addRow;
window.deleteRow = deleteRow;
window.clearAllRows = clearAllRows;
window.emptyStateHTML = emptyStateHTML;
window.renderTable = renderTable;
window.exportExcel = exportExcel;
window.loadSheetJS = loadSheetJS;
window.handleFileImport = handleFileImport;
window.onDragOver = onDragOver;
window.onDragLeave = onDragLeave;
window.onDrop = onDrop;
window.parsePastedCSV = parsePastedCSV;
window.parseCSVText = parseCSVText;
window.loadSampleData = loadSampleData;

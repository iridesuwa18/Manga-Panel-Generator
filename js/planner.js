// ============================================================
// js/planner.js — Manga Planner
//
// A self-contained "second app" living inside the same page,
// opened via the icon next to the logo (#plannerBtn → #plannerOverlay,
// same full-screen-overlay pattern as js/mobile.js's hamburger menu).
//
// Deliberately independent of the generator's `rows`/`pageSettings`
// state (js/state.js) — it has its own data model, its own
// localStorage key ('mpg_planner_autosave'), and its own CSV/Excel
// export. The two tools share only visual language (same CSS
// tokens) and the same underlying spreadsheet column meaning, so a
// planner export can be pasted straight into the same sheet you'd
// build the generator's A–H columns from, now with I–O filled in too.
//
// DATA MODEL
// ----------
// A page's rows stack top → bottom. Each row has a height (maxH,
// = column H) and a width target (maxL, = column G). Panels within
// a row sit left → right, each with its own width (l, = the L half
// of column F — H is shared by the whole row, matching every sample
// in the real dataset: RW1 40x40, RW2 panels both *x35, etc). This
// intentionally skips the generator's v-first/h-first skyline
// packer and CLM (column) mode — the planner is a simpler "split a
// row into columns" tool, not a full layout engine.
//
// plannerState = {
//   pages: [ {
//     id, chp, pg,
//     rows: [ {
//       id, row,      // auto label 'RW1', 'RW2'...
//       maxL, maxH,   // 0-100, snapped to 5s
//       panels: [ {
//         id, pnl,    // auto label 'PNL1', 'PNL2'...
//         l,          // this panel's width %, snapped to 5s
//         scn, shotType, angleType, subjects, description,
//         dialogues: [ { speechType, speaker, dialogue } ]
//       } ]
//     } ]
//   } ],
//   selectedPageId, selectedPanelKey  // `${rowId}:${panelId}`
// }
// ============================================================

const PLN_SHOT_TYPES = [
  'Extreme Close-Up – Detail', 'Close-Up – Face', 'Medium Close-Up – Chest up',
  'Medium Shot – Waist up', 'Medium Wide – Thigh up', 'Wide Shot – Full body',
  'Very Wide – Small figure', 'Extreme Wide – Environment',
];
const PLN_ANGLE_TYPES = [
  'Eye-Level – Neutral', 'High Angle – Looking down', 'Low Angle – Looking up',
  "Bird's-Eye – Top-down", "Worm's-Eye – From below", 'Dutch Angle – Tilted',
  'Over-the-Shoulder – Behind shoulder', 'Point of View – Character view', 'Reverse Shot – Opposite angle',
];
const PLN_HEADERS = [
  'Chapter No.', 'Scene No.', 'Page No.', 'Panel No.', 'Row No.', 'Panel (L x H in %)',
  'Total Max Panel L per row (/100)', 'Total Max Panel H per row (/100)',
  'Shot Type', 'Angle Type', 'Subjects in scene', 'Scene Description',
  'Speech Type', 'Speaker', 'Dialogue',
];
const PLN_STORAGE_KEY = 'mpg_planner_autosave';

// ── Small helpers ─────────────────────────────────────────────
function pln_uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function snap5(v) { v = Math.round((+v || 0) / 5) * 5; return Math.max(0, Math.min(100, v)); }
function _plnEsc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function _plnAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// ── Persistence ──────────────────────────────────────────────
let plannerState = null;
let _plnSaveTimer = null;

function pln_load() {
  try {
    const raw = localStorage.getItem(PLN_STORAGE_KEY);
    if (raw) { plannerState = JSON.parse(raw); return; }
  } catch (_) { /* corrupt/unavailable — fall through to default */ }
  plannerState = { pages: [], selectedPageId: null, selectedPanelKey: null };
}
function pln_save() {
  try { localStorage.setItem(PLN_STORAGE_KEY, JSON.stringify(plannerState)); } catch (_) { /* storage full/unavailable */ }
}
function pln_scheduleSave() {
  clearTimeout(_plnSaveTimer);
  _plnSaveTimer = setTimeout(pln_save, 800);
}
pln_load();

// ── Relabeling (RW#/PNL# always reflect current order) ─────────
function pln_relabel(page) {
  if (!page) return;
  page.rows.forEach((row, ri) => {
    row.row = 'RW' + (ri + 1);
    row.panels.forEach((p, pi) => { p.pnl = 'PNL' + (pi + 1); });
  });
}

// ── Factories ────────────────────────────────────────────────
function pln_makePanel(l, inherit) {
  return {
    id: pln_uid('pn'), pnl: 'PNL1', l: snap5(l),
    scn: inherit?.scn || '', shotType: '', angleType: '',
    subjects: inherit?.subjects || '', description: '', dialogues: [],
  };
}
function pln_makeRow(maxH) {
  return { id: pln_uid('rw'), row: 'RW1', maxL: 100, maxH: snap5(maxH), panels: [pln_makePanel(100)] };
}
function pln_findPage(pageId) { return plannerState.pages.find(p => p.id === pageId); }
function pln_findRow(pageId, rowId) {
  const page = pln_findPage(pageId);
  return { page, row: page?.rows.find(r => r.id === rowId) };
}
function pln_findPanel(pageId, rowId, panelId) {
  const { page, row } = pln_findRow(pageId, rowId);
  return { page, row, panel: row?.panels.find(p => p.id === panelId) };
}

// ── Open / close ─────────────────────────────────────────────
function openPlanner() {
  if (!plannerState.selectedPageId && plannerState.pages.length) {
    plannerState.selectedPageId = plannerState.pages[0].id;
  }
  document.getElementById('plannerOverlay')?.classList.add('open');
  renderPlanner();
}
function closePlanner() {
  document.getElementById('plannerOverlay')?.classList.remove('open');
  pln_save();
}
window.openPlanner = openPlanner;
window.closePlanner = closePlanner;

// While the planner is open, keep the generator's global shortcuts
// (Ctrl+Z, G, Delete, arrow-nudge, etc. — wired in js/init.js) from
// firing underneath it. Escape closes the planner instead of
// deselecting a bubble it can't see.
document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('plannerOverlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  if (e.key === 'Escape') { closePlanner(); e.stopPropagation(); return; }
  e.stopPropagation();
}, { capture: true });

window.addEventListener('beforeunload', () => {
  if (document.getElementById('plannerOverlay')?.classList.contains('open')) pln_save();
});

// ── Page CRUD ────────────────────────────────────────────────
function pln_nextPageNum() {
  let max = 0;
  plannerState.pages.forEach(pg => { const n = parseInt((pg.pg.match(/\d+/) || [0])[0]); if (n > max) max = n; });
  return max + 1;
}
function addPlannerPage() {
  const n = pln_nextPageNum();
  const lastChp = plannerState.pages[plannerState.pages.length - 1]?.chp || 'CHP 1';
  const page = { id: pln_uid('pg'), chp: lastChp, pg: 'PG ' + n, rows: [pln_makeRow(100)] };
  pln_relabel(page);
  plannerState.pages.push(page);
  plannerState.selectedPageId = page.id;
  plannerState.selectedPanelKey = null;
  pln_scheduleSave();
  renderPlanner();
}
function deletePlannerPage(id) {
  if (!confirm('Delete this page and everything planned on it?')) return;
  plannerState.pages = plannerState.pages.filter(p => p.id !== id);
  if (plannerState.selectedPageId === id) {
    plannerState.selectedPageId = plannerState.pages[0]?.id || null;
    plannerState.selectedPanelKey = null;
  }
  pln_scheduleSave();
  renderPlanner();
}
function selectPlannerPage(id) {
  plannerState.selectedPageId = id;
  plannerState.selectedPanelKey = null;
  renderPlanner();
}
function updatePageChp(id, val) {
  const pg = pln_findPage(id);
  if (pg) pg.chp = val || pg.chp;
  pln_scheduleSave();
  renderPlanner();
}
window.addPlannerPage = addPlannerPage;
window.deletePlannerPage = deletePlannerPage;
window.selectPlannerPage = selectPlannerPage;
window.updatePageChp = updatePageChp;

// ── Row CRUD ─────────────────────────────────────────────────
function addPlannerRow(pageId) {
  const page = pln_findPage(pageId); if (!page) return;
  const usedH = page.rows.reduce((s, r) => s + (+r.maxH || 0), 0);
  const remain = snap5(Math.max(10, 100 - usedH)) || 20;
  page.rows.push(pln_makeRow(remain <= 100 ? remain : 20));
  pln_relabel(page);
  pln_scheduleSave();
  renderPlanner();
}
function deletePlannerRow(pageId, rowId) {
  const page = pln_findPage(pageId); if (!page) return;
  if (page.rows.length <= 1) { window.showToast?.('A page needs at least one row'); return; }
  page.rows = page.rows.filter(r => r.id !== rowId);
  pln_relabel(page);
  if (plannerState.selectedPanelKey?.startsWith(rowId + ':')) plannerState.selectedPanelKey = null;
  pln_scheduleSave();
  renderPlanner();
}
function movePlannerRow(pageId, rowId, dir) {
  const page = pln_findPage(pageId); if (!page) return;
  const i = page.rows.findIndex(r => r.id === rowId);
  const j = i + dir;
  if (j < 0 || j >= page.rows.length) return;
  [page.rows[i], page.rows[j]] = [page.rows[j], page.rows[i]];
  pln_relabel(page);
  pln_scheduleSave();
  renderPlanner();
}
function updateRowField(pageId, rowId, field, val) {
  const { row } = pln_findRow(pageId, rowId); if (!row) return;
  row[field] = snap5(val);
  pln_scheduleSave();
  renderPlanner();
}
window.addPlannerRow = addPlannerRow;
window.deletePlannerRow = deletePlannerRow;
window.movePlannerRow = movePlannerRow;
window.updateRowField = updateRowField;

// ── Panel CRUD ───────────────────────────────────────────────
function addPlannerPanel(pageId, rowId) {
  const { page, row } = pln_findRow(pageId, rowId); if (!row) return;
  const usedL = row.panels.reduce((s, p) => s + (+p.l || 0), 0);
  const remain = snap5(Math.max(5, 100 - usedL));
  const last = row.panels[row.panels.length - 1];
  row.panels.push(pln_makePanel(remain > 0 ? remain : 20, last));
  pln_relabel(page);
  pln_scheduleSave();
  renderPlanner();
}
function splitPlannerPanel(pageId, rowId, panelId) {
  const { page, row } = pln_findRow(pageId, rowId); if (!row) return;
  const idx = row.panels.findIndex(p => p.id === panelId);
  if (idx < 0) return;
  const p = row.panels[idx];
  const left = Math.max(5, snap5(p.l / 2));
  const right = Math.max(5, p.l - left);
  p.l = left;
  const twin = pln_makePanel(right, p);
  row.panels.splice(idx + 1, 0, twin);
  pln_relabel(page);
  plannerState.selectedPanelKey = rowId + ':' + twin.id;
  pln_scheduleSave();
  renderPlanner();
}
function deletePlannerPanel(pageId, rowId, panelId) {
  const { page, row } = pln_findRow(pageId, rowId); if (!row) return;
  if (row.panels.length <= 1) { window.showToast?.('A row needs at least one panel'); return; }
  const idx = row.panels.findIndex(p => p.id === panelId);
  if (idx < 0) return;
  const removed = row.panels[idx];
  row.panels.splice(idx, 1);
  const neighbor = row.panels[idx - 1] || row.panels[idx];
  if (neighbor) neighbor.l = snap5(neighbor.l + removed.l);
  pln_relabel(page);
  if (plannerState.selectedPanelKey === rowId + ':' + panelId) plannerState.selectedPanelKey = null;
  pln_scheduleSave();
  renderPlanner();
}
function selectPlannerPanel(rowId, panelId) {
  plannerState.selectedPanelKey = rowId + ':' + panelId;
  renderPlanner();
  if (window.innerWidth < 900) {
    document.querySelector('.pln-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function updatePanelField(pageId, rowId, panelId, field, val) {
  const { panel } = pln_findPanel(pageId, rowId, panelId); if (!panel) return;
  panel[field] = val;
  pln_scheduleSave();
  renderPlanner();
}
window.addPlannerPanel = addPlannerPanel;
window.splitPlannerPanel = splitPlannerPanel;
window.deletePlannerPanel = deletePlannerPanel;
window.selectPlannerPanel = selectPlannerPanel;
window.updatePanelField = updatePanelField;

// ── Dialogue CRUD (stacked speaker lines on one panel) ──────────
function addDialogue(pageId, rowId, panelId) {
  const { panel } = pln_findPanel(pageId, rowId, panelId); if (!panel) return;
  panel.dialogues.push({ speechType: 'Speech', speaker: '', dialogue: '' });
  pln_scheduleSave();
  renderPlanner();
}
function removeDialogue(pageId, rowId, panelId, dIdx) {
  const { panel } = pln_findPanel(pageId, rowId, panelId); if (!panel) return;
  panel.dialogues.splice(dIdx, 1);
  pln_scheduleSave();
  renderPlanner();
}
function updateDialogueField(pageId, rowId, panelId, dIdx, field, val) {
  const { panel } = pln_findPanel(pageId, rowId, panelId); if (!panel?.dialogues[dIdx]) return;
  panel.dialogues[dIdx][field] = val;
  pln_scheduleSave();
  renderPlanner();
}
window.addDialogue = addDialogue;
window.removeDialogue = removeDialogue;
window.updateDialogueField = updateDialogueField;

// ── Divider drag: split a row's width at 5% increments ─────────
function pln_wireDividers() {
  document.querySelectorAll('.pln-divider').forEach(div => {
    div.addEventListener('pointerdown', pln_onDividerDown);
  });
}
function pln_onDividerDown(e) {
  e.preventDefault();
  const div = e.currentTarget;
  const pageId = div.dataset.pgid, rowId = div.dataset.rowid;
  const leftId = div.dataset.leftid, rightId = div.dataset.rightid;
  const { row } = pln_findRow(pageId, rowId); if (!row) return;
  const leftPanel = row.panels.find(p => p.id === leftId);
  const rightPanel = row.panels.find(p => p.id === rightId);
  if (!leftPanel || !rightPanel) return;

  const rowEl = div.closest('.pln-row-panels');
  const leftEl = div.previousElementSibling;
  const rightEl = div.nextElementSibling;
  const rowWidth = rowEl.getBoundingClientRect().width;
  const startX = e.clientX;
  const origLeft = leftPanel.l, origRight = rightPanel.l;
  div.setPointerCapture(e.pointerId);

  function onMove(ev) {
    const dxPct = ((ev.clientX - startX) / rowWidth) * 100;
    let newLeft = Math.round((origLeft + dxPct) / 5) * 5;
    newLeft = Math.max(5, Math.min(origLeft + origRight - 5, newLeft));
    const newRight = origLeft + origRight - newLeft;
    leftPanel.l = newLeft; rightPanel.l = newRight;
    if (leftEl) { leftEl.style.flexBasis = newLeft + '%'; leftEl.style.width = newLeft + '%'; }
    if (rightEl) { rightEl.style.flexBasis = newRight + '%'; rightEl.style.width = newRight + '%'; }
  }
  function onUp() {
    div.removeEventListener('pointermove', onMove);
    div.removeEventListener('pointerup', onUp);
    div.removeEventListener('pointercancel', onUp);
    pln_scheduleSave();
    renderPlanner();
  }
  div.addEventListener('pointermove', onMove);
  div.addEventListener('pointerup', onUp);
  div.addEventListener('pointercancel', onUp);
}

// ── Rendering ────────────────────────────────────────────────
function renderPlanner() {
  const body = document.getElementById('plannerBody');
  if (!body) return;
  body.innerHTML = `
    <div class="pln-rail">${pln_renderRail()}</div>
    <div class="pln-canvas">${pln_renderCanvas()}</div>
    <div class="pln-inspector">${pln_renderInspector()}</div>
  `;
  pln_wireDividers();
}
window.renderPlanner = renderPlanner;

function pln_renderRail() {
  const items = plannerState.pages.map(pg => {
    const active = pg.id === plannerState.selectedPageId;
    const hTotal = pg.rows.reduce((s, r) => s + (+r.maxH || 0), 0);
    const warn = hTotal !== 100;
    return `<div class="pln-page-item ${active ? 'active' : ''}" onclick="selectPlannerPage('${pg.id}')">
      <div class="pln-page-item-main">
        <span class="pln-page-item-label">${_plnEsc(pg.chp)} &middot; ${pg.pg}</span>
        <span class="chip ${warn ? 'pln-warn' : 'pln-ok'}">${hTotal}% H</span>
      </div>
      <button class="btn small danger" title="Delete page" onclick="event.stopPropagation();deletePlannerPage('${pg.id}')">&times;</button>
    </div>`;
  }).join('');
  return `
    <div class="pln-rail-head">
      <span class="section-title" style="margin:0;border:none;padding:0;">Pages</span>
      <button class="btn small primary" onclick="addPlannerPage()">+ Page</button>
    </div>
    <div class="pln-page-list">${items || '<div class="pln-empty">No pages yet — add one to start planning.</div>'}</div>
  `;
}

function pln_renderCanvas() {
  const page = pln_findPage(plannerState.selectedPageId);
  if (!page) return `<div class="pln-empty-canvas">Add a page to start planning your layout.</div>`;

  const hTotal = page.rows.reduce((s, r) => s + (+r.maxH || 0), 0);

  const rowsHTML = page.rows.map((row, ri) => {
    const lTotal = row.panels.reduce((s, p) => s + (+p.l || 0), 0);
    const lWarn = lTotal !== row.maxL;

    const panelsHTML = row.panels.map((p, pi) => {
      const selKey = row.id + ':' + p.id;
      const selected = plannerState.selectedPanelKey === selKey;
      const dcount = p.dialogues.length;
      const desc = p.description ? _plnEsc(p.description.slice(0, 90)) : '';
      const divider = pi > 0
        ? `<div class="pln-divider" data-pgid="${page.id}" data-rowid="${row.id}" data-leftid="${row.panels[pi - 1].id}" data-rightid="${p.id}"></div>`
        : '';
      return `${divider}<div class="pln-panel ${selected ? 'selected' : ''}" style="flex:0 0 ${p.l}%;width:${p.l}%;" onclick="selectPlannerPanel('${row.id}','${p.id}')">
        <span class="pln-panel-label">${p.pnl}${p.scn ? ' &middot; ' + _plnEsc(p.scn) : ''}</span>
        ${p.shotType ? `<span class="pln-panel-shot">${_plnEsc(p.shotType.split(' – ')[0])}</span>` : ''}
        ${desc ? `<span class="pln-panel-desc">${desc}</span>` : ''}
        ${dcount ? `<span class="chip pln-dchip">${dcount} line${dcount > 1 ? 's' : ''}</span>` : ''}
        <div class="pln-panel-actions">
          <button title="Split panel in two" onclick="event.stopPropagation();splitPlannerPanel('${page.id}','${row.id}','${p.id}')">&#9707;</button>
          <button title="Delete panel" onclick="event.stopPropagation();deletePlannerPanel('${page.id}','${row.id}','${p.id}')">&times;</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="pln-row" style="height:${row.maxH}%;">
      <div class="pln-row-bar">
        <span class="pln-row-label">${row.row}</span>
        <label class="pln-inline-field">H<input type="number" step="5" min="5" max="100" value="${row.maxH}" onchange="updateRowField('${page.id}','${row.id}','maxH',this.value)"></label>
        <label class="pln-inline-field">L tgt<input type="number" step="5" min="5" max="100" value="${row.maxL}" onchange="updateRowField('${page.id}','${row.id}','maxL',this.value)"></label>
        <span class="chip ${lWarn ? 'pln-warn' : 'pln-ok'}">${lTotal}/${row.maxL}L</span>
        <span class="pln-row-btns">
          <button title="Move row up" ${ri === 0 ? 'disabled' : ''} onclick="movePlannerRow('${page.id}','${row.id}',-1)">&#8593;</button>
          <button title="Move row down" ${ri === page.rows.length - 1 ? 'disabled' : ''} onclick="movePlannerRow('${page.id}','${row.id}',1)">&#8595;</button>
          <button title="Add panel to row" onclick="addPlannerPanel('${page.id}','${row.id}')">+P</button>
          <button title="Delete row" class="danger" onclick="deletePlannerRow('${page.id}','${row.id}')">&times;</button>
        </span>
      </div>
      <div class="pln-row-panels">${panelsHTML}</div>
    </div>`;
  }).join('');

  return `
    <div class="pln-canvas-toolbar">
      <div class="field">
        <label>Chapter</label>
        <input type="text" value="${_plnAttr(page.chp)}" onchange="updatePageChp('${page.id}',this.value)">
      </div>
      <span class="chip">${page.pg}</span>
      <span class="chip ${hTotal !== 100 ? 'pln-warn' : 'pln-ok'}">H total ${hTotal}/100</span>
      <button class="btn small primary" onclick="addPlannerRow('${page.id}')">+ Row</button>
    </div>
    <div class="pln-page-frame-wrap">
      <div class="pln-page-frame" id="plnPageFrame">${rowsHTML}</div>
    </div>
  `;
}

function pln_renderInspector() {
  const key = plannerState.selectedPanelKey;
  if (!key) return `<div class="pln-empty">Select a panel on the page to edit its shot, subjects, description, and dialogue.</div>`;
  const [rowId, panelId] = key.split(':');
  const { row, panel: p } = pln_findRow(plannerState.selectedPageId, rowId);
  const panel = row?.panels.find(x => x.id === panelId);
  if (!row || !panel) return `<div class="pln-empty">Select a panel on the page to edit its details.</div>`;

  const shotOpts = PLN_SHOT_TYPES.map(s => `<option value="${s}" ${panel.shotType === s ? 'selected' : ''}>${s}</option>`).join('');
  const angleOpts = PLN_ANGLE_TYPES.map(s => `<option value="${_plnAttr(s)}" ${panel.angleType === s ? 'selected' : ''}>${s}</option>`).join('');

  const dialoguesHTML = panel.dialogues.map((d, i) => `
    <div class="pln-dialogue-card">
      <div class="pln-dialogue-head">
        <span>Line ${i + 1}</span>
        <button title="Remove line" onclick="removeDialogue('${plannerState.selectedPageId}','${row.id}','${panel.id}',${i})">&times;</button>
      </div>
      <div class="field">
        <label>Speaker</label>
        <input type="text" value="${_plnAttr(d.speaker)}" placeholder="e.g. Bond" onchange="updateDialogueField('${plannerState.selectedPageId}','${row.id}','${panel.id}',${i},'speaker',this.value)">
      </div>
      <div class="field">
        <label>Speech Type</label>
        <input type="text" value="${_plnAttr(d.speechType)}" placeholder="Speech / Thought / Narration / SFX" onchange="updateDialogueField('${plannerState.selectedPageId}','${row.id}','${panel.id}',${i},'speechType',this.value)">
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Dialogue</label>
        <textarea onchange="updateDialogueField('${plannerState.selectedPageId}','${row.id}','${panel.id}',${i},'dialogue',this.value)">${_plnEsc(d.dialogue)}</textarea>
      </div>
    </div>`).join('');

  return `
    <div class="pln-inspector-head">${row.row} &middot; ${panel.pnl}</div>
    <div class="field">
      <label>Scene No.</label>
      <input type="text" value="${_plnAttr(panel.scn)}" placeholder="e.g. S1" onchange="updatePanelField('${plannerState.selectedPageId}','${row.id}','${panel.id}','scn',this.value)">
    </div>
    <div class="field">
      <label>Shot Type</label>
      <select onchange="updatePanelField('${plannerState.selectedPageId}','${row.id}','${panel.id}','shotType',this.value)">
        <option value="">—</option>${shotOpts}
      </select>
    </div>
    <div class="field">
      <label>Angle Type</label>
      <select onchange="updatePanelField('${plannerState.selectedPageId}','${row.id}','${panel.id}','angleType',this.value)">
        <option value="">—</option>${angleOpts}
      </select>
    </div>
    <div class="field">
      <label>Subjects in Scene</label>
      <input type="text" value="${_plnAttr(panel.subjects)}" placeholder="e.g. Bond, Aero" onchange="updatePanelField('${plannerState.selectedPageId}','${row.id}','${panel.id}','subjects',this.value)">
    </div>
    <div class="field">
      <label>Scene Description</label>
      <textarea onchange="updatePanelField('${plannerState.selectedPageId}','${row.id}','${panel.id}','description',this.value)">${_plnEsc(panel.description)}</textarea>
    </div>
    <div class="section-title">Dialogue</div>
    ${dialoguesHTML || '<div class="pln-empty" style="padding:var(--sp-2) 0;">No dialogue yet.</div>'}
    <button class="btn full" onclick="addDialogue('${plannerState.selectedPageId}','${row.id}','${panel.id}')">+ Add Speaker Line</button>
  `;
}

// ── Export (separate from the generator's own export.js) ────────
function pln_buildExportRows() {
  const out = [];
  plannerState.pages.forEach(page => {
    page.rows.forEach(row => {
      row.panels.forEach(p => {
        const lh = `${p.l}x${row.maxH}`;
        const dialogues = p.dialogues.length ? p.dialogues : [{ speechType: '', speaker: '', dialogue: '' }];
        dialogues.forEach(d => {
          out.push([
            page.chp, p.scn || '', page.pg, p.pnl, row.row, lh, row.maxL, row.maxH,
            p.shotType || '', p.angleType || '', p.subjects || '', p.description || '',
            d.speechType || '', d.speaker || '', d.dialogue || '',
          ]);
        });
      });
    });
  });
  return out;
}

function exportPlannerCSV() {
  const dataRows = pln_buildExportRows();
  if (!dataRows.length) { window.showToast?.('No planner data to export yet'); return; }
  const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [PLN_HEADERS, ...dataRows].map(r => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'manga-planner.csv'; a.click();
  URL.revokeObjectURL(url);
  window.showToast?.('Planner exported as CSV ✓');
}
async function exportPlannerXLSX() {
  const dataRows = pln_buildExportRows();
  if (!dataRows.length) { window.showToast?.('No planner data to export yet'); return; }
  try {
    const loader = window.loadSheetJS;
    if (!loader) throw new Error('SheetJS loader unavailable');
    const XLSX = await loader();
    const aoa = [PLN_HEADERS, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planner');
    XLSX.writeFile(wb, 'manga-planner.xlsx');
    window.showToast?.('Planner exported as Excel ✓');
  } catch (_) {
    exportPlannerCSV();
  }
}
window.exportPlannerCSV = exportPlannerCSV;
window.exportPlannerXLSX = exportPlannerXLSX;

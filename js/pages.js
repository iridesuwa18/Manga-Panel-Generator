// ============================================================
// js/pages.js — Step 4
// Page settings (zone/flow/gutter), per-page list rendering for
// the Page Editor drawer tab (spec Section B, Row 2), PBP mode,
// page duplication, and the new createBlankPage() feature
// (spec Section E — previously unimplemented).
//
// Adaptations from the old monolith required by the new UI:
//   - rebuildPageList() now targets #pageList inside the Page
//     Editor drawer tab, not the old sidebar "Pages" tab.
//   - PBP mode (setPbpMode/navigateToPbpPage) is rewritten clean:
//     no #pbpNavBar, no #mobilePbpBar, no #mtab-pages, no emoji
//     labels (📄). The only DOM it touches is #canvasInner (for
//     the .pbp-mode/.pbp-active classes that drive which page is
//     visible) and the Page Editor drawer's own page selector
//     (#pageEditorPageSel), which ui.js builds.
//   - duplicatePage()'s bubble-copying step is guarded — js/
//     bubbles.js doesn't exist until Step 7, so `bubbles` may be
//     undefined this early; the guard makes it a safe no-op
//     until then rather than throwing.
//   - createBlankPage(side) is new, per spec Section E: adds a
//     page entry with zero panel rows but valid metadata, so it
//     shows up in getPages()/rebuildPageList() and generateAll()
//     renders it as a blank frame+safe-zone page.
// ============================================================

// ── Page settings bookkeeping ────────────────────────────
function refreshPageSettings() {
  getPages().forEach(({ pg }) => {
    if (!pageSettings[pg]) {
      pageSettings[pg] = { mode: 'safe', gutter: 12 };
    }
  });
  rebuildPageList();
}

// ── Page Editor drawer: per-page collapsible list ────────
// Renders into #pageList, which lives inside the Page Editor
// tab of the Pages & Panels drawer (Row 2). Safe no-op if the
// drawer hasn't been built yet (ui.js, Step 5).
function rebuildPageList() {
  const container = document.getElementById('pageList');
  if (!container) { syncPageSelects(); return; }

  const pages = getPages();
  const noPages = document.getElementById('noPages');
  if (noPages) noPages.style.display = pages.length ? 'none' : '';

  container.innerHTML = pages.map(({ pg, chp }) => {
    const pgNum = parseInt((pg.match(/\d+/) || [1])[0]);
    const isOdd = pgNum % 2 !== 0;
    const ps = pageSettings[pg] || { mode: 'safe', gutter: 12 };
    const panelCount = rows.filter(r => r.pg === pg && !r._blankPlaceholder).length;
    const safeId = pg.replace(/\s/g, '_');
    return `
    <div class="page-entry" id="pe-${safeId}">
      <div class="page-entry-head" onclick="document.getElementById('pe-${safeId}').classList.toggle('open')">
        <span>${chp} &middot; ${pg}</span>
        <span class="chip">${isOdd ? 'ODD' : 'EVEN'}</span>
        <span class="chip">${panelCount} panels</span>
        <button class="btn small" onclick="event.stopPropagation();duplicatePage('${pg}')" title="Duplicate page">Dup</button>
      </div>
      <div class="page-entry-body">
        <div class="field">
          <label>Zone</label>
          <select onchange="pageSettings['${pg}'].mode=this.value">
            <option value="safe" ${ps.mode === 'safe' ? 'selected' : ''}>Safe</option>
            <option value="frame" ${ps.mode === 'frame' ? 'selected' : ''}>Full Frame</option>
            <option value="random" ${ps.mode === 'random' ? 'selected' : ''}>Random</option>
          </select>
        </div>
        <div class="field">
          <label>Flow</label>
          <select onchange="pageSettings['${pg}'].flow=this.value">
            <option value="v-first" ${(ps.flow || 'v-first') === 'v-first' ? 'selected' : ''}>V-first</option>
            <option value="h-first" ${(ps.flow || 'v-first') === 'h-first' ? 'selected' : ''}>H-first</option>
          </select>
        </div>
        <div class="field">
          <label>Gutter</label>
          <input type="number" value="${ps.gutter}" min="0" max="200"
            onchange="pageSettings['${pg}'].gutter=+this.value">
        </div>
      </div>
    </div>`;
  }).join('');

  syncPageSelects();
}

// ── Keep the Page Editor's page selector + PBP nav selector
//    (if present) in sync with the current page list ────────
function syncPageSelects() {
  const pages = getPages();
  const opts = pages.map(({ pg, chp }) => `<option value="${pg}">${chp} &middot; ${pg}</option>`).join('');

  const editorSel = document.getElementById('pageEditorPageSel');
  if (editorSel) {
    editorSel.innerHTML = opts;
    if (_pbpCurrentPage) editorSel.value = _pbpCurrentPage;
  }

  // Panel/Bubble/Layer editor drawers (Steps 7) each keep their
  // own page selector; call their refresh hooks if they exist.
  window.refreshPanelsPanel?.(_pbpCurrentPage);
  window.refreshBubblePageSelect?.();
}

// ── Page-by-page mode ─────────────────────────────────────
// Replaces setPbpMode()/navigateToPbpPage() from the old
// monolith. Same behavior (show one page at a time, reset
// scroll, track current page) with all removed-DOM references
// stripped per spec Section D.
let _pbpCurrentPage = null;

function setPbpMode(enabled, targetPage) {
  pageBypageMode = enabled;
  const inner = document.getElementById('canvasInner');

  if (inner) {
    if (!enabled) {
      inner.classList.remove('pbp-mode');
      document.querySelectorAll('.page-thumb-wrap').forEach(w => w.classList.remove('pbp-active'));
      _pbpCurrentPage = null;
      panY = 0;
      window.applyCanvasTransform?.();
    } else {
      inner.classList.add('pbp-mode');
      const pages = getPages();
      if (pages.length) {
        const pg = targetPage || _pbpCurrentPage || pages[0].pg;
        navigateToPbpPage(pg);
      }
    }
  }

  // The Page Editor's Mode buttons (All Pages / Page-by-Page) and the
  // prev/next page nav both depend on pageBypageMode — refresh the
  // drawer tab in place (desktop or mobile, whichever is open) so the
  // change shows immediately instead of needing a close/reopen.
  window.refreshDrawerTabIfOpen?.('pages');
  window.refreshMobDrawerTab?.('pages');
}

function navigateToPbpPage(pg) {
  if (!pageBypageMode) return;
  _pbpCurrentPage = pg;

  panY = 0;
  window.applyCanvasTransform?.();

  document.querySelectorAll('.page-thumb-wrap').forEach(w => {
    const cont = w.querySelector('.page-output[data-pg]');
    w.classList.toggle('pbp-active', cont?.dataset.pg === pg);
  });

  const editorSel = document.getElementById('pageEditorPageSel');
  if (editorSel) editorSel.value = pg;
}

function pbpPrev() {
  const pages = getPages();
  if (!pages.length) return;
  const idx = pages.findIndex(p => p.pg === _pbpCurrentPage);
  const prev = pages[Math.max(0, idx - 1)];
  navigateToPbpPage(prev.pg);
}

function pbpNext() {
  const pages = getPages();
  if (!pages.length) return;
  const idx = pages.findIndex(p => p.pg === _pbpCurrentPage);
  const next = pages[Math.min(pages.length - 1, idx + 1)];
  navigateToPbpPage(next.pg);
}

// ── Duplicate page ────────────────────────────────────────
function duplicatePage(pg) {
  window.snapshotState?.();
  const pageRows = rows.filter(r => r.pg === pg);
  const pgNum = parseInt((pg.match(/\d+/) || [1])[0]);
  const newPg = pg.replace(/\d+/, String(pgNum) + 'b');
  const newRows = pageRows.map(r => ({ ...r, pg: newPg }));
  rows.push(...newRows);
  if (pageSettings[pg]) pageSettings[newPg] = { ...pageSettings[pg] };

  // Bubbles dict doesn't exist until js/bubbles.js (Step 7) —
  // guarded so duplicatePage() works correctly before then.
  if (typeof bubbles !== 'undefined' && bubbles[pg]) {
    bubbles[newPg] = bubbles[pg].map(b => ({
      ...JSON.parse(JSON.stringify(b)),
      id: 'b' + Date.now() + Math.random().toString(36).slice(2, 6)
    }));
  }

  renderTable();
  refreshPageSettings();
  window.generateAll?.();
  window.showToast?.(`Duplicated as "${newPg}" — rename PG column to finalise`);
}

// ── Create Blank Page (new feature, spec Section E) ──────
// Adds a page with valid metadata and zero panel rows. Since
// getPages()/computePanelRects() key off `rows`, a page with no
// rows never appears via the normal data flow — so a blank page
// is tracked separately in `pageSettings` with a `_blank: true`
// + `_side` flag, and generateAll() (Step 3, generate.js) must
// check for blank pages alongside getPages(). To keep this
// self-contained at Step 4 without touching generate.js again,
// blank pages are represented as a single placeholder row with
// 0% size — it occupies no visible space, satisfies getPages()'s
// "has at least one row" assumption, and lets per-page Zone/Flow/
// Gutter settings still apply normally if panels are added later.
function createBlankPage(side) {
  const isOdd = side === 'left';
  const pages = getPages();
  const existingNums = pages.map(p => parseInt((p.pg.match(/\d+/) || [0])[0]));
  let n = existingNums.length ? Math.max(...existingNums) + 1 : 1;
  // Match the page's odd/even-ness to the requested side.
  if (isOdd && n % 2 === 0) n += 1;
  if (!isOdd && n % 2 !== 0) n += 1;

  const pg = `PG ${n}`;
  const chp = pages.length ? pages[pages.length - 1].chp : 'CHP 1';

  rows.push({
    chp, scn: 'S1', pg, pnl: '', row: '',
    lh: '0x0', maxL: '100', maxH: '100', _blankPlaceholder: true
  });
  pageSettings[pg] = { mode: 'safe', gutter: 12 };

  renderTable();
  refreshPageSettings();
  window.generateAll?.();
  window.showToast?.(`Created blank ${side === 'left' ? 'left (odd)' : 'right (even)'} page "${pg}"`);
  return pg;
}

window.refreshPageSettings = refreshPageSettings;
window.rebuildPageList = rebuildPageList;
window.syncPageSelects = syncPageSelects;
window.setPbpMode = setPbpMode;
window.navigateToPbpPage = navigateToPbpPage;
window.pbpPrev = pbpPrev;
window.pbpNext = pbpNext;
window.duplicatePage = duplicatePage;
window.createBlankPage = createBlankPage;

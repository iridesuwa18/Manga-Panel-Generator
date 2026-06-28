// ============================================================
// js/text.js — Step 9
// Freeform text elements: inserted directly onto the page canvas,
// independent of speech bubbles. Spec Section B (Row 3, Text
// Editor tab) and Section E ("Text Editor (freeform text)" — was
// a stub; this implements createTextElement(opts) and wires it
// to real controls instead of leaving "Coming Soon").
//
// Deliberately simpler than bubbles.js: text elements are plain
// positioned/rotated <div> nodes (CSS, not SVG/foreignObject —
// simplest reliable rendering for editable text at canvas scale),
// with drag-to-move and a properties form, but no resize handles,
// no tail, no panel-clipping in this first pass. The data model
// and render/select pipeline are real, not placeholders, so v2
// features (resize, layers reorder, etc.) can build on top.
//
// Depends on: state.js (textElements, selectedTextElement, scale),
//   generate.js (getPages, PAGE_W, PAGE_H), undo.js (snapshotState),
//   ui.js (showToast), init.js (scheduleAutoSave).
// ============================================================

// ── Create a new text element ─────────────────────────────────
// opts: { pg, content, font, size, color, x, y, rotation }
// Any field not given falls back to a sane default. Returns the
// created text data object (already pushed into textElements[pg]
// and rendered).
function createTextElement(opts = {}) {
  const pg = opts.pg || (window.getPages?.()[0]?.pg);
  if (!pg) { window.showToast?.('No page to add text to — generate pages first'); return null; }

  const t = {
    id: 't' + Date.now() + Math.random().toString(36).slice(2, 6),
    content: opts.content || 'New text',
    font: opts.font || 'Inter, system-ui, sans-serif',
    size: opts.size || 48,
    color: opts.color || '#1a1a1a',
    x: opts.x ?? (PAGE_W / 2 - 200),
    y: opts.y ?? (PAGE_H / 2 - 30),
    rotation: opts.rotation || 0,
    zIndex: (textElements[pg]?.length || 0) + 1,
  };

  if (!textElements[pg]) textElements[pg] = [];
  textElements[pg].push(t);

  // NOTE: snapshotState() is called AFTER mutating, not before — this
  // matches the established convention elsewhere in the codebase (see
  // bpUpdate in bubbles.js). The undo stack must hold POST-edit states;
  // snapshotting before the mutation would mean undo() lands one step
  // too far back (on the state before this edit's "before" state),
  // skipping the edit it was supposed to undo to.
  window.snapshotState?.();

  renderTextElementsOnPage(pg);
  window.refreshLayersPanel?.(pg);
  window.scheduleAutoSave?.();
  window.showToast?.('Text element added');
  return t;
}
window.createTextElement = createTextElement;

// ── Render all text elements for a page ───────────────────────
function renderTextElementsOnPage(pg) {
  const containers = document.querySelectorAll('.page-output[data-pg]');
  for (const cont of containers) {
    if (cont.dataset.pg !== pg) continue;
    let overlay = cont.querySelector('.text-overlay');
    if (overlay) overlay.remove();
    const svgWrap = cont.querySelector('div[style*="transform-origin"]');
    overlay = document.createElement('div');
    overlay.className = 'text-overlay';
    overlay.style.cssText = `position:absolute;top:0;left:0;width:${PAGE_W}px;height:${PAGE_H}px;pointer-events:none;`;
    if (svgWrap) svgWrap.appendChild(overlay);
    else cont.appendChild(overlay);
    (textElements[pg] || []).forEach((t, i) => {
      t.zIndex = t.zIndex || (i + 1);
      overlay.appendChild(createTextEl(t, pg));
    });
    break;
  }
}
window.renderTextElementsOnPage = renderTextElementsOnPage;

function renderAllTextElements() {
  for (const pg of Object.keys(textElements)) renderTextElementsOnPage(pg);
}
window.renderAllTextElements = renderAllTextElements;

// ── Build a single text element's DOM node ────────────────────
function createTextEl(t, pgKey) {
  const wrap = document.createElement('div');
  wrap.className = 'text-wrap';
  wrap.dataset.id = t.id;
  wrap.dataset.pgKey = pgKey;
  applyTextStyle(wrap, t);
  wrap.textContent = t.content;
  setupTextDrag(wrap, t, pgKey);
  wrap.addEventListener('click', e => {
    e.stopPropagation();
    selectTextElement(wrap, t, pgKey);
  });
  return wrap;
}

function applyTextStyle(wrap, t) {
  wrap.style.cssText = `
    position:absolute; left:${t.x}px; top:${t.y}px;
    font-family:${t.font}; font-size:${t.size}px; color:${t.color};
    transform:rotate(${t.rotation}deg); transform-origin:top left;
    white-space:pre-wrap; cursor:move; pointer-events:all;
    user-select:none; touch-action:none; z-index:${t.zIndex || 1};
    padding:4px;
  `;
}
window.applyTextStyle = applyTextStyle;

// ── Drag to move ───────────────────────────────────────────────
function setupTextDrag(wrap, t, pgKey) {
  let ox = 0, oy = 0;
  wrap.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    wrap.setPointerCapture(e.pointerId);
    ox = e.clientX / scale - t.x;
    oy = e.clientY / scale - t.y;
    const onMove = ev => {
      t.x = ev.clientX / scale - ox;
      t.y = ev.clientY / scale - oy;
      wrap.style.left = t.x + 'px';
      wrap.style.top  = t.y + 'px';
    };
    const onUp = () => {
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerup', onUp);
      window.snapshotState?.();
      window.scheduleAutoSave?.();
      if (selectedTextElement?.data.id === t.id) syncTextEditorFields(t);
    };
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
  });
}

// ── Selection ─────────────────────────────────────────────────
function selectTextElement(el, data, pgKey) {
  document.querySelectorAll('.text-wrap.selected').forEach(w => w.classList.remove('selected'));
  el.classList.add('selected');
  applyTextStyle(el, data);
  selectedTextElement = { el, data, pgKey };
  window.selectedTextElement = selectedTextElement;

  const noSel  = document.getElementById('tp-nosel');
  const editor = document.getElementById('tp-editor');
  if (noSel)  noSel.style.display  = 'none';
  if (editor) editor.style.display = '';
  syncTextEditorFields(data);
}
window.selectTextElement = selectTextElement;

function deselectTextElement() {
  document.querySelectorAll('.text-wrap.selected').forEach(w => w.classList.remove('selected'));
  selectedTextElement = null;
  window.selectedTextElement = null;
  const noSel  = document.getElementById('tp-nosel');
  const editor = document.getElementById('tp-editor');
  if (noSel)  noSel.style.display  = '';
  if (editor) editor.style.display = 'none';
}
window.deselectTextElement = deselectTextElement;

function syncTextEditorFields(t) {
  const map = {
    'tp-content': t.content, 'tp-font': t.font, 'tp-size': t.size,
    'tp-color': t.color, 'tp-x': Math.round(t.x), 'tp-y': Math.round(t.y),
    'tp-rotation': t.rotation,
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
}

// ── Editor form → data updates ─────────────────────────────────
function tpUpdate(field, value) {
  const sel = selectedTextElement;
  if (!sel) return;
  sel.data[field] = value;
  if (field === 'content') sel.el.textContent = value;
  else applyTextStyle(sel.el, sel.data);
  // Snapshot AFTER mutating — see note in createTextElement().
  window.snapshotState?.();
  window.scheduleAutoSave?.();
}
window.tpUpdate = tpUpdate;

function tpUpdatePos() {
  const sel = selectedTextElement;
  if (!sel) return;
  const x = +document.getElementById('tp-x')?.value;
  const y = +document.getElementById('tp-y')?.value;
  const rot = +document.getElementById('tp-rotation')?.value;
  if (!isNaN(x)) sel.data.x = x;
  if (!isNaN(y)) sel.data.y = y;
  if (!isNaN(rot)) sel.data.rotation = rot;
  applyTextStyle(sel.el, sel.data);
  // Snapshot AFTER mutating — see note in createTextElement().
  window.snapshotState?.();
  window.scheduleAutoSave?.();
}
window.tpUpdatePos = tpUpdatePos;

// ── Delete / list management ───────────────────────────────────
function deleteSelectedTextElement() {
  const sel = selectedTextElement;
  if (!sel) return;
  textElements[sel.pgKey] = (textElements[sel.pgKey] || []).filter(t => t.id !== sel.data.id);
  sel.el.remove();
  deselectTextElement();
  // Snapshot AFTER mutating — see note in createTextElement().
  window.snapshotState?.();
  window.refreshLayersPanel?.(sel.pgKey);
  window.scheduleAutoSave?.();
  window.showToast?.('Text element deleted');
}
window.deleteSelectedTextElement = deleteSelectedTextElement;

function deleteTextElementById(pgKey, id) {
  textElements[pgKey] = (textElements[pgKey] || []).filter(t => t.id !== id);
  if (selectedTextElement?.data.id === id) deselectTextElement();
  renderTextElementsOnPage(pgKey);
  // Snapshot AFTER mutating — see note in createTextElement().
  window.snapshotState?.();
  window.refreshLayersPanel?.(pgKey);
  window.scheduleAutoSave?.();
}
window.deleteTextElementById = deleteTextElementById;

function selectTextElementById(pg, id) {
  const containers = document.querySelectorAll('.page-output[data-pg]');
  for (const cont of containers) {
    if (cont.dataset.pg !== pg) continue;
    const el = cont.querySelector(`.text-wrap[data-id="${id}"]`);
    const t  = (textElements[pg] || []).find(t => t.id === id);
    if (el && t) selectTextElement(el, t, pg);
    break;
  }
}
window.selectTextElementById = selectTextElementById;

// ── List of existing text elements (rendered into the Text
//    Editor drawer tab below the create/edit form) ────────────
function refreshTextElementList(pg) {
  const body = document.getElementById('textElementListBody');
  if (!body) return;
  const items = textElements[pg] || [];
  if (!items.length) {
    body.innerHTML = '<div style="color:var(--text-3);font-size:var(--type-sm);">No text elements on this page.</div>';
    return;
  }
  body.innerHTML = items.map(t => {
    const label = (t.content || '').slice(0, 28) + (t.content && t.content.length > 28 ? '…' : '');
    const isSel = selectedTextElement?.data.id === t.id;
    return `<div class="layer-row ${isSel ? 'active' : ''}" data-id="${t.id}"
        onclick="selectTextElementById('${pg}','${t.id}')">
      <span class="layer-label" style="flex:1;font-size:var(--type-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label || '(empty)'}</span>
      <div class="layer-btns" style="flex-shrink:0;display:flex;gap:1px;">
        <button title="Delete" onclick="event.stopPropagation();deleteTextElementById('${pg}','${t.id}')">&times;</button>
      </div>
    </div>`;
  }).join('');
}
window.refreshTextElementList = refreshTextElementList;

// ============================================================
// js/init.js — Step 8
// DOMContentLoaded bootstrap, global keyboard shortcuts, and the
// autosave WRITE side (the read/restore side — restoreAutoSave() —
// already lives in js/export.js from Step 6).
//
// Per spec Implementation Note #3: autosave must survive the
// refactor. init.js loads/seeds state on boot; generate.js calls
// scheduleAutoSave() after each generation (one extra line added
// there, see bottom of this file's comments) and the pointer-
// gesture interceptor in undo.js also calls scheduleAutoSave()
// after any committed drag/resize gesture.
//
// Depends on: state.js, undo.js (seedUndoStack, undo, redo),
//   export.js (buildSaveData, restoreSaveData, restoreAutoSave),
//   generate.js (generateAll), bubbles.js (selectedBubble,
//   deleteSelectedBubble, duplicateBubbleById), ui.js (showToast,
//   updateUndoRowLabel), canvas.js (applyCanvasTransform).
// ============================================================

// ── AUTO-SAVE TO LOCALSTORAGE (write side) ──────────────────────
// Read/restore side (restoreAutoSave) already exists in export.js.
let _autoSaveTimer = null;
let _lastAutoSave = null;

function scheduleAutoSave() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(doAutoSave, 30000); // 30s after last change
}

function doAutoSave() {
  try {
    const data = JSON.stringify(window.buildSaveData ? window.buildSaveData() : {});
    localStorage.setItem('mpg_autosave', data);
    _lastAutoSave = new Date();
    updateAutoSaveLabel();
  } catch (_) { /* storage full or unavailable */ }
}

function updateAutoSaveLabel() {
  const el = document.getElementById('autosaveLabel');
  if (!el || !_lastAutoSave) return;
  const mins = Math.round((Date.now() - _lastAutoSave) / 60000);
  el.textContent = mins < 1 ? 'Auto-saved just now' : `Auto-saved ${mins}m ago`;
}

// Refresh the label text once a minute so "just now" ages correctly
// without needing a new save event.
setInterval(updateAutoSaveLabel, 60000);

window.scheduleAutoSave = scheduleAutoSave;
window.doAutoSave       = doAutoSave;

// ── KEYBOARD SHORTCUTS ───────────────────────────────────────────
// Reset View (Ctrl/Cmd+0) is already handled inside canvas.js.
// Everything else lives here.
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — undo/redo (always active, even while typing)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault(); window.undo?.(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault(); window.redo?.(); return;
  }

  // Ctrl+S — quick save (opens GitHub save drawer/modal, same as before)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault(); window.saveToGitHub?.(); return;
  }

  if (typing) return; // remaining shortcuts don't fire while typing in a field

  // Delete / Backspace — delete selected bubble or text element
  // NOTE: selectedBubble / selectedTextElement are `let` in state.js,
  // reassigned by bubbles.js / text.js. Unlike function declarations,
  // `let` bindings don't attach to `window` across <script> tags — so
  // this reads the bare identifiers, not window.selectedBubble (which
  // would always read undefined).
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedBubble) {
      window.snapshotState?.();
      window.deleteSelectedBubble?.();
      window.scheduleAutoSave?.();
    } else if (selectedTextElement) {
      window.deleteSelectedTextElement?.();
    }
    return;
  }

  // Escape — deselect the active bubble or text element
  if (e.key === 'Escape') {
    window.deselectBubble?.();
    window.deselectTextElement?.();
    return;
  }

  // Ctrl+D — duplicate selected bubble
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    if (selectedBubble) {
      window.duplicateBubbleById?.(selectedBubble.pgKey, selectedBubble.data.id);
    }
    return;
  }

  // Arrow keys — nudge selected bubble or text element (1px; Shift = 10px)
  if (selectedBubble && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const b = selectedBubble.data;
    if (e.key === 'ArrowLeft')  b.x -= step;
    if (e.key === 'ArrowRight') b.x += step;
    if (e.key === 'ArrowUp')    b.y -= step;
    if (e.key === 'ArrowDown')  b.y += step;
    window.applyBubble?.(b, selectedBubble.el, selectedBubble.pgKey);
    window.scheduleAutoSave?.();
    return;
  }
  if (selectedTextElement && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const t = selectedTextElement.data;
    if (e.key === 'ArrowLeft')  t.x -= step;
    if (e.key === 'ArrowRight') t.x += step;
    if (e.key === 'ArrowUp')    t.y -= step;
    if (e.key === 'ArrowDown')  t.y += step;
    window.applyTextStyle?.(selectedTextElement.el, t);
    window.scheduleAutoSave?.();
    return;
  }

  // G — generate all
  if (e.key === 'g') { window.generateAll?.(); return; }
});

// ── BOOTSTRAP ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Seed the undo stack with the initial (empty or freshly-loaded) state.
  window.seedUndoStack?.();

  // Surface a hint if a previous autosave exists, so it isn't silently lost.
  if (localStorage.getItem('mpg_autosave')) {
    window.showToast?.('Autosave found — open EXPORT → JSON → Restore Autosave to recover');
  }

  // Make sure the canvas/drawer reflect whatever state.js started with.
  window.renderTable?.();
  window.refreshPageSettings?.();
  window.resetCanvasView?.();
  window.updateUndoRowLabel?.();
});

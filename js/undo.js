// ============================================================
// js/undo.js — Step 8
// Undo/redo history + the global pointer-gesture interceptor.
//
// Adapted (not ported verbatim) from Old_index.html's "temp JSON"
// undo system. The old monolith used two arrays — undoStack +
// a separate redoStack — built by push/pop. Step 5 (js/ui.js) and
// js/state.js were already written against a SINGLE undoStack +
// an undoPtr index instead (window.undoPtr, window.undoStack.length
// are read directly by ui.js's updateUndoRowLabel()), so this file
// implements that pointer model rather than reintroducing redoStack.
//
//   undoStack[undoPtr] === the snapshot currently on screen.
//   undo() moves the pointer back one slot and applies it.
//   redo() moves the pointer forward one slot and applies it.
//   Any new mutation truncates everything after undoPtr before
//   pushing, which is the standard "redo is invalidated by a new
//   edit" behaviour the old redoStack also had (redoStack = []
//   on every snapshotState()/gesture-end).
//
// Depends on: state.js (rows, pageSettings, bubbles, panelOverrides,
//   cornerOffsets, cornerLocks, cornerAxisMode, cornerEnabled,
//   splitOffsets, splitLocks, undoStack, undoPtr), data.js
//   (renderTable), pages.js (refreshPageSettings), generate.js
//   (generateAll), ui.js (showToast, updateUndoRowLabel).
// ============================================================

// ── window sync for undoStack / undoPtr ──────────────────────────
// state.js declares these with `let`, which (unlike `var`) does NOT
// create a property on `window` in classic <script> tags. js/ui.js
// reads them as window.undoPtr / window.undoStack.length (see its
// updateUndoRowLabel()), so every reassignment in this file must be
// mirrored onto window or that check silently always sees undefined.
function _syncUndoWindowRefs() {
  window.undoStack = undoStack;
  window.undoPtr = undoPtr;
}

const UNDO_MAX = 60;
let _undoPaused = false;

// The one function that knows what "all mutable state" means.
// Returns a plain object — same shape as the save-file JSON
// (export.js's buildSaveData/restoreSaveData cover the rest of
// the save format; this only needs the fields that change during
// normal editing and that undo/redo must roll back).
function _cloneState() {
  return structuredClone({
    rows,
    pageSettings,
    bubbles,
    textElements,
    panelOverrides,
    cornerOffsets,
    cornerLocks,
    cornerAxisMode,
    cornerEnabled,
    splitOffsets,
    splitLocks,
  });
}

// Restore every state field from a plain object snapshot.
function _applyStateObj(d) {
  rows = d.rows || [];
  pageSettings = d.pageSettings || {};
  Object.keys(bubbles).forEach(k => delete bubbles[k]);
  Object.assign(bubbles, d.bubbles || {});
  Object.keys(textElements).forEach(k => delete textElements[k]);
  Object.assign(textElements, d.textElements || {});
  Object.keys(panelOverrides).forEach(k => delete panelOverrides[k]);
  Object.assign(panelOverrides, d.panelOverrides || {});
  Object.keys(cornerOffsets).forEach(k => delete cornerOffsets[k]);
  Object.assign(cornerOffsets, d.cornerOffsets || {});
  Object.keys(cornerLocks).forEach(k => delete cornerLocks[k]);
  Object.assign(cornerLocks, d.cornerLocks || {});
  Object.keys(cornerAxisMode).forEach(k => delete cornerAxisMode[k]);
  Object.assign(cornerAxisMode, d.cornerAxisMode || {});
  Object.keys(cornerEnabled).forEach(k => delete cornerEnabled[k]);
  Object.assign(cornerEnabled, d.cornerEnabled || {});
  Object.keys(splitOffsets).forEach(k => delete splitOffsets[k]);
  Object.assign(splitOffsets, d.splitOffsets || {});
  Object.keys(splitLocks).forEach(k => delete splitLocks[k]);
  Object.assign(splitLocks, d.splitLocks || {});
}

// Call this after any programmatic mutation (import, delete, type
// change…). Idempotent — calling it twice with no real state change
// is a no-op. Truncates any redo history past the current pointer.
function snapshotState() {
  if (_undoPaused) return;
  const snap = _cloneState();

  if (undoStack.length && undoPtr >= 0) {
    const prev = JSON.stringify(undoStack[undoPtr]);
    const cur  = JSON.stringify(snap);
    if (prev === cur) return;
  }

  // Drop any redo entries beyond the current pointer — a new edit
  // invalidates the redo branch, same as the old redoStack = [] reset.
  undoStack = undoStack.slice(0, undoPtr + 1);

  undoStack.push(snap);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  undoPtr = undoStack.length - 1;

  _syncUndoWindowRefs();
  window.updateUndoRowLabel?.();
}

function applySnapshot(snap) {
  _undoPaused = true;
  _applyStateObj(snap);
  window.renderTable?.();
  window.refreshPageSettings?.();
  window.generateAll?.();
  _undoPaused = false;
}

function undo() {
  if (undoPtr <= 0) { window.showToast?.('Nothing to undo'); return; }
  undoPtr -= 1;
  _syncUndoWindowRefs();
  applySnapshot(undoStack[undoPtr]);
  window.updateUndoRowLabel?.();
  window.showToast?.('Undo ↩');
}

function redo() {
  if (undoPtr >= undoStack.length - 1) { window.showToast?.('Nothing to redo'); return; }
  undoPtr += 1;
  _syncUndoWindowRefs();
  applySnapshot(undoStack[undoPtr]);
  window.updateUndoRowLabel?.();
  window.showToast?.('Redo ↪');
}

// Seeds the stack with the current (initial) state. Called once
// from init.js on boot, before any user edits exist, so undo/redo
// always has a baseline to fall back to.
function seedUndoStack() {
  undoStack = [_cloneState()];
  undoPtr = 0;
  _syncUndoWindowRefs();
  window.updateUndoRowLabel?.();
}

// ── GLOBAL POINTER GESTURE INTERCEPTOR ──────────────────────────
// Captures a "before" snapshot automatically on every pointer
// gesture start, then commits it to the undo stack if state
// actually changed by gesture end. Covers drag / resize / rotate /
// tail-drag / corner-drag — and any future pointer-based feature —
// with zero per-handler wiring required elsewhere.
{
  let _preSnap = null;

  document.addEventListener('pointerdown', () => {
    if (_undoPaused) return;
    _preSnap = _cloneState();
  }, { capture: true });

  function _onGestureEnd() {
    if (_undoPaused || _preSnap === null) return;
    const preStr   = JSON.stringify(_preSnap);
    const afterStr = JSON.stringify(_cloneState());
    if (afterStr !== preStr) {
      // Only push the "before" snapshot if it's not already what's
      // sitting at the current pointer (avoids duplicate entries
      // when snapshotState() already ran earlier in the same gesture).
      if (undoPtr < 0 || JSON.stringify(undoStack[undoPtr]) !== preStr) {
        undoStack = undoStack.slice(0, undoPtr + 1);
        undoStack.push(_preSnap);
        if (undoStack.length > UNDO_MAX) undoStack.shift();
        undoPtr = undoStack.length - 1;
      }
      // The "after" state becomes the new current entry.
      undoStack.push(JSON.parse(afterStr));
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      undoPtr = undoStack.length - 1;

      _syncUndoWindowRefs();
      window.updateUndoRowLabel?.();
      window.scheduleAutoSave?.();
    }
    _preSnap = null;
  }

  document.addEventListener('pointerup',     _onGestureEnd, { capture: true });
  document.addEventListener('pointercancel', _onGestureEnd, { capture: true });
}

window.snapshotState  = snapshotState;
window.applySnapshot  = applySnapshot;
window.undo           = undo;
window.redo           = redo;
window.seedUndoStack  = seedUndoStack;

// ============================================================
// js/state.js — global constants & app state.
// Panel geometry math (PAGE_W, getDrawX, getSafeRect, etc.) has
// moved to js/generate.js as of Step 3, per spec Implementation
// Note #2 — it is correct and tested and stays there unchanged.
// ============================================================

// ── Diagnostic: surface uncaught errors on-screen ─────────────
// Loaded first so it catches errors thrown by any later script.
// Shows a small dismissible banner (not a toast — toasts auto-hide
// in ~2s, too fast to read or screenshot) with a Copy button, so a
// real error message can actually be reported instead of guessing
// from symptoms alone.
(function () {
  let lastMsg = '', lastTime = 0;

  function showErrorBanner(msg) {
    const now = Date.now();
    if (msg === lastMsg && now - lastTime < 4000) return; // dedupe rapid repeats
    lastMsg = msg; lastTime = now;

    let bar = document.getElementById('_errBanner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = '_errBanner';
      bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;'
        + 'background:#3a1010;color:#ffdada;border:1px solid #a33;border-radius:6px;'
        + 'padding:10px 12px;font:12px/1.4 monospace;max-height:40vh;overflow-y:auto;'
        + 'white-space:pre-wrap;word-break:break-word;';
      document.body.appendChild(bar);
    }
    bar.innerHTML = '';
    const text = document.createElement('div');
    text.textContent = msg;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = 'padding:4px 10px;';
    copyBtn.onclick = () => { navigator.clipboard?.writeText(msg).catch(() => {}); copyBtn.textContent = 'Copied!'; };
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Dismiss';
    closeBtn.style.cssText = 'padding:4px 10px;';
    closeBtn.onclick = () => bar.remove();
    row.appendChild(copyBtn);
    row.appendChild(closeBtn);
    bar.appendChild(text);
    bar.appendChild(row);
  }

  window.addEventListener('error', (e) => {
    const msg = `${e.message}\n${(e.filename || '').split('/').pop() || ''}:${e.lineno}:${e.colno}`;
    console.error('Uncaught error:', e.error || e.message);
    showErrorBanner(msg);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = 'Unhandled promise rejection: ' + (e.reason?.message || e.reason || 'unknown');
    console.error(msg, e.reason);
    showErrorBanner(msg);
  });
})();


// ── App state ────────────────────────────────────────────
let rows = [];          // raw panel data rows
let pageSettings = {};  // keyed by pageKey "PG X"
let scale = 0.18;       // canvas zoom level (replaces desktop/mobile dual default —
                         // single value now, adjusted via Ctrl+scroll/pinch only)
let panX = 0, panY = 0; // canvas pan offset, applied via #canvasInner transform

let pageBypageMode = false;
let snapEnabled = false;

let activeRow = null;   // currently open rail row id, or null
let activeDrawerTab = {}; // keyed by row id -> active tab id

let undoStack = [];
let undoPtr = -1;

let selectedLayerId = null; // currently selected layer (panel/bubble/text)

// ── Panel rendering / editing state (read by js/generate.js,
//    written by js/panels.js — Step 7). Declared here now so
//    generate.js has somewhere to read from before panels.js
//    exists, per spec Implementation Note #1 (move verbatim,
//    adjust only global references). ──────────────────────────
let panelFillColor = '#f0ede6';
let panelStrokeColor = '#1a1a1a';
let panelStrokeWidth = 8;

const _lastPanelRects = {};          // [pg] -> last computed panel rects, used for snapping
const _lastBaseRects  = {};          // [pg] -> pre-override rects, used by panel editor
const panelOverrides  = {};          // panelOverrides[pg][idx] = {x,y,w,h,visible,locked}
const cornerOffsets   = {};          // cornerOffsets[pg][idx] = {tl,tr,bl,br,tlY,trY,blY,brY}
const cornerEditMode  = {};          // cornerEditMode[pg] = true/false
const cornerLocks     = {};          // cornerLocks[pg][idx] = {tl,tr,bl,br} booleans
const cornerAxisMode  = {};          // cornerAxisMode[pg][idx] = 'free'|'h'|'v'
const cornerEnabled   = {};          // cornerEnabled[pg][idx] = true/false (are offsets applied?)
const splitOffsets    = {};          // splitOffsets[pg][idx][splitIdx] = {aX,aY,bX,bY} — px offsets for each split endpoint
const splitLocks      = {};          // splitLocks[pg][idx] = {all} — lock all splits for panel

// ── Bubble state (populated by bubbles.js) ──────────────────
const bubbles = {};          // bubbles[pgKey] = [bubbleData, ...]
let selectedBubble = null;   // { el, data, pgKey } — set by bubbles.js

// ── Freeform text state (populated by text.js — Step 9) ──────
const textElements = {};     // textElements[pgKey] = [textData, ...]
let selectedTextElement = null; // { el, data, pgKey } — set by text.js

// ── Single isMobile utility (replaces dual mobile/desktop code paths) ──
const isMobile = () => window.innerWidth < 600;

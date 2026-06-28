// ============================================================
// js/state.js — global constants & app state.
// Panel geometry math (PAGE_W, getDrawX, getSafeRect, etc.) has
// moved to js/generate.js as of Step 3, per spec Implementation
// Note #2 — it is correct and tested and stays there unchanged.
// ============================================================


// ── App state ────────────────────────────────────────────
let rows = [];          // raw panel data rows
let pageSettings = {};  // keyed by pageKey "PG X"
let scale = 0.06;       // canvas zoom level (replaces desktop/mobile dual default —
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

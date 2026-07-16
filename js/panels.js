// ============================================================
// js/panels.js — Step 7
// Panel editor: per-panel position/size overrides, corner offsets,
// split lines, visibility/lock toggles, layout lock (bake).
//
// All functions ported verbatim from Old_index.html.
// The old floating #panelsPanel div is gone — these functions
// now render into #panelEditorBody inside the drawer (ui.js
// calls refreshPanelsPanel(pg) via afterDrawerRender).
//
// Depends on: state.js, generate.js (rerenderPageSVG,
//   refreshCornerOverlay, rebuildPageSVG), undo.js
//   (snapshotState, scheduleAutoSave), ui.js (showToast),
//   pages.js (rebuildPageList)
// ============================================================

// ── Helper: ensure override entry exists ─────────────────────
function ppEnsure(pg, idx) {
  if (!panelOverrides[pg]) panelOverrides[pg] = {};
  if (!panelOverrides[pg][idx]) panelOverrides[pg][idx] = {};
}

// ── Per-panel setters ─────────────────────────────────────────
function ppSet(pg, idx, field, val) {
  ppEnsure(pg, idx);
  if (panelOverrides[pg][idx].locked) return;
  panelOverrides[pg][idx][field] = val;
  rerenderPageSVG(pg);
  refreshPanelsPanel(pg);
  scheduleAutoSave?.();
}
window.ppSet = ppSet;

function ppToggleVisible(pg, idx) {
  ppEnsure(pg, idx);
  const cur = panelOverrides[pg][idx].visible;
  panelOverrides[pg][idx].visible = (cur === false) ? true : false;
  rerenderPageSVG(pg);
  refreshPanelsPanel(pg);
  scheduleAutoSave?.();
}
window.ppToggleVisible = ppToggleVisible;

function ppToggleLock(pg, idx) {
  ppEnsure(pg, idx);
  panelOverrides[pg][idx].locked = !panelOverrides[pg][idx].locked;
  refreshPanelsPanel(pg);
}
window.ppToggleLock = ppToggleLock;

function ppReset(pg, idx) {
  if (!panelOverrides[pg]) return;
  const locked = panelOverrides[pg][idx]?.locked;
  delete panelOverrides[pg][idx];
  if (locked) { ppEnsure(pg, idx); panelOverrides[pg][idx].locked = true; }
  rerenderPageSVG(pg);
  refreshPanelsPanel(pg);
  scheduleAutoSave?.();
}
window.ppReset = ppReset;

function ppResetAll(pg) {
  if (!pg) return;
  delete panelOverrides[pg];
  rerenderPageSVG(pg);
  refreshPanelsPanel(pg);
  scheduleAutoSave?.();
  showToast?.(`All panel overrides reset for ${pg}`);
}
window.ppResetAll = ppResetAll;

// ── Layout lock (bake positions so Generate won't re-roll) ────
function lockAllPanels(pg) {
  const base = _lastBaseRects[pg];
  if (!base?.length) { showToast?.('Generate pages first!'); return; }
  if (!panelOverrides[pg]) panelOverrides[pg] = {};
  const ovs = panelOverrides[pg];
  const finalRects = base.map((r, idx) => {
    const ov = ovs[idx] || {};
    return { ...r, x: ov.x !== undefined ? ov.x : r.x, y: ov.y !== undefined ? ov.y : r.y, w: ov.w !== undefined ? ov.w : r.w, h: ov.h !== undefined ? ov.h : r.h };
  });
  panelOverrides[pg]._lockedRects = finalRects;
  finalRects.forEach((r, idx) => { if (!ovs[idx]) ovs[idx] = {}; Object.assign(ovs[idx], { x: r.x, y: r.y, w: r.w, h: r.h, locked: true }); });
  _lastBaseRects[pg] = finalRects;
  refreshPanelsPanel(pg);
  rebuildPageList?.();
  scheduleAutoSave?.();
  showToast?.(`Layout locked for ${pg}`);
}
window.lockAllPanels = lockAllPanels;

function unlockAllPanels(pg) {
  if (panelOverrides[pg]) delete panelOverrides[pg]._lockedRects;
  refreshPanelsPanel(pg);
  scheduleAutoSave?.();
  showToast?.(`Layout unlocked for ${pg}`);
}
window.unlockAllPanels = unlockAllPanels;

function ppToggleLockAll() {
  const pg = document.getElementById('panelEditorPageSel')?.value; if (!pg) return;
  if (panelOverrides[pg]?._lockedRects) unlockAllPanels(pg);
  else lockAllPanels(pg);
  syncLockBtn(pg);
}
window.ppToggleLockAll = ppToggleLockAll;

function syncLockBtn(pg) {
  const btn = document.getElementById('pp-lock-btn'); if (!btn) return;
  const isLocked = !!(panelOverrides[pg]?._lockedRects);
  btn.textContent = isLocked ? 'Locked' : 'Lock Layout';
  btn.style.borderColor = isLocked ? 'var(--danger)' : '';
  btn.style.color = isLocked ? 'var(--danger)' : '';
}

// ── Corner system ─────────────────────────────────────────────
const CORNER_META = {
  tl: { label: 'TL', tip: 'Top-Left' },
  tr: { label: 'TR', tip: 'Top-Right' },
  bl: { label: 'BL', tip: 'Bottom-Left' },
  br: { label: 'BR', tip: 'Bottom-Right' },
};

function ppCornerHTML(pg, idx) {
  const co   = (cornerOffsets[pg] || {})[idx] || {};
  const lk   = (cornerLocks[pg]   || {})[idx] || {};
  const axis = (cornerAxisMode[pg]|| {})[idx] || 'free';
  const ena  = (cornerEnabled[pg] || {})[idx];
  const anySet = ['tl','tr','bl','br'].some(k => co[k] || co[k+'Y']);
  const isEnabled = ena === true || (ena === undefined && anySet);
  const allLocked = ['tl','tr','bl','br'].every(k => !!lk[k]);

  const cornerInput = (key) => {
    const xVal = Math.round(co[key]||0), yVal = Math.round(co[key+'Y']||0);
    const { label } = CORNER_META[key];
    const disabled = allLocked ? 'disabled' : '';
    const showX = axis === 'free' || axis === 'v';
    const showY = axis === 'free' || axis === 'h';
    let inp = `<div style="background:var(--surface-3);border:1px solid var(--border);border-radius:3px;padding:4px 6px;opacity:${allLocked?0.5:1};">`;
    inp += `<div style="font-size:10px;color:var(--accent);font-family:'IBM Plex Mono',monospace;margin-bottom:3px;">${label}</div>`;
    if (showX) inp += `<div style="display:flex;align-items:center;gap:3px;${showY?'margin-bottom:2px;':''}"><span style="font-size:9px;color:var(--text-3);width:10px;">&#8596;</span><input type="number" value="${xVal}" ${disabled} style="flex:1;min-width:0;background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:2px 3px;font-size:10px;border-radius:2px;font-family:'IBM Plex Mono',monospace;" onchange="setCornerOffset('${pg}',${idx},'${key}',+this.value)"></div>`;
    if (showY) inp += `<div style="display:flex;align-items:center;gap:3px;"><span style="font-size:9px;color:var(--text-3);width:10px;">&#8597;</span><input type="number" value="${yVal}" ${disabled} style="flex:1;min-width:0;background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:2px 3px;font-size:10px;border-radius:2px;font-family:'IBM Plex Mono',monospace;" onchange="setCornerOffset('${pg}',${idx},'${key+'Y'}',+this.value)"></div>`;
    inp += `</div>`;
    return inp;
  };

  let html = `<div style="margin-top:6px;border-top:1px solid var(--border);padding-top:5px;">`;
  html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:${isEnabled?'6':'0'}px;">`;
  html += `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;flex:1;"><input type="checkbox" ${isEnabled?'checked':''} style="accent-color:var(--accent);" onchange="ppToggleCornersEnabled('${pg}',${idx},this.checked)"><span style="font-size:9px;color:var(--text-3);font-family:'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:0.5px;">Edit Corners</span>${anySet?`<span style="font-size:8px;background:var(--accent);color:var(--ink);border-radius:2px;padding:0 3px;font-family:'IBM Plex Mono',monospace;">active</span>`:''}</label>`;
  html += `<button onclick="ppToggleCornersLocked('${pg}',${idx})" style="background:none;border:1px solid ${allLocked?'var(--danger)':'var(--border)'};border-radius:3px;cursor:pointer;font-size:10px;padding:1px 6px;color:${allLocked?'var(--danger)':'var(--text-3)'};">${allLocked?'&#128274;':'&#128275;'}</button>`;
  if (anySet) html += `<button onclick="resetCorners('${pg}',${idx})" style="background:none;border:1px solid var(--border);border-radius:2px;cursor:pointer;font-size:9px;color:var(--text-3);padding:1px 5px;">&#8634;</button>`;
  html += `</div>`;
  if (isEnabled) {
    html += `<div style="display:flex;gap:3px;margin-bottom:5px;"><span style="font-size:9px;color:var(--text-3);align-self:center;margin-right:3px;">Axis:</span>`;
    ['free','h','v'].forEach(m => { const label=m==='free'?'Free':m==='h'?'H (&#8597; only)':'V (&#8596; only)'; html+=`<button onclick="ppSetCornerAxis('${pg}',${idx},'${m}')" style="padding:2px 6px;font-size:9px;border-radius:2px;border:1px solid ${axis===m?'var(--accent)':'var(--border)'};background:${axis===m?'var(--accent)':'var(--surface-2)'};color:${axis===m?'var(--ink)':'var(--text-2)'};cursor:pointer;font-family:'IBM Plex Mono',monospace;">${label}</button>`; });
    html += `</div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">${cornerInput('tl')+cornerInput('tr')+cornerInput('bl')+cornerInput('br')}</div>`;
  }
  html += `</div>`;
  return html;
}
window.ppCornerHTML = ppCornerHTML;

function ppToggleCornersEnabled(pg, idx, enabled) {
  if (!cornerEnabled[pg]) cornerEnabled[pg] = {};
  cornerEnabled[pg][idx] = enabled;
  const anyEnabled = Object.values(cornerEnabled[pg]||{}).some(v=>v===true);
  cornerEditMode[pg] = anyEnabled;
  rebuildPageSVG?.(pg); refreshCornerOverlay?.(pg);
  refreshPanelsPanel(pg);
  scheduleAutoSave?.();
}
window.ppToggleCornersEnabled = ppToggleCornersEnabled;

function ppToggleCornersLocked(pg, idx) {
  if (!cornerLocks[pg]) cornerLocks[pg] = {};
  if (!cornerLocks[pg][idx]) cornerLocks[pg][idx] = {};
  const allLocked = ['tl','tr','bl','br'].every(k=>!!cornerLocks[pg][idx][k]);
  ['tl','tr','bl','br'].forEach(k => { cornerLocks[pg][idx][k] = !allLocked; });
  refreshCornerOverlay?.(pg); refreshPanelsPanel(pg);
}
window.ppToggleCornersLocked = ppToggleCornersLocked;

function ppSetCornerAxis(pg, idx, mode) {
  if (!cornerAxisMode[pg]) cornerAxisMode[pg] = {};
  cornerAxisMode[pg][idx] = mode;
  refreshCornerOverlay?.(pg); refreshPanelsPanel(pg);
}
window.ppSetCornerAxis = ppSetCornerAxis;
window.ppToggleCornersOpen = (pg, idx, open) => ppToggleCornersEnabled(pg, idx, open); // legacy compat

// ── Split system ──────────────────────────────────────────────
function _getSplitsArr(pg, idx) {
  const _ovEntry = (panelOverrides[pg]||{})[idx] || {};
  if (_ovEntry.split && !_ovEntry.splits) {
    ppEnsure(pg, idx); panelOverrides[pg][idx].splits = [_ovEntry.split]; delete panelOverrides[pg][idx].split;
    const oldSo = splitOffsets[pg]?.[idx];
    if (oldSo && !Array.isArray(oldSo) && typeof oldSo==='object' && ('aX' in oldSo||'aY' in oldSo||'bX' in oldSo||'bY' in oldSo)) splitOffsets[pg][idx]={0:oldSo};
  }
  return panelOverrides[pg]?.[idx]?.splits || [];
}

function ppAddSplit(pg, idx) {
  ppEnsure(pg, idx); _getSplitsArr(pg, idx);
  if (!panelOverrides[pg][idx].splits) panelOverrides[pg][idx].splits = [];
  const existing = panelOverrides[pg][idx].splits.length;
  panelOverrides[pg][idx].splits.push({ dir:'h', pos: existing===0?50:Math.round(100/(existing+1)), gap:0, style:'line' });
  delete panelOverrides[pg][idx].split;
  rerenderPageSVG(pg); refreshCornerOverlay?.(pg); refreshPanelsPanel(pg); scheduleAutoSave?.();
}
window.ppAddSplit = ppAddSplit;

function ppRemoveSplit(pg, idx, splitIdx) {
  ppEnsure(pg, idx); _getSplitsArr(pg, idx);
  const arr = panelOverrides[pg][idx].splits; if (!arr) return;
  arr.splice(splitIdx, 1);
  if (splitOffsets[pg]?.[idx]) {
    const newSo={};
    Object.keys(splitOffsets[pg][idx]).forEach(k=>{const ki=parseInt(k);if(ki<splitIdx)newSo[ki]=splitOffsets[pg][idx][ki];else if(ki>splitIdx)newSo[ki-1]=splitOffsets[pg][idx][ki];});
    splitOffsets[pg][idx]=newSo;
  }
  if (arr.length===0){delete panelOverrides[pg][idx].splits;if(splitOffsets[pg])delete splitOffsets[pg][idx];if(splitLocks[pg])delete splitLocks[pg][idx];}
  rerenderPageSVG(pg); refreshCornerOverlay?.(pg); refreshPanelsPanel(pg); scheduleAutoSave?.();
}
window.ppRemoveSplit = ppRemoveSplit;

function ppUpdateSplit(pg, idx, splitIdx, field, val) {
  ppEnsure(pg, idx); _getSplitsArr(pg, idx);
  const arr=panelOverrides[pg][idx].splits; if(!arr||!arr[splitIdx]) return;
  arr[splitIdx][field]=val;
  if(field==='dir'&&splitOffsets[pg]?.[idx]?.[splitIdx]) delete splitOffsets[pg][idx][splitIdx];
  rerenderPageSVG(pg); refreshCornerOverlay?.(pg); refreshPanelsPanel(pg); scheduleAutoSave?.();
}
window.ppUpdateSplit = ppUpdateSplit;

function ppSetSplitT(pg, idx, splitIdx, field, val) {
  if (!splitOffsets[pg]) splitOffsets[pg]={};
  if (!splitOffsets[pg][idx]) splitOffsets[pg][idx]={};
  if (!splitOffsets[pg][idx][splitIdx]) splitOffsets[pg][idx][splitIdx]={};
  splitOffsets[pg][idx][splitIdx][field]=Math.max(0.02,Math.min(0.98,val));
  rerenderPageSVG(pg); refreshCornerOverlay?.(pg); scheduleAutoSave?.();
}
window.ppSetSplitT = ppSetSplitT;

function ppResetSplitOffsets(pg, idx, splitIdx) {
  if (splitOffsets[pg]?.[idx]) delete splitOffsets[pg][idx][splitIdx];
  rerenderPageSVG(pg); refreshCornerOverlay?.(pg); refreshPanelsPanel(pg); scheduleAutoSave?.();
}
window.ppResetSplitOffsets = ppResetSplitOffsets;

function ppToggleSplitLock(pg, idx) {
  if (!splitLocks[pg]) splitLocks[pg]={};
  if (!splitLocks[pg][idx]) splitLocks[pg][idx]={};
  splitLocks[pg][idx].all=!splitLocks[pg][idx].all;
  refreshCornerOverlay?.(pg); refreshPanelsPanel(pg); scheduleAutoSave?.();
}
window.ppToggleSplitLock = ppToggleSplitLock;

// Legacy ppSetSplit: kept for backward compat
function ppSetSplit(pg, idx, enabled) {
  if (enabled) ppAddSplit(pg, idx);
  else {
    ppEnsure(pg, idx);
    delete panelOverrides[pg][idx].splits; delete panelOverrides[pg][idx].split;
    if (splitOffsets[pg]) delete splitOffsets[pg][idx];
    if (splitLocks[pg])   delete splitLocks[pg][idx];
    rerenderPageSVG(pg); refreshCornerOverlay?.(pg); refreshPanelsPanel(pg); scheduleAutoSave?.();
  }
}
window.ppSetSplit = ppSetSplit;

function ppSplitHTML(pg, idx) {
  const _ovEntry = (panelOverrides[pg]||{})[idx] || {};
  const splits = _ovEntry.splits ? _ovEntry.splits : (_ovEntry.split ? [_ovEntry.split] : []);
  const allLocked = !!(splitLocks[pg]?.[idx]?.all);
  const dis = allLocked ? 'disabled' : '';
  const opq = allLocked ? 'opacity:0.45;pointer-events:none;' : '';

  let html = '<div style="margin-top:5px;border-top:1px solid var(--border);padding-top:5px;">';
  html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span style="font-size:9px;color:var(--text-3);font-family:'IBM Plex Mono',monospace;flex:1;">SPLIT PANEL</span>`;
  html += `<button onclick="ppToggleSplitLock('${pg}',${idx})" style="background:none;border:1px solid ${allLocked?'var(--danger)':'var(--border)'};border-radius:3px;cursor:pointer;font-size:10px;padding:1px 6px;color:${allLocked?'var(--danger)':'var(--text-3)'};">${allLocked?'&#128274;':'&#128275;'}</button>`;
  html += `<button ${dis} onclick="ppAddSplit('${pg}',${idx})" style="background:var(--surface-2);border:1px solid var(--border-2);border-radius:3px;cursor:pointer;font-size:10px;padding:1px 7px;color:var(--text);${opq}">&#65291; Add</button></div>`;

  if (!splits.length) { html += `<div style="font-size:9px;color:var(--text-3);font-family:'IBM Plex Mono',monospace;padding:2px 0 4px;">No splits. Click &#65291; Add to create one.</div>`; }

  splits.forEach((sp, splitIdx) => {
    if (!sp) return;
    const spDir=sp.dir||'h', spPos=sp.pos!==undefined?sp.pos:50, spGap=sp.gap!==undefined?sp.gap:0, spStyle=sp.style||'line';
    const so=((splitOffsets[pg]||{})[idx]||{})[splitIdx]||{};
    const aT=(so.aT!==undefined)?so.aT:spPos/100, bT=(so.bT!==undefined)?so.bT:spPos/100;
    const hasOffsets=(so.aT!==undefined||so.bT!==undefined);
    html += `<div style="background:var(--surface-3);border:1px solid var(--border);border-radius:3px;padding:5px;margin-bottom:4px;${opq}">`;
    html += `<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;"><span style="font-size:9px;color:var(--accent);font-family:'IBM Plex Mono',monospace;flex:1;">Split ${splitIdx+1}</span><button ${dis} onclick="ppRemoveSplit('${pg}',${idx},${splitIdx})" style="background:none;border:1px solid var(--border);border-radius:2px;cursor:pointer;font-size:9px;padding:1px 5px;color:var(--danger);">&#10005; Remove</button></div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:3px;">`;
    html += `<div><div style="font-size:9px;color:var(--text-3);margin-bottom:2px;">Direction</div><select ${dis} style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:2px;font-size:10px;border-radius:2px;" onchange="ppUpdateSplit('${pg}',${idx},${splitIdx},'dir',this.value)"><option value="h" ${spDir==='h'?'selected':''}>Horizontal &#8212;</option><option value="v" ${spDir==='v'?'selected':''}>Vertical &#124;</option></select></div>`;
    html += `<div><div style="font-size:9px;color:var(--text-3);margin-bottom:2px;">Style</div><select ${dis} style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:2px;font-size:10px;border-radius:2px;" onchange="ppUpdateSplit('${pg}',${idx},${splitIdx},'style',this.value)"><option value="line" ${spStyle==='line'?'selected':''}>Line only</option><option value="gap" ${spStyle==='gap'?'selected':''}>Gap (hollow)</option><option value="solid" ${spStyle==='solid'?'selected':''}>Double line</option></select></div>`;
    html += `</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:3px;">`;
    html += `<div><div style="font-size:9px;color:var(--text-3);margin-bottom:2px;">Position %</div><input type="number" min="5" max="95" value="${spPos}" ${dis} style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:2px 4px;font-size:10px;border-radius:2px;" onchange="ppUpdateSplit('${pg}',${idx},${splitIdx},'pos',+this.value)"></div>`;
    html += `<div><div style="font-size:9px;color:var(--text-3);margin-bottom:2px;">Gap (px)</div><input type="number" min="0" max="200" value="${spGap}" ${dis} style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:2px 4px;font-size:10px;border-radius:2px;" onchange="ppUpdateSplit('${pg}',${idx},${splitIdx},'gap',+this.value)"></div>`;
    html += `</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:3px;">`;
    html += `<div><div style="font-size:9px;color:var(--text-3);margin-bottom:2px;">A position %</div><input type="number" min="2" max="98" value="${Math.round(aT*100)}" ${dis} style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:2px 4px;font-size:10px;border-radius:2px;" onchange="ppSetSplitT('${pg}',${idx},${splitIdx},'aT',+this.value/100)"></div>`;
    html += `<div><div style="font-size:9px;color:var(--text-3);margin-bottom:2px;">B position %</div><input type="number" min="2" max="98" value="${Math.round(bT*100)}" ${dis} style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:2px 4px;font-size:10px;border-radius:2px;" onchange="ppSetSplitT('${pg}',${idx},${splitIdx},'bT',+this.value/100)"></div>`;
    html += `</div>`;
    if (hasOffsets) html += `<button style="width:100%;background:none;border:1px solid var(--border);color:var(--text-3);font-size:9px;padding:2px;border-radius:2px;cursor:pointer;" onclick="ppResetSplitOffsets('${pg}',${idx},${splitIdx})">&#8634; Reset A/B to pos%</button>`;
    html += `</div>`;
  });
  html += `</div>`;
  return html;
}
window.ppSplitHTML = ppSplitHTML;

// ── Main panel editor renderer (targets #panelEditorBody) ─────
function refreshPanelsPanel(pg) {
  // Target new drawer body id
  const body = document.getElementById('panelEditorBody') || document.getElementById('pp-body');
  if (!body) return;

  const sel = document.getElementById('panelEditorPageSel');
  if (sel && pg) sel.value = pg;
  syncLockBtn(pg);

  const baseRects = _lastBaseRects[pg] || [];
  const ovs = panelOverrides[pg] || {};

  if (!baseRects.length) {
    body.innerHTML = '<div style="color:var(--text-3);font-size:var(--type-sm);">Generate pages first to see panels here.</div>';
    return;
  }

  body.innerHTML = baseRects.map((r, idx) => {
    const ov = ovs[idx] || {};
    const x = ov.x !== undefined ? ov.x : r.x, y = ov.y !== undefined ? ov.y : r.y;
    const w = ov.w !== undefined ? ov.w : r.w, h = ov.h !== undefined ? ov.h : r.h;
    const visible = ov.visible !== false, locked = ov.locked === true;
    const hasOv = Object.keys(ov).some(k => k !== 'locked');
    return `<div class="pp-card" id="pp-card-${idx}">
      <div class="pp-card-head">
        <span class="pp-pnl-lbl">PNL ${idx+1}</span>
        <button class="btn small${visible?'':' muted'}" title="${visible?'Hide panel':'Show panel'}" onclick="ppToggleVisible('${pg}',${idx})">${visible?'&#128065;':'&#128683;'}</button>
        <button class="btn small${locked?' danger':''}" title="${locked?'Unlock':'Lock position'}" onclick="ppToggleLock('${pg}',${idx})">${locked?'&#128274;':'&#128275;'}</button>
        ${hasOv?`<button class="btn small" title="Reset" onclick="ppReset('${pg}',${idx})">&#8634;</button>`:''}
      </div>
      <div class="pp-input-grid${locked?' pp-locked-inputs':''}">
        <span class="pp-lbl">X</span><input type="number" value="${Math.round(x)}" ${locked?'disabled':''} onchange="ppSet('${pg}',${idx},'x',+this.value)">
        <span class="pp-lbl">Y</span><input type="number" value="${Math.round(y)}" ${locked?'disabled':''} onchange="ppSet('${pg}',${idx},'y',+this.value)">
        <span class="pp-lbl">W</span><input type="number" value="${Math.round(w)}" ${locked?'disabled':''} onchange="ppSet('${pg}',${idx},'w',+this.value)">
        <span class="pp-lbl">H</span><input type="number" value="${Math.round(h)}" ${locked?'disabled':''} onchange="ppSet('${pg}',${idx},'h',+this.value)">
      </div>
      ${ppCornerHTML(pg, idx)}
      ${ppSplitHTML(pg, idx)}
    </div>`;
  }).join('');

  // Lock btn header
  let header = document.getElementById('pp-lock-btn-wrap');
  if (!header) {
    header = document.createElement('div');
    header.id = 'pp-lock-btn-wrap';
    header.style.cssText = 'display:flex;gap:var(--sp-2);margin-bottom:var(--sp-3);';
    header.innerHTML = `<button id="pp-lock-btn" class="btn small full" onclick="ppToggleLockAll()">Lock Layout</button><button class="btn small danger" onclick="ppResetAll('${pg}')">Reset All</button>`;
    body.insertAdjacentElement('beforebegin', header);
  } else {
    // Keep Reset All targeting whichever page is currently selected —
    // this header is reused across page switches, not recreated.
    header.querySelector('.btn.danger')?.setAttribute('onclick', `ppResetAll('${pg}')`);
  }
  syncLockBtn(pg);
}
window.refreshPanelsPanel = refreshPanelsPanel;

// ── Quick Layout: fill a page with an evenly-spaced grid ──────
// Generates `rowsCount` row-groups of `colsCount` panels each and
// writes them into `rows` exactly the way a pasted/imported CSV
// would describe a uniform grid — same fields (chp/scn/pg/pnl/row/
// lh/maxL/maxH), same layout engine (js/generate.js's
// computePanelRects). Each row group gets maxH = 100/rowsCount (so
// the rows stack to fill the page) and every panel in it gets
// lh = (100/colsCount) x (100/rowsCount) (so it exactly fills its
// row, which makes the skyline packer place `colsCount` panels
// side-by-side with no special-casing needed).
function applyQuickLayout(pg, rowsCount, colsCount) {
  if (!pg) { showToast?.('Pick a page first!'); return; }
  rowsCount = Math.max(1, Math.min(8, Math.round(rowsCount) || 1));
  colsCount = Math.max(1, Math.min(6, Math.round(colsCount) || 1));

  const existing = rows.filter(r => r.pg === pg && !r._blankPlaceholder);
  if (existing.length && !confirm(
    `This page already has ${existing.length} panel row(s). Replace them with a ${rowsCount}\u00d7${colsCount} grid?`
  )) return;

  window.snapshotState?.();

  // Preserve chapter/scene from whatever this page already had.
  const ref = rows.find(r => r.pg === pg) || {};
  const chp = ref.chp || (getPages().find(p => p.pg === pg)?.chp) || 'CHP 1';
  const scn = ref.scn || 'S1';

  // Remove every existing row for this page (including the blank
  // placeholder, if any) — the new grid fully replaces them.
  rows = rows.filter(r => r.pg !== pg);

  const rowHpct = +(100 / rowsCount).toFixed(2);
  const colWpct = +(100 / colsCount).toFixed(2);

  for (let ri = 1; ri <= rowsCount; ri++) {
    for (let ci = 1; ci <= colsCount; ci++) {
      rows.push({
        chp, scn, pg,
        pnl: `PNL ${(ri - 1) * colsCount + ci}`,
        row: `RW ${ri}`,
        lh: `${colWpct}x${rowHpct}`,
        maxL: '100',
        maxH: String(rowHpct),
      });
    }
  }

  if (!pageSettings[pg]) pageSettings[pg] = { mode: 'safe', gutter: 12 };

  renderTable();
  refreshPageSettings();
  window.generateAll?.();
  showToast?.(`Added a ${rowsCount}\u00d7${colsCount} grid to ${pg}`);
}
window.applyQuickLayout = applyQuickLayout;

// ── On-canvas "+ Add Panels" button for blank pages ───────────
// generate.js renders this button directly into a blank page's SVG
// (screen-only, never in exports) — clicking it jumps straight to
// this page's Panel Editor tab so Quick Layout is right there,
// instead of needing to go hunting for the right drawer/page first.
function openQuickLayoutFor(pg) {
  if (isMobile()) {
    window.openMobileMenu?.();
    window.openMobileSection?.('pages', 'panel');
  } else {
    window.openDrawer?.('pages', 'panel');
  }
  const sel = document.getElementById('panelEditorPageSel');
  if (sel) sel.value = pg;
  refreshPanelsPanel(pg);
}
window.openQuickLayoutFor = openQuickLayoutFor;

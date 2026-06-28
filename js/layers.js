// ============================================================
// js/layers.js — Step 7 (text-element rows added in Step 9)
// Layer list rendering, visibility toggle, reorder (up/down),
// per-layer selection, multi-select, bulk lock, dialogue popup.
//
// All functions ported verbatim from Old_index.html.
// Targets #layerListBody (inside drawer) instead of the old
// floating #layersPanel element.
//
// Depends on: state.js (bubbles, textElements), bubbles.js
//   (selectBubble, applyBubbleStyle, renderBubblesOnPage),
//   text.js (selectTextElementById, deleteTextElementById —
//   Step 9), undo.js (snapshotState), ui.js (showToast)
// ============================================================

let _layerSelected = new Set();

// ── Layer icon (text-only per spec F — no emoji in UI chrome) ─
function layerIcon(type) {
  const map = { circle:'○', bold:'●', square:'□', rectangle:'▭', thought:'◌', fading:'◎', dashed:'⊙', spiked:'✦', lilypad:'◑' };
  return map[type] || '○';
}

// ── Main renderer — targets #layerListBody in the drawer ──────
function refreshLayersPanel(pg) {
  const body = document.getElementById('layerListBody');
  if (!body) return;

  if (!pg) {
    body.innerHTML = '<div style="color:var(--text-3);font-size:var(--type-sm);">No page selected.</div>';
    return;
  }

  const bbs = bubbles[pg] || [];
  const txts = textElements[pg] || [];
  if (!bbs.length && !txts.length) {
    body.innerHTML = '<div style="color:var(--text-3);font-size:var(--type-sm);">No bubbles or text elements on this page.</div>';
    return;
  }

  const anySelected = _layerSelected.size > 0;
  const toolbar = bbs.length ? `
    <div style="display:flex;align-items:center;gap:4px;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:4px;">
      <label style="font-size:var(--type-xs);color:var(--text-3);display:flex;align-items:center;gap:3px;cursor:pointer;user-select:none;">
        <input type="checkbox" id="layer-sel-all"
          onchange="layerToggleSelectAll('${pg}',this.checked)"
          style="accent-color:var(--accent);"
          ${anySelected && _layerSelected.size === bbs.length ? 'checked' : ''}>
        <span>All</span>
      </label>
      <span style="flex:1;font-size:var(--type-xs);color:var(--text-3);">${anySelected ? _layerSelected.size + ' selected' : ''}</span>
      ${anySelected ? `
        <button class="btn small" onclick="layerBulkLock('${pg}','move',true)"   title="Lock Move">&#128274;M</button>
        <button class="btn small" onclick="layerBulkLock('${pg}','move',false)"  title="Unlock Move">&#128275;M</button>
        <button class="btn small" onclick="layerBulkLock('${pg}','resize',true)" title="Lock Resize">&#128274;R</button>
        <button class="btn small" onclick="layerBulkLock('${pg}','resize',false)"title="Unlock Resize">&#128275;R</button>
      ` : ''}
    </div>` : '';

  const bubbleRows = [...bbs].reverse().map((b, ri) => {
    const i = bbs.length - 1 - ri;
    const isSel = selectedBubble && selectedBubble.data.id === b.id;
    const isChecked = _layerSelected.has(b.id);
    const mLock  = b.lockMove   ? 'color:var(--danger);border-color:var(--danger);' : '';
    const rsLock = b.lockResize ? 'color:var(--danger);border-color:var(--danger);' : '';
    const rtLock = b.lockRotate ? 'color:var(--danger);border-color:var(--danger);' : '';
    const label  = (b.text || '').slice(0, 24) + (b.text && b.text.length > 24 ? '…' : '');
    return `<div class="layer-row ${isSel ? 'active' : ''}" data-id="${b.id}"
        onclick="event.stopPropagation();selectLayerById('${pg}','${b.id}')">
      <input type="checkbox" class="layer-chk" data-id="${b.id}" ${isChecked ? 'checked' : ''}
        style="accent-color:var(--accent);flex-shrink:0;cursor:pointer;"
        onclick="event.stopPropagation();layerToggleSelect('${pg}','${b.id}',this.checked)">
      <span class="layer-icon" style="flex-shrink:0;">${layerIcon(b.type)}</span>
      <span class="layer-label" style="flex:1;font-size:var(--type-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        ondblclick="layerLabelInteract(event,(bubbles['${pg}']||[]).find(x=>x.id==='${b.id}')||{},this)"
        ontouchend="layerLabelTouch(event,(bubbles['${pg}']||[]).find(x=>x.id==='${b.id}')||{},this)">${label || '(empty)'}</span>
      <div class="layer-btns" style="flex-shrink:0;display:flex;gap:1px;">
        <button title="Lock/Unlock Move"   onclick="event.stopPropagation();layerToggleLock('${pg}','${b.id}','move')"   style="padding:1px 4px;font-size:9px;${mLock}">${b.lockMove?'&#128274;':'&#128275;'}M</button>
        <button title="Lock/Unlock Resize" onclick="event.stopPropagation();layerToggleLock('${pg}','${b.id}','resize')" style="padding:1px 4px;font-size:9px;${rsLock}">${b.lockResize?'&#128274;':'&#128275;'}R</button>
        <button title="Move up"   onclick="event.stopPropagation();layerMove('${pg}','${b.id}',1)">&#8593;</button>
        <button title="Move down" onclick="event.stopPropagation();layerMove('${pg}','${b.id}',-1)">&#8595;</button>
        <button title="Duplicate" onclick="event.stopPropagation();duplicateBubbleById('${pg}','${b.id}')">&#10697;</button>
      </div>
    </div>`;
  }).join('');

  // Text elements section (spec Row 4: "List of all elements
  // (panels, bubbles, text) for the current page"). Kept as its
  // own simple block rather than merged into the bubble-row
  // builder above, since text elements don't have lock/resize
  // state — just position, content, and delete.
  const textRows = txts.length ? `
    <div style="font-size:var(--type-xs);color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;padding:8px 0 4px;${bbs.length ? 'border-top:1px solid var(--border);margin-top:4px;' : ''}">Text</div>
    ${[...txts].reverse().map(t => {
      const isSel = selectedTextElement && selectedTextElement.data.id === t.id;
      const label = (t.content || '').slice(0, 24) + (t.content && t.content.length > 24 ? '…' : '');
      return `<div class="layer-row ${isSel ? 'active' : ''}" data-id="${t.id}"
          onclick="event.stopPropagation();selectTextElementById('${pg}','${t.id}')">
        <span class="layer-icon" style="flex-shrink:0;">T</span>
        <span class="layer-label" style="flex:1;font-size:var(--type-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label || '(empty)'}</span>
        <div class="layer-btns" style="flex-shrink:0;display:flex;gap:1px;">
          <button title="Delete" onclick="event.stopPropagation();deleteTextElementById('${pg}','${t.id}')">&times;</button>
        </div>
      </div>`;
    }).join('')}` : '';

  body.innerHTML = toolbar + bubbleRows + textRows;
}
window.refreshLayersPanel = refreshLayersPanel;

// Alias used by older call sites
window.renderLayerList = () => {
  const pg = selectedBubble?.pgKey || selectedTextElement?.pgKey || Object.keys(bubbles)[0];
  refreshLayersPanel(pg);
};

// ── Select / toggle helpers ───────────────────────────────────
function layerToggleSelect(pg, id, checked) {
  if (checked) _layerSelected.add(id);
  else _layerSelected.delete(id);
  refreshLayersPanel(pg);
}
window.layerToggleSelect = layerToggleSelect;

function layerToggleSelectAll(pg, checked) {
  const bbs = bubbles[pg] || [];
  if (checked) bbs.forEach(b => _layerSelected.add(b.id));
  else _layerSelected.clear();
  refreshLayersPanel(pg);
}
window.layerToggleSelectAll = layerToggleSelectAll;

// ── Per-layer lock toggle ─────────────────────────────────────
function layerToggleLock(pg, id, field) {
  const bbs = bubbles[pg] || [];
  const b = bbs.find(x => x.id === id); if (!b) return;
  snapshotState?.();
  const key = 'lock' + field[0].toUpperCase() + field.slice(1);
  b[key] = !b[key];
  const el = document.querySelector(`.bubble-wrap[data-id="${id}"]`);
  if (el) applyBubbleStyle?.(el, b);
  refreshLayersPanel(pg);
}
window.layerToggleLock = layerToggleLock;

// ── Bulk lock ─────────────────────────────────────────────────
function layerBulkLock(pg, field, lockVal) {
  const bbs = bubbles[pg] || [];
  const key = 'lock' + field[0].toUpperCase() + field.slice(1);
  snapshotState?.();
  bbs.forEach(b => {
    if (!_layerSelected.has(b.id)) return;
    b[key] = lockVal;
    const el = document.querySelector(`.bubble-wrap[data-id="${b.id}"]`);
    if (el) applyBubbleStyle?.(el, b);
  });
  refreshLayersPanel(pg);
  showToast?.(`${lockVal ? 'Locked' : 'Unlocked'} ${field} for ${_layerSelected.size} bubble(s)`);
}
window.layerBulkLock = layerBulkLock;

// ── Reorder (spec E: implement moveLayer) ────────────────────
function layerMove(pg, id, dir) {
  const bbs = bubbles[pg] || [];
  const i = bbs.findIndex(b => b.id === id);
  const j = i + dir;
  if (j < 0 || j >= bbs.length) return;
  [bbs[i], bbs[j]] = [bbs[j], bbs[i]];
  bbs.forEach((b, idx) => { b.zIndex = idx + 1; });
  renderBubblesOnPage?.(pg);
  refreshLayersPanel(pg);
}
window.layerMove = layerMove;

// Named alias per spec E
function moveLayer(pageKey, fromIdx, toIdx) {
  const bbs = bubbles[pageKey] || [];
  if (fromIdx < 0 || fromIdx >= bbs.length || toIdx < 0 || toIdx >= bbs.length) return;
  const [item] = bbs.splice(fromIdx, 1);
  bbs.splice(toIdx, 0, item);
  bbs.forEach((b, idx) => { b.zIndex = idx + 1; });
  renderBubblesOnPage?.(pageKey);
  refreshLayersPanel(pageKey);
}
window.moveLayer = moveLayer;

// ── Select layer by ID (spec E: selectLayer) ─────────────────
function selectLayerById(pg, id) {
  const containers = document.querySelectorAll('.page-output[data-pg]');
  for (const cont of containers) {
    if (cont.dataset.pg !== pg) continue;
    const el = cont.querySelector(`.bubble-wrap[data-id="${id}"]`);
    const b  = (bubbles[pg] || []).find(b => b.id === id);
    if (el && b) selectBubble?.(el, b, pg);
    break;
  }
}
window.selectLayerById = selectLayerById;
window.selectLayer = selectLayerById; // spec E alias

// ── Dialogue popup (dbl-click layer label shows text preview) ─
let _ldpEl = null, _ldpTimer = null;

function showLayerPopup(b, anchorEl) {
  hideLayerPopup();
  _ldpEl = document.createElement('div');
  _ldpEl.className = 'layer-dialogue-popup';
  _ldpEl.style.cssText = 'position:fixed;background:var(--surface-2);border:1px solid var(--border-2);border-radius:4px;padding:8px 10px;max-width:220px;z-index:9999;font-size:var(--type-sm);box-shadow:0 4px 16px rgba(0,0,0,.5);pointer-events:none;';
  if (b.speaker) {
    const sp = document.createElement('div');
    sp.style.cssText = 'font-weight:600;color:var(--accent);margin-bottom:4px;font-size:var(--type-xs);text-transform:uppercase;letter-spacing:.5px;';
    sp.textContent = b.speaker; _ldpEl.appendChild(sp);
  }
  const tx = document.createElement('div');
  tx.style.cssText = 'color:var(--text);line-height:1.5;';
  tx.textContent = b.text || '(no text)'; _ldpEl.appendChild(tx);
  document.body.appendChild(_ldpEl);
  const rect = anchorEl.getBoundingClientRect();
  const popW = 220;
  let left = rect.right + 8;
  if (left + popW > window.innerWidth) left = rect.left - popW - 8;
  let top = rect.top;
  if (top + _ldpEl.offsetHeight > window.innerHeight) top = window.innerHeight - _ldpEl.offsetHeight - 8;
  _ldpEl.style.left = Math.max(4, left) + 'px';
  _ldpEl.style.top  = Math.max(4, top)  + 'px';
}

function hideLayerPopup() {
  if (_ldpEl) { _ldpEl.remove(); _ldpEl = null; }
  clearTimeout(_ldpTimer);
}

function layerLabelInteract(e, b, anchorEl) {
  e.stopPropagation();
  if (e.detail === 2 || e.type === 'dblclick') {
    if (_ldpEl) { hideLayerPopup(); return; }
    showLayerPopup(b, anchorEl);
    _ldpTimer = setTimeout(hideLayerPopup, 4000);
  }
}
window.layerLabelInteract = layerLabelInteract;

const _ldpTapTimes = new WeakMap();
function layerLabelTouch(e, b, anchorEl) {
  e.stopPropagation();
  const now = Date.now(), last = _ldpTapTimes.get(anchorEl) || 0;
  _ldpTapTimes.set(anchorEl, now);
  if (now - last < 350) {
    if (_ldpEl) { hideLayerPopup(); return; }
    showLayerPopup(b, anchorEl);
    _ldpTimer = setTimeout(hideLayerPopup, 4000);
  }
}
window.layerLabelTouch = layerLabelTouch;

document.addEventListener('pointerdown', e => {
  if (_ldpEl && !e.target.closest('.layer-dialogue-popup')) hideLayerPopup();
}, { capture: true });

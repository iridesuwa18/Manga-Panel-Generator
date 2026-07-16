// ============================================================
// js/bubbles.js — Step 7
// Bubble data model, SVG shape builders, DOM overlay renderer,
// drag/resize/rotate interaction, import/clear, layers refresh,
// custom font loading.
//
// All functions ported verbatim from the monolithic Old_index.html.
// References to the old floating #bubblePanel and #layersPanel IDs
// are replaced with calls to refreshLayersPanel() (layers.js) and
// openDrawerTab() (ui.js) where appropriate.
//
// Depends on: state.js (scale, rows, pageSettings, bubbles,
//   panelOverrides, cornerOffsets, cornerEnabled, _lastPanelRects,
//   _lastBaseRects, PAGE_W, PAGE_H), generate.js (generateAll),
//   undo.js (snapshotState), ui.js (showToast, openDrawerTab),
//   layers.js (refreshLayersPanel)
// ============================================================

// ── Font registry ─────────────────────────────────────────────
const BUBBLE_FONTS = {
  'Bangers':        'Bangers, cursive',
  'Permanent Marker': '"Permanent Marker", cursive',
  'Caveat':         'Caveat, cursive',
  'BubbleSans':     'BubbleSans, sans-serif',
  'XLTightBoo':     'XLTightBoo, sans-serif',
  'TGLEngschrift':  'TGLEngschrift, sans-serif',
  'custom1':        'CustomFont1, sans-serif',
  'custom2':        'CustomFont2, sans-serif',
};
window.BUBBLE_FONTS = BUBBLE_FONTS;

const _customFontDataURLs = {};
window._customFontDataURLs = _customFontDataURLs;

// ── Per-type default font/size presets ────────────────────────
// Applied only when a NEW bubble is created (defaultBubble below) —
// editing a bubble afterward always overrides these via the Bubble
// Editor. Tweak the values here to change what a fresh bubble of a
// given type starts out looking like.
const BUBBLE_TYPE_PRESETS = {
  circle:    { font: 'BubbleSans',        fontSize: 60 },                    // normal speech
  thought:   { font: 'Caveat',            fontSize: 56, italic: true },      // thought bubble
  spiked:    { font: 'Bangers',           fontSize: 72, bold: true },        // shout/yell
  bold:      { font: 'Permanent Marker',  fontSize: 64, bold: true },        // intense/monster
  fading:    { font: 'BubbleSans',        fontSize: 52, italic: true },      // weak/trailing off
  dashed:    { font: 'BubbleSans',        fontSize: 44, italic: true },      // whisper
  lilypad:   { font: 'BubbleSans',        fontSize: 54 },                    // off-panel aside
  square:    { font: 'TGLEngschrift',     fontSize: 50, italic: true },      // narration/inner monologue
  rectangle: { font: 'TGLEngschrift',     fontSize: 58, bold: true },        // caption/title box
};
window.BUBBLE_TYPE_PRESETS = BUBBLE_TYPE_PRESETS;

let customFontCount = 0;

function loadCustomFont(e) {
  const file = e.target.files[0]; if (!file) return;
  customFontCount++;
  const key = 'custom' + customFontCount;
  const url = URL.createObjectURL(file);
  const style = document.createElement('style');
  style.textContent = `@font-face{font-family:'CustomFont${customFontCount}';src:url('${url}');}`;
  document.head.appendChild(style);
  BUBBLE_FONTS[key] = `CustomFont${customFontCount},sans-serif`;
  const reader = new FileReader();
  reader.onload = ev => { _customFontDataURLs[key] = ev.target.result; };
  reader.readAsDataURL(file);
  // Update font select in the drawer (single fontFileInput per spec E)
  const sel = document.getElementById('bp-font'); if (!sel) return;
  for (const o of sel.options) {
    if (o.value === key) {
      o.textContent = file.name.replace(/\.[^.]+$/, '') + ' (custom)';
      o.disabled = false; o.hidden = false; break;
    }
  }
  showToast('Font loaded: ' + file.name);
}
window.loadCustomFont = loadCustomFont;

// ── Snap helpers (snapEnabled and _lastPanelRects declared in state.js) ──
function getSnapX(x, pg) {
  if (!snapEnabled) return x;
  const rects = _lastPanelRects[pg] || [];
  let best = x, bestDist = SNAP_THRESHOLD;
  rects.forEach(r => { [r.x, r.x + r.w].forEach(sx => { const d = Math.abs(x - sx); if (d < bestDist) { bestDist = d; best = sx; } }); });
  return best;
}
function getSnapY(y, pg) {
  if (!snapEnabled) return y;
  const rects = _lastPanelRects[pg] || [];
  let best = y, bestDist = SNAP_THRESHOLD;
  rects.forEach(r => { [r.y, r.y + r.h].forEach(sy => { const d = Math.abs(y - sy); if (d < bestDist) { bestDist = d; best = sy; } }); });
  return best;
}

// ── defaultBubble ────────────────────────────────────────────
function defaultBubble(type, text, speaker, index) {
  const preset = BUBBLE_TYPE_PRESETS[type] || { font: 'BubbleSans', fontSize: 60 };
  const b = {
    id: 'b' + Date.now() + Math.random().toString(36).slice(2, 6),
    type, text, speaker: speaker || '',
    x: -9999, y: -9999, w: 600, h: 400, rotate: 0,
    font: preset.font, fontSize: preset.fontSize, bold: !!preset.bold, italic: !!preset.italic,
    tailAngle: 225, tailLen: 150, tailBreadth: 7,
    extraTails: [], dotCount: 4, spikeCount: 16, dashCount: 7,
    lineHeight: 1.3, padRatio: 0.14,
    lockMove: false, lockResize: false, lockRotate: false,
    zIndex: (index || 0) + 1,
    color: '#111111', clipPanel: null,
  };
  if (type === 'lilypad') { b.tailLen = 20; b.tailBreadth = 1; }
  sizeBubbleToText(b);
  return b;
}
window.defaultBubble = defaultBubble;

function sizeBubbleToText(b) {
  const PAD_RATIO = b.padRatio != null ? b.padRatio : 0.14;
  const MAX_W = 3000, MIN_W = 300, MIN_H = 240;
  const LINE_H = b.fontSize * (b.lineHeight != null ? b.lineHeight : 1.3);
  const fontFamily = BUBBLE_FONTS[b.font] || BUBBLE_FONTS['BubbleSans'];
  const weight = b.bold ? 'bold' : 'normal', fstyle = b.italic ? 'italic' : 'normal';
  const text = (b.text || '').trim();
  let ctx = null;
  try { const oc = new OffscreenCanvas(1,1); ctx = oc.getContext('2d'); ctx.font = `${fstyle} ${weight} ${b.fontSize}px ${fontFamily}`; } catch(_) { ctx = null; }
  function measureStr(s) {
    if (ctx) { try { return ctx.measureText(s).width; } catch(_) {} }
    const ratio = /XLTight|TGL|Engschrift/i.test(fontFamily) ? 0.42 : /Bangers/i.test(fontFamily) ? 0.52 : /Permanent|Marker/i.test(fontFamily) ? 0.65 : /Caveat/i.test(fontFamily) ? 0.50 : 0.55;
    return s.length * b.fontSize * ratio;
  }
  if (!text) { b.w = Math.max(MIN_W, b.w); b.h = Math.max(MIN_H, b.h); return; }
  const hardLines = text.split('\n');
  let naturalW = 0;
  hardLines.forEach(seg => { naturalW = Math.max(naturalW, measureStr(seg)); });
  const TARGET_RATIO = 1.4;
  const idealW = Math.sqrt(naturalW * LINE_H * TARGET_RATIO);
  const contentW = Math.min(naturalW, Math.max(MIN_W * 0.55, idealW));
  const displayLines = [];
  hardLines.forEach(seg => {
    const words = seg.split(' ');
    let cur = '', curW = 0;
    words.forEach(word => {
      const ww = measureStr(word), spW = cur ? measureStr(' ') : 0;
      if (cur && curW + spW + ww > contentW) { displayLines.push(cur); cur = word; curW = ww; }
      else { cur = cur ? cur + ' ' + word : word; curW += spW + ww; }
    });
    if (cur) displayLines.push(cur);
  });
  const textW = Math.min(contentW, Math.max(...displayLines.map(l => measureStr(l))));
  const textH = displayLines.length * LINE_H;
  let w = textW / (1 - 2 * PAD_RATIO) + 1, h = textH / (1 - 2 * PAD_RATIO) + 1;
  for (let i = 0; i < 2; i++) { const pad = PAD_RATIO * Math.min(w,h); w = textW + pad*2; h = textH + pad*2; }
  b.w = Math.round(Math.max(MIN_W, w)); b.h = Math.round(Math.max(MIN_H, h));
}

// ── Import bubbles (from drawer paste area) ──────────────────
function parseType(raw) {
  const r = raw.toLowerCase();
  if (r.includes('spiked') || r.includes('yell'))           return 'spiked';
  if (r.includes('thought') || (r.includes('cloud') && r.includes('dot'))) return 'thought';
  if (r.includes('fad') || r.includes('weak'))              return 'fading';
  if (r.includes('dashed') || r.includes('whisper'))        return 'dashed';
  if (r.includes('bold') || r.includes('intense') || r.includes('monster')) return 'bold';
  if (r.includes('lily') || r.includes('off'))              return 'lilypad';
  if (r.includes('square') || r.includes('narrat') || r.includes('inner')) return 'square';
  if (r.includes('rect') || r.includes('title'))            return 'rectangle';
  return 'circle';
}

function importBubbles() {
  // The drawer uses id="bubblePasteArea" and id="bubblePageSel" (from ui.js tplBubbles)
  const raw = document.getElementById('bubblePasteArea')?.value?.trim();
  if (!raw) { showToast('Nothing to import!'); return; }
  const pg = document.getElementById('bubblePageSel')?.value;
  if (!pg) { showToast('Select a page first'); return; }
  if (!bubbles[pg]) bubbles[pg] = [];
  const existing = bubbles[pg].length;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const firstLower = lines[0].toLowerCase();
  const startI = (firstLower.startsWith('speech') || firstLower.startsWith('type') || firstLower === 'speech type\tspeaker\tdialogue') ? 1 : 0;
  const added = [];
  for (let i = startI; i < lines.length; i++) {
    const cols = lines[i].split('\t').map(c => c.trim());
    if (!cols[0]) continue;
    const type = parseType(cols[0]);
    const speaker = cols[1] || '', text = cols[2] || cols[1] || '';
    added.push(defaultBubble(type, text, speaker, existing + added.length));
  }
  const panelCenters = getPanelCenters(pg);
  added.forEach((b, i) => {
    const pc = panelCenters.length > 0 ? panelCenters[Math.min(i, panelCenters.length - 1)] : null;
    if (pc) { b.x = pc.x - b.w / 2; b.y = pc.y - b.h / 2; }
    else { b.x = (PAGE_W - b.w) / 2; b.y = (PAGE_H - b.h) / 2; }
  });
  bubbles[pg].push(...added);
  renderBubblesOnPage(pg);
  refreshLayersPanel?.(pg);
  showToast(`Added ${added.length} bubble(s) to ${pg}`);
}
window.importBubbles = importBubbles;

function getPanelCenters(pg) {
  const cont = document.querySelector(`.page-output[data-pg="${pg}"]`);
  if (!cont) return [];
  const svgEl = cont.querySelector('svg'); if (!svgEl) return [];
  const rects = svgEl.querySelectorAll('rect'), centers = [];
  rects.forEach(r => {
    const x = parseFloat(r.getAttribute('x')||0), y = parseFloat(r.getAttribute('y')||0);
    const w = parseFloat(r.getAttribute('width')||0), h = parseFloat(r.getAttribute('height')||0);
    if (w < 20 || h < 20 || w > PAGE_W * 0.95 || h > PAGE_H * 0.95) return;
    const fill = (r.getAttribute('fill')||'').toLowerCase();
    if (fill === 'white' || fill === '#ffffff' || fill === 'none' || fill === '') return;
    centers.push({ x: x + w/2, y: y + h/2 });
  });
  const rowTol = PAGE_H * 0.10;
  centers.sort((a, b) => { const same = Math.abs(a.y - b.y) < rowTol; return same ? a.x - b.x : a.y - b.y; });
  return centers;
}

function clearBubbles() {
  const pg = document.getElementById('bubblePageSel')?.value;
  if (!pg) { showToast('Select a page first'); return; }
  if (!confirm(`Clear all bubbles on ${pg}?`)) return;
  bubbles[pg] = [];
  renderBubblesOnPage(pg);
  refreshLayersPanel?.(pg);
  showToast('Bubbles cleared for ' + pg);
}
window.clearBubbles = clearBubbles;

function refreshBubblePageSelect() {
  const pgs = getPages?.() || [];
  const sel = document.getElementById('bubblePageSel'); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = pgs.map(({pg}) => `<option value="${pg}">${pg}</option>`).join('');
  if (cur) sel.value = cur;
}
window.refreshBubblePageSelect = refreshBubblePageSelect;

// ── Quick Insert: drop a bubble straight onto a chosen panel ──
// Populates the Panel dropdown in the Bubbles & Text drawer from
// this page's last-generated panel rects (same array panels.js's
// editor cards are numbered from, so "Panel 3" here is the same
// panel as "PNL 3" there).
function refreshQuickBubblePanelSel(pg) {
  const sel = document.getElementById('qbPanelSel');
  if (!sel) return;
  const all = (_lastPanelRects[pg]?.length ? _lastPanelRects[pg] : _lastBaseRects[pg]) || [];
  const rects = all.filter(r => r.pnl); // exclude the blank-page placeholder rect
  if (!rects.length) {
    sel.innerHTML = '<option value="">Generate panels on this page first</option>';
    return;
  }
  sel.innerHTML = rects.map((r, i) => `<option value="${i}">Panel ${i + 1}</option>`).join('');
}
window.refreshQuickBubblePanelSel = refreshQuickBubblePanelSel;

// type/text can come straight from the picker with no pre-written
// dialogue — text defaults to empty and is editable afterward by
// clicking the bubble on the canvas (opens the Selected Bubble editor).
function insertBubbleToPanel(pg, panelIdx, type, text) {
  if (!pg) { showToast('Pick a page first!'); return; }
  const rects = (_lastPanelRects[pg]?.length ? _lastPanelRects[pg] : _lastBaseRects[pg]) || [];
  if (!rects.length) { showToast('Generate this page first!'); return; }
  const r = rects[panelIdx];
  if (!r) { showToast('Pick a panel first!'); return; }

  if (!bubbles[pg]) bubbles[pg] = [];
  const b = defaultBubble(type || 'circle', text || '', '', bubbles[pg].length);
  // Center the bubble within the chosen panel, same placement logic
  // importBubbles() uses for panel centers.
  b.x = (r.x + r.w / 2) - b.w / 2;
  b.y = (r.y + r.h / 2) - b.h / 2;
  bubbles[pg].push(b);

  renderBubblesOnPage(pg);
  refreshLayersPanel?.(pg);
  window.scheduleAutoSave?.();
  showToast(`Added a ${type} bubble to Panel ${+panelIdx + 1}`);
}
window.insertBubbleToPanel = insertBubbleToPanel;

// ── Render bubbles on a page ──────────────────────────────────
function renderBubblesOnPage(pg) {
  const containers = document.querySelectorAll('.page-output[data-pg]');
  for (const cont of containers) {
    if (cont.dataset.pg !== pg) continue;
    let overlay = cont.querySelector('.bubble-overlay');
    if (overlay) overlay.remove();
    const svgWrap = cont.querySelector('div[style*="transform-origin"]');
    overlay = document.createElement('div');
    overlay.className = 'bubble-overlay';
    overlay.style.cssText = `position:absolute;top:0;left:0;width:${PAGE_W}px;height:${PAGE_H}px;pointer-events:none;`;
    if (svgWrap) svgWrap.appendChild(overlay);
    else cont.appendChild(overlay);
    (bubbles[pg] || []).forEach((b, i) => {
      if (b.x === -9999 || b.y === -9999) { b.x = (PAGE_W - b.w) / 2; b.y = (PAGE_H - b.h) / 2; }
      b.zIndex = b.zIndex || (i + 1);
      if (!b.extraTails) b.extraTails = [];
      const el = createBubbleEl(b, pg);
      overlay.appendChild(el);
    });
    break;
  }
}
window.renderBubblesOnPage = renderBubblesOnPage;

function renderAllBubbles() {
  for (const pg of Object.keys(bubbles)) renderBubblesOnPage(pg);
}
window.renderAllBubbles = renderAllBubbles;

// ── Create bubble DOM element ────────────────────────────────
function createBubbleEl(b, pgKey) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap'; wrap.dataset.id = b.id; wrap.dataset.pgKey = pgKey;
  applyBubbleStyle(wrap, b);
  const svg = buildBubbleSVG(b); svg.classList.add('bubble-svg'); wrap.appendChild(svg);
  const textDiv = document.createElement('div'); textDiv.className = 'bubble-text';
  updateTextStyle(textDiv, b); wrap.appendChild(textDiv);
  applyBubbleStyle(wrap, b);
  const selBox = document.createElement('div'); selBox.className = 'sel-box'; wrap.appendChild(selBox);
  ['nw','n','ne','e','se','s','sw','w'].forEach(dir => {
    const h = document.createElement('div'); h.className = 'sel-handle ' + dir; h.dataset.dir = dir; wrap.appendChild(h);
  });
  const stem = document.createElement('div'); stem.className = 'rotate-stem'; wrap.appendChild(stem);
  const rotH = document.createElement('div'); rotH.className = 'rotate-handle'; wrap.appendChild(rotH);
  if (['circle','thought','fading','dashed','bold','spiked','lilypad'].includes(b.type)) {
    const tailH = document.createElement('div'); tailH.className = 'tail-handle';
    positionTailHandle(tailH, b); wrap.appendChild(tailH); setupTailDrag(tailH, b, pgKey, wrap);
  }
  syncExtraTailHandles(wrap, b, pgKey);
  setupDrag(wrap, b, pgKey);
  wrap.querySelectorAll('.sel-handle').forEach(h => setupResize(h, wrap, b, pgKey));
  setupRotate(wrap.querySelector('.rotate-handle'), wrap, b, pgKey);
  wrap.addEventListener('click', e => { if (!e.target.classList.contains('sel-handle') && !e.target.classList.contains('rotate-handle') && !e.target.classList.contains('tail-handle')) selectBubble(wrap, b, pgKey); });
  return wrap;
}

// ── Clip logic ───────────────────────────────────────────────
function applyBubbleClip(wrap, b) {
  const svgEl = wrap.querySelector('svg.bubble-svg');
  const txtEl = wrap.querySelector('.bubble-text');
  const clearClip = () => {
    if (svgEl) { svgEl.querySelector('defs.bubble-clip-defs')?.remove(); svgEl.querySelectorAll(':scope > path, :scope > ellipse, :scope > rect, :scope > g').forEach(el => el.removeAttribute('clip-path')); svgEl.style.clipPath = ''; }
    if (txtEl) txtEl.style.clipPath = '';
  };
  if (b.clipPanel == null) { clearClip(); return; }
  const pgKey = wrap.dataset.pgKey;
  const rects = pgKey ? (_lastPanelRects[pgKey] || []) : [];
  const r = rects[b.clipPanel]; if (!r) { clearClip(); return; }
  const sw = (parseInt(document.getElementById('strokeWidth')?.value) || 8) / 2;
  const co = (cornerOffsets[pgKey]||{})[b.clipPanel];
  const ena = (cornerEnabled[pgKey]||{})[b.clipPanel];
  const hasCorners = co && ena !== false && (co.tl||co.tr||co.bl||co.br||co.tlY||co.trY||co.blY||co.brY);
  if (svgEl) {
    svgEl.style.clipPath = '';
    const clipId = 'bclip-' + b.id;
    let defs = svgEl.querySelector('defs.bubble-clip-defs');
    if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg','defs'); defs.classList.add('bubble-clip-defs'); const cp = document.createElementNS('http://www.w3.org/2000/svg','clipPath'); cp.id = clipId; cp.setAttribute('clipPathUnits','userSpaceOnUse'); defs.appendChild(cp); svgEl.insertBefore(defs, svgEl.firstChild); }
    else { const cp = defs.querySelector('clipPath'); if(cp) cp.id = clipId; }
    const cp = defs.querySelector('clipPath');
    while (cp.firstChild) cp.removeChild(cp.firstChild);
    if (hasCorners) {
      const x1=r.x,y1=r.y,x2=r.x+r.w,y2=r.y+r.h;
      const pts=[{x:x1+(co.tl||0)-b.x+sw,y:y1+(co.tlY||0)-b.y+sw},{x:x2+(co.tr||0)-b.x-sw,y:y1+(co.trY||0)-b.y+sw},{x:x2+(co.br||0)-b.x-sw,y:y2+(co.brY||0)-b.y-sw},{x:x1+(co.bl||0)-b.x+sw,y:y2+(co.blY||0)-b.y-sw}];
      const poly=document.createElementNS('http://www.w3.org/2000/svg','polygon'); poly.setAttribute('points',pts.map(p=>`${p.x},${p.y}`).join(' ')); cp.appendChild(poly);
    } else {
      const cx=r.x-b.x+sw,cy=r.y-b.y+sw,cw=Math.max(0,r.w-sw*2),ch=Math.max(0,r.h-sw*2);
      const cr=document.createElementNS('http://www.w3.org/2000/svg','rect'); cr.setAttribute('x',cx); cr.setAttribute('y',cy); cr.setAttribute('width',cw); cr.setAttribute('height',ch); cp.appendChild(cr);
    }
    svgEl.querySelectorAll(':scope > path, :scope > ellipse, :scope > rect, :scope > g').forEach(el => el.setAttribute('clip-path',`url(#${clipId})`));
    if (txtEl) { if (hasCorners) { txtEl.style.clipPath=''; } else { const cx=r.x-b.x+sw,cy=r.y-b.y+sw,cw=Math.max(0,r.w-sw*2),ch=Math.max(0,r.h-sw*2); txtEl.style.clipPath=`inset(${Math.max(0,cy)}px ${Math.max(0,b.w-(cx+cw))}px ${Math.max(0,b.h-(cy+ch))}px ${Math.max(0,cx)}px)`; } }
  }
}
window.applyBubbleClip = applyBubbleClip;

function applyBubbleStyle(wrap, b) {
  wrap.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;transform:rotate(${b.rotate}deg);z-index:${b.zIndex||1};pointer-events:all;cursor:${b.lockMove?'default':'move'};user-select:none;touch-action:none;overflow:visible;`;
  applyBubbleClip(wrap, b);
}
window.applyBubbleStyle = applyBubbleStyle;

function updateTextStyle(textDiv, b) {
  const padRatio = b.padRatio != null ? b.padRatio : 0.14;
  const pad = Math.min(b.w, b.h) * padRatio;
  const lineH = b.lineHeight != null ? b.lineHeight : 1.3;
  textDiv.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-family:${BUBBLE_FONTS[b.font]||BUBBLE_FONTS['BubbleSans']};font-size:${b.fontSize}px;font-weight:${b.bold?'bold':'normal'};font-style:${b.italic?'italic':'normal'};color:${b.color||'#111111'};padding:${pad}px;line-height:${lineH};word-break:break-word;white-space:pre-wrap;overflow:hidden;pointer-events:none;box-sizing:border-box;`;
  textDiv.innerHTML = b.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  requestAnimationFrame(() => { const wrap = textDiv.parentElement; if (wrap) checkBubbleOverflow(wrap, b); });
}
window.updateTextStyle = updateTextStyle;

function checkBubbleOverflow(wrap, b) {
  const textDiv = wrap.querySelector('.bubble-text'); if (!textDiv) return;
  let slack = 2;
  if (b) { if (b.type === 'thought') slack = Math.round(textDiv.clientHeight * 0.18); else if (b.type === 'rectangle' || b.type === 'square') slack = Math.round(textDiv.clientHeight * 0.12); }
  wrap.classList.toggle('text-overflow', textDiv.scrollHeight > textDiv.clientHeight + slack || textDiv.scrollWidth > textDiv.clientWidth + slack);
}

// ── SVG Shape Builders ────────────────────────────────────────
function ep(cx,cy,rx,ry,a){ return [cx+rx*Math.cos(a), cy+ry*Math.sin(a)]; }
function mkPath(svg,d,stroke,fill,sw,dash='') {
  const el=document.createElementNS('http://www.w3.org/2000/svg','path');
  el.setAttribute('d',d); el.setAttribute('stroke',stroke); el.setAttribute('fill',fill);
  el.setAttribute('stroke-width',sw); el.setAttribute('stroke-linejoin','round'); el.setAttribute('stroke-linecap','round');
  if(dash) el.setAttribute('stroke-dasharray',dash); svg.appendChild(el); return el;
}
function svgRect(svg,x,y,w,h,sw,stroke,fill) {
  if(w<=0||h<=0)return;
  const el=document.createElementNS('http://www.w3.org/2000/svg','rect');
  el.setAttribute('x',x);el.setAttribute('y',y);el.setAttribute('width',w);el.setAttribute('height',h);
  el.setAttribute('stroke',stroke);el.setAttribute('stroke-width',sw);el.setAttribute('fill',fill);
  svg.appendChild(el);
}

function buildBubbleSVG(b) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width',b.w); svg.setAttribute('height',b.h);
  svg.setAttribute('viewBox',`0 0 ${b.w} ${b.h}`); svg.setAttribute('overflow','visible');
  const cx=b.w/2, cy=b.h/2, rx=b.w/2-4, ry=b.h/2-4, sw=b.type==='bold'?5:2.5;
  switch(b.type) {
    case 'circle': svgCircleWithTail(svg,cx,cy,rx,ry,b,sw,'#111','#fff'); break;
    case 'bold':   svgCircleWithTail(svg,cx,cy,rx,ry,b,sw,'#111','#fff'); break;
    case 'square': svgRect(svg,4,4,b.w-8,b.h-8,2.5,'#111','#fff'); break;
    case 'rectangle': svgRect(svg,4,4,b.w-8,b.h-8,2.5,'#111','#fff'); svgRect(svg,9,9,b.w-18,b.h-18,1.2,'#111','none'); break;
    case 'thought': svgThought(svg,cx,cy,rx,ry,b); break;
    case 'fading':  svgFading(svg,cx,cy,rx,ry,b); break;
    case 'dashed':  svgDashedBubble(svg,cx,cy,rx,ry,b); break;
    case 'spiked':  svgSpikedBubble(svg,cx,cy,rx,ry,b); break;
    case 'lilypad': svgLilypad(svg,cx,cy,rx,ry,b); break;
  }
  if (b.extraTails && b.extraTails.length) {
    b.extraTails.forEach(et => {
      if(!et||(et.len||0)<=0) return;
      svgExtraTail(svg,cx,cy,rx,ry,Object.assign({},b,{tailAngle:et.angle,tailLen:et.len,tailBreadth:et.breadth||1,dotCount:et.dotCount!=null?et.dotCount:b.dotCount,spikeCount:et.spikeCount!=null?et.spikeCount:b.spikeCount,dashCount:et.dashCount!=null?et.dashCount:b.dashCount}),sw,b.type);
    });
  }
  return svg;
}
window.buildBubbleSVG = buildBubbleSVG;

function svgCircleWithTail(svg,cx,cy,rx,ry,b,sw,stroke,fill) {
  if(b.tailLen<=0){const el=document.createElementNS('http://www.w3.org/2000/svg','ellipse');el.setAttribute('cx',cx);el.setAttribute('cy',cy);el.setAttribute('rx',rx);el.setAttribute('ry',ry);el.setAttribute('stroke',stroke);el.setAttribute('stroke-width',sw);el.setAttribute('fill',fill);svg.appendChild(el);return;}
  const tar=(b.tailAngle*Math.PI)/180, baseGap=Math.min(0.28,8/Math.max(rx,ry)), gapHalf=baseGap*(b.tailBreadth||1.0);
  const [x1,y1]=ep(cx,cy,rx,ry,tar-gapHalf), [x2,y2]=ep(cx,cy,rx,ry,tar+gapHalf);
  const tipX=cx+(rx+b.tailLen)*Math.cos(tar), tipY=cy+(ry+b.tailLen)*Math.sin(tar);
  mkPath(svg,`M ${x2} ${y2} A ${rx} ${ry} 0 1 1 ${x1} ${y1} L ${tipX} ${tipY} Z`,stroke,fill,sw);
}
function svgThought(svg,cx,cy,rx,ry,b) {
  const n=Math.max(5,b.spikeCount||Math.round((rx+ry)/9)); let d='';
  for(let i=0;i<n;i++){const a1=(i/n)*Math.PI*2,a2=((i+1)/n)*Math.PI*2,am=(a1+a2)/2,bump=0.14;const ox=cx+rx*(1+bump*1.9)*Math.cos(am),oy=cy+ry*(1+bump*1.9)*Math.sin(am);const x1=cx+rx*(1+bump)*Math.cos(a1),y1=cy+ry*(1+bump)*Math.sin(a1);const x2=cx+rx*(1+bump)*Math.cos(a2),y2=cy+ry*(1+bump)*Math.sin(a2);d+=(i===0?`M ${x1} ${y1} `:'')+`Q ${ox} ${oy} ${x2} ${y2} `;}
  mkPath(svg,d+'Z','#111','#fff',2.5);
  if(b.tailLen<=0)return;
  const tar=(b.tailAngle*Math.PI)/180, bx=cx+rx*Math.cos(tar), by_=cy+ry*Math.sin(tar);
  const tipX=cx+(rx+b.tailLen)*Math.cos(tar), tipY=cy+(ry+b.tailLen)*Math.sin(tar);
  const dots=Math.max(1,b.dotCount||4);
  for(let i=0;i<dots;i++){const t=(i+1)/(dots+1),px=bx+(tipX-bx)*t,py=by_+(tipY-by_)*t,r=Math.max(1,5.5*(b.tailBreadth||1)*(1-t*0.6));const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',px);c.setAttribute('cy',py);c.setAttribute('r',r);c.setAttribute('stroke','#111');c.setAttribute('stroke-width',1.5);c.setAttribute('fill','#fff');svg.appendChild(c);}
}
function svgFading(svg,cx,cy,rx,ry,b) {
  const n=Math.max(4,b.spikeCount||Math.round((rx+ry)/16)); let d='';
  for(let i=0;i<n;i++){const a1=(i/n)*Math.PI*2,a2=((i+1)/n)*Math.PI*2,am=(a1+a2)/2,bump=0.07;const ox=cx+rx*(1+bump*1.3)*Math.cos(am),oy=cy+ry*(1+bump*1.3)*Math.sin(am);const x1=cx+rx*(1+bump)*Math.cos(a1),y1=cy+ry*(1+bump)*Math.sin(a1);const x2=cx+rx*(1+bump)*Math.cos(a2),y2=cy+ry*(1+bump)*Math.sin(a2);d+=(i===0?`M ${x1} ${y1} `:'')+`Q ${ox} ${oy} ${x2} ${y2} `;}
  mkPath(svg,d+'Z','#111','#fff',2);
  if(b.tailLen<=0)return;
  const tar=(b.tailAngle*Math.PI)/180, perp=tar+Math.PI/2;
  const bx=cx+rx*Math.cos(tar), by_=cy+ry*Math.sin(tar);
  const tipX=cx+(rx+b.tailLen)*Math.cos(tar), tipY=cy+(ry+b.tailLen)*Math.sin(tar);
  const baseW=Math.min(rx,ry)*0.3*(b.tailBreadth||1.0);
  const s1x=bx+baseW*Math.cos(perp),s1y=by_+baseW*Math.sin(perp),s2x=bx-baseW*Math.cos(perp),s2y=by_-baseW*Math.sin(perp);
  const m1=0.35,m2=0.65,amp=baseW*0.8;
  const cp1x=(bx+(tipX-bx)*m1)+amp*Math.cos(perp),cp1y=(by_+(tipY-by_)*m1)+amp*Math.sin(perp);
  const cp2x=(bx+(tipX-bx)*m2)-amp*Math.cos(perp),cp2y=(by_+(tipY-by_)*m2)-amp*Math.sin(perp);
  const cp3x=(bx+(tipX-bx)*m1)-amp*Math.cos(perp),cp3y=(by_+(tipY-by_)*m1)-amp*Math.sin(perp);
  const cp4x=(bx+(tipX-bx)*m2)+amp*Math.cos(perp),cp4y=(by_+(tipY-by_)*m2)+amp*Math.sin(perp);
  mkPath(svg,`M ${s1x} ${s1y} Q ${cp1x} ${cp1y} ${bx+(tipX-bx)*m2} ${by_+(tipY-by_)*m2} Q ${cp2x} ${cp2y} ${tipX} ${tipY} Q ${cp3x} ${cp3y} ${bx+(tipX-bx)*m1} ${by_+(tipY-by_)*m1} Q ${cp4x} ${cp4y} ${s2x} ${s2y} Z`,'#111','#fff',1.5);
}
function svgDashedBubble(svg,cx,cy,rx,ry,b) {
  const dc=b.dashCount||7, dashArr=`${dc},5`;
  if(b.tailLen<=0){const el=document.createElementNS('http://www.w3.org/2000/svg','ellipse');el.setAttribute('cx',cx);el.setAttribute('cy',cy);el.setAttribute('rx',rx);el.setAttribute('ry',ry);el.setAttribute('stroke','#111');el.setAttribute('stroke-width',2.5);el.setAttribute('fill','#fff');el.setAttribute('stroke-dasharray',dashArr);svg.appendChild(el);return;}
  const tar=(b.tailAngle*Math.PI)/180, baseGapD=Math.min(0.25,7/Math.max(rx,ry)), gapHalf=baseGapD*(b.tailBreadth||1.0);
  const [x1,y1]=ep(cx,cy,rx,ry,tar-gapHalf),[x2,y2]=ep(cx,cy,rx,ry,tar+gapHalf);
  const tipX=cx+(rx+b.tailLen)*Math.cos(tar), tipY=cy+(ry+b.tailLen)*Math.sin(tar);
  mkPath(svg,`M ${x2} ${y2} A ${rx} ${ry} 0 1 1 ${x1} ${y1} L ${tipX} ${tipY} Z`,'#111','#fff',2.5,dashArr);
}
function svgSpikedBubble(svg,cx,cy,rx,ry,b) {
  const n=Math.max(5,b.spikeCount||16), tar=(b.tailAngle*Math.PI)/180, tailLen=b.tailLen||0, breadth=b.tailBreadth||1, total=n*2;
  const pts=[];
  for(let i=0;i<total;i++){const a=(i/total)*Math.PI*2-Math.PI/2,r=(i%2===0)?1:0.62;pts.push({x:cx+rx*r*Math.cos(a),y:cy+ry*r*Math.sin(a),a,isOuter:i%2===0});}
  if(tailLen>0){const spikeStep=(2*Math.PI)/total, halfSpread=spikeStep*Math.max(0.5,(breadth-1)*0.5);
    pts.forEach(p=>{if(!p.isOuter)return;let diff=p.a-tar;while(diff>Math.PI)diff-=Math.PI*2;while(diff<-Math.PI)diff+=Math.PI*2;const absDiff=Math.abs(diff);if(absDiff<=halfSpread+spikeStep){const inf=Math.max(0,1-absDiff/(halfSpread+spikeStep));p.x=cx+(rx+tailLen*inf)*Math.cos(p.a);p.y=cy+(ry+tailLen*inf)*Math.sin(p.a);}});}
  mkPath(svg,pts.map((p,i)=>`${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ')+' Z','#111','#fff',2);
}
function svgLilypad(svg,cx,cy,rx,ry,b) {
  const a=(b.tailAngle*Math.PI)/180, rawBreadth=(b.tailBreadth!=null)?b.tailBreadth:1.0;
  const nw=(rawBreadth/20)*Math.PI, a1=a-nw, a2=a+nw;
  const [x1,y1]=ep(cx,cy,rx,ry,a1), [x2,y2]=ep(cx,cy,rx,ry,a2);
  const rawLen=(b.tailLen!=null)?b.tailLen:20, depth=(rawLen/100)*Math.min(rx,ry);
  const ix=cx+(rx-depth)*Math.cos(a), iy=cy+(ry-depth)*Math.sin(a);
  const d=depth<0.5?`M ${cx+rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx+rx-0.001} ${cy} Z`:`M ${x2} ${y2} A ${rx} ${ry} 0 1 1 ${x1} ${y1} L ${ix} ${iy} Z`;
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',d);path.setAttribute('fill','#fff');path.setAttribute('stroke','#111');path.setAttribute('stroke-width',2.5);path.setAttribute('stroke-linejoin','round');svg.appendChild(path);
}
function svgExtraTail(svg,cx,cy,rx,ry,b,sw,type) {
  const tar=(b.tailAngle*Math.PI)/180;
  const tipX=cx+(rx+b.tailLen)*Math.cos(tar), tipY=cy+(ry+b.tailLen)*Math.sin(tar);
  if(type==='thought'){const bx=cx+rx*Math.cos(tar),by_=cy+ry*Math.sin(tar),dots=Math.max(1,b.dotCount||4);for(let i=0;i<dots;i++){const t=(i+1)/(dots+1),px=bx+(tipX-bx)*t,py=by_+(tipY-by_)*t,r=Math.max(1,5.5*(b.tailBreadth||1)*(1-t*0.6));const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',px);c.setAttribute('cy',py);c.setAttribute('r',r);c.setAttribute('stroke','#111');c.setAttribute('stroke-width',1.5);c.setAttribute('fill','#fff');svg.appendChild(c);}return;}
  if(type==='fading'){const bx=cx+rx*Math.cos(tar),by_=cy+ry*Math.sin(tar),perp=tar+Math.PI/2,baseW=Math.min(rx,ry)*0.3*(b.tailBreadth||1.0),m1=0.35,m2=0.65,amp=baseW*0.8,s1x=bx+baseW*Math.cos(perp),s1y=by_+baseW*Math.sin(perp),s2x=bx-baseW*Math.cos(perp),s2y=by_-baseW*Math.sin(perp),cp1x=(bx+(tipX-bx)*m1)+amp*Math.cos(perp),cp1y=(by_+(tipY-by_)*m1)+amp*Math.sin(perp),cp2x=(bx+(tipX-bx)*m2)-amp*Math.cos(perp),cp2y=(by_+(tipY-by_)*m2)-amp*Math.sin(perp),cp3x=(bx+(tipX-bx)*m1)-amp*Math.cos(perp),cp3y=(by_+(tipY-by_)*m1)-amp*Math.sin(perp),cp4x=(bx+(tipX-bx)*m2)+amp*Math.cos(perp),cp4y=(by_+(tipY-by_)*m2)+amp*Math.sin(perp);mkPath(svg,`M ${s1x} ${s1y} Q ${cp1x} ${cp1y} ${bx+(tipX-bx)*m2} ${by_+(tipY-by_)*m2} Q ${cp2x} ${cp2y} ${tipX} ${tipY} Q ${cp3x} ${cp3y} ${bx+(tipX-bx)*m1} ${by_+(tipY-by_)*m1} Q ${cp4x} ${cp4y} ${s2x} ${s2y} Z`,'#111','#fff',1.5);return;}
  const baseGap=Math.min(0.28,8/Math.max(rx,ry)),gapHalf=baseGap*(b.tailBreadth||1.0);
  const [x1,y1]=ep(cx,cy,rx,ry,tar-gapHalf),[x2,y2]=ep(cx,cy,rx,ry,tar+gapHalf);
  const fill=document.createElementNS('http://www.w3.org/2000/svg','path');fill.setAttribute('d',`M ${x1} ${y1} L ${tipX} ${tipY} L ${x2} ${y2} Z`);fill.setAttribute('fill','#fff');fill.setAttribute('stroke','none');svg.appendChild(fill);
  const stroke=document.createElementNS('http://www.w3.org/2000/svg','path');stroke.setAttribute('d',`M ${x1} ${y1} L ${tipX} ${tipY} L ${x2} ${y2}`);stroke.setAttribute('fill','none');stroke.setAttribute('stroke','#111');stroke.setAttribute('stroke-width',sw);stroke.setAttribute('stroke-linejoin','round');stroke.setAttribute('stroke-linecap','round');svg.appendChild(stroke);
}

// Export buildBubbleTextSVGNative (used by export.js)
function buildBubbleTextSVGNative(b) {
  if (!b.text) return '';
  const padRatio = b.padRatio != null ? b.padRatio : 0.14;
  const pad = Math.min(b.w, b.h) * padRatio, maxW = b.w - pad * 2;
  const family = (BUBBLE_FONTS[b.font] || BUBBLE_FONTS['BubbleSans']).replace(/&/g,'&amp;');
  const familyRaw = BUBBLE_FONTS[b.font] || BUBBLE_FONTS['BubbleSans'];
  const weight = b.bold?'bold':'normal', fstyle = b.italic?'italic':'normal';
  const color = (b.color||'#111111').replace(/&/g,'&amp;'), fontSize = b.fontSize || 40;
  const lineH = fontSize * (b.lineHeight != null ? b.lineHeight : 1.3);
  let measureCtx = null;
  try { const oc=new OffscreenCanvas(1,1); measureCtx=oc.getContext('2d'); measureCtx.font=`${fstyle} ${weight} ${fontSize}px ${familyRaw}`; } catch(_) { measureCtx=null; }
  function measureWord(w) { if(measureCtx){try{return measureCtx.measureText(w).width;}catch(_){}} const ratio=/XLTight|TGL|Engschrift/i.test(familyRaw)?0.42:/Bangers/i.test(familyRaw)?0.52:/Permanent|Marker/i.test(familyRaw)?0.65:/Caveat/i.test(familyRaw)?0.50:0.55; return w.length*fontSize*ratio; }
  const rawLines = b.text.split('\n'), lines = [];
  rawLines.forEach(seg => { const words=seg.split(' '); let cur='', curW=0; words.forEach(word=>{const ww=measureWord(word),spaceW=cur?measureWord(' '):0;if(cur&&curW+spaceW+ww>maxW){lines.push(cur);cur=word;curW=ww;}else{cur=cur?cur+' '+word:word;curW+=spaceW+ww;}}); if(cur)lines.push(cur); });
  const totalH=lines.length*lineH, startY=b.h/2-totalH/2+fontSize*0.85;
  const tspans=lines.map((line,i)=>`<tspan x="${b.w/2}" dy="${i===0?0:lineH}">${line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</tspan>`).join('');
  return `<text x="${b.w/2}" y="${startY.toFixed(1)}" text-anchor="middle" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" font-style="${fstyle}" fill="${color}">${tspans}</text>`;
}
window.buildBubbleTextSVGNative = buildBubbleTextSVGNative;

// ── Interaction ───────────────────────────────────────────────
function rebuildSVG(wrap, b) {
  const old=wrap.querySelector('svg'); if(old) old.remove();
  const newSvg=buildBubbleSVG(b); newSvg.classList.add('bubble-svg'); wrap.insertBefore(newSvg,wrap.firstChild);
  applyBubbleClip(wrap,b);
  const pgKey=wrap.dataset.pgKey; syncExtraTailHandles(wrap,b,pgKey);
}
function _rebuildSVGOnly(wrap,b) {
  const old=wrap.querySelector('svg'); if(old) old.remove();
  const newSvg=buildBubbleSVG(b); newSvg.classList.add('bubble-svg'); wrap.insertBefore(newSvg,wrap.firstChild); applyBubbleClip(wrap,b);
}
function positionTailHandle(handle,b){handle.style.left=(b.w/2+b.w/2*Math.cos((b.tailAngle*Math.PI)/180))+'px';handle.style.top=(b.h/2+b.h/2*Math.sin((b.tailAngle*Math.PI)/180))+'px';}
function positionTailHandleInWrap(wrap,b){const th=wrap.querySelector('.tail-handle');if(th)positionTailHandle(th,b);wrap.querySelectorAll('.extra-tail-handle').forEach(h=>{const idx=parseInt(h.dataset.tailIdx);positionExtraTailHandle(h,b,idx);});}
function positionExtraTailHandle(handle,b,idx){const et=b.extraTails&&b.extraTails[idx];if(!et)return;const a=(et.angle*Math.PI)/180;handle.style.left=(b.w/2+b.w/2*Math.cos(a))+'px';handle.style.top=(b.h/2+b.h/2*Math.sin(a))+'px';}
function syncExtraTailHandles(wrap,b,pgKey){wrap.querySelectorAll('.extra-tail-handle').forEach(h=>h.remove());if(!b.extraTails)return;b.extraTails.forEach((et,idx)=>{if(!et)return;const h=document.createElement('div');h.className='extra-tail-handle';h.dataset.tailIdx=idx;positionExtraTailHandle(h,b,idx);wrap.appendChild(h);setupExtraTailDrag(h,b,idx,wrap);});}

function setupTailDrag(handle,b,pgKey,wrap){handle.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);const onMove=ev=>{const wr=wrap.getBoundingClientRect();const lx=(ev.clientX-wr.left)/scale-b.w/2,ly=(ev.clientY-wr.top)/scale-b.h/2;b.tailAngle=((Math.atan2(ly,lx)*180/Math.PI)+360)%360;positionTailHandle(handle,b);rebuildSVG(wrap,b);};const onUp=()=>{handle.removeEventListener('pointermove',onMove);handle.removeEventListener('pointerup',onUp);};handle.addEventListener('pointermove',onMove);handle.addEventListener('pointerup',onUp);});}

function setupExtraTailDrag(handle,b,idx,wrap){handle.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);const onMove=ev=>{const wr=wrap.getBoundingClientRect();const lx=(ev.clientX-wr.left)/scale-b.w/2,ly=(ev.clientY-wr.top)/scale-b.h/2;if(!b.extraTails[idx])return;b.extraTails[idx].angle=((Math.atan2(ly,lx)*180/Math.PI)+360)%360;positionExtraTailHandle(handle,b,idx);_rebuildSVGOnly(wrap,b);};const onUp=()=>{handle.removeEventListener('pointermove',onMove);handle.removeEventListener('pointerup',onUp);snapshotState?.();};handle.addEventListener('pointermove',onMove);handle.addEventListener('pointerup',onUp);});}

function setupDrag(wrap,b,pgKey){let ox=0,oy=0;wrap.addEventListener('pointerdown',e=>{if(b.lockMove)return;if(['sel-handle','rotate-handle','tail-handle','extra-tail-handle'].some(c=>e.target.classList.contains(c)))return;e.preventDefault();e.stopPropagation();wrap.setPointerCapture(e.pointerId);ox=e.clientX/scale-b.x;oy=e.clientY/scale-b.y;const onMove=ev=>{b.x=getSnapX(ev.clientX/scale-ox,pgKey);b.y=getSnapY(ev.clientY/scale-oy,pgKey);wrap.style.left=b.x+'px';wrap.style.top=b.y+'px';if(b.clipPanel!==null&&b.clipPanel!==undefined)applyBubbleClip(wrap,b);};const onUp=()=>{wrap.removeEventListener('pointermove',onMove);wrap.removeEventListener('pointerup',onUp);if(selectedBubble&&selectedBubble.data===b)syncBubbleEditorFields(b);};wrap.addEventListener('pointermove',onMove);wrap.addEventListener('pointerup',onUp);});}

function setupResize(handle,wrap,b,pgKey){if(!handle)return;let sx=0,sy=0,ox=0,oy=0,ow=0,oh=0;handle.addEventListener('pointerdown',e=>{if(b.lockResize)return;e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);sx=e.clientX;sy=e.clientY;ox=b.x;oy=b.y;ow=b.w;oh=b.h;const dir=handle.dataset.dir||'se';const onMove=ev=>{const dx=(ev.clientX-sx)/scale,dy=(ev.clientY-sy)/scale;let nx=ox,ny=oy,nw=ow,nh=oh;if(dir.includes('e'))nw=Math.max(100,ow+dx);if(dir.includes('s'))nh=Math.max(80,oh+dy);if(dir.includes('w')){nw=Math.max(100,ow-dx);nx=ox+ow-nw;}if(dir.includes('n')){nh=Math.max(80,oh-dy);ny=oy+oh-nh;}b.x=nx;b.y=ny;b.w=nw;b.h=nh;wrap.style.left=b.x+'px';wrap.style.top=b.y+'px';wrap.style.width=b.w+'px';wrap.style.height=b.h+'px';rebuildSVG(wrap,b);const td=wrap.querySelector('.bubble-text');if(td)updateTextStyle(td,b);positionTailHandleInWrap(wrap,b);};const onUp=()=>{handle.removeEventListener('pointermove',onMove);handle.removeEventListener('pointerup',onUp);if(selectedBubble&&selectedBubble.data===b)syncBubbleEditorFields(b);};handle.addEventListener('pointermove',onMove);handle.addEventListener('pointerup',onUp);});}

function setupRotate(handle,wrap,b){if(!handle)return;handle.addEventListener('pointerdown',e=>{if(b.lockRotate)return;e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);const onMove=ev=>{const r=wrap.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;b.rotate=Math.round(Math.atan2(ev.clientY-cy,ev.clientX-cx)*180/Math.PI+90);wrap.style.transform=`rotate(${b.rotate}deg)`;};const onUp=()=>{handle.removeEventListener('pointermove',onMove);handle.removeEventListener('pointerup',onUp);if(selectedBubble&&selectedBubble.data===b)syncBubbleEditorFields(b);};handle.addEventListener('pointermove',onMove);handle.addEventListener('pointerup',onUp);});}

// ── Select / Apply ────────────────────────────────────────────
// selectedBubble is declared in state.js — used directly here

function selectBubble(el, data, pgKey) {
  document.querySelectorAll('.bubble-wrap.selected').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected'); selectedBubble = { el, data, pgKey };
  refreshLayersPanel?.(pgKey);
  showBubbleEditorPanel(true);
  syncBubbleEditorFields(data);
  // Open bubble editor drawer tab
  openDrawerTab?.('bubbles', 'bubble');
}
window.selectBubble = selectBubble;

// Show/hide the "Selected Bubble" section vs. the "click a bubble" hint.
function showBubbleEditorPanel(show) {
  const noSel  = document.getElementById('bp-nosel');
  const editor = document.getElementById('bp-editor');
  if (noSel)  noSel.style.display  = show ? 'none' : '';
  if (editor) editor.style.display = show ? '' : 'none';
}
window.showBubbleEditorPanel = showBubbleEditorPanel;

// Copy a bubble's current data into the bp-* editor fields. Called on
// select, and again whenever the drawer re-renders (openDrawer/tab
// switch wipes #drawer's innerHTML, which resets every field to blank).
function syncBubbleEditorFields(b) {
  if (!b) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('bp-type', b.type);
  set('bp-speaker', b.speaker || '');
  set('bp-text', b.text || '');
  set('bp-font', b.font);
  set('bp-fsize', b.fontSize);
  set('bp-color', b.color || '#111111');
  set('bp-line-height', b.lineHeight != null ? b.lineHeight : 1.3);
  set('bp-pad-ratio', b.padRatio != null ? b.padRatio : 0.14);
  set('bp-x', Math.round(b.x));
  set('bp-y', Math.round(b.y));
  set('bp-w', Math.round(b.w));
  set('bp-h', Math.round(b.h));
  set('bp-rot', b.rotate || 0);
  set('bp-tail-angle', Math.round(b.tailAngle != null ? b.tailAngle : 225));
  set('bp-tail-len', b.tailLen != null ? b.tailLen : 150);
  set('bp-tail-breadth', b.tailBreadth != null ? b.tailBreadth : 1.0);
  set('bp-dot-count', b.dotCount || 4);
  set('bp-spike-count', b.spikeCount || 16);
  set('bp-dash-count', b.dashCount || 7);
  document.getElementById('bp-bold')?.classList.toggle('active', !!b.bold);
  document.getElementById('bp-italic')?.classList.toggle('active', !!b.italic);
  document.getElementById('lock-move')?.classList.toggle('active', !!b.lockMove);
  document.getElementById('lock-resize')?.classList.toggle('active', !!b.lockResize);
  document.getElementById('lock-rotate')?.classList.toggle('active', !!b.lockRotate);
}
window.syncBubbleEditorFields = syncBubbleEditorFields;

function deselectBubble() {
  document.querySelectorAll('.bubble-wrap.selected').forEach(el => el.classList.remove('selected'));
  selectedBubble = null;
  showBubbleEditorPanel(false);
}
window.deselectBubble = deselectBubble;

function applyBubble(b, wrap, pgKey) {
  applyBubbleStyle(wrap, b); rebuildSVG(wrap, b);
  const td = wrap.querySelector('.bubble-text'); if(td) updateTextStyle(td, b);
  positionTailHandleInWrap(wrap, b); refreshLayersPanel?.(pgKey);
}
window.applyBubble = applyBubble;

function getActiveBubble() {
  if (selectedBubble) return selectedBubble;
  const activeRow = document.querySelector('.layer-row.active'); if(!activeRow) return null;
  const id = activeRow.dataset.id; if(!id) return null;
  for (const pg of Object.keys(bubbles)) { const b=(bubbles[pg]||[]).find(x=>x.id===id); if(b){const el=document.querySelector(`.bubble-wrap[data-id="${id}"]`);return el?{data:b,el,pgKey:pg}:null;} }
  return null;
}

let _bpInputSnapTimer = null;
function debouncedSnapshot(delay=800){clearTimeout(_bpInputSnapTimer);_bpInputSnapTimer=setTimeout(()=>snapshotState?.(),delay);}

function bpUpdate(field, val) {
  const ab = getActiveBubble(); if(!ab) return;
  ab.data[field]=val; applyBubble(ab.data,ab.el,ab.pgKey);
  if(['type','font','bold','italic'].includes(field)) snapshotState?.(); else debouncedSnapshot();
}
window.bpUpdate = bpUpdate;

function bpToggle(field){const ab=getActiveBubble();if(!ab)return;ab.data[field]=!ab.data[field];applyBubble(ab.data,ab.el,ab.pgKey);document.getElementById('bp-'+field)?.classList.toggle('active',ab.data[field]);}
window.bpToggle = bpToggle;

function bpLockToggle(field){const ab=getActiveBubble();if(!ab)return;snapshotState?.();const key='lock'+field[0].toUpperCase()+field.slice(1);ab.data[key]=!ab.data[key];applyBubbleStyle(ab.el,ab.data);document.getElementById('lock-'+field)?.classList.toggle('active',ab.data[key]);}
window.bpLockToggle = bpLockToggle;

function bpUpdatePos(){const ab=getActiveBubble();if(!ab)return;const b=ab.data,wrap=ab.el,g=id=>{const e=document.getElementById(id);return e?+e.value:null;},gm=(id,fb)=>{const v=g(id);return v!==null?v:fb;};b.x=gm('bp-x',b.x);b.y=gm('bp-y',b.y);b.w=Math.max(100,gm('bp-w',b.w));b.h=Math.max(80,gm('bp-h',b.h));b.rotate=gm('bp-rot',b.rotate);b.tailAngle=gm('bp-tail-angle',b.tailAngle);b.tailLen=gm('bp-tail-len',b.tailLen);b.tailBreadth=gm('bp-tail-breadth',b.tailBreadth||1.0);b.lineHeight=gm('bp-line-height',b.lineHeight!=null?b.lineHeight:1.3);b.padRatio=gm('bp-pad-ratio',b.padRatio!=null?b.padRatio:0.14);applyBubble(b,wrap,ab.pgKey);}
window.bpUpdatePos = bpUpdatePos;

function bpSetClipPanel(val){const ab=getActiveBubble();if(!ab)return;snapshotState?.();ab.data.clipPanel=(val===''||val===null)?null:parseInt(val);applyBubble(ab.data,ab.el,ab.pgKey);}
window.bpSetClipPanel = bpSetClipPanel;

function deleteSelectedBubble(){if(!selectedBubble)return;const{el,data,pgKey}=selectedBubble;bubbles[pgKey]=(bubbles[pgKey]||[]).filter(b=>b.id!==data.id);el.remove();selectedBubble=null;refreshLayersPanel?.(pgKey);}
window.deleteSelectedBubble = deleteSelectedBubble;

function duplicateBubbleById(pgKey, id){const bbs=bubbles[pgKey]||[];const b=bbs.find(x=>x.id===id);if(!b)return;snapshotState?.();const nb=JSON.parse(JSON.stringify(b));nb.id='b'+Date.now()+Math.random().toString(36).slice(2,6);nb.x+=40;nb.y+=40;nb.zIndex=(bbs.length+1);bbs.push(nb);renderBubblesOnPage(pgKey);refreshLayersPanel?.(pgKey);showToast('Bubble duplicated');}
window.duplicateBubbleById = duplicateBubbleById;

// ── Deselect on canvas background click ──────────────────────
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.bubble-wrap') && !e.target.closest('#drawer')) {
    deselectBubble();
  }
});

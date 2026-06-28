// ============================================================
// js/export.js — Step 6
// SVG export, PNG export, Excel/CSV export, JSON project
// export/import.  All functions mirror the originals from the
// monolithic index.html verbatim (spec note 1 — no refactor
// beyond wiring to the new IDs used by the drawer UI).
//
// Global helpers it depends on (all in window scope by load order):
//   generate.js : buildSVG, computePanelRects, _lastBaseRects
//   state.js    : rows, pageSettings, panelOverrides, cornerOffsets,
//                 cornerEnabled, splitOffsets, bubbles, scale,
//                 pageBypageMode, _pbpCurrentPage, PAGE_W, PAGE_H
//   bubbles.js  : buildBubbleSVG, buildBubbleTextSVGNative, BUBBLE_FONTS
//   ui.js       : showToast
// ============================================================

// ── Font helpers ─────────────────────────────────────────────

async function fetchFontB64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  } catch (_) { return null; }
}

async function buildFontDefs() {
  const LOCAL_FONTS = [
    { family: 'BubbleSans',    url: 'Bubble_Sans.otf',   fmt: 'opentype' },
    { family: 'XLTightBoo',    url: 'XL-TightBoo.otf',   fmt: 'opentype' },
    { family: 'TGLEngschrift', url: 'TGL_0-1451Eng.ttf', fmt: 'truetype' },
  ];
  // Include any user-uploaded custom fonts (populated by bubbles.js)
  const fontDataURLs = window._customFontDataURLs || {};
  const BFONTS = window.BUBBLE_FONTS || {};
  for (const [key, family] of Object.entries(BFONTS)) {
    if (key.startsWith('custom') && fontDataURLs[key]) {
      LOCAL_FONTS.push({ family: family.split(',')[0].replace(/[\"\']/g, ''), dataUrl: fontDataURLs[key] });
    }
  }

  const rules = [];
  for (const f of LOCAL_FONTS) {
    if (f.dataUrl) {
      rules.push(`@font-face{font-family:'${f.family}';src:url('${f.dataUrl}')}`);
    } else {
      const b64 = await fetchFontB64(f.url);
      if (b64) {
        const mime = f.fmt === 'truetype' ? 'font/ttf' : 'font/otf';
        rules.push(`@font-face{font-family:'${f.family}';src:url('data:${mime};base64,${b64}') format('${f.fmt}')}`);
      } else {
        rules.push(`@font-face{font-family:'${f.family}';src:url('${f.url}') format('${f.fmt}')}`);
      }
    }
  }
  rules.push(`@import url('https://fonts.googleapis.com/css2?family=Bangers&amp;family=Permanent+Marker&amp;family=Caveat:wght@600&amp;display=swap');`);
  return `<defs><style>${rules.join('')}</style></defs>`;
}

// ── Transparent-background helper ────────────────────────────

function getExportFillColor(transparentOverride) {
  if (transparentOverride) return 'none';
  return document.getElementById('panelFill')?.value || '#ffffff';
}

// ── SVG string builder (for export) ─────────────────────────

function buildExportSVGString(pg, fontDefsStr, transparent) {
  const pgNum = parseInt((pg.match(/\d+/) || [1])[0]);
  const fillColor   = getExportFillColor(transparent);
  const strokeColor = document.getElementById('panelStroke')?.value || '#111111';
  const strokeW     = parseInt(document.getElementById('strokeWidth')?.value) || 8;
  const ps          = pageSettings[pg] || { mode: 'safe', gutter: 12 };
  const pageRows    = rows.filter(r => r.pg === pg);

  let baseRects;
  if (panelOverrides[pg]?._lockedRects?.length) {
    baseRects = panelOverrides[pg]._lockedRects;
  } else {
    baseRects = computePanelRects(pageRows, ps.mode, ps.gutter, ps.flow || 'v-first');
  }

  const _pgOvs = panelOverrides[pg] || {};
  const panelRects = baseRects.map((r, idx) => {
    const ov = _pgOvs[idx];
    if (!ov) return r;
    return { ...r,
      x: ov.x !== undefined ? ov.x : r.x,
      y: ov.y !== undefined ? ov.y : r.y,
      w: ov.w !== undefined ? ov.w : r.w,
      h: ov.h !== undefined ? ov.h : r.h,
      _hidden: ov.visible === false,
    };
  });

  let exportSvg = buildSVG(pg, pgNum, panelRects, fillColor, strokeColor, strokeW, true, _pgOvs);
  exportSvg = exportSvg.replace(/<defs>.*?<\/defs>/s, fontDefsStr);

  const pgBubbles = (bubbles || {})[pg] || [];
  if (pgBubbles.length) {
    const serializer = new XMLSerializer();
    const sw = strokeW / 2;

    const clipDefs = pgBubbles
      .filter(b => b.clipPanel !== null && b.clipPanel !== undefined && panelRects[b.clipPanel])
      .map(b => {
        const r  = panelRects[b.clipPanel];
        const co = (cornerOffsets[pg] || {})[b.clipPanel];
        const ena = (cornerEnabled[pg] || {})[b.clipPanel];
        const hasCorners = co && ena !== false &&
          (co.tl || co.tr || co.bl || co.br || co.tlY || co.trY || co.blY || co.brY);
        let clipShape;
        if (hasCorners) {
          const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
          const pts = [
            `${(x1 + (co.tl||0) + sw).toFixed(1)},${(y1 + (co.tlY||0) + sw).toFixed(1)}`,
            `${(x2 + (co.tr||0) - sw).toFixed(1)},${(y1 + (co.trY||0) + sw).toFixed(1)}`,
            `${(x2 + (co.br||0) - sw).toFixed(1)},${(y2 + (co.brY||0) - sw).toFixed(1)}`,
            `${(x1 + (co.bl||0) + sw).toFixed(1)},${(y2 + (co.blY||0) - sw).toFixed(1)}`,
          ].join(' ');
          clipShape = `<polygon points="${pts}"/>`;
        } else {
          const cx = (r.x + sw).toFixed(1), cy = (r.y + sw).toFixed(1);
          const cw = Math.max(0, r.w - sw * 2).toFixed(1);
          const ch = Math.max(0, r.h - sw * 2).toFixed(1);
          clipShape = `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}"/>`;
        }
        return `<clipPath id="bclip-${b.id}">${clipShape}</clipPath>`;
      }).join('');

    if (clipDefs) {
      exportSvg = exportSvg.replace('</defs>', clipDefs + '</defs>');
    }

    const bubbleGroup = pgBubbles.map(b => {
      const bsvgEl = buildBubbleSVG(b);
      let bsvgStr = new XMLSerializer().serializeToString(bsvgEl);
      bsvgStr = bsvgStr.replace(/ style="[^"]*"/g, '');
      const inner = `<g transform="translate(${b.x},${b.y}) rotate(${b.rotate||0},${b.w/2},${b.h/2})">${bsvgStr}${buildBubbleTextSVGNative(b)}</g>`;
      if (b.clipPanel !== null && b.clipPanel !== undefined && panelRects[b.clipPanel]) {
        return `<g clip-path="url(#bclip-${b.id})">${inner}</g>`;
      }
      return inner;
    }).join('');
    exportSvg = exportSvg.replace('</svg>', bubbleGroup + '</svg>');
  }
  return exportSvg;
}

// ── Export All SVG ───────────────────────────────────────────

async function exportAllSVG(pageFilter, transparent) {
  let containers = Array.from(document.querySelectorAll('.page-output[data-svg]'));
  if (!containers.length) { showToast('Generate pages first!'); return; }
  if (pageFilter && pageFilter !== '__all__') {
    containers = containers.filter(c => c.dataset.pg === pageFilter);
  }
  showToast('Building fonts… please wait');
  const fontDefsStr = await buildFontDefs();
  const downloads = [];
  containers.forEach(c => {
    const pg     = c.dataset.pg;
    const pgSafe = pg.replace(/\s/g, '_');
    const svgStr = buildExportSVGString(pg, fontDefsStr, transparent);
    const blob   = new Blob([svgStr], { type: 'image/svg+xml' });
    downloads.push({ url: URL.createObjectURL(blob), filename: `manga_${pgSafe}.svg` });
  });
  const total = downloads.length;
  downloads.forEach(({ url, filename }, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      if (i === total - 1) showToast(`Exported ${total} SVG file(s) ✓`);
    }, i * 200);
  });
}
window.exportAllSVG = exportAllSVG;

// ── SVG → PNG renderer ───────────────────────────────────────

function renderSVGtoPNG(svgStr, w, h, filename) {
  return new Promise(resolve => {
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      setTimeout(() => {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(pngBlob => {
          const purl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = purl; a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(purl), 2000);
          resolve();
        }, 'image/png');
      }, 200);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    img.src = url;
  });
}

// ── Export All PNG ───────────────────────────────────────────

async function exportAllPNG(pageFilter, transparent) {
  let containers = Array.from(document.querySelectorAll('.page-output[data-svg]'));
  if (!containers.length) { showToast('Generate pages first!'); return; }
  if (pageFilter && pageFilter !== '__all__') {
    containers = containers.filter(c => c.dataset.pg === pageFilter);
  }
  showToast('Rendering PNGs… this may take a moment');
  const fontDefsStr = await buildFontDefs();
  const total = containers.length;
  let done = 0;
  for (const c of containers) {
    const pg     = c.dataset.pg;
    const pgSafe = pg.replace(/\s/g, '_');
    const svgStr = buildExportSVGString(pg, fontDefsStr, transparent);
    await renderSVGtoPNG(svgStr, PAGE_W, PAGE_H, `manga_${pgSafe}.png`);
    done++;
    showToast(`Exporting PNG ${done}/${total}…`);
    await new Promise(r => setTimeout(r, 100));
  }
  showToast(`Exported ${total} PNG file(s) ✓`);
}
window.exportAllPNG = exportAllPNG;

// ── Export Excel / CSV ───────────────────────────────────────

function loadSheetJS() {
  return new Promise((res, rej) => {
    if (window.XLSX) { res(window.XLSX); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = () => res(window.XLSX);
    s.onerror = () => rej(new Error('SheetJS failed'));
    document.head.appendChild(s);
  });
}

async function exportExcel() {
  if (!rows.length) { showToast('No data to export!'); return; }
  try {
    const XLSX = await loadSheetJS();
    const headers = ['Chapter No.','Scene No.','Page No.','Panel No.','Row No.',
      'Panel (L x H in %)','Total Max Panel L per row (/100)','Total Max Panel H per row (/100)'];
    const data = [headers, ...rows.map(r => [r.chp, r.scn, r.pg, r.pnl, r.row, r.lh, r.maxL, r.maxH])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Panels');
    XLSX.writeFile(wb, 'manga_panels.xlsx');
    showToast('Excel exported!');
  } catch (_) {
    const headers = 'Chapter No.,Scene No.,Page No.,Panel No.,Row No.,Panel (L x H in %),Total Max Panel L per row (/100),Total Max Panel H per row (/100)';
    const csv = [headers, ...rows.map(r => [r.chp, r.scn, r.pg, r.pnl, r.row, r.lh, r.maxL, r.maxH].join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'manga_panels.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast('Exported as CSV (SheetJS unavailable)');
  }
}
window.exportExcel = exportExcel;

// ── JSON project export ──────────────────────────────────────

function buildSaveData() {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
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
    pageBypageMode,
    pbpCurrentPage: window._pbpCurrentPage || null,
    globalSettings: {
      scale:       document.getElementById('scaleSlider')?.value,
      panelFill:   document.getElementById('panelFill')?.value,
      panelStroke: document.getElementById('panelStroke')?.value,
      strokeWidth: document.getElementById('strokeWidth')?.value,
    }
  };
}
window.buildSaveData = buildSaveData;

function exportProjectJSON() {
  const data = JSON.stringify(buildSaveData(), null, 2);
  const blob  = new Blob([data], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  const date  = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `manga-save-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON exported ✓');
}
window.exportProjectJSON = exportProjectJSON;

// ── JSON project import ──────────────────────────────────────

function restoreSaveData(data) {
  if (data.rows)           { rows = data.rows; renderTable?.(); }
  if (data.pageSettings)   { Object.assign(pageSettings,   data.pageSettings);   refreshPageSettings?.(); }
  if (data.bubbles)        { Object.assign(bubbles,        data.bubbles); }
  if (data.textElements)   { Object.assign(textElements,   data.textElements); }
  if (data.panelOverrides) { Object.assign(panelOverrides, data.panelOverrides); }
  if (data.cornerOffsets)  { Object.assign(cornerOffsets,  data.cornerOffsets);  }
  if (data.cornerLocks)    { Object.assign(cornerLocks,    data.cornerLocks);    }
  if (data.cornerAxisMode) { Object.assign(cornerAxisMode, data.cornerAxisMode); }
  if (data.cornerEnabled)  { Object.assign(cornerEnabled,  data.cornerEnabled);  }
  if (data.splitOffsets)   { Object.assign(splitOffsets,   data.splitOffsets);   }
  if (data.splitLocks)     { Object.assign(splitLocks,     data.splitLocks);     }

  // Migrate old single `split` → `splits` array in panelOverrides
  Object.values(panelOverrides).forEach(pgOvs => {
    Object.keys(pgOvs).forEach(k => {
      if (k === '_lockedRects') return;
      const ov = pgOvs[k];
      if (ov && typeof ov === 'object' && ov.split && !ov.splits) {
        ov.splits = [ov.split]; delete ov.split;
      }
    });
  });
  // Migrate flat splitOffsets
  Object.keys(splitOffsets).forEach(pg => {
    Object.keys(splitOffsets[pg]).forEach(idx => {
      const so = splitOffsets[pg][idx];
      if (so && typeof so === 'object' && !Array.isArray(so)) {
        if ('aX' in so || 'aY' in so || 'bX' in so || 'bY' in so) {
          splitOffsets[pg][idx] = { 0: so };
        }
      }
    });
  });

  if (data.pageBypageMode !== undefined) {
    pageBypageMode        = data.pageBypageMode;
    window._pbpCurrentPage = data.pbpCurrentPage || null;
  }
  if (data.globalSettings) {
    const gs = data.globalSettings;
    if (gs.scale)       { const sl = document.getElementById('scaleSlider'); if (sl) { sl.value = gs.scale; updateScale?.(gs.scale); } }
    if (gs.panelFill)   { const el = document.getElementById('panelFill');   if (el) el.value = gs.panelFill; }
    if (gs.panelStroke) { const el = document.getElementById('panelStroke'); if (el) el.value = gs.panelStroke; }
    if (gs.strokeWidth) { const el = document.getElementById('strokeWidth'); if (el) el.value = gs.strokeWidth; }
  }
}
window.restoreSaveData = restoreSaveData;

function importFromJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      restoreSaveData(data);
      setTimeout(() => {
        generateAll?.();
        showToast('Project loaded from JSON ✓');
      }, 200);
    } catch (_) {
      showToast('Invalid JSON file');
    }
  };
  reader.readAsText(file);
}
window.importFromJSON = importFromJSON;

// ── Autosave restore ─────────────────────────────────────────

function restoreAutoSave() {
  try {
    const raw = localStorage.getItem('mpg_autosave');
    if (!raw) { showToast('No autosave found'); return; }
    const data = JSON.parse(raw);
    restoreSaveData(data);
    showToast('Autosave restored ✓');
    setTimeout(() => generateAll?.(), 200);
  } catch (_) { showToast('Could not restore autosave'); }
}
window.restoreAutoSave = restoreAutoSave;

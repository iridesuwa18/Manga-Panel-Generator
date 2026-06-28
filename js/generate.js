// ============================================================
// js/generate.js — Step 3
// Panel geometry constants, the layout engine (computePanelRects),
// SVG generation (buildSVG), and generateAll(). Moved verbatim
// from the original monolith per spec Implementation Note #2
// ("panel geometry math ... stays in js/generate.js unchanged —
// it is correct and tested"). Only adjustments made:
//   - fillColor/strokeColor/strokeW now read from state
//     (panelFillColor/panelStrokeColor/panelStrokeWidth in
//     state.js) instead of #panelFill/#panelStroke/#strokeWidth
//     DOM inputs, since those inputs don't exist until the
//     Panel Editor drawer is built in Step 7. js/panels.js will
//     write to these state vars when the real controls exist;
//     until then the defaults match the old monolith exactly.
//   - canvasArea lookup renamed to #canvasInner (matches the
//     new HTML skeleton's id, same element role as before).
//   - showToast() is called defensively (window.showToast?.())
//     since it doesn't exist until js/ui.js (Step 5).
//   - getPages()/computePanelRects()/buildSVG() logic itself is
//     untouched — same skyline-packing layout engine, same
//     split/gap/corner-skew SVG rendering.
// ============================================================

// ── Full-res manga page geometry (unchanged from original) ──
const PAGE_W = 3300, PAGE_H = 4677;
const FRAME_W = 2800, FRAME_H = 3940; // framing border (centered in page)
const SAFE_W  = 2520, SAFE_H  = 3940; // safe zone (within framing border)
const FRAME_X = (PAGE_W - FRAME_W) / 2; // 250
const FRAME_Y = (PAGE_H - FRAME_H) / 2; // 368.5

const DRAW_W = 2520, DRAW_H = 3940;
const DRAW_Y = FRAME_Y; // same top as frame

function getDrawX(isOdd) {
  return isOdd
    ? FRAME_X                      // left-anchored (odd)
    : FRAME_X + FRAME_W - DRAW_W;  // right-anchored (even) = 250+2800-2520 = 530
}

const SAFE_MARGIN_X = (DRAW_W - SAFE_W) / 2; // (2520-2520)/2 = 0 actually same width
const REAL_SAFE_W = 2205, REAL_SAFE_H = 3625;

function getSafeRect(isOdd) {
  const drawX = getDrawX(isOdd);
  const sx = drawX + (DRAW_W - REAL_SAFE_W) / 2;
  const sy = DRAW_Y + (DRAW_H - REAL_SAFE_H) / 2;
  return { x: sx, y: sy, w: REAL_SAFE_W, h: REAL_SAFE_H };
}

// ─────────────────────────────────────────────
// PAGES
// ─────────────────────────────────────────────
function getPages() {
  const seen = new Map();
  rows.forEach(r => {
    if (!seen.has(r.pg)) seen.set(r.pg, r.chp);
  });
  return [...seen.entries()].map(([pg, chp]) => ({ pg, chp }));
}

// ─────────────────────────────────────────────
// LAYOUT ENGINE
// ─────────────────────────────────────────────
function parseLH(str) {
  const parts = str.toString().toLowerCase().split('x');
  return { l: parseFloat(parts[0]) || 0, h: parseFloat(parts[1]) || 0 };
}

function deduplicateRows(pageRows) {
  const seen = new Set();
  return pageRows.filter(r => {
    const key = r.pg + '|' + r.pnl + '|' + r.row;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function computePanelRects(pageRows, mode, gutter, flow = 'v-first') {
  pageRows = deduplicateRows(pageRows);

  const isOdd = (() => {
    const pg = pageRows[0]?.pg || 'PG 1';
    return parseInt((pg.match(/\d+/) || [1])[0]) % 2 !== 0;
  })();

  const safe = getSafeRect(isOdd);
  const drawX = getDrawX(isOdd);

  const groupBoundsCache = new Map();
  function getGroupBounds(groupKey) {
    if (groupBoundsCache.has(groupKey)) return groupBoundsCache.get(groupKey);
    let useFrame = false;
    if (mode === 'frame') useFrame = true;
    else if (mode === 'random') useFrame = Math.random() > 0.5;
    const b = useFrame
      ? { left: drawX, top: DRAW_Y, width: DRAW_W, height: DRAW_H }
      : { left: safe.x, top: safe.y, width: safe.w, height: safe.h };
    groupBoundsCache.set(groupKey, b);
    return b;
  }

  const groups = new Map();
  pageRows.forEach(r => {
    if (!groups.has(r.row)) groups.set(r.row, []);
    groups.get(r.row).push(r);
  });
  const keys = [...groups.keys()];
  const isCLM = pageRows.some(r => r.row.toString().toUpperCase().startsWith('CLM'));
  const rects = [];

  if (isCLM) {
    // ── COLUMN MODE ──────────────────────────────────────────────────────
    // Columns go left→right. Within each column panels stack top→bottom.
    let curX = null;
    keys.forEach(clmKey => {
      const panels = groups.get(clmKey);
      const bounds = getGroupBounds(clmKey);
      if (curX === null) curX = bounds.left;
      const maxLpct = parseFloat(panels[0].maxL) / 100;
      const colW = bounds.width * maxLpct;
      let curY = bounds.top;
      panels.forEach(p => {
        const { h } = parseLH(p.lh);
        const ph = bounds.height * (h / 100);
        rects.push({
          pnl: p.pnl, pg: p.pg,
          x: curX, y: curY,
          w: Math.max(0, colW - gutter),
          h: Math.max(0, ph - gutter)
        });
        curY += ph;
      });
      curX += colW;
    });

  } else {
    // ── ROW MODE ─────────────────────────────────────────────────────────
    //
    // Think of each RW group as a rectangular region (groupW x groupH).
    // We place panels into this region using a SKYLINE packer:
    //
    //   skyline = array of {x, y} sorted by x, meaning "at position x,
    //             the next free Y is y". Starts as [{x: originX, y: originY}].
    //
    // For each panel (pw x ph):
    //   1. Find the leftmost position in the skyline where the panel fits
    //      horizontally (pw wide) and the skyline is at its lowest Y there.
    //      "Fits" means x + pw <= originX + groupW.
    //   2. Place the panel at that (x, skylineY).
    //   3. Update the skyline: raise the segment [x, x+pw] by ph.
    //
    // This naturally handles:
    //   - Side-by-side panels (they go left→right at the same Y)
    //   - Stacking (short panel leaves gap, next panel fills it)
    //   - Mixed layouts (PNL1 tall on left, PNL2 short top-right, PNL3/4 below PNL2)

    let groupOriginY = null;

    keys.forEach(rowKey => {
      const panels = groups.get(rowKey);
      const bounds = getGroupBounds(rowKey);
      if (groupOriginY === null) groupOriginY = bounds.top;

      const maxLpct = parseFloat(panels[0].maxL) / 100;
      const maxHpct = parseFloat(panels[0].maxH) / 100;
      const groupW = bounds.width * maxLpct;
      const groupH = bounds.height * maxHpct;
      const originX = bounds.left;
      const originY = groupOriginY;

      // Skyline: sorted array of segments {x, y}
      // Segment i covers [skyline[i].x, skyline[i+1].x) with free Y = skyline[i].y
      // Last segment implicitly ends at originX + groupW
      if (flow === 'v-first') {
        // ── V-FIRST: stack panels vertically in a column, advance X when full ──
        // Good for layouts where same-width panels stack (e.g. PNL2+3 both 20x25)
        let curX = originX;
        const colNextY = {};

        panels.forEach(p => {
          const { l, h } = parseLH(p.lh);
          const pw = bounds.width * (l / 100);
          const ph = bounds.height * (h / 100);

          const xk = Math.round(curX * 100);
          if (!(xk in colNextY)) colNextY[xk] = originY;
          const py = colNextY[xk];
          const px = curX;

          colNextY[xk] = py + ph;

          // Advance curX only when this column is full
          if (colNextY[xk] >= originY + groupH - 0.5) {
            curX += pw;
          }

          rects.push({
            pnl: p.pnl, pg: p.pg,
            x: px, y: py,
            w: Math.max(0, pw - gutter),
            h: Math.max(0, ph - gutter)
          });
        });

      } else {
        // ── H-FIRST: fill row left→right, wrap down when line width fills ──
        // Good for layouts where a tall panel sits left and shorter panels
        // fill the remaining space in sub-rows (e.g. PNL1 tall, PNL2 short top-right,
        // PNL3+4 fill below PNL2)
        // Uses a per-x nextY tracker; curX only advances when its column is full,
        // but new columns inherit the Y level of their left neighbour's nextY.
        let curX = originX;
        const colNextY = {};
        const colOrder = [];

        let lastStartY = originY; // Y of the panel that last triggered a curX advance

        panels.forEach(p => {
          const { l, h } = parseLH(p.lh);
          const pw = bounds.width * (l / 100);
          const ph = bounds.height * (h / 100);

          const xk = Math.round(curX * 100);
          if (!(xk in colNextY)) {
            // New column: start at lastStartY if set, else check open cols, else originY
            const openCols = colOrder.filter(k => colNextY[k] < originY + groupH - 0.5);
            colNextY[xk] = openCols.length > 0
              ? colNextY[openCols[openCols.length - 1]]
              : lastStartY > originY + 0.5 ? lastStartY : originY;
            colOrder.push(xk);
          }

          const py = colNextY[xk];
          const px = curX;

          colNextY[xk] = py + ph;

          if (colNextY[xk] >= originY + groupH - 0.5) {
            lastStartY = py; // remember where this panel started
            curX += pw;
          }

          rects.push({
            pnl: p.pnl, pg: p.pg,
            x: px, y: py,
            w: Math.max(0, pw - gutter),
            h: Math.max(0, ph - gutter)
          });
        });
      }

      groupOriginY += groupH;
    });
  }

  return rects;
}

// ─────────────────────────────────────────────
// SVG GENERATION
// ─────────────────────────────────────────────
function buildSVG(pg, pgNum, panelRects, fillColor, strokeColor, strokeW, forExport = false, ovs = null) {
  const isOdd = pgNum % 2 !== 0;
  const drawX = getDrawX(isOdd);
  const safe = getSafeRect(isOdd);

  const overflowAttr = forExport ? ' overflow="visible"' : '';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}"${overflowAttr}>`;

  if (forExport) {
    svg += `<defs><style>@font-face{font-family:'BubbleSans';src:url('Bubble_Sans.otf') format('opentype')}@font-face{font-family:'XLTightBoo';src:url('XL-TightBoo.otf') format('opentype')}@font-face{font-family:'TGLEngschrift';src:url('TGL_0-1451Eng.ttf') format('truetype')}</style></defs>`;
  } else {
    svg += `<rect width="${PAGE_W}" height="${PAGE_H}" fill="white"/>`;
    svg += `<rect x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_W}" height="${FRAME_H}" fill="none" stroke="#ccc" stroke-width="2" stroke-dasharray="20,10"/>`;
    svg += `<rect x="${drawX}" y="${DRAW_Y}" width="${DRAW_W}" height="${DRAW_H}" fill="none" stroke="#ddd" stroke-width="2" stroke-dasharray="10,6"/>`;
    svg += `<rect x="${safe.x}" y="${safe.y}" width="${safe.w}" height="${safe.h}" fill="none" stroke="#e8d5a3" stroke-width="2" stroke-dasharray="6,4" opacity="0.4"/>`;
  }

  const pgCorners = cornerOffsets[pg] || {};
  const pgCornerEnabled = cornerEnabled[pg] || {};

  // Helper: get the 4 effective corner points of a panel
  function getPanelCornerPts(r, co, isEnabled) {
    const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
    if (!co || !isEnabled) return { tl: { x: x1, y: y1 }, tr: { x: x2, y: y1 }, br: { x: x2, y: y2 }, bl: { x: x1, y: y2 } };
    return {
      tl: { x: x1 + (co.tl || 0), y: y1 + (co.tlY || 0) },
      tr: { x: x2 + (co.tr || 0), y: y1 + (co.trY || 0) },
      br: { x: x2 + (co.br || 0), y: y2 + (co.brY || 0) },
      bl: { x: x1 + (co.bl || 0), y: y2 + (co.blY || 0) },
    };
  }
  function lp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function pp(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }
  function polyAttr(...pts) { return pts.map(pp).join(' '); }

  const _ovs = ovs || panelOverrides[pg] || {};

  // Build clipPath defs for panels with splits so lines/gaps never surpass the panel boundary
  let _defsContent = '';
  panelRects.filter(r => !r._hidden).forEach((r, idx) => {
    const _co2 = pgCorners[idx];
    const _ena2 = pgCornerEnabled[idx] !== false;
    const _ov2 = _ovs[idx] || {};
    const _splitsCheck = _ov2.splits ? _ov2.splits : (_ov2.split ? [_ov2.split] : []);
    if (!_splitsCheck.length) return;
    const _c2 = getPanelCornerPts(r, _co2, _ena2);
    const _exp = strokeW / 2 + 1;
    const _clipPts = [
      { x: _c2.tl.x - _exp, y: _c2.tl.y - _exp },
      { x: _c2.tr.x + _exp, y: _c2.tr.y - _exp },
      { x: _c2.br.x + _exp, y: _c2.br.y + _exp },
      { x: _c2.bl.x - _exp, y: _c2.bl.y + _exp },
    ];
    const _safeId = `clip_${pg.replace(/[^a-z0-9]/gi, '_')}_${idx}`;
    _defsContent += `<clipPath id="${_safeId}"><polygon points="${_clipPts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}"/></clipPath>`;
  });
  if (_defsContent) svg += `<defs>${_defsContent}</defs>`;

  panelRects.filter(r => !r._hidden).forEach((r, idx) => {
    const co = pgCorners[idx];
    const isEnabled = pgCornerEnabled[idx] !== false; // default true if set, but default off if never set
    const hasCorners = co && isEnabled;
    const sp = _ovs[idx]?.split || null;
    const corners = getPanelCornerPts(r, co, isEnabled);
    const isSkewed = hasCorners && (co.tl || co.tr || co.bl || co.br || co.tlY || co.trY || co.blY || co.brY);
    const _clipId = `clip_${pg.replace(/[^a-z0-9]/gi, '_')}_${idx}`;

    // Normalise: support both legacy single `split` and new `splits` array
    const _ov = _ovs[idx] || {};
    const splitsArr = _ov.splits ? _ov.splits : (sp ? [sp] : []);

    // ── Polygon subdivision helpers ──────────────────────────────────────────
    // Clip a convex polygon to the half-plane on the LEFT side of directed line P→Q.
    // Returns a new polygon (array of {x,y}).
    function clipPolyToHalfPlane(poly, P, Q) {
      if (!poly.length) return [];
      const out = [];
      const dx = Q.x - P.x, dy = Q.y - P.y;
      function side(pt) { return dx * (pt.y - P.y) - dy * (pt.x - P.x); } // >0 = left
      function intersect(a, b) {
        const da = side(a), db = side(b);
        const t = da / (da - db);
        return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      }
      for (let i = 0; i < poly.length; i++) {
        const cur = poly[i], nxt = poly[(i + 1) % poly.length];
        const sc = side(cur), sn = side(nxt);
        if (sc >= 0) out.push(cur);
        if ((sc > 0 && sn < 0) || (sc < 0 && sn > 0)) out.push(intersect(cur, nxt));
      }
      return out;
    }

    // Split a polygon with a directed line (P→Q): returns [leftPoly, rightPoly].
    function splitPoly(poly, P, Q) {
      const left = clipPolyToHalfPlane(poly, P, Q);
      // Right = clip to opposite half-plane (reverse direction)
      const right = clipPolyToHalfPlane(poly, Q, P);
      return [left, right];
    }

    // Extend a line through two points far beyond the canvas so it always fully cuts any polygon
    function extendLine(A, B) {
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const FAR = 99999;
      return {
        P: { x: A.x - dx / len * FAR, y: A.y - dy / len * FAR },
        Q: { x: A.x + dx / len * FAR, y: A.y + dy / len * FAR },
      };
    }

    // ── Build split geometry ─────────────────────────────────────────────────
    const pgSoArr = (splitOffsets[pg] || {})[idx] || {};

    // Collect split types
    const gapSplits = splitsArr.map((sp, si) => ({ sp, si })).filter(({ sp }) => sp && sp.style === 'gap');
    const solidSplits = splitsArr.map((sp, si) => ({ sp, si })).filter(({ sp }) => sp && sp.style === 'solid');
    const lineSplits = splitsArr.map((sp, si) => ({ sp, si })).filter(({ sp }) => sp && sp.style === 'line');

    if (gapSplits.length > 0) {
      // ── Gap mode: iteratively subdivide the panel polygon ──
      // Start with the panel as a single region
      let regions = [[corners.tl, corners.tr, corners.br, corners.bl]];

      gapSplits.forEach(({ sp, si }) => {
        const pct = Math.max(0.02, Math.min(0.98, (sp.pos || 50) / 100));
        const gap = sp.gap || 0;
        const half = gap / 2;
        const dir = sp.dir || 'h';
        const so = pgSoArr[si] || {};
        const aT = so.aT !== undefined ? so.aT : pct;
        const bT = so.bT !== undefined ? so.bT : pct;

        // The centre line: A and B are on opposite panel edges
        let A, B;
        if (dir === 'h') {
          A = lp(corners.tl, corners.bl, aT); // left edge
          B = lp(corners.tr, corners.br, bT); // right edge
        } else {
          A = lp(corners.tl, corners.tr, aT); // top edge
          B = lp(corners.bl, corners.br, bT); // bottom edge
        }

        // Direction vector of the split line, and a perpendicular for gap offset
        const lineVec = { x: B.x - A.x, y: B.y - A.y };
        const lineLen = Math.hypot(lineVec.x, lineVec.y) || 1;
        // Perpendicular pointing "up" (for h splits) or "left" (for v splits)
        const perp = { x: -lineVec.y / lineLen, y: lineVec.x / lineLen };

        // Two cutting lines: one half-gap above, one half-gap below the centre line
        const topA = { x: A.x + perp.x * half, y: A.y + perp.y * half };
        const topB = { x: B.x + perp.x * half, y: B.y + perp.y * half };
        const botA = { x: A.x - perp.x * half, y: A.y - perp.y * half };
        const botB = { x: B.x - perp.x * half, y: B.y - perp.y * half };

        const topLine = extendLine(topA, topB);
        const botLine = extendLine(botA, botB);

        // Cut every existing region with both lines, keep only the "outside" halves
        const newRegions = [];
        regions.forEach(poly => {
          // Cut with top line (keep left = "above" side)
          const [above] = splitPoly(poly, topLine.P, topLine.Q);
          // Cut with bot line (keep right = "below" side)
          const [, below] = splitPoly(poly, botLine.P, botLine.Q);
          if (above.length >= 3) newRegions.push(above);
          if (below.length >= 3) newRegions.push(below);
          // The strip between the two cuts is discarded (that's the gap)
        });
        regions = newRegions;
      });

      // ── Draw all resulting sub-panels ──
      // Clear the panel background first (white flush)
      svg += `<g clip-path="url(#${_clipId})">`;
      svg += `<polygon points="${polyAttr(corners.tl, corners.tr, corners.br, corners.bl)}" fill="white" stroke="none"/>`;
      regions.forEach(poly => {
        if (poly.length < 3) return;
        const pts = poly.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
        svg += `<polygon points="${pts}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linejoin="miter"/>`;
      });
      svg += `</g>`;

      // ── Draw any line splits on top ──
      lineSplits.forEach(({ sp, si }) => {
        const pct = Math.max(0.02, Math.min(0.98, (sp.pos || 50) / 100));
        const dir = sp.dir || 'h';
        const so = pgSoArr[si] || {};
        const aT = so.aT !== undefined ? so.aT : pct;
        const bT = so.bT !== undefined ? so.bT : pct;
        svg += `<g clip-path="url(#${_clipId})">`;
        if (dir === 'h') {
          const L = lp(corners.tl, corners.bl, aT);
          const Rp = lp(corners.tr, corners.br, bT);
          svg += `<line x1="${L.x.toFixed(1)}" y1="${L.y.toFixed(1)}" x2="${Rp.x.toFixed(1)}" y2="${Rp.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
        } else {
          const T = lp(corners.tl, corners.tr, aT);
          const Bp = lp(corners.bl, corners.br, bT);
          svg += `<line x1="${T.x.toFixed(1)}" y1="${T.y.toFixed(1)}" x2="${Bp.x.toFixed(1)}" y2="${Bp.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
        }
        svg += `</g>`;
      });

      // ── Draw solid double-line splits on top ──
      solidSplits.forEach(({ sp, si }) => {
        const pct = Math.max(0.02, Math.min(0.98, (sp.pos || 50) / 100));
        const gap = sp.gap || 0;
        const half = gap / 2;
        const dir = sp.dir || 'h';
        const so = pgSoArr[si] || {};
        const aT = so.aT !== undefined ? so.aT : pct;
        const bT = so.bT !== undefined ? so.bT : pct;
        svg += `<g clip-path="url(#${_clipId})">`;
        if (dir === 'h') {
          const A = lp(corners.tl, corners.bl, aT);
          const B = lp(corners.tr, corners.br, bT);
          const lineVec = { x: B.x - A.x, y: B.y - A.y };
          const lineLen = Math.hypot(lineVec.x, lineVec.y) || 1;
          const perp = { x: -lineVec.y / lineLen, y: lineVec.x / lineLen };
          const L1 = { x: A.x + perp.x * half, y: A.y + perp.y * half };
          const R1 = { x: B.x + perp.x * half, y: B.y + perp.y * half };
          const L2 = { x: A.x - perp.x * half, y: A.y - perp.y * half };
          const R2 = { x: B.x - perp.x * half, y: B.y - perp.y * half };
          svg += `<line x1="${L1.x.toFixed(1)}" y1="${L1.y.toFixed(1)}" x2="${R1.x.toFixed(1)}" y2="${R1.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
          svg += `<line x1="${L2.x.toFixed(1)}" y1="${L2.y.toFixed(1)}" x2="${R2.x.toFixed(1)}" y2="${R2.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
        } else {
          const A = lp(corners.tl, corners.tr, aT);
          const B = lp(corners.bl, corners.br, bT);
          const lineVec = { x: B.x - A.x, y: B.y - A.y };
          const lineLen = Math.hypot(lineVec.x, lineVec.y) || 1;
          const perp = { x: -lineVec.y / lineLen, y: lineVec.x / lineLen };
          const T1 = { x: A.x + perp.x * half, y: A.y + perp.y * half };
          const B1 = { x: B.x + perp.x * half, y: B.y + perp.y * half };
          const T2 = { x: A.x - perp.x * half, y: A.y - perp.y * half };
          const B2 = { x: B.x - perp.x * half, y: B.y - perp.y * half };
          svg += `<line x1="${T1.x.toFixed(1)}" y1="${T1.y.toFixed(1)}" x2="${B1.x.toFixed(1)}" y2="${B1.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
          svg += `<line x1="${T2.x.toFixed(1)}" y1="${T2.y.toFixed(1)}" x2="${B2.x.toFixed(1)}" y2="${B2.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
        }
        svg += `</g>`;
      });

    } else {
      // ── No gap splits: draw the base panel normally ──
      if (isSkewed) {
        svg += `<polygon points="${polyAttr(corners.tl, corners.tr, corners.br, corners.bl)}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linejoin="miter"/>`;
      } else {
        svg += `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
      }

      // ── Draw line splits on top ──
      lineSplits.forEach(({ sp, si }) => {
        const pct = Math.max(0.02, Math.min(0.98, (sp.pos || 50) / 100));
        const dir = sp.dir || 'h';
        const so = pgSoArr[si] || {};
        const aT = so.aT !== undefined ? so.aT : pct;
        const bT = so.bT !== undefined ? so.bT : pct;
        svg += `<g clip-path="url(#${_clipId})">`;
        if (dir === 'h') {
          const L = lp(corners.tl, corners.bl, aT);
          const Rp = lp(corners.tr, corners.br, bT);
          svg += `<line x1="${L.x.toFixed(1)}" y1="${L.y.toFixed(1)}" x2="${Rp.x.toFixed(1)}" y2="${Rp.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
        } else {
          const T = lp(corners.tl, corners.tr, aT);
          const Bp = lp(corners.bl, corners.br, bT);
          svg += `<line x1="${T.x.toFixed(1)}" y1="${T.y.toFixed(1)}" x2="${Bp.x.toFixed(1)}" y2="${Bp.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
        }
        svg += `</g>`;
      });

      // ── Draw solid double-line splits on top ──
      solidSplits.forEach(({ sp, si }) => {
        const pct = Math.max(0.02, Math.min(0.98, (sp.pos || 50) / 100));
        const gap = sp.gap || 0;
        const half = gap / 2;
        const dir = sp.dir || 'h';
        const so = pgSoArr[si] || {};
        const aT = so.aT !== undefined ? so.aT : pct;
        const bT = so.bT !== undefined ? so.bT : pct;
        svg += `<g clip-path="url(#${_clipId})">`;
        if (dir === 'h') {
          const A = lp(corners.tl, corners.bl, aT);
          const B = lp(corners.tr, corners.br, bT);
          const lineVec = { x: B.x - A.x, y: B.y - A.y };
          const lineLen = Math.hypot(lineVec.x, lineVec.y) || 1;
          const perp = { x: -lineVec.y / lineLen, y: lineVec.x / lineLen };
          const L1 = { x: A.x + perp.x * half, y: A.y + perp.y * half };
          const R1 = { x: B.x + perp.x * half, y: B.y + perp.y * half };
          const L2 = { x: A.x - perp.x * half, y: A.y - perp.y * half };
          const R2 = { x: B.x - perp.x * half, y: B.y - perp.y * half };
          svg += `<line x1="${L1.x.toFixed(1)}" y1="${L1.y.toFixed(1)}" x2="${R1.x.toFixed(1)}" y2="${R1.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
          svg += `<line x1="${L2.x.toFixed(1)}" y1="${L2.y.toFixed(1)}" x2="${R2.x.toFixed(1)}" y2="${R2.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
        } else {
          const A = lp(corners.tl, corners.tr, aT);
          const B = lp(corners.bl, corners.br, bT);
          const lineVec = { x: B.x - A.x, y: B.y - A.y };
          const lineLen = Math.hypot(lineVec.x, lineVec.y) || 1;
          const perp = { x: -lineVec.y / lineLen, y: lineVec.x / lineLen };
          const T1 = { x: A.x + perp.x * half, y: A.y + perp.y * half };
          const B1 = { x: B.x + perp.x * half, y: B.y + perp.y * half };
          const T2 = { x: A.x - perp.x * half, y: A.y - perp.y * half };
          const B2 = { x: B.x - perp.x * half, y: B.y - perp.y * half };
          svg += `<line x1="${T1.x.toFixed(1)}" y1="${T1.y.toFixed(1)}" x2="${B1.x.toFixed(1)}" y2="${B1.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
          svg += `<line x1="${T2.x.toFixed(1)}" y1="${T2.y.toFixed(1)}" x2="${B2.x.toFixed(1)}" y2="${B2.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}"/>`;
        }
        svg += `</g>`;
      });
    }

    if (!forExport) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="80" fill="${strokeColor}" opacity="0.3">${r.pnl}</text>`;
    }
  });

  svg += `</svg>`;
  return svg;
}

// ─────────────────────────────────────────────
// GENERATE & RENDER
// ─────────────────────────────────────────────
function generateAll() {
  const pages = getPages();
  if (!pages.length) { window.showToast?.('No data to generate!'); return; }

  const fillColor = panelFillColor;
  const strokeColor = panelStrokeColor;
  const strokeW = panelStrokeWidth || 8;

  const canvasInner = document.getElementById('canvasInner');
  canvasInner.innerHTML = '';

  pages.forEach(({ pg, chp }) => {
    const pgNum = parseInt((pg.match(/\d+/) || [1])[0]);
    const ps = pageSettings[pg] || { mode: 'safe', gutter: 12 };
    const pageRows = rows.filter(r => r.pg === pg);

    // If layout is locked, use the stored snapshot — never re-roll random
    let baseRects;
    if (panelOverrides[pg]?._lockedRects?.length) {
      baseRects = panelOverrides[pg]._lockedRects;
      // Keep _lastBaseRects in sync for Panel Editor
      _lastBaseRects[pg] = baseRects;
    } else {
      baseRects = computePanelRects(pageRows, ps.mode, ps.gutter, ps.flow || 'v-first');
      _lastBaseRects[pg] = baseRects;
    }

    // Apply per-panel overrides (position / size / visibility)
    const _pgOvs = panelOverrides[pg] || {};
    const panelRects = baseRects.map((r, idx) => {
      const ov = _pgOvs[idx];
      if (!ov) return r;
      return {
        ...r,
        x: ov.x !== undefined ? ov.x : r.x,
        y: ov.y !== undefined ? ov.y : r.y,
        w: ov.w !== undefined ? ov.w : r.w,
        h: ov.h !== undefined ? ov.h : r.h,
        _hidden: ov.visible === false,
      };
    });

    _lastPanelRects[pg] = panelRects;

    const svgStr = buildSVG(pg, pgNum, panelRects, fillColor, strokeColor, strokeW, false, _pgOvs);

    const w = Math.round(PAGE_W * scale);
    const h = Math.round(PAGE_H * scale);

    // No .page-label here — per spec Section A, #canvasInner is a pure
    // viewport with no labels/overlays of any kind. Page metadata
    // (chapter, odd/even, panel count, mode) moves to the Page Editor
    // drawer's per-page entries (js/pages.js, Step 4) instead.
    const wrap = document.createElement('div');
    wrap.className = 'page-thumb-wrap';
    wrap.dataset.chp = chp;
    wrap.dataset.pgNum = pgNum;

    const container = document.createElement('div');
    container.className = 'page-output';
    container.style.width = w + 'px';
    container.style.height = h + 'px';
    container.style.overflow = 'hidden';
    container.style.position = 'relative';
    container.dataset.svg = svgStr;
    container.dataset.pg = pg;

    // Render inline SVG scaled via transform
    const svgWrap = document.createElement('div');
    svgWrap.style.position = 'absolute';
    svgWrap.style.top = '0';
    svgWrap.style.left = '0';
    svgWrap.style.transformOrigin = 'top left';
    svgWrap.style.transform = `scale(${scale})`;
    svgWrap.style.width = PAGE_W + 'px';
    svgWrap.style.height = PAGE_H + 'px';
    svgWrap.innerHTML = svgStr;
    container.appendChild(svgWrap);
    wrap.appendChild(container);
    canvasInner.appendChild(wrap);
  });

  // generateAll() rebuilds #canvasInner from scratch on every call (including
  // from undo/redo via applySnapshot), which wipes any bubble/text overlays
  // that were attached to the previous DOM. Re-render them here so they
  // survive every regeneration — this also fixes a pre-existing gap where
  // renderAllBubbles() (bubbles.js) was defined but never actually called.
  window.renderAllBubbles?.();
  window.renderAllTextElements?.();

  // Re-apply pan/zoom transform now that canvasInner has new content
  // (js/canvas.js owns the transform; generate.js only triggers a refresh)
  window.applyCanvasTransform?.();

  // Per spec Implementation Note #3 — generate.js writes autosave
  // after each generation (init.js owns the actual write/timer logic).
  window.scheduleAutoSave?.();

  window.showToast?.(`Generated ${pages.length} page(s)`);
}

window.getPages = getPages;
window.computePanelRects = computePanelRects;
window.buildSVG = buildSVG;
window.generateAll = generateAll;

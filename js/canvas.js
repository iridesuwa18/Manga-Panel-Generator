// ============================================================
// js/canvas.js — Step 2
// Pan/zoom for #canvasInner via CSS transform (translate+scale).
// Adapted verbatim in logic from the original monolith's
// canvasZoom/canvasPanX/canvasPanY system, with these changes
// required by the spec:
//   - No custom scrollbar (#canvasScrollTrack/#canvasScrollThumb
//     are gone — removed per Section D). Pan is the only way to
//     move around; there is nothing to clamp against except the
//     natural bounds of the page content itself.
//   - No #canvasResetBtn inside the canvas. Reset View is a
//     keyboard shortcut only (Ctrl/Cmd+0), per Section A.
//   - Ctrl+scroll zoom now zooms toward the cursor position
//     (the old plain-wheel zoom didn't anchor to the pointer;
//     this is a deliberate improvement, not a behavior removal,
//     since the spec explicitly calls out "Zoom: Ctrl + scroll
//     ... toward cursor" as expected behavior).
//   - Adds the ResizeObserver on #workspace that sets
//     body.dataset.layout = desktop | tablet | mobile, per
//     Section G, replacing any onload dimension checks.
// State vars (scale, panX, panY) live in js/state.js; this file
// only reads/writes them and drives the transform + listeners.
// ============================================================

(function () {
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 4;

  let canvasArea, canvasInner;

  function getEls() {
    canvasArea = canvasArea || document.getElementById('canvasArea');
    canvasInner = canvasInner || document.getElementById('canvasInner');
    return canvasArea && canvasInner;
  }

  // ── Apply current scale/panX/panY to #canvasInner ──────────
  function applyCanvasTransform() {
    if (!getEls()) return;
    canvasInner.style.willChange = 'transform';
    canvasInner.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
    canvasInner.style.transformOrigin = '0 0';
  }

  function resetCanvasView() {
    scale = 0.18;
    panX = 0;
    panY = 0;
    applyCanvasTransform();
  }

  // ── Space + drag panning ─────────────────────────────────
  let spaceDown = false;
  let panActive = false;
  let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;

  function onKeyDown(e) {
    if (e.key === ' ' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      spaceDown = true;
      if (canvasArea) canvasArea.style.cursor = 'grab';
      e.preventDefault();
    }
    // Reset View — Ctrl/Cmd+0 (keyboard-only, per spec: no in-canvas button)
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      resetCanvasView();
    }
  }
  function onKeyUp(e) {
    if (e.key === ' ') {
      spaceDown = false;
      if (canvasArea) canvasArea.style.cursor = '';
    }
  }

  function onPointerDown(e) {
    if (!spaceDown) return;
    panActive = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
    canvasArea.classList.add('panning');
    canvasArea.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!panActive) return;
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    applyCanvasTransform();
  }
  function onPointerUp() {
    panActive = false;
    if (canvasArea) canvasArea.classList.remove('panning');
  }

  // ── Ctrl+scroll → zoom toward cursor; two-finger trackpad
  //    drag (plain wheel, no ctrl) → pan ────────────────────
  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = canvasArea.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale * delta));
      // Keep the point under the cursor stationary while zooming.
      panX = cx - (cx - panX) * (newZoom / scale);
      panY = cy - (cy - panY) * (newZoom / scale);
      scale = newZoom;
    } else {
      // Two-finger trackpad drag arrives as wheel deltas — pan.
      panX -= e.deltaX;
      panY -= e.deltaY;
    }
    applyCanvasTransform();
  }

  // ── Pinch to zoom + single-finger pan on touch ───────────
  let pinchStartDist = 0, pinchStartZoom = 1;
  let pinchStartMidX = 0, pinchStartMidY = 0, pinchStartPanX = 0, pinchStartPanY = 0;
  let touch1StartX = 0, touch1StartY = 0, touchPanOriginX = 0, touchPanOriginY = 0;
  let touchPanning = false;
  let touchScrollPass = false; // true = pass gesture to body scroll

  function _isMobileLayout() { return window.innerWidth < 600; }

  function onTouchStart(e) {
    touchScrollPass = false;
    if (e.touches.length === 2) {
      e.preventDefault();
      const t0 = e.touches[0], t1 = e.touches[1];
      pinchStartDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      pinchStartZoom = scale;
      pinchStartMidX = (t0.clientX + t1.clientX) / 2;
      pinchStartMidY = (t0.clientY + t1.clientY) / 2;
      pinchStartPanX = panX;
      pinchStartPanY = panY;
      touchPanning = false;
    } else if (e.touches.length === 1) {
      if (e.target.closest('.bubble-wrap') || e.target.closest('.corner-dot') || e.target.closest('.split-dot')) {
        touchPanning = false;
        return;
      }
      touch1StartX = e.touches[0].clientX;
      touch1StartY = e.touches[0].clientY;
      touchPanOriginX = panX;
      touchPanOriginY = panY;
      touchPanning = true;
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      if (pinchStartDist < 1) return; // guard divide-by-near-zero on gesture start
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoom * (dist / pinchStartDist)));
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const rect = canvasArea.getBoundingClientRect();
      const originX = pinchStartMidX - rect.left;
      const originY = pinchStartMidY - rect.top;
      panX = originX - (originX - pinchStartPanX) * (newZoom / pinchStartZoom) + (midX - pinchStartMidX);
      panY = originY - (originY - pinchStartPanY) * (newZoom / pinchStartZoom) + (midY - pinchStartMidY);
      scale = newZoom;
      applyCanvasTransform();
    } else if (e.touches.length === 1) {
      if (e.target.closest('.corner-dot') || e.target.closest('.split-dot')) {
        e.preventDefault();
        return;
      }

      if (touchPanning) {
        const dx = e.touches[0].clientX - touch1StartX;
        const dy = e.touches[0].clientY - touch1StartY;

        // On mobile: if the gesture hasn't been committed yet, decide
        // whether it's a downward page-scroll or a canvas pan.
        if (_isMobileLayout() && !touchScrollPass) {
          const absDx = Math.abs(dx), absDy = Math.abs(dy);
          if (absDy > 8 || absDx > 8) {
            // Predominantly downward swipe → body scroll, not canvas pan
            if (absDy > absDx && dy > 0) {
              touchScrollPass = true;
              touchPanning = false;
              // Don't preventDefault — let the browser scroll body
              return;
            }
            // Otherwise it's a canvas pan — commit to that
          } else {
            return; // not enough movement yet to decide
          }
        }

        if (touchScrollPass) return; // already handed off

        e.preventDefault();
        panX = touchPanOriginX + dx;
        panY = touchPanOriginY + dy;
        applyCanvasTransform();
      }
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) touchPanning = false;
    if (e.touches.length === 0) { touchPanning = false; touchScrollPass = false; }
  }

  // ── ResizeObserver → body[data-layout] (Section G) ───────
  // Pure visual breakpoints stay in responsive.css @media rules;
  // this attribute exists only for JS that needs to branch on
  // layout (e.g. pinch-zoom threshold via isMobile()).
  function setupLayoutObserver() {
    const workspace = document.getElementById('workspace');
    if (!workspace || !('ResizeObserver' in window)) return;
    const update = (width) => {
      document.body.dataset.layout = width >= 900 ? 'desktop' : width >= 600 ? 'tablet' : 'mobile';
    };
    update(workspace.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        update(entry.contentRect.width);
      }
    });
    ro.observe(workspace);
  }

  function initCanvas() {
    if (!getEls()) return;
    applyCanvasTransform();
    setupLayoutObserver();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    canvasArea.addEventListener('pointerdown', onPointerDown);
    canvasArea.addEventListener('pointermove', onPointerMove);
    canvasArea.addEventListener('pointerup', onPointerUp);
    canvasArea.addEventListener('pointercancel', onPointerUp);

    canvasArea.addEventListener('wheel', onWheel, { passive: false });

    canvasArea.addEventListener('touchstart', onTouchStart, { passive: false });
    canvasArea.addEventListener('touchmove', onTouchMove, { passive: false });
    canvasArea.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  // Exposed globally — generate.js calls applyCanvasTransform()
  // after regenerating pages; ui.js wires Reset View if surfaced
  // in the Preview Options drawer; init.js calls initCanvas().
  window.applyCanvasTransform = applyCanvasTransform;
  window.resetCanvasView = resetCanvasView;
  window.initCanvas = initCanvas;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCanvas);
  } else {
    initCanvas();
  }
})();

// ── Smart initial scale: fit a manga page to ~80% of canvas height ──
// On mobile there's no side rail/drawer competing for horizontal
// space (canvasArea is the full screen width), so we can afford to
// fill much more of the viewport than on desktop/tablet.
function computeAutoScale() {
  const area = document.getElementById('canvasArea');
  if (!area) return 0.18;
  const mobile = document.body.dataset.layout === 'mobile';
  const hRatio = mobile ? 0.94 : 0.82;
  const wRatio = mobile ? 0.92 : 0.72;
  const availH = area.clientHeight * hRatio;
  const availW = area.clientWidth * wRatio;
  const scaleByH = availH / 4677;
  const scaleByW = availW / 3300;
  return Math.max(0.06, Math.min(scaleByH, scaleByW));
}

// Override resetCanvasView with smart auto-scale, centered in the
// visible canvas area (used on boot, Ctrl/Cmd+0, and — on mobile —
// automatically after every Generate; see generate.js) so the page
// always lands fully on-screen instead of requiring a manual pinch
// to fit.
window.resetCanvasView = function() {
  const area = document.getElementById('canvasArea');
  scale = computeAutoScale();
  if (area) {
    panX = (area.clientWidth  - 3300 * scale) / 2;
    panY = (area.clientHeight - 4677 * scale) / 2;
  } else {
    panX = 40;
    panY = 30;
  }
  window.applyCanvasTransform?.();
};

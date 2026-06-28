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
    canvasInner.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
    canvasInner.style.transformOrigin = '0 0';
  }

  function resetCanvasView() {
    scale = 0.06;
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
  let touch1StartX = 0, touch1StartY = 0, touchPanOriginX = 0, touchPanOriginY = 0, touchPanning = false;

  function onTouchStart(e) {
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
      // Don't pan when touching interactive overlay elements
      // (corner/split dots, bubble handles) — they need their
      // own pointermove drag to keep firing underneath.
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
        // fall through — pointer drag handlers for the dot keep receiving events
      } else if (touchPanning) {
        e.preventDefault();
        panX = touchPanOriginX + (e.touches[0].clientX - touch1StartX);
        panY = touchPanOriginY + (e.touches[0].clientY - touch1StartY);
        applyCanvasTransform();
      }
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) touchPanning = false;
    if (e.touches.length === 0) touchPanning = false;
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

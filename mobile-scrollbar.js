// ============================================================
// mobile-scrollbar.js
// A custom overlay scrollbar on the right edge of the screen,
// visible only on mobile. Appears on touch, auto-hides after 5s.
// Dragging the thumb scrolls window.scrollY directly.
// Tapping anywhere in the track jumps to that position.
// ============================================================

(function () {
  if (window.innerWidth >= 600) return; // desktop: do nothing

  // ── Build DOM ─────────────────────────────────────────────
  const track = document.createElement('div');
  track.id = 'mob-scrollbar-track';

  const thumb = document.createElement('div');
  thumb.id = 'mob-scrollbar-thumb';

  track.appendChild(thumb);
  document.body.appendChild(track);

  // ── State ─────────────────────────────────────────────────
  let hideTimer = null;
  let isDragging = false;
  let dragStartY = 0;
  let dragStartScroll = 0;

  // ── Helpers ───────────────────────────────────────────────
  function totalScrollable() {
    return document.documentElement.scrollHeight - window.innerHeight;
  }

  function thumbHeightRatio() {
    const docH = document.documentElement.scrollHeight;
    const winH = window.innerHeight;
    return Math.max(0.06, winH / docH); // min 6% thumb height
  }

  function updateThumb() {
    const trackH = track.offsetHeight;
    const ratio  = thumbHeightRatio();
    const thumbH = Math.max(36, trackH * ratio);
    const scrollable = totalScrollable();
    const scrollRatio = scrollable > 0 ? window.scrollY / scrollable : 0;
    const maxTop = trackH - thumbH;
    const top = scrollRatio * maxTop;

    thumb.style.height = thumbH + 'px';
    thumb.style.transform = `translateY(${top}px)`;
  }

  function show() {
    track.classList.add('visible');
    updateThumb();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 5000);
  }

  function hide() {
    if (!isDragging) track.classList.remove('visible');
  }

  function resetHideTimer() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 5000);
  }

  // ── Show on any touch in the right-edge zone (rightmost 28px) ──
  document.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    if (touch.clientX >= window.innerWidth - 28) {
      show();
    }
  }, { passive: true });

  // ── Scroll → update thumb ─────────────────────────────────
  window.addEventListener('scroll', () => {
    if (!isDragging) updateThumb();
  }, { passive: true });

  // ── Thumb drag ────────────────────────────────────────────
  thumb.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    isDragging = true;
    dragStartY = e.touches[0].clientY;
    dragStartScroll = window.scrollY;
    track.classList.add('dragging');
    clearTimeout(hideTimer);
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const dy = e.touches[0].clientY - dragStartY;
    const trackH = track.offsetHeight;
    const thumbH = thumb.offsetHeight;
    const maxTop = trackH - thumbH;
    const scrollable = totalScrollable();
    const newScroll = dragStartScroll + (dy / maxTop) * scrollable;
    window.scrollTo({ top: Math.max(0, Math.min(scrollable, newScroll)), behavior: 'instant' });
    updateThumb();
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    track.classList.remove('dragging');
    resetHideTimer();
  }, { passive: true });

  // ── Track tap → jump ──────────────────────────────────────
  track.addEventListener('touchstart', (e) => {
    if (e.target === thumb) return;
    e.stopPropagation();
    const rect = track.getBoundingClientRect();
    const tapY = e.touches[0].clientY - rect.top;
    const ratio = Math.max(0, Math.min(1, tapY / track.offsetHeight));
    window.scrollTo({ top: ratio * totalScrollable(), behavior: 'smooth' });
    show();
  }, { passive: true });

  // ── Resize guard ──────────────────────────────────────────
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 600) {
      track.remove();
    } else {
      updateThumb();
    }
  });

  // Initial thumb size
  updateThumb();
})();

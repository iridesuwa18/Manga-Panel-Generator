// ============================================================
// js/mobile.js — Mobile full-screen menu (hamburger overlay)
// #mobMenuOverlay is a fixed, full-screen panel (hidden until the
// hamburger button in #topbar is tapped) that contains #mobileNav —
// the same .mob-row / .mob-drawer accordion as before, just living
// inside a modal instead of inline below the canvas.
// Reuses the same tab content builders from ui.js.
// ============================================================

(function () {
  const MOBILE_BP = 600;
  function isMobileLayout() { return window.innerWidth < MOBILE_BP; }

  const _mobActiveTab = {};

  // Tab definitions matching ui.js ROWS
  const TAB_DEFS = {
    export:  [{ id: 'svg', label: 'SVG' }, { id: 'png', label: 'PNG' }, { id: 'json', label: 'JSON' }, { id: 'github', label: 'GitHub' }],
    pages:   [{ id: 'page', label: 'Page Editor' }, { id: 'panel', label: 'Panel Editor' }],
    bubbles: [{ id: 'bubble', label: 'Bubble Editor' }, { id: 'text', label: 'Text Editor' }],
    layers:  [{ id: 'layers', label: 'Layers' }, { id: 'editor', label: 'Editor' }],
    preview: [{ id: 'undo', label: 'Undo' }, { id: 'redo', label: 'Redo' }, { id: 'generate', label: 'Generate' }, { id: 'blank', label: 'Create Blank' }, { id: 'sample', label: 'Sample' }],
  };
  const FIRST_TABS = { export:'svg', pages:'page', bubbles:'bubble', layers:'layers', preview:'undo' };

  // ── Hamburger open/close ─────────────────────────────────
  function openMobileMenu() {
    document.getElementById('mobMenuOverlay')?.classList.add('open');
  }
  function closeMobileMenu() {
    document.getElementById('mobMenuOverlay')?.classList.remove('open');
  }
  window.openMobileMenu = openMobileMenu;
  window.closeMobileMenu = closeMobileMenu;

  // Renders rowId's currently-open drawer for the given tab. A single
  // shared function (not recreated per-row) so it can be called
  // reliably from anywhere — row taps, tab-pill taps, and external
  // refresh calls (e.g. pages.js re-rendering the Page Editor tab
  // after setPbpMode() changes state it displays) — regardless of
  // which row was opened most recently.
  //
  // `isExplicitTap` distinguishes "just opened this row" (false) from
  // "user tapped a specific tab pill" (true). Only an explicit tap on
  // an action tab (Undo/Redo/Generate) actually runs it — the very
  // first render of a row must never auto-fire an action, or the row
  // closes itself before the person ever sees the tab bar (this was
  // hiding Create Blank / Sample behind Preview Options).
  function render(rowId, tabId, isExplicitTap) {
    const container = document.getElementById('mob-' + rowId);
    const row = document.querySelector(`.mob-row[data-row="${rowId}"]`);
    if (!container || !row) return;

    _mobActiveTab[rowId] = tabId;
    row.classList.add('active');

    const tabs = TAB_DEFS[rowId] || [];
    const tabBar = tabs.length > 1
      ? `<div class="mob-tabs">${tabs.map(t =>
          `<button class="tab-pill ${t.id === tabId ? 'active' : ''}"
            onclick="window._mobRender('${rowId}','${t.id}')">${t.label}</button>`
        ).join('')}</div>`
      : '';

    // Get content via the hook exposed by ui.js
    const bodyHTML = window.buildMobTabContent?.(rowId, tabId) ?? '<div style="color:var(--text-3);font-size:var(--type-xs);padding:8px">Loading…</div>';

    // Wrap in a single child div (required for grid-template-rows animation)
    container.innerHTML = `<div>${tabBar}<div class="mob-body">${bodyHTML}</div></div>`;

    // Run after-render hooks (populate selects, lists, etc.)
    window.afterMobDrawerRender?.(rowId, tabId);

    // For preview action tabs, fire only on an explicit tab tap.
    if (rowId === 'preview' && isExplicitTap) {
      const actionTabs = { undo:'undo', redo:'redo', generate:'generate' };
      if (actionTabs[tabId]) {
        container.innerHTML = '';
        container.classList.remove('open');
        row.classList.remove('active');
        switch (tabId) {
          case 'undo':     window.undo?.();        break;
          case 'redo':     window.redo?.();        break;
          case 'generate': window.generateAll?.(); break;
        }
        return;
      }
    }

    container.classList.add('open');
  }

  // rowId, optional forceTabId — pass forceTabId to jump straight to a
  // specific tab (e.g. the on-canvas "+ Add Panels" button opening
  // Pages & Panels directly on the Panel Editor tab, not whichever
  // tab was last open).
  window.openMobileSection = function (rowId, forceTabId) {
    if (!isMobileLayout()) {
      window.openDrawer?.(rowId, forceTabId);
      return;
    }

    const container = document.getElementById('mob-' + rowId);
    const row = document.querySelector(`.mob-row[data-row="${rowId}"]`);
    if (!container || !row) return;

    const isOpen = row.classList.contains('active');
    if (isOpen && !forceTabId) {
      // Collapse
      row.classList.remove('active');
      container.classList.remove('open');
      return;
    }

    const activeTab = forceTabId || _mobActiveTab[rowId] || FIRST_TABS[rowId];
    render(rowId, activeTab, false);
  };

  // Tab pills call this with (rowId, tabId).
  window._mobRender = function (rowId, tabId) { render(rowId, tabId, true); };

  // Re-render an already-open row's current tab in place — used when
  // something OUTSIDE the tab-pill click changes state that the open
  // drawer should reflect immediately (e.g. toggling All Pages /
  // Page-by-Page mode), instead of requiring a close/reopen to see it.
  window.refreshMobDrawerTab = function (rowId) {
    const row = document.querySelector(`.mob-row[data-row="${rowId}"]`);
    const tabId = _mobActiveTab[rowId];
    if (!row || !row.classList.contains('active') || !tabId) return;
    render(rowId, tabId, false);
  };

  // Collapse everything (including the overlay itself) on resize to desktop
  window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
      closeMobileMenu();
      document.querySelectorAll('.mob-row.active').forEach(r => r.classList.remove('active'));
      document.querySelectorAll('.mob-drawer.open').forEach(d => d.classList.remove('open'));
    }
  });
})();

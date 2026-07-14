// ============================================================
// js/mobile.js — Mobile accordion drawer system
// Works independently of the desktop #drawer. Uses #mobileNav
// with .mob-row / .mob-drawer elements for each section.
// Reuses the same tab content builders from ui.js.
// ============================================================

(function () {
  const MOBILE_BP = 600;
  function isMobileLayout() { return window.innerWidth < MOBILE_BP; }

  const _mobActiveTab = {};

  window.openMobileSection = function (rowId) {
    if (!isMobileLayout()) {
      window.openDrawer?.(rowId);
      return;
    }

    const container = document.getElementById('mob-' + rowId);
    const row = document.querySelector(`.mob-row[data-row="${rowId}"]`);
    if (!container || !row) return;

    const isOpen = row.classList.contains('active');

    if (isOpen) {
      // Collapse
      row.classList.remove('active');
      container.classList.remove('open');
      return;
    }

    // Open this row
    row.classList.add('active');

    // Tab definitions matching ui.js ROWS
    const tabDefs = {
      export:  [{ id: 'svg', label: 'SVG' }, { id: 'png', label: 'PNG' }, { id: 'json', label: 'JSON' }, { id: 'github', label: 'GitHub' }],
      pages:   [{ id: 'page', label: 'Page Editor' }, { id: 'panel', label: 'Panel Editor' }],
      bubbles: [{ id: 'bubble', label: 'Bubble Editor' }, { id: 'text', label: 'Text Editor' }],
      layers:  [{ id: 'layers', label: 'Layers' }, { id: 'editor', label: 'Editor' }],
      preview: [{ id: 'undo', label: 'Undo' }, { id: 'redo', label: 'Redo' }, { id: 'generate', label: 'Generate' }, { id: 'blank', label: 'Create Blank' }, { id: 'sample', label: 'Sample' }],
    };

    const firstTabs = { export:'svg', pages:'page', bubbles:'bubble', layers:'layers', preview:'generate' };
    const activeTab = _mobActiveTab[rowId] || firstTabs[rowId];

    // `isExplicitTap` distinguishes "just opened this row" (false) from
    // "user tapped a specific tab pill" (true). Only an explicit tap on
    // an action tab (Undo/Redo/Generate) should actually run it — the
    // very first render of a row must never auto-fire an action, or the
    // row closes itself before the person ever sees the tab bar (this is
    // what was hiding Create Blank / Sample behind Preview Options).
    function render(tabId, isExplicitTap) {
      _mobActiveTab[rowId] = tabId;

      const tabs = tabDefs[rowId] || [];
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

      // For preview action tabs, fire only on an explicit tab tap —
      // never on the initial row-open (see comment above render()).
      if (rowId === 'preview' && isExplicitTap) {
        const actionTabs = { undo:'undo', redo:'redo', generate:'generate' };
        if (actionTabs[tabId]) {
          container.innerHTML = '';
          container.classList.remove('open');
          row.classList.remove('active');
          switch(tabId) {
            case 'undo':     window.undo?.();        break;
            case 'redo':     window.redo?.();        break;
            case 'generate': window.generateAll?.(); break;
          }
          return;
        }
      }

      container.classList.add('open');
    }

    // Expose so tab pills can re-render. Tab pills call this with
    // (rowId, tabId) — only tabId is needed here since this closure
    // already knows its own rowId, but we must NOT forward rowId into
    // render()'s tabId slot (that was the tab-switch bug: every pill
    // tap was rendering content for e.g. tabId="export" instead of
    // tabId="png", which doesn't exist, so the body came back empty).
    window._mobRender = function (_rowId, tabId) { render(tabId, true); };
    render(activeTab, false);
  };

  // Collapse all mobile sections on resize to desktop
  window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
      document.querySelectorAll('.mob-row.active').forEach(r => r.classList.remove('active'));
      document.querySelectorAll('.mob-drawer.open').forEach(d => d.classList.remove('open'));
    }
  });

  // Hide scroll hint after first body scroll
  let hintDismissed = false;
  window.addEventListener('scroll', () => {
    if (!hintDismissed && window.scrollY > 10) {
      hintDismissed = true;
      document.body.classList.add('scrolled');
    }
  }, { passive: true });
})();

// ============================================================
// js/ui.js — Step 5
// Drawer open/close, rail row clicks, tab switching inside the
// drawer, toast notifications, and the per-row template builders
// (spec Section B). #drawer is a single <aside> whose innerHTML
// is swapped per row — there are no separate hidden panel divs.
//
// Anything wired here that depends on a later step (undo.js,
// export.js, github.js, bubbles.js, panels.js, layers.js — Steps
// 6-8) is called defensively via `window.fn?.()` and will start
// working automatically once those files exist, per spec
// Implementation Note #1.
//
// Row 5 (Preview Options) tabs are ACTIONS, not content tabs —
// Undo/Redo/Generate fire immediately with no drawer; Create
// Blank/Sample open the drawer with a small options form, per
// spec Section B, Row 5.
// ============================================================

(function () {

  // ── Toast ────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, duration = 2200) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ── Row registry ─────────────────────────────────────────
  // label: shown in drawer header. tabs: ordered list of {id,label}.
  // action: true => Row 5 style, row click without a tab fires
  // nothing by itself (each tab is its own action/content).
  const ROWS = {
    export:  { label: 'Import / Export',  tabs: [
      { id: 'svg',    label: 'SVG' },
      { id: 'png',    label: 'PNG' },
      { id: 'json',   label: 'JSON' },
      { id: 'github', label: 'GitHub' },
    ]},
    pages:   { label: 'Pages & Panels',   tabs: [
      { id: 'page',  label: 'Page Editor' },
      { id: 'panel', label: 'Panel Editor' },
    ]},
    bubbles: { label: 'Bubbles & Text',   tabs: [
      { id: 'bubble', label: 'Bubble Editor' },
      { id: 'text',   label: 'Text Editor' },
    ]},
    layers:  { label: 'Layers',           tabs: [
      { id: 'layers', label: 'Layers' },
      { id: 'editor', label: 'Editor' },
    ]},
    preview: { label: 'Preview Options',  action: true, tabs: [
      { id: 'undo',   label: 'Undo' },
      { id: 'redo',   label: 'Redo' },
      { id: 'generate', label: 'Generate' },
      { id: 'blank',  label: 'Create Blank' },
      { id: 'sample', label: 'Sample' },
    ]},
  };

  // ── Drawer / rail state ──────────────────────────────────
  function drawerEl() { return document.getElementById('drawer'); }
  function railRowEl(rowId) { return document.querySelector(`.rail-row[data-row="${rowId}"]`); }

  function closeDrawer() {
    const d = drawerEl();
    if (d) d.classList.remove('open');
    document.querySelectorAll('.rail-row.active').forEach(r => r.classList.remove('active'));
    activeRow = null;
  }

  function setActiveRailRow(rowId) {
    document.querySelectorAll('.rail-row.active').forEach(r => r.classList.remove('active'));
    const row = railRowEl(rowId);
    if (row) row.classList.add('active');
  }

  // Open a row's drawer (or close it if it's already open).
  // Row 5 is action-style: clicking the row itself just opens
  // to its default tab — the real behavior lives in the tabs.
  function openDrawer(rowId, tabId) {
    const def = ROWS[rowId];
    if (!def) return;

    if (activeRow === rowId && !tabId) {
      closeDrawer();
      return;
    }

    activeRow = rowId;
    activeDrawerTab[rowId] = tabId || activeDrawerTab[rowId] || def.tabs[0]?.id;

    renderDrawer(rowId);
    const d = drawerEl();
    if (d) d.classList.add('open');
    setActiveRailRow(rowId);
  }

  function openDrawerTab(rowId, tabId) {
    const def = ROWS[rowId];
    if (!def) return;

    // Row 5's action tabs (Undo/Redo/Generate) fire immediately, but
    // still need the drawer to re-render + mark the clicked pill as
    // active — otherwise the tab bar visibly stays on whatever tab
    // was showing before, which looks like the click did nothing.
    if (def.action) {
      runPreviewAction(tabId);
    }

    activeDrawerTab[rowId] = tabId;
    openDrawer(rowId, tabId);
  }

  function renderDrawer(rowId) {
    const d = drawerEl();
    if (!d) return;
    const def = ROWS[rowId];
    const tabId = activeDrawerTab[rowId];

    const tabsHTML = def.tabs.length > 1 ? `
      <div class="drawer-tabs">
        ${def.tabs.map(t => `
          <button class="tab-pill ${t.id === tabId ? 'active' : ''}"
            onclick="openDrawerTab('${rowId}','${t.id}')">${t.label}</button>
        `).join('')}
      </div>` : '';

    d.innerHTML = `
      <div class="drawer-header">
        <span>${def.label}</span>
        <button class="btn small" onclick="closeDrawer()" aria-label="Close">&times;</button>
      </div>
      ${tabsHTML}
      <div class="drawer-body" id="drawerBody">${buildTabContent(rowId, tabId)}</div>
    `;

    afterDrawerRender(rowId, tabId);
  }

  // ── Content dispatch ──────────────────────────────────────
  function buildTabContent(rowId, tabId) {
    switch (rowId) {
      case 'export':  return tplExport(tabId);
      case 'pages':   return tplPages(tabId);
      case 'bubbles': return tplBubbles(tabId);
      case 'layers':  return tplLayers(tabId);
      case 'preview': return tplPreview(tabId);
      default: return '';
    }
  }

  // Hooks that need to run after the drawer's innerHTML lands
  // in the DOM (populate selects, render lists, etc.) — mirrors
  // what the old monolith did on tab-show.
  function afterDrawerRender(rowId, tabId) {
    if (rowId === 'export' && tabId === 'github') {
      // Populate stored GitHub credentials into the drawer fields
      window.populateGitHubFields?.();
    }
    if (rowId === 'pages' && tabId === 'page') {
      window.renderTable?.();
      window.rebuildPageList?.();
    }
    if (rowId === 'pages' && tabId === 'panel') {
      const pg = window._pbpCurrentPage || window.getPages?.()[0]?.pg;
      window.refreshPanelsPanel?.(pg);
    }
    if (rowId === 'bubbles' && tabId === 'bubble') {
      window.refreshBubblePageSelect?.();
      const pg = document.getElementById('bubblePageSel')?.value || window.getPages?.()[0]?.pg;
      window.refreshQuickBubblePanelSel?.(pg);
      // The drawer's innerHTML was just rebuilt from scratch, which resets
      // the Selected Bubble section back to its empty/hidden default —
      // re-show + re-fill it here if a bubble is still selected.
      if (selectedBubble) {
        window.showBubbleEditorPanel?.(true);
        window.syncBubbleEditorFields?.(selectedBubble.data);
      } else {
        window.showBubbleEditorPanel?.(false);
      }
    }
    if (rowId === 'bubbles' && tabId === 'text') {
      const pg = window.selectedTextElement?.pgKey || window.getPages?.()[0]?.pg;
      window.refreshTextElementList?.(pg);
    }
    if (rowId === 'layers' && tabId === 'layers') {
      // NOTE: selectedBubble is a `let` in state.js — it doesn't attach
      // to `window` across <script> tags (only function declarations
      // do), so this reads the bare identifier instead of window.selectedBubble.
      const pg = selectedBubble?.pgKey || window.getPages?.()[0]?.pg;
      window.refreshLayersPanel?.(pg);
    }
    if (rowId === 'layers' && tabId === 'editor') {
      // Editor tab: if a bubble is selected, show its properties
      const pg = selectedBubble?.pgKey || window.getPages?.()[0]?.pg;
      window.refreshLayersPanel?.(pg);
    }
    if (rowId === 'preview') {
      updateUndoRowLabel();
    }
  }

  // ============================================================
  // Row 1 — Import / Export
  // All export logic already exists in data.js (exportExcel) or
  // is stubbed until Step 6 (export.js: exportAllSVG/exportAllPNG,
  // JSON import/export; github.js: saveToGitHub/loadFromGitHub/
  // restoreAutoSave). Buttons call them defensively so they start
  // working the moment those files land — no rewiring needed here.
  // ============================================================
  function tplExport(tabId) {
    switch (tabId) {
      case 'svg': return `
        <div class="section">
          <div class="section-title">Export SVG</div>
          <div class="field">
            <label>Page</label>
            <select id="svgPageSel">
              <option value="__all__">All pages</option>
              ${pageOptionsHTML()}
            </select>
          </div>
          <div class="field" style="flex-direction:row;align-items:center;gap:var(--sp-2)">
            <input type="checkbox" id="svgTransparentBg">
            <label style="text-transform:none;font-size:var(--type-sm)">Transparent background</label>
          </div>
          <button class="btn primary full" onclick="window.exportAllSVG?.(
              document.getElementById('svgPageSel').value,
              document.getElementById('svgTransparentBg').checked
            ) ?? window.showToast?.('SVG export not wired yet')">&#8595; Export SVG</button>
        </div>`;
      case 'png': return `
        <div class="section">
          <div class="section-title">Export PNG</div>
          <div class="field">
            <label>Page</label>
            <select id="pngPageSel">
              <option value="__all__">All pages</option>
              ${pageOptionsHTML()}
            </select>
          </div>
          <div class="field" style="flex-direction:row;align-items:center;gap:var(--sp-2)">
            <input type="checkbox" id="pngTransparentBg">
            <label style="text-transform:none;font-size:var(--type-sm)">Transparent background</label>
          </div>
          <button class="btn primary full" onclick="window.exportAllPNG?.(
              document.getElementById('pngPageSel').value,
              document.getElementById('pngTransparentBg').checked
            ) ?? window.showToast?.('PNG export not wired yet')">&#8595; Export PNG</button>
        </div>
        <div class="section">
          <div class="section-title">Export Data</div>
          <button class="btn full" onclick="exportExcel()">&#8595; Export Excel / CSV</button>
        </div>`;
      case 'json': return `
        <div class="section">
          <div class="section-title">Export Project</div>
          <button class="btn primary full" onclick="window.exportProjectJSON?.() ?? window.showToast?.('JSON export not wired yet')">&#8595; Export JSON</button>
        </div>
        <div class="section">
          <div class="section-title">Import Project</div>
          <input type="file" id="jsonImportInput" accept=".json" style="display:none"
            onchange="window.importFromJSON?.(this.files[0]) ?? window.showToast?.('JSON import not wired yet')">
          <button class="btn full" onclick="document.getElementById('jsonImportInput').click()">&#8593; Import JSON</button>
        </div>
        <div class="section">
          <div class="section-title">Autosave</div>
          <button class="btn full" onclick="window.restoreAutoSave?.() ?? window.showToast?.('Autosave restore not wired yet')">Restore Autosave</button>
        </div>`;
      case 'github': return `
        <div class="section">
          <div class="section-title">Repository</div>
          <div class="field"><label>Repository (owner/repo)</label><input type="text" id="ghRepo" placeholder="owner/repo"></div>
          <div class="field"><label>Branch</label><input type="text" id="ghBranch" placeholder="main"></div>
          <div class="field"><label>Personal Access Token</label><input type="password" id="ghToken" placeholder="ghp_..."></div>
          <button class="btn full" onclick="window.saveGitHubConfig?.()">Save Config</button>
        </div>
        <div class="section">
          <div class="section-title">Sync</div>
          <div id="ghStatus" style="font-size:var(--type-xs);color:var(--text-3);min-height:16px;margin-bottom:var(--sp-2);font-family:'IBM Plex Mono',monospace;"></div>
          <button class="btn primary full" onclick="window.saveToGitHub?.()" style="margin-bottom:var(--sp-2)">&#8593; Save to GitHub</button>
          <button class="btn full" onclick="window.loadFromGitHub?.()">&#8595; Load from GitHub</button>
        </div>`;
      default: return '';
    }
  }

  function pageOptionsHTML() {
    const pages = window.getPages?.() || [];
    return pages.map(({ pg, chp }) => `<option value="${pg}">${chp} &middot; ${pg}</option>`).join('');
  }

  // ============================================================
  // Row 2 — Pages & Panels
  // Page Editor tab embeds the existing data table (#dataTableBody,
  // data.js) and page list (#pageList, pages.js) verbatim — those
  // files already target these exact ids. Panel Editor is stubbed
  // until panels.js (Step 7).
  // ============================================================
  function tplPages(tabId) {
    if (tabId === 'page') return `
      <div class="section">
        <div class="section-title">Mode</div>
        <div class="field" style="flex-direction:row;gap:var(--sp-2)">
          <button class="btn ${!pageBypageMode ? 'primary' : ''}" onclick="setPbpMode(false)">All Pages</button>
          <button class="btn ${pageBypageMode ? 'primary' : ''}" onclick="setPbpMode(true)">Page-by-Page</button>
        </div>
        ${pageBypageMode ? `
          <div class="field" style="flex-direction:row;align-items:center;gap:var(--sp-2)">
            <button class="btn small" onclick="pbpPrev()">&lsaquo;</button>
            <select id="pageEditorPageSel" style="flex:1" onchange="navigateToPbpPage(this.value)">
              ${pageOptionsHTML()}
            </select>
            <button class="btn small" onclick="pbpNext()">&rsaquo;</button>
          </div>` : `<select id="pageEditorPageSel" style="display:none">${pageOptionsHTML()}</select>`}
      </div>

      <div class="section">
        <div class="section-title">Import Data</div>
        <div class="drop-zone" id="dropZone"
          ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDrop(event)">
          Drag a .csv / .xlsx file here
          <div style="margin-top:var(--sp-2)">
            <input type="file" id="fileImportInput" accept=".csv,.xlsx,.xls" style="display:none" onchange="handleFileImport(event)">
            <button class="btn small" onclick="document.getElementById('fileImportInput').click()">Browse&hellip;</button>
          </div>
        </div>
        <div class="field" style="margin-top:var(--sp-3)">
          <label>Or paste CSV</label>
          <textarea id="pasted-csv" placeholder="Chapter No., Scene No., Page No., ..."></textarea>
        </div>
        <button class="btn full" onclick="parsePastedCSV()">Parse Pasted CSV</button>
      </div>

      <div class="section">
        <div class="section-title">Page List</div>
        <div id="noPages" style="color:var(--text-3);font-size:var(--type-sm)">No pages yet.</div>
        <div id="pageList"></div>
      </div>

      <div class="section">
        <div class="section-title">Raw Data</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Chp</th><th>Scn</th><th>Pg</th><th>Pnl</th><th>Row</th><th>L&times;H</th><th>MaxL</th><th>MaxH</th><th></th>
            </tr></thead>
            <tbody id="dataTableBody"></tbody>
          </table>
        </div>
        <div class="field" style="flex-direction:row;gap:var(--sp-2);margin-top:var(--sp-2)">
          <button class="btn small" onclick="addRow()">+ Row</button>
          <button class="btn small" onclick="exportExcel()">Export Excel</button>
          <button class="btn small danger" onclick="clearAllRows()">Clear All</button>
        </div>
      </div>
    `;

    if (tabId === 'panel') return `
      <div class="section">
        <div class="field">
          <label>Page</label>
          <select id="panelEditorPageSel" onchange="window.refreshPanelsPanel?.(this.value)">
            ${pageOptionsHTML()}
          </select>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Quick Layout</div>
        <p style="color:var(--text-3);font-size:var(--type-sm);margin-bottom:var(--sp-2)">
          Fill the page above with an evenly-spaced grid of panels —
          works the same as typing out that many rows of data by hand.
        </p>
        <div class="field" style="flex-direction:row;gap:var(--sp-2)">
          <div class="field" style="flex:1">
            <label>Rows</label>
            <input type="number" id="qlRows" min="1" max="8" value="2">
          </div>
          <div class="field" style="flex:1">
            <label>Columns</label>
            <input type="number" id="qlCols" min="1" max="6" value="2">
          </div>
        </div>
        <button class="btn primary full" onclick="window.applyQuickLayout?.(
            document.getElementById('panelEditorPageSel')?.value,
            +document.getElementById('qlRows').value,
            +document.getElementById('qlCols').value
          )">Generate Grid</button>
      </div>

      <div class="section">
        <div id="panelEditorBody" style="color:var(--text-3);font-size:var(--type-sm)">
          Generate pages first to see panel controls.
        </div>
      </div>`;

    return '';
  }

  function tplBubbles(tabId) {
    if (tabId === 'bubble') return `
      <div class="section">
        <div class="field">
          <label>Target Page</label>
          <select id="bubblePageSel" onchange="window.refreshQuickBubblePanelSel?.(this.value)">${pageOptionsHTML()}</select>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Insert Bubble</div>
        <p style="color:var(--text-3);font-size:var(--type-sm);margin-bottom:var(--sp-2)">
          Drop a bubble straight onto a panel — no dialogue needed yet,
          edit its text after by clicking it on the canvas.
        </p>
        <div class="field">
          <label>Panel</label>
          <select id="qbPanelSel"></select>
        </div>
        <div class="field">
          <label>Type</label>
          <select id="qbType">
            <option value="circle">Circle</option>
            <option value="bold">Bold</option>
            <option value="square">Square</option>
            <option value="rectangle">Rectangle</option>
            <option value="thought">Thought</option>
            <option value="fading">Fading</option>
            <option value="dashed">Dashed</option>
            <option value="spiked">Spiked</option>
            <option value="lilypad">Lilypad</option>
          </select>
        </div>
        <div class="field">
          <label>Dialogue (optional)</label>
          <input type="text" id="qbText" placeholder="Leave blank and edit later">
        </div>
        <button class="btn primary full" onclick="window.insertBubbleToPanel?.(
            document.getElementById('bubblePageSel').value,
            +document.getElementById('qbPanelSel').value,
            document.getElementById('qbType').value,
            document.getElementById('qbText').value
          )">&#43; Insert Bubble</button>
      </div>

      <div class="section">
        <div class="section-title">Import Bubbles</div>
        <div class="field">
          <label>Paste Bubble Data (Type &middot; Speaker &middot; Dialogue, tab-separated)</label>
          <textarea id="bubblePasteArea" rows="5" placeholder="circle&#9;Hero&#9;Hello world!"></textarea>
        </div>
        <button class="btn full" onclick="window.importBubbles?.()">&#43; Add Bubbles from Text</button>
      </div>

      <div class="section" id="bp-nosel" style="color:var(--text-3);font-size:var(--type-sm);">
        Click a bubble on the canvas to edit it here.
      </div>

      <div class="section" id="bp-editor" style="display:none;">
        <div class="section-title">Selected Bubble</div>

        <div class="field">
          <label>Type</label>
          <select id="bp-type" onchange="window.bpUpdate?.('type',this.value)">
            <option value="circle">Circle</option>
            <option value="bold">Bold</option>
            <option value="square">Square</option>
            <option value="rectangle">Rectangle</option>
            <option value="thought">Thought</option>
            <option value="fading">Fading</option>
            <option value="dashed">Dashed</option>
            <option value="spiked">Spiked</option>
            <option value="lilypad">Lilypad</option>
          </select>
        </div>

        <div class="field">
          <label>Speaker</label>
          <input type="text" id="bp-speaker" oninput="window.bpUpdate?.('speaker',this.value)">
        </div>
        <div class="field">
          <label>Text</label>
          <textarea id="bp-text" rows="3" oninput="window.bpUpdate?.('text',this.value)"></textarea>
        </div>

        <div class="field">
          <label>Font</label>
          <select id="bp-font" onchange="window.bpUpdate?.('font',this.value)">
            <option value="BubbleSans">BubbleSans</option>
            <option value="XLTightBoo">XLTightBoo</option>
            <option value="TGLEngschrift">TGLEngschrift</option>
            <option value="Bangers">Bangers</option>
            <option value="Permanent Marker">Permanent Marker</option>
            <option value="Caveat">Caveat</option>
            <option value="custom1" disabled hidden>Custom 1</option>
            <option value="custom2" disabled hidden>Custom 2</option>
          </select>
        </div>
        <div class="field" style="flex-direction:row;gap:var(--sp-2);align-items:center;">
          <label style="flex:1;">Custom Font</label>
          <input type="file" id="fontFileInput" accept=".otf,.ttf,.woff,.woff2" style="display:none" onchange="window.loadCustomFont?.(event)">
          <button class="btn small" onclick="document.getElementById('fontFileInput').click()">&#8593; Load Font</button>
        </div>

        <div class="field">
          <label>Font Size</label>
          <input type="number" id="bp-fsize" min="10" max="400" oninput="window.bpUpdate?.('fontSize',+this.value)">
        </div>
        <div class="field" style="flex-direction:row;gap:var(--sp-2);">
          <button id="bp-bold"   class="btn small" onclick="window.bpToggle?.('bold')">B</button>
          <button id="bp-italic" class="btn small" onclick="window.bpToggle?.('italic')"><em>I</em></button>
        </div>
        <div class="field">
          <label>Color</label>
          <input type="color" id="bp-color" oninput="window.bpUpdate?.('color',this.value)">
        </div>
        <div class="field">
          <label>Line Height</label>
          <input type="number" id="bp-line-height" min="0.8" max="3" step="0.05" oninput="window.bpUpdate?.('lineHeight',+this.value)">
        </div>
        <div class="field">
          <label>Padding Ratio</label>
          <input type="number" id="bp-pad-ratio" min="0.01" max="0.4" step="0.01" oninput="window.bpUpdate?.('padRatio',+this.value)">
        </div>

        <div class="section-title" style="margin-top:var(--sp-3);">Position &amp; Size</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          <div class="field"><label>X</label><input type="number" id="bp-x" onchange="window.bpUpdatePos?.()"></div>
          <div class="field"><label>Y</label><input type="number" id="bp-y" onchange="window.bpUpdatePos?.()"></div>
          <div class="field"><label>W</label><input type="number" id="bp-w" onchange="window.bpUpdatePos?.()"></div>
          <div class="field"><label>H</label><input type="number" id="bp-h" onchange="window.bpUpdatePos?.()"></div>
        </div>
        <div class="field"><label>Rotation&deg;</label><input type="number" id="bp-rot" onchange="window.bpUpdatePos?.()"></div>

        <div class="section-title" style="margin-top:var(--sp-3);">Tail</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          <div class="field"><label>Angle&deg;</label><input type="number" id="bp-tail-angle" min="0" max="360" oninput="window.bpUpdatePos?.()"></div>
          <div class="field"><label>Length</label><input type="number"  id="bp-tail-len"   min="0" oninput="window.bpUpdatePos?.()"></div>
          <div class="field"><label>Breadth</label><input type="number" id="bp-tail-breadth" min="0.1" max="30" step="0.1" oninput="window.bpUpdatePos?.()"></div>
          <div class="field"><label>Dots</label><input type="number"    id="bp-dot-count"   min="1" max="12" oninput="window.bpUpdate?.('dotCount',+this.value)"></div>
          <div class="field"><label>Spikes</label><input type="number"  id="bp-spike-count" min="5" max="40" oninput="window.bpUpdate?.('spikeCount',+this.value)"></div>
          <div class="field"><label>Dashes</label><input type="number"  id="bp-dash-count"  min="2" max="20" oninput="window.bpUpdate?.('dashCount',+this.value)"></div>
        </div>

        <div class="section-title" style="margin-top:var(--sp-3);">Locks</div>
        <div class="field" style="flex-direction:row;gap:var(--sp-2);">
          <button id="lock-move"   class="btn small" onclick="window.bpLockToggle?.('move')">Lock Move</button>
          <button id="lock-resize" class="btn small" onclick="window.bpLockToggle?.('resize')">Lock Resize</button>
          <button id="lock-rotate" class="btn small" onclick="window.bpLockToggle?.('rotate')">Lock Rotate</button>
        </div>
      </div>

      <div class="section">
        <button class="btn danger full" onclick="window.clearBubbles?.()">Clear All Bubbles</button>
      </div>`;

    if (tabId === 'text') return `
      <div class="section">
        <div class="section-title">Add Text Element</div>
        <div class="field">
          <label>Target Page</label>
          <select id="textPageSel" onchange="window.refreshTextElementList?.(this.value)">${pageOptionsHTML()}</select>
        </div>
        <button class="btn primary full" onclick="window.createTextElement?.({ pg: document.getElementById('textPageSel').value })">&#43; Add Text Element</button>
      </div>

      <div class="section" id="tp-nosel" style="color:var(--text-3);font-size:var(--type-sm);">
        Click a text element on the canvas to edit it here.
      </div>

      <div class="section" id="tp-editor" style="display:none;">
        <div class="section-title">Selected Text</div>
        <div class="field">
          <label>Content</label>
          <textarea id="tp-content" rows="3" oninput="window.tpUpdate?.('content',this.value)"></textarea>
        </div>
        <div class="field">
          <label>Font</label>
          <select id="tp-font" onchange="window.tpUpdate?.('font',this.value)">
            <option value="Inter, system-ui, sans-serif">Inter</option>
            <option value="'IBM Plex Mono', monospace">IBM Plex Mono</option>
            <option value="Bangers">Bangers</option>
            <option value="'Permanent Marker'">Permanent Marker</option>
            <option value="Caveat">Caveat</option>
          </select>
        </div>
        <div class="field">
          <label>Size</label>
          <input type="number" id="tp-size" min="8" max="400" oninput="window.tpUpdate?.('size',+this.value)">
        </div>
        <div class="field">
          <label>Color</label>
          <input type="color" id="tp-color" oninput="window.tpUpdate?.('color',this.value)">
        </div>
        <div class="section-title" style="margin-top:var(--sp-3);">Position &amp; Rotation</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          <div class="field"><label>X</label><input type="number" id="tp-x" onchange="window.tpUpdatePos?.()"></div>
          <div class="field"><label>Y</label><input type="number" id="tp-y" onchange="window.tpUpdatePos?.()"></div>
        </div>
        <div class="field"><label>Rotation&deg;</label><input type="number" id="tp-rotation" onchange="window.tpUpdatePos?.()"></div>
        <button class="btn danger full" style="margin-top:var(--sp-3);" onclick="window.deleteSelectedTextElement?.()">Delete Text Element</button>
      </div>

      <div class="section">
        <div class="section-title">All Text Elements</div>
        <div id="textElementListBody" style="color:var(--text-3);font-size:var(--type-sm);">
          Loading…
        </div>
      </div>`;

    return '';
  }

  // ============================================================
  // Row 4 — Layers
  // ============================================================
  function tplLayers(tabId) {
    const pagesOpts = pageOptionsHTML();
    const pgSel = `<div class="field" style="margin-bottom:var(--sp-2);">
      <label>Page</label>
      <select id="layersPageSel" onchange="window.refreshLayersPanel?.(this.value)">${pagesOpts}</select>
    </div>`;

    if (tabId === 'layers') return `
      <div class="section">
        ${pgSel}
        <div id="layerListBody" style="color:var(--text-3);font-size:var(--type-sm);">
          Loading layers…
        </div>
      </div>`;

    if (tabId === 'editor') return `
      <div class="section">
        ${pgSel}
        <div id="layerEditorBody" style="color:var(--text-3);font-size:var(--type-sm);">
          Select a layer above to edit its properties here.
        </div>
        <div id="layerListBody" style="max-height:200px;overflow-y:auto;margin-top:var(--sp-3);border-top:1px solid var(--border);padding-top:var(--sp-2);">
        </div>
      </div>`;

    return '';
  }

  // ============================================================
  // Row 5 — Preview Options (action tabs)
  // Undo/Redo/Generate fire immediately. Create Blank / Sample
  // open the drawer with a small options form per spec.
  // ============================================================
  function tplPreview(tabId) {
    if (tabId === 'blank') return `
      <div class="section">
        <div class="section-title">Create Blank Page</div>
        <p style="color:var(--text-3);font-size:var(--type-sm);margin-bottom:var(--sp-3)">
          Generates a blank manga page template with frame and safe-zone
          guides but no panels.
        </p>
        <div class="field" style="flex-direction:row;gap:var(--sp-2)">
          <button class="btn full" onclick="createBlankPage('left')">Left Page (odd)</button>
          <button class="btn full" onclick="createBlankPage('right')">Right Page (even)</button>
        </div>
      </div>`;

    if (tabId === 'sample') return `
      <div class="section">
        <div class="section-title">Load Sample Data</div>
        <p style="color:var(--text-3);font-size:var(--type-sm);margin-bottom:var(--sp-3)">
          Loads the built-in sample dataset and regenerates all pages.
        </p>
        <button class="btn primary full" onclick="loadSampleData();generateAll();window.showToast?.('Sample data loaded')">Load Sample</button>
      </div>`;

    // Undo / Redo / Generate don't need drawer content — they fire
    // and the drawer for 'preview' just shows the row's current
    // disabled-state summary as a fallback view.
    return `
      <div class="section" style="color:var(--text-3);font-size:var(--type-sm)">
        Undo, Redo, and Generate run immediately when clicked — this
        drawer only opens for Create Blank and Sample, which need options.
      </div>`;
  }

  function runPreviewAction(tabId) {
    switch (tabId) {
      case 'undo':
        if (window.undo) { window.undo(); updateUndoRowLabel(); }
        else window.showToast?.('Undo not wired yet');
        break;
      case 'redo':
        if (window.redo) { window.redo(); updateUndoRowLabel(); }
        else window.showToast?.('Redo not wired yet');
        break;
      case 'generate':
        window.generateAll?.();
        break;
      // 'blank' and 'sample' are handled by openDrawerTab opening
      // the drawer with their options form — no immediate action.
    }
  }

  // Reflects undo/redo disabled state on the rail row label itself,
  // since the floating undo/redo buttons no longer exist (spec
  // Section E: "Wire updateUndoButtons() to update the Preview
  // Options row label text to show disabled state").
  function updateUndoRowLabel() {
    const row = railRowEl('preview');
    // NOTE: undoStack/undoPtr are `let` in state.js — they don't attach
    // to `window` across <script> tags (only function declarations do),
    // so this reads the bare identifiers rather than window.undoStack /
    // window.undoPtr, which would silently always read undefined.
    const canUndo = (typeof undoPtr !== 'undefined' ? undoPtr : -1) > 0;
    const stackLen = typeof undoStack !== 'undefined' ? undoStack.length : 0;
    const canRedo = stackLen > 0 && (typeof undoPtr !== 'undefined' ? undoPtr : -1) < stackLen - 1;
    if (row) {
      row.classList.toggle('undo-disabled', !canUndo);
      row.classList.toggle('redo-disabled', !canRedo);
    }
    // Rail row and drawer tab pills are sibling subtrees, so the
    // disabled state also needs to live on a shared ancestor (body)
    // for the tab-pill dimming CSS in components.css to read it.
    document.body.dataset.undo = canUndo ? 'enabled' : 'disabled';
    document.body.dataset.redo = canRedo ? 'enabled' : 'disabled';
  }
  window.updateUndoRowLabel = updateUndoRowLabel;

  window.openDrawer = openDrawer;
  window.openDrawerTab = openDrawerTab;
  window.closeDrawer = closeDrawer;
  window.showToast = showToast;
  window.renderDrawer = renderDrawer;

  // Re-render rowId's tab in place, but only if it's the row currently
  // open — used by code outside ui.js (e.g. pages.js's setPbpMode())
  // that changes state the open drawer should reflect immediately,
  // instead of requiring a close/reopen to see the change.
  window.refreshDrawerTabIfOpen = function (rowId) {
    if (activeRow === rowId) renderDrawer(rowId);
  };

  // ── Exposed for mobile.js accordion system ────────────────
  // buildMobTabContent / afterMobDrawerRender mirror the desktop
  // equivalents but target the mobile drawer containers.
  window.buildMobTabContent = function(rowId, tabId) {
    return buildTabContent(rowId, tabId);
  };
  window.afterMobDrawerRender = function(rowId, tabId) {
    afterDrawerRender(rowId, tabId);
  };
})();

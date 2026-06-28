// ============================================================
// js/github.js — Step 6
// GitHub save / load, and credential persistence via
// localStorage key 'mpg_github_config' (spec Section E).
//
// The old monolith hard-coded GH_USER/GH_REPO/GH_FILE.  The
// new version reads them from the config stored by the GitHub
// drawer tab fields (ghRepo, ghBranch, ghToken), which is
// exactly what the spec requires.
//
// Depends on: export.js (buildSaveData, restoreSaveData),
//             ui.js (showToast), generate.js (generateAll)
// ============================================================

// ── Config helpers ────────────────────────────────────────────

const GH_CONFIG_KEY = 'mpg_github_config';

function loadGitHubConfig() {
  try { return JSON.parse(localStorage.getItem(GH_CONFIG_KEY) || '{}'); }
  catch (_) { return {}; }
}

function saveGitHubConfig() {
  const repo   = document.getElementById('ghRepo')?.value.trim()   || '';
  const branch = document.getElementById('ghBranch')?.value.trim() || 'main';
  const token  = document.getElementById('ghToken')?.value.trim()  || '';
  const cfg = { repo, branch, token };
  localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(cfg));
  showToast('GitHub config saved');
}
window.saveGitHubConfig = saveGitHubConfig;

// Populate the drawer fields with stored config when the drawer opens.
function populateGitHubFields() {
  const cfg = loadGitHubConfig();
  const repoEl   = document.getElementById('ghRepo');
  const branchEl = document.getElementById('ghBranch');
  const tokenEl  = document.getElementById('ghToken');
  if (repoEl   && cfg.repo)   repoEl.value   = cfg.repo;
  if (branchEl && cfg.branch) branchEl.value = cfg.branch;
  if (tokenEl  && cfg.token)  tokenEl.value  = cfg.token;
}
window.populateGitHubFields = populateGitHubFields;

// ── Build API URL ─────────────────────────────────────────────

function getGitHubAPIUrl() {
  const cfg    = loadGitHubConfig();
  const repo   = cfg.repo   || '';
  const branch = cfg.branch || 'main';
  // Default file path — same as the old monolith
  const file   = 'manga-save.json';
  if (!repo) return null;
  return { url: `https://api.github.com/repos/${repo}/contents/${file}`, branch, token: cfg.token || '' };
}

// ── Status helper (shown inside the drawer) ──────────────────

function setGhStatus(msg, color) {
  const el = document.getElementById('ghStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color || 'var(--text-3)';
}

// ── Save to GitHub ────────────────────────────────────────────

async function saveToGitHub() {
  const api = getGitHubAPIUrl();
  if (!api?.url || !api.token) {
    setGhStatus('Enter repo and token first.', 'var(--danger)');
    showToast('GitHub: fill in repo + token');
    return;
  }
  setGhStatus('Saving…');
  try {
    let sha = null;
    try {
      const check = await fetch(api.url, {
        headers: { Authorization: `Bearer ${api.token}`, Accept: 'application/vnd.github+json' }
      });
      if (check.ok) { const j = await check.json(); sha = j.sha; }
    } catch (_) {}

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(buildSaveData(), null, 2))));
    const body    = { message: `Save: ${new Date().toLocaleString()}`, content, branch: api.branch };
    if (sha) body.sha = sha;

    const res = await fetch(api.url, {
      method:  'PUT',
      headers: {
        Authorization:   `Bearer ${api.token}`,
        Accept:          'application/vnd.github+json',
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setGhStatus('Saved to GitHub ✓', 'var(--success)');
      showToast('Saved to GitHub ✓');
    } else {
      const err = await res.json();
      setGhStatus('Error: ' + (err.message || res.status), 'var(--danger)');
    }
  } catch (e) {
    setGhStatus('Error: ' + e.message, 'var(--danger)');
  }
}
window.saveToGitHub = saveToGitHub;

// ── Load from GitHub ──────────────────────────────────────────

async function loadFromGitHub() {
  const api = getGitHubAPIUrl();
  if (!api?.url || !api.token) {
    setGhStatus('Enter repo and token first.', 'var(--danger)');
    showToast('GitHub: fill in repo + token');
    return;
  }
  setGhStatus('Loading…');
  try {
    const res = await fetch(api.url + '?ref=' + api.branch, {
      headers: { Authorization: `Bearer ${api.token}`, Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) {
      const err = await res.json();
      setGhStatus('Error: ' + (err.message || 'File not found'), 'var(--danger)');
      return;
    }
    const j    = await res.json();
    const data = JSON.parse(decodeURIComponent(escape(atob(j.content))));
    restoreSaveData(data);
    setGhStatus('Loaded ✓ — regenerating…', 'var(--success)');
    setTimeout(() => {
      generateAll?.();
      showToast('Session loaded from GitHub ✓');
    }, 800);
  } catch (e) {
    setGhStatus('Error: ' + e.message, 'var(--danger)');
  }
}
window.loadFromGitHub = loadFromGitHub;

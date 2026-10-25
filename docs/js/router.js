// Hash router: "#/read/<book>/<chapter>/<section>" → view(params). Paths are relative-safe for GitHub Pages.

const routes = [];
let cleanup = null;
let renderId = 0;

export function route(pattern, view, tab) {
  const names = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
  routes.push({ re, names, view, tab });
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) render();
}

export async function render() {
  const id = ++renderId;
  const path = location.hash.replace(/^#/, '') || '/today';
  const match = matchRoute(path) || matchRoute('/today');
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch { /* view cleanup must never block navigation */ }
  }
  cleanup = null;

  for (const a of document.querySelectorAll('.tabbar a')) {
    a.classList.toggle('active', a.dataset.tab === match.tab);
  }

  const root = document.getElementById('view');
  const result = await match.view(root, match.params, () => id === renderId);
  if (id === renderId) cleanup = result;
  else if (typeof result === 'function') result();
}

// Exported for tests. A malformed %-escape counts as "no match", so the app falls back to Today.
export function matchRoute(path) {
  const [p] = path.split('?');
  for (const r of routes) {
    const m = r.re.exec(p);
    if (!m) continue;
    try {
      const params = {};
      r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { ...r, params };
    } catch {
      return null;
    }
  }
  return null;
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  return render();
}

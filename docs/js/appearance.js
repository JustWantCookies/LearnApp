// Theme + reader font size, mirrored in localStorage so they apply before IndexedDB opens.

export function applyAppearance({ theme, fontSize }) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  if (fontSize) root.style.setProperty('--reader-size', `${fontSize}px`);
  try { localStorage.setItem('appearance', JSON.stringify({ theme, fontSize })); } catch { /* private mode */ }
}

export function applyCachedAppearance() {
  try {
    const cached = JSON.parse(localStorage.getItem('appearance') || 'null');
    if (cached) applyAppearance(cached);
  } catch { /* ignore */ }
}

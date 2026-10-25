import { route, startRouter } from './router.js';
import { openDB, getSetting } from './db.js';
import { h, clear, errorMessage } from './dom.js';
import { todayView } from './views/today.js';
import { libraryView } from './views/library.js';
import { bookView } from './views/book.js';
import { settingsView } from './views/settings.js';
import { aboutView } from './views/about.js';
import { exportView } from './views/export.js';
import { readerView } from './reader.js';
import { quizView } from './quiz.js';
import { applyAppearance, applyCachedAppearance } from './appearance.js';

// ---------- Service worker + update banner ----------

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  const banner = document.getElementById('update-banner');
  const show = (reg) => {
    banner.hidden = false;
    document.getElementById('update-reload').onclick = () => {
      reloading = true;
      reg.waiting?.postMessage('skipWaiting');
    };
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) show(reg);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        // Only an *update* gets a banner; the very first install just works silently.
        if (sw.state === 'installed' && navigator.serviceWorker.controller) show(reg);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => { /* offline or unsupported: app still works from the network */ });
}

// ---------- Boot ----------

function wrap(view) {
  return async (root, params, isCurrent) => {
    try {
      return await view(root, params, isCurrent);
    } catch (err) {
      console.error(err);
      if (!isCurrent()) return;
      clear(root);
      root.append(h('div', { class: 'card warn' },
        h('h3', {}, 'This screen could not be shown'),
        h('p', {}, errorMessage(err)),
        h('p', {}, h('a', { href: '#/today' }, 'Back to Today'))));
    }
  };
}

route('/today', wrap(todayView), 'today');
route('/export', wrap(exportView), 'today');
route('/quiz/due', wrap((root, p, cur) => quizView(root, { mode: 'due' }, cur)), 'today');
route('/quiz/section/:bookId/:chapterId/:sectionId', wrap((root, p, cur) => quizView(root, { mode: 'section', ...p }, cur)), 'library');
route('/library', wrap(libraryView), 'library');
route('/book/:bookId', wrap(bookView), 'library');
route('/read/:bookId/:chapterId/:sectionId', wrap(readerView), 'library');
route('/settings', wrap(settingsView), 'settings');
route('/about/:bookId', wrap(aboutView), 'settings');

async function boot() {
  applyCachedAppearance();
  setupServiceWorker();
  try {
    await openDB();
    applyAppearance({ theme: await getSetting('theme', 'auto'), fontSize: await getSetting('fontSize', 18) });
  } catch (err) {
    const root = document.getElementById('view');
    root.append(h('div', { class: 'card warn' },
      h('h3', {}, 'Storage is not available'),
      h('p', {}, err?.userMessage || 'This browser blocked local storage. Open the app from the Home Screen icon, not in a private tab.')));
    return;
  }
  await startRouter();
}

boot();

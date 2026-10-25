import { h, clear, hrefFor, toast, saveFile, pickFiles, errorMessage } from '../dom.js';
import { getAll, getSetting, setSetting } from '../db.js';
import { applyAppearance } from '../appearance.js';
import { getCaps } from '../progress.js';
import { requestPersistence, removeBookContent } from '../packs.js';
import {
  parseGrades, knownItemIds, applyGrades, createBackup, validateBackup, restoreBackup, markBackedUp,
} from '../exportImport.js';
import { daysSince, todayStr } from '../dates.js';

export async function settingsView(root, params, isCurrent) {
  const [theme, fontSize, caps, books, chapters, lastBackup] = await Promise.all([
    getSetting('theme', 'auto'), getSetting('fontSize', 18), getCaps(),
    getAll('books'), getAll('chapters'), getSetting('lastBackup', null),
  ]);
  if (!isCurrent()) return;
  clear(root);
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  root.append(h('h1', { class: 'page-title' }, 'Settings'));

  // ---------- Reading ----------
  const sizeLabel = h('span', {}, `Font size: ${fontSize}px`);
  const size = h('input', { type: 'range', min: 15, max: 26, step: 1, value: fontSize, 'aria-label': 'Font size' });
  size.addEventListener('input', () => {
    sizeLabel.textContent = `Font size: ${size.value}px`;
    applyAppearance({ theme: currentTheme, fontSize: Number(size.value) });
  });
  size.addEventListener('change', () => setSetting('fontSize', Number(size.value)));

  let currentTheme = theme;
  const themeBtns = ['auto', 'light', 'dark'].map((t) => h('button', {
    type: 'button', 'aria-pressed': String(t === theme),
    onclick: async () => {
      currentTheme = t;
      themeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
      applyAppearance({ theme: t, fontSize: Number(size.value) });
      await setSetting('theme', t);
    },
    dataset: { t },
  }, t[0].toUpperCase() + t.slice(1)));

  root.append(h('h2', { class: 'section-title' }, 'Reading'),
    h('div', { class: 'card stack' },
      h('label', { class: 'field' }, sizeLabel, size),
      h('div', {}, h('span', { class: 'small muted' }, 'Theme'), h('div', { class: 'segmented' }, themeBtns)),
      h('p', { class: 'reader small' }, 'Preview: The heart pumps blood through two circuits.')));

  // ---------- Daily limits ----------
  const capInput = (key, label) => {
    const input = h('input', { type: 'number', min: 0, max: 999, inputmode: 'numeric', value: caps[key] });
    input.addEventListener('change', async () => {
      const n = Math.max(0, Math.min(999, Math.round(Number(input.value) || 0)));
      input.value = n;
      await setSetting('caps', { ...(await getCaps()), [key]: n });
      toast('Saved.');
    });
    return h('label', { class: 'field' }, h('span', {}, label), input);
  };
  root.append(h('h2', { class: 'section-title' }, 'Daily limits'),
    h('div', { class: 'card stack' }, capInput('newPerDay', 'New questions per day'), capInput('reviewsPerDay', 'Reviews per day')));

  // ---------- Import grades ----------
  const paste = h('textarea', { placeholder: '{"results": {"book/ch/section/e1": 2}}', 'aria-label': 'Grades JSON', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' });
  const preview = h('div', { class: 'stack small' });
  const check = async () => {
    clear(preview);
    const res = parseGrades(paste.value, await knownItemIds());
    if (res.error) { preview.append(h('p', {}, res.error)); return; }
    const n = Object.keys(res.valid).length;
    preview.append(h('p', {}, `${n} item${n === 1 ? '' : 's'} will be updated.`));
    if (res.unknown.length) preview.append(h('p', {}, `Unknown or non-explain IDs (ignored): ${res.unknown.join(', ')}`));
    if (res.invalid.length) preview.append(h('p', {}, `Invalid scores (ignored): ${res.invalid.join(', ')}`));
    if (n) {
      const apply = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
        apply.disabled = true;
        try {
          await applyGrades(res.valid);
          paste.value = '';
          clear(preview);
          toast(`Updated ${n} item${n === 1 ? '' : 's'}.`);
        } catch (err) {
          apply.disabled = false;
          toast(errorMessage(err));
        }
      } }, `Apply ${n} grade${n === 1 ? '' : 's'}`);
      preview.append(apply);
    }
  };
  root.append(h('h2', { class: 'section-title' }, 'Import grades from Claude'),
    h('div', { class: 'card stack' }, paste, h('button', { type: 'button', class: 'btn', onclick: check }, 'Preview'), preview));

  // ---------- Backup ----------
  const days = lastBackup ? daysSince(lastBackup) : null;
  const backup = async () => {
    try {
      const data = await createBackup();
      const saved = await saveFile(`backup-${todayStr()}.json`, JSON.stringify(data), 'application/json');
      if (saved) { await markBackedUp(); toast('Backup saved.'); rerender(); }
    } catch (err) { toast(errorMessage(err)); }
  };
  const restore = async () => {
    const [file] = await pickFiles({ accept: '.json,application/json' });
    if (!file) return;
    let obj;
    try { obj = JSON.parse(await file.text()); } catch { toast('That file is not valid JSON.'); return; }
    const problem = validateBackup(obj);
    if (problem) { toast(problem, 5000); return; }
    const when = obj.created ? new Date(obj.created).toLocaleString() : 'unknown date';
    if (!confirm(`Replace all progress on this phone with the backup from ${when}? This cannot be undone.`)) return;
    try {
      await restoreBackup(obj);
      const s = obj.stores.settings || {};
      applyAppearance({ theme: s.theme || 'auto', fontSize: s.fontSize || 18 });
      toast('Progress restored.');
      rerender();
    } catch (err) { toast(errorMessage(err)); }
  };
  root.append(h('h2', { class: 'section-title' }, 'Backup'),
    h('div', { class: `card stack${days === null || days >= 14 ? ' warn' : ''}` },
      h('p', {}, days === null ? 'Last backup: never' : `Last backup: ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`),
      h('p', { class: 'small muted' }, 'The backup contains progress only (answers, schedule, reading positions, settings). Re-import packs after restoring on a new phone.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: backup }, 'Back up'),
        h('button', { type: 'button', class: 'btn', onclick: restore }, 'Restore…'))));

  // ---------- Storage ----------
  const storageInfo = h('p', { class: 'small' }, 'Checking…');
  const persistInfo = h('p', { class: 'small' });
  const persistBtn = h('button', { type: 'button', class: 'btn btn-small', onclick: async () => {
    try {
      const ok = await requestPersistence();
      persistInfo.textContent = ok ? 'Persistent storage: granted' : 'Persistent storage: not granted (add the app to the Home Screen and try again)';
    } catch (err) { toast(errorMessage(err)); }
  } }, 'Request persistent storage');
  root.append(h('h2', { class: 'section-title' }, 'Storage'),
    h('div', { class: 'card stack' }, storageInfo, persistInfo, persistBtn));
  (async () => {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      storageInfo.textContent = `Used ${mb(usage)} of about ${mb(quota)}.`;
    } else storageInfo.textContent = 'Storage usage is not available in this browser.';
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    persistInfo.textContent = persisted === null ? 'Persistent storage: not supported' : `Persistent storage: ${persisted ? 'granted' : 'not granted'}`;
    persistBtn.hidden = persisted !== false;
  })();

  // ---------- Books ----------
  const unsupported = chapters.reduce((n, c) => n + (c.unsupportedItems || 0), 0);
  const bookList = h('ul', { class: 'list' });
  for (const b of books) {
    bookList.append(h('li', {}, h('div', { class: 'list-row' },
      h('span', { class: 'grow' }, h('a', { href: hrefFor('about', b.id) }, b.title),
        h('span', { class: 'meta' }, 'About & License')),
      h('button', { type: 'button', class: 'btn btn-small btn-danger', onclick: async () => {
        if (!confirm(`Remove the content of "${b.title}" from this phone? Your progress is kept and comes back when you re-import the packs.`)) return;
        try {
          await removeBookContent(b.id);
          toast('Book content removed.');
          rerender();
        } catch (err) { toast(errorMessage(err)); }
      } }, 'Remove'))));
  }
  root.append(h('h2', { class: 'section-title' }, 'Books'),
    books.length ? bookList : h('p', { class: 'muted small' }, 'No books imported.'));
  if (unsupported) {
    root.append(h('p', { class: 'small muted' }, `${unsupported} unsupported item${unsupported === 1 ? '' : 's'} skipped (newer question types; update the app to use them).`));
  }

  root.append(h('p', { class: 'small muted' }, 'No accounts, no tracking. Everything stays on this device.'));
}

function mb(bytes) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

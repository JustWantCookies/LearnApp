import { h, clear } from '../dom.js';
import { get } from '../db.js';

// Attribution page — required by CC BY / BY-SA / BY-NC-SA.
export async function aboutView(root, { bookId }, isCurrent) {
  const book = await get('books', bookId);
  if (!isCurrent()) return;
  clear(root);
  root.append(h('div', { class: 'reader-top' },
    h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Back' }, '‹'),
    h('span', { class: 'crumb' }, 'Settings')));
  if (!book) {
    root.append(h('div', { class: 'card empty' }, h('p', {}, 'This book is not in your library.')));
    return;
  }

  const link = (url, text) => (/^https:\/\//.test(url || '') ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text || url) : text || '');
  const rows = [
    ['Title', book.title],
    ['Authors', (book.authors || []).join(', ')],
    ['Publisher', book.publisher],
    ['License', link(book.licenseUrl, book.license)],
    ['Source', link(book.sourceUrl)],
  ].filter(([, v]) => v);

  root.append(
    h('h1', { class: 'page-title' }, 'About & License'),
    h('div', { class: 'card' },
      h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
    h('div', { class: 'card' },
      h('h3', {}, 'Attribution'),
      h('p', {}, book.attribution)),
    h('p', { class: 'small muted' }, 'Content was converted for phone reading (split into sections, restyled, images recompressed). Questions are generated study aids, not part of the original work.'));
}

import { h, clear, hrefFor } from '../dom.js';
import { get, getAllByIndex } from '../db.js';
import { loadStudyState } from '../progress.js';
import { isDue } from '../scheduler.js';

export async function bookView(root, { bookId }, isCurrent) {
  const [book, chapters, study] = await Promise.all([
    get('books', bookId), getAllByIndex('chapters', 'bookId', bookId), loadStudyState(),
  ]);
  if (!isCurrent()) return;
  clear(root);

  root.append(h('div', { class: 'reader-top' },
    h('a', { class: 'icon-btn', href: '#/library', 'aria-label': 'Back to library' }, '‹'),
    h('span', { class: 'crumb' }, 'Library')));

  if (!book) {
    root.append(h('div', { class: 'card empty' }, h('p', {}, 'This book is not in your library.')));
    return;
  }

  root.append(h('h1', { class: 'page-title' }, book.title),
    h('p', { class: 'small muted' }, h('a', { href: hrefFor('about', book.id) }, 'About & License')));

  chapters.sort((a, b) => a.order - b.order);
  for (const ch of chapters) {
    const stats = chapterStats(ch, study);
    const list = h('ul', { class: 'list' });
    for (const s of ch.sections) {
      const key = `${ch.key}/${s.id}`;
      const seen = study.seen.has(key);
      list.append(h('li', { class: 'sub' }, h('a', { href: hrefFor('read', book.id, ch.id, s.id) },
        h('span', { class: 'grow' }, h('span', { class: 'title' }, s.title)),
        seen ? h('span', { class: 'pill seen' }, 'read') : null,
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))));
    }
    root.append(
      h('h2', { class: 'section-title' }, ch.title),
      h('p', { class: 'small muted' },
        `${stats.readPct}% read · ${stats.due} due · ${ch.itemCount} questions`),
      h('div', { class: 'progress' }, progressBar(stats.readPct)),
      h('div', { class: 'stack' }, list));
  }
}

function progressBar(pct) {
  const bar = h('span');
  bar.style.width = `${pct}%`;
  return bar;
}

export function chapterStats(ch, study) {
  const seenCount = ch.sections.filter((s) => study.seen.has(`${ch.key}/${s.id}`)).length;
  let due = 0;
  for (const it of study.items) {
    if (it.chapterKey !== ch.key || it.type !== 'mcq') continue;
    const r = study.reviews.get(it.id);
    if (r ? isDue(r, study.today) : study.seen.has(it.sectionKey)) due++;
  }
  return { readPct: ch.sections.length ? Math.round((seenCount / ch.sections.length) * 100) : 0, due };
}

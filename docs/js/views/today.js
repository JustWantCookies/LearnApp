import { h, clear, hrefFor } from '../dom.js';
import { get, getAll, getSetting } from '../db.js';
import { latestReading, loadStudyState } from '../progress.js';
import { countAvailable, SESSION_SIZE } from '../scheduler.js';
import { daysSince } from '../dates.js';

export async function todayView(root, params, isCurrent) {
  const [books, reading, study, lastBackup] = await Promise.all([
    getAll('books'), latestReading(), loadStudyState(), getSetting('lastBackup', null),
  ]);
  let cont = null;
  if (reading) {
    const ch = await get('chapters', `${reading.bookId}/${reading.chapterId}`);
    const s = ch?.sections.find((x) => x.id === reading.sectionId);
    if (s) cont = { href: hrefFor('read', reading.bookId, ch.id, s.id), title: s.title, chapter: ch.title };
  }
  if (!isCurrent()) return;
  clear(root);

  root.append(h('h1', { class: 'page-title' }, 'Today'));

  if (!books.length) {
    root.append(h('div', { class: 'card empty' },
      h('p', {}, 'Your library is empty.'),
      h('a', { class: 'btn btn-primary', href: '#/library' }, 'Import a pack')));
    return;
  }

  const due = countAvailable(study);

  if (cont) {
    root.append(h('a', { class: 'big-action secondary', href: cont.href },
      h('span', { class: 'label' }, 'Continue reading'), cont.title));
  } else {
    root.append(h('a', { class: 'big-action secondary', href: '#/library' },
      h('span', { class: 'label' }, 'Start reading'), 'Pick a chapter in the Library'));
  }

  if (due > 0) {
    root.append(h('a', { class: 'big-action', href: '#/quiz/due' },
      h('span', { class: 'label' }, `${due} question${due === 1 ? '' : 's'} due`),
      `Start a session (${Math.min(due, SESSION_SIZE)})`));
  } else {
    root.append(h('div', { class: 'card' },
      h('h3', {}, 'No questions due'),
      h('p', { class: 'muted small' }, 'Questions unlock after you read a section.')));
  }

  root.append(h('h2', { class: 'section-title' }, 'Claude loop'),
    h('a', { class: 'btn btn-block', href: '#/export' }, 'Export review sheet'));

  const days = lastBackup ? daysSince(lastBackup) : null;
  if (study.log.length && (days === null || days >= 14)) {
    root.append(h('div', { class: 'card warn', role: 'note' },
      h('h3', {}, days === null ? 'No backup yet' : `Last backup ${days} days ago`),
      h('p', { class: 'small' }, 'Your progress only lives on this phone.'),
      h('a', { class: 'btn btn-small', href: '#/settings' }, 'Back up now')));
  }
}

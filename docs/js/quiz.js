// Quiz session: one MCQ per screen, immediate feedback, summary at the end.

import { h, clear, hrefFor, errorMessage } from './dom.js';
import { get, getAllByIndex } from './db.js';
import { loadStudyState, recordResult } from './progress.js';
import { selectSession, normalizeResult, SESSION_SIZE } from './scheduler.js';
import { relativeDay } from './dates.js';

export async function quizView(root, opts, isCurrent) {
  let queue;
  let backHref = '#/today';
  if (opts.mode === 'section') {
    const key = `${opts.bookId}/${opts.chapterId}/${opts.sectionId}`;
    queue = (await getAllByIndex('items', 'sectionKey', key)).filter((i) => i.type === 'mcq').sort((a, b) => a.sort - b.sort);
    backHref = hrefFor('read', opts.bookId, opts.chapterId, opts.sectionId);
  } else {
    const study = await loadStudyState();
    const ids = selectSession({ ...study, limit: SESSION_SIZE });
    const byId = new Map(study.items.map((i) => [i.id, i]));
    queue = ids.map((id) => byId.get(id));
  }
  if (!isCurrent()) return;

  const results = [];
  let i = 0;
  const sectionTitles = new Map();

  const showQuestion = async () => {
    const item = queue[i];
    const title = await sectionTitle(item, sectionTitles);
    if (!isCurrent()) return;
    clear(root);

    const order = shuffle(item.options.map((_, k) => k));
    const optionEls = order.map((k) => h('button', { type: 'button', class: 'option', dataset: { k } }, item.options[k]));
    const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });

    const answer = async (chosen) => {
      for (const el of optionEls) {
        el.disabled = true;
        const k = Number(el.dataset.k);
        if (k === item.answer) el.classList.add('correct');
        else if (k === chosen) el.classList.add('wrong');
      }
      const correct = chosen === item.answer;
      let state = null;
      try {
        state = await recordResult(item.id, normalizeResult('mcq', correct), 'app');
      } catch (err) {
        feedback.append(h('p', { class: 'small' }, errorMessage(err)));
      }
      results.push({ item, correct, state });
      const last = i === queue.length - 1;
      feedback.append(
        h('p', { class: `verdict ${correct ? 'good' : 'bad'}` }, correct ? 'Correct' : 'Not quite'),
        item.explanation ? h('p', {}, item.explanation) : null,
        h('p', { class: 'small' }, h('a', { href: hrefFor('read', item.bookId, item.chapterId, item.sectionId) }, `Read this section: ${title}`)),
        h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => { i++; last ? showSummary() : showQuestion(); } },
          last ? 'See results' : 'Next question'));
      feedback.querySelector('.btn-primary').focus({ preventScroll: true });
      feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    optionEls.forEach((el) => el.addEventListener('click', () => answer(Number(el.dataset.k)), { once: true }));

    root.append(
      h('div', { class: 'reader-top' },
        h('a', { class: 'icon-btn', href: backHref, 'aria-label': 'End session' }, '✕'),
        h('span', { class: 'crumb' }, title)),
      h('p', { class: 'quiz-progress' }, `Question ${i + 1} of ${queue.length}`),
      h('p', { class: 'quiz-prompt' }, item.prompt),
      h('ul', { class: 'options' }, optionEls.map((el) => h('li', {}, el))),
      feedback);
    window.scrollTo(0, 0);
  };

  const showSummary = () => {
    clear(root);
    const correct = results.filter((r) => r.correct).length;
    const byDay = new Map();
    for (const r of results) {
      if (!r.state) continue;
      const label = relativeDay(r.state.due);
      byDay.set(label, (byDay.get(label) || 0) + 1);
    }
    root.append(
      h('h1', { class: 'page-title' }, 'Session done'),
      h('div', { class: 'card' },
        h('p', { class: 'summary-score' }, `${correct}/${results.length}`),
        h('p', { class: 'muted' }, 'correct')),
      h('h2', { class: 'section-title' }, 'Coming back'),
      h('ul', { class: 'list' }, [...byDay].map(([label, n]) =>
        h('li', {}, h('div', { class: 'list-row' }, h('span', { class: 'grow' }, `${n} question${n === 1 ? '' : 's'}`), h('span', { class: 'muted' }, label))))),
      h('div', { class: 'stack' },
        h('a', { class: 'btn btn-primary btn-block', href: '#/today' }, 'Back to Today'),
        opts.mode === 'section' ? h('a', { class: 'btn btn-block', href: backHref }, 'Back to the section') : null));
    window.scrollTo(0, 0);
  };

  if (!queue.length) {
    clear(root);
    root.append(
      h('h1', { class: 'page-title' }, 'Nothing due'),
      h('div', { class: 'card empty' },
        h('p', {}, opts.mode === 'section' ? 'This section has no questions yet.' : 'You are done for today. Read a new section to unlock more questions.'),
        h('a', { class: 'btn', href: '#/today' }, 'Back to Today')));
    return;
  }
  await showQuestion();
}

async function sectionTitle(item, cache) {
  if (cache.has(item.sectionKey)) return cache.get(item.sectionKey);
  const ch = await get('chapters', item.chapterKey);
  const title = ch?.sections.find((s) => s.id === item.sectionId)?.title || item.sectionId;
  cache.set(item.sectionKey, title);
  return title;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

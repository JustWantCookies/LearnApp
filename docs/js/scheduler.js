// Spaced repetition, v1: Leitner box ladder.
// Pure functions only — no DOM, no DB — so the algorithm can be swapped (e.g. FSRS) later.

import { addDays } from './dates.js';

export const INTERVALS = [0, 1, 3, 7, 16, 35, 90];
export const MAX_BOX = INTERVALS.length - 1;

export const DEFAULT_CAPS = { newPerDay: 15, reviewsPerDay: 60 };
export const SESSION_SIZE = 10;

export function newState(itemId, today) {
  return { itemId, box: 0, due: today, lapses: 0, lastResult: null, lastReviewed: null, introduced: today };
}

// MCQ: correct → 3, wrong → 0. Explain (graded by Claude): 0–3 as given.
export function normalizeResult(type, raw) {
  if (type === 'mcq') return raw ? 3 : 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 3) throw new RangeError('Result must be an integer 0–3');
  return n;
}

export function applyResult(state, result, today) {
  let { box, lapses } = state;
  if (result >= 2) box = Math.min(box + 1, MAX_BOX);
  else if (result === 1) box = Math.max(box - 1, 1);
  else { box = 1; lapses += 1; }
  return { ...state, box, lapses, lastResult: result, lastReviewed: today, due: addDays(today, INTERVALS[box]) };
}

export function isDue(state, today) {
  return state.due <= today;
}

// How much of today's budget is already used, derived from reviews + log.
export function usageToday({ reviews, log, today }) {
  let newToday = 0;
  const introducedToday = new Set();
  for (const r of reviews) {
    if (r.introduced === today) { newToday++; introducedToday.add(r.itemId); }
  }
  const reviewed = new Set();
  for (const e of log) {
    if (e.day === today && !introducedToday.has(e.itemId)) reviewed.add(e.itemId);
  }
  return { newToday, reviewsToday: reviewed.size };
}

// Picks the items for one session.
// items: [{ id, type, sectionKey, sort }], reviews: Map itemId → state, seen: Set of sectionKeys.
export function selectSession({ items, reviews, seen, today, usage, caps = DEFAULT_CAPS, limit = SESSION_SIZE, type = 'mcq' }) {
  const reviewBudget = Math.max(0, caps.reviewsPerDay - usage.reviewsToday);
  const newBudget = Math.max(0, caps.newPerDay - usage.newToday);

  const due = [];
  const fresh = [];
  for (const item of items) {
    if (item.type !== type) continue;
    const state = reviews.get(item.id);
    if (state) {
      if (isDue(state, today)) due.push({ item, state });
    } else if (seen.has(item.sectionKey)) {
      fresh.push(item);
    }
  }
  due.sort((a, b) => (a.state.due < b.state.due ? -1 : a.state.due > b.state.due ? 1 : a.state.box - b.state.box || a.item.sort - b.item.sort));
  fresh.sort((a, b) => a.sort - b.sort);

  const picked = due.slice(0, Math.min(limit, reviewBudget)).map((d) => d.item.id);
  const room = Math.min(limit - picked.length, newBudget);
  for (const item of fresh.slice(0, Math.max(0, room))) picked.push(item.id);
  return picked;
}

// Number of items a "due" session could serve today (ignores the per-session limit).
export function countAvailable(args) {
  return selectSession({ ...args, limit: Infinity }).length;
}

// Sections where MCQ accuracy over the last `days` days is below threshold.
export function weakSections({ log, items, today, days = 14, threshold = 0.6 }) {
  const since = addDays(today, -days);
  const byId = new Map(items.map((i) => [i.id, i]));
  const stats = new Map();
  for (const e of log) {
    const day = e.day;
    if (day <= since || e.source !== 'app') continue;
    const item = byId.get(e.itemId);
    if (!item || item.type !== 'mcq') continue;
    const s = stats.get(item.sectionKey) || { sectionKey: item.sectionKey, correct: 0, total: 0 };
    s.total++;
    if (e.result >= 2) s.correct++;
    stats.set(item.sectionKey, s);
  }
  return [...stats.values()]
    .filter((s) => s.correct / s.total < threshold)
    .sort((a, b) => a.correct / a.total - b.correct / b.total);
}

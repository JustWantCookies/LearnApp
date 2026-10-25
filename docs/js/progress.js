// Progress data access: reviews, answer log, seen sections, reading positions, settings.

import { withTx, reqP, get, getAll, put, getSetting } from './db.js';
import { todayStr } from './dates.js';
import { applyResult, newState, DEFAULT_CAPS, usageToday } from './scheduler.js';

export async function getCaps() {
  const caps = await getSetting('caps', DEFAULT_CAPS);
  return { ...DEFAULT_CAPS, ...caps };
}

// Applies one result through the scheduler and logs it, atomically.
export async function recordResult(itemId, result, source, today = todayStr()) {
  return withTx(['reviews', 'log'], 'readwrite', async (s) => {
    const prev = (await reqP(s.reviews.get(itemId))) || newState(itemId, today);
    const next = applyResult(prev, result, today);
    await reqP(s.reviews.put(next));
    await reqP(s.log.add({ itemId, ts: new Date().toISOString(), day: today, result, source }));
    return next;
  });
}

export async function markSeen(sectionKey) {
  const existing = await get('seen', sectionKey);
  if (!existing) await put('seen', { key: sectionKey, firstSeen: todayStr() });
}

export async function loadStudyState() {
  const [items, reviewList, seenList, log, caps] = await Promise.all([
    getAll('items'), getAll('reviews'), getAll('seen'), getAll('log'), getCaps(),
  ]);
  const today = todayStr();
  const reviews = new Map(reviewList.map((r) => [r.itemId, r]));
  const seen = new Set(seenList.map((s) => s.key));
  const usage = usageToday({ reviews: reviewList, log, today });
  return { items, reviews, reviewList, seen, log, caps, today, usage };
}

export async function saveReading(bookId, chapterId, sectionId, scrollRatio) {
  await put('reading', { bookId, chapterId, sectionId, scrollRatio, updatedAt: new Date().toISOString() });
}

export async function latestReading() {
  const all = await getAll('reading');
  all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return all[0] || null;
}
